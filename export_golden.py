#!/usr/bin/env python3
"""Export golden fixtures for the JavaScript engine's parity test.

The Python model is the reference implementation. This writes what it computes
for a spread of leagues, rosters and trades; the JS test asserts it produces the
same numbers from the same players.json.

    python3 export_golden.py
"""

from __future__ import annotations

import json
import pathlib
import sys

from model.fromfile import load_document, weeks_covered
from model.lineup import band, grade_trade
from model.value import PRESETS, League, replacement_points, vor
from trades import ROSTER, TRADES

PLAYERS = pathlib.Path("web/public/players.json")
OUT = pathlib.Path("web/src/engine/__tests__/golden.json")

# A rest-of-season file scales every projection *and* every curve row by
# weeks_remaining/17, so the per-week number should come out the same as the
# full-season file's. What must not happen is dividing by 17 regardless, which
# is what the client used to do -- see PLAN-v2.md D1. Graded here at several
# horizons against the shipped (full-season) file, which isolates the divisor
# from the scaling.
HORIZONS = (17, 14, 8, 3, 1)

LEAGUES = {
    "standard-12": {},
    "ppr-12": {"scoring": "ppr"},
    "std-scoring-12": {"scoring": "standard"},
    "shallow-8": {"teams": 8},
    "deep-14": {"teams": 14},
    "superflex-12": {"superflex_slots": 1},
    "two-flex-10": {"teams": 10, "flex_slots": 2},
    "te-premium-shape": {"starters": {"QB": 1, "RB": 2, "WR": 2, "TE": 2}},
    # A short bench turns every uneven trade into a forced drop, which is the
    # only way the cut selector gets exercised across all twelve trades.
    "tight-bench-12": {"bench_slots": 2},
    "no-bench-12": {"bench_slots": 0},
}


def make_league(spec: dict) -> League:
    kwargs = dict(spec)
    scoring = kwargs.pop("scoring", "half_ppr")
    return League(scoring=dict(PRESETS[scoring]), **kwargs)


def league_payload(spec: dict) -> dict:
    """The same configuration, in the shape the JS engine takes."""
    lg = make_league(spec)
    return {
        "teams": lg.teams,
        "scoring": lg.scoring,
        "starters": lg.starters,
        "flexSlots": lg.flex_slots,
        "superflexSlots": lg.superflex_slots,
        "benchSlots": lg.bench_slots,
        "flexShare": lg.flex_share,
        "superflexShare": lg.superflex_share,
    }


def main() -> int:
    if not PLAYERS.exists():
        print(f"run build_players.py first — {PLAYERS} not found")
        return 1

    players, curves, _doc = load_document(PLAYERS)
    by_name = {p.name: p for p in players}

    missing = [n for n in ROSTER if n not in by_name]
    if missing:
        print(f"roster names not in players.json: {missing}")
        return 1

    roster = [by_name[n] for n in ROSTER]

    cases = []
    for league_name, spec in LEAGUES.items():
        lg = make_league(spec)
        repl = replacement_points(curves, lg)

        top = sorted(players, key=lambda p: -vor(p, lg, repl))[:25]

        trade_results = []
        for t in TRADES:
            if any(n not in by_name for n in t["give"] + t["receive"]):
                continue
            g = grade_trade(
                roster,
                [by_name[n] for n in t["give"]],
                [by_name[n] for n in t["receive"]],
                lg,
                repl,
            )
            trade_results.append({
                "id": t["id"],
                "cuts": [p.name for p in g.cuts],
                "spotsFreed": g.spots_freed,
                "overBefore": g.over_before,
                "give": t["give"],
                "receive": t["receive"],
                "deltaSeason": g.delta_season,
                "deltaPerWeek": g.delta_per_week,
                "deltaDepth": g.delta_depth,
                "verdict": g.verdict,
                "direction": g.direction,
                "explanation": g.explanation,
                "beforePoints": g.before.points,
                "afterPoints": g.after.points,
                "beforeSlots": [[s, p.name] for s, p in g.before.slots],
                "afterSlots": [[s, p.name] for s, p in g.after.slots],
            })

        cases.append({
            "name": league_name,
            "league": league_payload(spec),
            "replacementPoints": repl,
            "topVor": [
                {"name": p.name, "points": p.points(lg.scoring), "vor": vor(p, lg, repl)}
                for p in top
            ],
            "trades": trade_results,
        })

    # One league, one roster, several horizons. Small on purpose: this exists to
    # pin the divisor, and the leagues above already cover everything else.
    lg = make_league({})
    repl = replacement_points(curves, lg)
    horizons = []
    for weeks in HORIZONS:
        for t in TRADES:
            if any(n not in by_name for n in t["give"] + t["receive"]):
                continue
            g = grade_trade(
                roster,
                [by_name[n] for n in t["give"]],
                [by_name[n] for n in t["receive"]],
                lg,
                repl,
                weeks,
            )
            horizons.append({
                "id": t["id"],
                "cuts": [p.name for p in g.cuts],
                "spotsFreed": g.spots_freed,
                "overBefore": g.over_before,
                "weeksCovered": weeks,
                "give": t["give"],
                "receive": t["receive"],
                "deltaSeason": g.delta_season,
                "deltaPerWeek": g.delta_per_week,
                "verdict": g.verdict,
                "direction": g.direction,
                "explanation": g.explanation,
            })

    bands = [
        {"delta": d, "verdict": band(d)}
        for d in (-9.0, -5.0, -4.9, -2.0, -1.9, -0.6, -0.5, -0.49, 0.0,
                  0.49, 0.5, 0.6, 1.9, 2.0, 4.9, 5.0, 9.0)
    ]

    payload = {
        "note": "Generated by export_golden.py. The Python model is the reference "
                "implementation; the JS engine must reproduce these exactly.",
        "roster": ROSTER,
        "weeksCovered": weeks_covered(_doc),
        "bands": bands,
        "cases": cases,
        "horizonLeague": league_payload({}),
        "horizons": horizons,
    }

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(payload, indent=1), encoding="utf-8")

    trades = sum(len(c["trades"]) for c in cases)
    print(f"wrote {OUT}")
    print(f"  {len(cases)} leagues x {trades // len(cases)} trades = {trades} graded cases")
    print(f"  {sum(len(c['topVor']) for c in cases)} VOR values, {len(bands)} band boundaries")
    print(f"  {len(horizons)} graded cases across horizons {HORIZONS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
