#!/usr/bin/env python3
"""Does the roster limit behave, and does the reference implementation agree?

The JavaScript port has its own behavioural suite in
web/src/engine/__tests__/roster.test.js, and the golden fixtures pin the two
against each other. This file covers the same properties on the Python side, so
a change made here fails here rather than only surfacing as a parity diff with no
explanation attached.

Run: python3 test_roster.py
"""

from __future__ import annotations

import sys

from model.lineup import (
    DEPTH_DECAY,
    DEPTH_WEIGHT,
    best_lineup,
    depth_value,
    enforce_limit,
    grade_trade,
    roster_limit,
    starting_slots,
    uncovered_positions,
)
from model.sources import COMPONENTS
from model.value import HALF_PPR, League, Player

CHECKS = []


def check(fn):
    CHECKS.append(fn)
    return fn


def player(name: str, pos: str, rec_yd: float) -> Player:
    """Points come only from receiving yards, so they read at a glance."""
    proj = {c: 0.0 for c in COMPONENTS}
    proj["rec_yd"] = rec_yd
    return Player(name=name, pos=pos, team="FA", pos_rank=1, ecr=1.0, proj=proj)


# 1QB / 2RB / 3WR / 1TE / 1FLEX = 8 starting slots, plus 2 bench = 10.
LEAGUE = League(scoring=dict(HALF_PPR), bench_slots=2)
REPL = {"QB": 100.0, "RB": 100.0, "WR": 100.0, "TE": 100.0}


def starters() -> list[Player]:
    return [
        player("QB-good", "QB", 2000),
        player("RB-good", "RB", 2000), player("RB-ok", "RB", 1800),
        player("WR-best", "WR", 2400), player("WR-good", "WR", 2000),
        player("WR-ok", "WR", 1800), player("WR-flex", "WR", 1600),
        player("TE-good", "TE", 2000),
    ]


@check
def limit_is_starters_plus_bench():
    assert starting_slots(LEAGUE) == 8, starting_slots(LEAGUE)
    assert roster_limit(LEAGUE) == 10, roster_limit(LEAGUE)
    assert roster_limit(League(scoring=dict(HALF_PPR), bench_slots=0)) == 8
    return "8 starting slots + 2 bench = 10"


@check
def depth_decays_down_a_position():
    """Four spare receivers are not four times as useful as one. A flat weight is
    how a roster gets valued for hoarding."""
    bench = [player(f"WR-b{i}", "WR", 2000) for i in range(3)]
    got = depth_value(bench, LEAGUE, REPL)
    want = DEPTH_WEIGHT * 100 * (1 + DEPTH_DECAY + DEPTH_DECAY**2)
    assert abs(got - want) < 1e-9, f"{got} != {want}"
    assert got < DEPTH_WEIGHT * 300
    return f"three equal backups are worth {got:.0f}, not {DEPTH_WEIGHT * 300:.0f}"


@check
def depth_does_not_decay_across_positions():
    spread = [player("WR-b", "WR", 2000), player("RB-b", "RB", 2000),
              player("TE-b", "TE", 2000)]
    got = depth_value(spread, LEAGUE, REPL)
    assert abs(got - DEPTH_WEIGHT * 300) < 1e-9, got
    return "each position has its own depth chart"


@check
def depth_ignores_players_below_replacement():
    scrubs = [player("WR-scrub", "WR", 500), player("RB-scrub", "RB", 900)]
    assert depth_value(scrubs, LEAGUE, REPL) == 0.0
    return "a below-replacement bench is worth nothing, not something small"


@check
def a_legal_roster_is_left_alone():
    roster = starters()
    kept, cut = enforce_limit(roster, LEAGUE, REPL)
    assert cut == [] and kept == roster
    return "no cuts, same order"


@check
def cuts_the_cheapest_first_and_only_as_many_as_needed():
    roster = starters() + [
        player("WR-junk", "WR", 1100),
        player("WR-worse", "WR", 1050),
        player("WR-spare", "WR", 1900),
        player("WR-extra", "WR", 1850),
    ]
    kept, cut = enforce_limit(roster, LEAGUE, REPL)
    assert [p.name for p in cut] == ["WR-worse", "WR-junk"], [p.name for p in cut]
    assert len(kept) == roster_limit(LEAGUE)
    return "two over -> two cuts, worst first"


