#!/usr/bin/env python3
"""Emit players.json — the data contract between the Python build and the client.

    python3 build_players.py                     # build to the default path
    python3 build_players.py --source ffc        # use FFC ADP instead of consensus ECR
    python3 build_players.py --check web/public/players.json   # validate an existing file

Exits non-zero on any validation failure. That is deliberate: a failed build in
CI leaves the last good file live, and stale data always beats wrong data.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import sys

from model import schema
from model.build import build_universe, name_match_quality
from model.sources import COMPONENTS, load_player_ids, load_rankings

DEFAULT_OUT = pathlib.Path("web/public/players.json")

SOURCE_LABELS = {
    "fantasypros": "FantasyPros consensus via DynastyProcess mirror",
    "ffc": "fantasyfootballcalculator.com",
}


def build_document(args: argparse.Namespace) -> tuple[dict, object, list]:
    u = build_universe(source=args.source, teams=args.teams)

    weeks = args.weeks_remaining
    if args.basis == "rest_of_season":
        if weeks is None:
            raise SystemExit("--basis rest_of_season requires --weeks-remaining")
        scale = weeks / 17.0
    else:
        scale = 1.0

    # A player with no nflverse id has no stable key for roster URLs or storage,
    # so it cannot ship. Dropping is fine deep in the pool and unacceptable near
    # the top; either way it is logged, never silent.
    resolved = [p for p in u.players if p.gsis_id]
    dropped = [p for p in u.players if not p.gsis_id]
    near_top = [p for p in dropped if p.ecr <= args.drop_guard]
    if near_top:
        raise SystemExit(
            f"\n  ABORT: {len(near_top)} player(s) inside consensus rank "
            f"{args.drop_guard} have no nflverse id:\n    "
            + "\n    ".join(f"{p.name} ({p.pos}, rank {p.ecr:.0f})" for p in near_top)
            + "\n\n  A missing star is a credibility problem that surfaces later as a"
            "\n  bug report. Fix the crosswalk before shipping."
        )

    players = []
    for p in resolved:
        proj = {k: round(v * scale, 2) for k, v in p.proj.items()}
        row = {
            "id": p.gsis_id,
            "name": p.name,
            "pos": p.pos,
            "team": p.team,
            "adp": round(p.ecr, 2),
            "pos_adp_rank": p.pos_rank,
            "proj": proj,
        }
        if p.bye:
            row["bye"] = p.bye
        last = u.last_season.get(p.gsis_id or "")
        if last:
            row["last_season"] = {
                k: round(v, 2) for k, v in last.items() if v or k == "games"
            }
        players.append(row)

    doc = {
        "schema_version": schema.SCHEMA_VERSION,
        "generated_at": dt.datetime.now(dt.timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z"),
        "season": args.season,
        "basis": args.basis,
        "weeks_remaining": weeks if args.basis == "rest_of_season" else None,
        "curve_meta": {
            "seasons_used": u.curves.seasons,
            "reference_scoring": u.curves.reference_scoring,
            "components": list(COMPONENTS),
        },
        # The client needs the curve to price replacement level at a fractional
        # rank (a 12-team league replaces RB at rank 29.4). It cannot rebuild the
        # curve from `players`: id-less players are dropped, which leaves gaps in
        # pos_adp_rank, and a league can be deep enough that replacement level
        # falls past the last ranked player. So the curve ships explicitly.
        "curves": {
            pos: [
                {k: round(v * scale, 2) for k, v in row.items()}
                for row in u.curves.data[pos]
            ]
            for pos in u.curves.positions
        },
        "sources": {
            "ranks": SOURCE_LABELS.get(u.source, u.source),
            "ranks_as_of": u.scrape_date,
            "stats": "nflverse",
            "ids": "DynastyProcess crosswalk",
        },
        "players": players,
    }
    return doc, u, dropped


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=pathlib.Path, default=DEFAULT_OUT)
    ap.add_argument("--source", choices=("fantasypros", "ffc"), default="fantasypros")
    ap.add_argument("--season", type=int, default=dt.date.today().year)
    ap.add_argument("--basis", choices=("full_season", "rest_of_season"), default="full_season")
    ap.add_argument("--weeks-remaining", type=int, default=None)
    ap.add_argument("--teams", type=int, default=12, help="only affects FFC ADP pool")
    ap.add_argument("--drop-guard", type=float, default=200.0,
                    help="abort if an unresolved player sits inside this consensus rank")
    ap.add_argument("--check", type=pathlib.Path, help="validate an existing file and exit")
    ap.add_argument("--probe-name-matching", action="store_true",
                    help="dry-run the name-only join an id-less source would need")
    args = ap.parse_args()

    if args.check:
        doc = json.loads(args.check.read_text(encoding="utf-8"))
        problems = schema.validate(doc)
        _report(args.check, doc, problems)
        return 1 if problems else 0

    if args.probe_name_matching:
        return _probe()

    print(f"Building from {args.source}...")
    doc, u, dropped = build_document(args)

    print(f"  ranks as of      {u.scrape_date}")
    print(f"  players          {len(doc['players'])}")
    print(f"  ids by shared id {u.join.by_id}")
    print(f"  ids by name      {u.join.by_name}")
    if dropped:
        print(f"  DROPPED          {len(dropped)} with no nflverse id "
              f"(deepest kept rank {max(p.ecr for p in u.players if p.gsis_id):.0f})")
        for p in dropped:
            print(f"    - {p.name} ({p.pos}, consensus rank {p.ecr:.0f})")

    problems = schema.validate(doc)
    if problems:
        _report(args.out, doc, problems)
        print("\nNothing written. Fix the source before shipping this file.")
        return 1

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(doc, separators=(",", ":")), encoding="utf-8")

    size_kb = args.out.stat().st_size / 1024
    print(f"\n  wrote {args.out}  ({size_kb:.0f} KB)")
    print(f"  generated_at {doc['generated_at']}  basis {doc['basis']}")
    return 0


def _probe() -> int:
    """Measure how good a name-only join is, using the id join as ground truth.

    This is the readiness check for switching to an ADP source that carries no
    shared player id, so it has to be able to say *no*. It exits non-zero when a
    miss lands inside the top TOP_N_MUST_RESOLVE, which is exactly the condition
    the build itself refuses to ship: a deep miss is a shrug, a missing star is a
    credibility problem.
    """
    rankings = load_rankings()
    crosswalk = load_player_ids()
    matched, total, misses = name_match_quality(rankings, crosswalk)

    cutoff = schema.TOP_N_MUST_RESOLVE
    blocking = [m for m in misses if m["ecr"] <= cutoff]

    print("Name-only join dry run (what an id-less ADP source would face)")
    print(f"  matched {matched}/{total}  ({matched / total:.1%})")
    print(f"  misses among the whole pool: {len(misses)}")
    for m in misses[:15]:
        print(f"    {m['name']} ({m['pos']}, consensus rank {m['ecr']:.0f})")
    if len(misses) > 15:
        print(f"    ... and {len(misses) - 15} more")

    if blocking:
        print()
        print(f"  NOT READY: {len(blocking)} miss(es) inside consensus rank {cutoff}:")
        for m in blocking:
            print(f"    - {m['name']} ({m['pos']}, rank {m['ecr']:.0f})")
        print()
        print("  Add them to sources.ALIASES before switching to an id-less source.")
        return 1

    print()
    print(f"  READY: no misses inside consensus rank {cutoff}.")
    return 0


def _report(path: pathlib.Path, doc: dict, problems: list[str]) -> None:
    print(f"\nValidating {path}")
    print(f"  schema_version {doc.get('schema_version')}  "
          f"generated_at {doc.get('generated_at')}  "
          f"players {len(doc.get('players', []))}")
    if not problems:
        print("  OK — no problems found")
        return
    print(f"\n  {len(problems)} problem(s):")
    for p in problems:
        print(f"    - {p}")


if __name__ == "__main__":
    sys.exit(main())