@check
def a_starting_slot_outranks_the_bench():
    """Nothing tells the selector that tight ends are special. Dropping the only
    one empties a starting slot down to replacement level, and the arithmetic
    notices on its own."""
    roster = starters() + [
        player("WR-spare", "WR", 2200),
        player("WR-extra", "WR", 2100),
        player("WR-third", "WR", 2050),
    ]
    _, cut = enforce_limit(roster, LEAGUE, REPL)
    assert "TE" not in [p.pos for p in cut], [p.name for p in cut]
    return "the only tight end survives three better receivers"


@check
def cover_is_read_off_the_bench_not_counted_against_starters():
    """Four receivers against a requirement of three looks covered until you
    notice the fourth is in the flex."""
    lineup = best_lineup(starters(), LEAGUE, LEAGUE.scoring, REPL)
    assert [p.pos for p in starters()].count("WR") == 4
    assert LEAGUE.starters["WR"] == 3
    assert "WR" in uncovered_positions(lineup, LEAGUE)
    withcover = best_lineup(
        starters() + [player("QB-back", "QB", 1500)], LEAGUE, LEAGUE.scoring, REPL
    )
    assert "QB" not in uncovered_positions(withcover, LEAGUE)
    return "a flex-filling fourth receiver is not cover"


@check
def a_three_for_one_is_charged_for_what_it_cannot_keep():
    """The bug this phase exists for. The roster used to simply grow."""
    roster = starters() + [player("WR-bench1", "WR", 1900), player("WR-bench2", "WR", 1850)]
    give = [next(p for p in roster if p.name == "WR-flex")]
    receive = [player("WR-in1", "WR", 1700), player("WR-in2", "WR", 1650),
               player("WR-in3", "WR", 1620)]
    g = grade_trade(roster, give, receive, LEAGUE, REPL)
    assert len(g.cuts) == 2, [p.name for p in g.cuts]
    assert len(g.after.slots) + len(g.after.bench) == roster_limit(LEAGUE)
    assert "two over the roster limit" in g.explanation
    for p in g.cuts:
        assert p.name in g.explanation
    return "two over, two named cuts, roster stays legal"


@check
def a_bench_only_trade_still_reports_its_cuts():
    """The path that used to fall silent. No starting slot changes, so `explain`
    returned early and never mentioned that two players had to go."""
    roster = starters() + [player("WR-bench1", "WR", 1200), player("WR-bench2", "WR", 1150)]
    give = [next(p for p in roster if p.name == "WR-bench1")]
    receive = [player("WR-in1", "WR", 1150), player("WR-in2", "WR", 1100)]
    g = grade_trade(roster, give, receive, LEAGUE, REPL)
    assert g.cuts, "expected a forced cut"
    assert "does not change" in g.explanation
    assert "roster limit" in g.explanation or "over the limit" in g.explanation
    return "lineup unchanged, cuts still named"


@check
def a_pre_existing_overflow_is_not_blamed_on_the_trade():
    """A player traded for himself must not report five forced cuts as though the
    trade caused them."""
    roster = starters() + [player(f"WR-x{i}", "WR", 1200 - i * 10) for i in range(5)]
    same = next(p for p in roster if p.name == "WR-flex")
    g = grade_trade(roster, [same], [same], LEAGUE, REPL)
    assert g.over_before == len(g.cuts), (g.over_before, len(g.cuts))
    assert "already" in g.explanation, g.explanation
    assert "You would be" not in g.explanation
    return f"{g.over_before} pre-existing cuts, reported as pre-existing"


@check
def freeing_spots_is_said_out_loud():
    roster = starters() + [player("WR-bench1", "WR", 1900), player("WR-bench2", "WR", 1850)]
    give = [next(p for p in roster if p.name == n)
            for n in ("WR-bench1", "WR-bench2", "WR-flex")]
    g = grade_trade(roster, give, [player("WR-star", "WR", 2600)], LEAGUE, REPL)
    assert g.cuts == [] and g.spots_freed == 2
    assert "frees two roster spots" in g.explanation
    return "3-for-1 frees two spots"


def main() -> int:
    failures = 0
    for fn in CHECKS:
        try:
            note = fn()
            print(f"PASS  {fn.__name__:<48} {note}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {fn.__name__:<48} {e}")

    print(f"\n{len(CHECKS) - failures}/{len(CHECKS)} roster properties held")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
