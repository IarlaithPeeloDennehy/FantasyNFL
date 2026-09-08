#!/usr/bin/env python3
"""Absence, and the guard against charging for it twice.

The naive version of this feature scales an injured player's projection down by
the fraction of weeks he misses. That says the wrong thing: a back who misses
five of eight weeks is not a mediocre back for eight weeks, he is an elite back
for three and absent for five. Scaled flat, he can lose his starting slot to a
worse player who plays throughout -- which is exactly backwards, because for
three weeks he is the best player on the roster.

Run: python3 test_availability.py
"""

from __future__ import annotations

import sys

from model.lineup import (
    availability_phases,
    grade_trade,
    phase_boundaries,
    phased_lineup,
    weeks_out,
)
from model.sources import COMPONENTS
from model.value import HALF_PPR, League, Player

CHECKS = []


def check(fn):
    CHECKS.append(fn)
    return fn


def player(name: str, pos: str, rec_yd: float) -> Player:
    proj = {c: 0.0 for c in COMPONENTS}
    proj["rec_yd"] = rec_yd
    return Player(
        name=name, pos=pos, team="FA", pos_rank=1, ecr=1.0, proj=proj, gsis_id=name
    )


LEAGUE = League(scoring=dict(HALF_PPR), bench_slots=4)
REPL = {"QB": 100.0, "RB": 100.0, "WR": 100.0, "TE": 100.0}
WEEKS = 8


def starters() -> list[Player]:
    return [
        player("QB1", "QB", 2000),
        player("RB-elite", "RB", 3000), player("RB-ok", "RB", 1800),
        player("WR1", "WR", 2400), player("WR2", "WR", 2000),
        player("WR3", "WR", 1800), player("WR4", "WR", 1600),
        player("TE1", "TE", 2000),
    ]


@check
def weeks_out_reads_the_map_and_refuses_nonsense():
    p = player("A", "WR", 1000)
    assert weeks_out(p, None, False) == 0
    assert weeks_out(p, {}, False) == 0
    assert weeks_out(p, {"A": 5}, False) == 5
    assert weeks_out(p, {"A": -3}, False) == 0
    return "absent, empty and negative all mean available"


@check
def the_ranks_knew_guard_applies_nothing():
    """ADP already prices a known injury: a player who tore something in week 2
    has already fallen down the board, so his rank maps to a lower curve row and
    the projection is discounted once already. Zeroing his weeks on top charges
    twice, and the second charge is invisible."""
    assert weeks_out(player("A", "WR", 1000), {"A": 5}, True) == 0
    return "a known absence is left to the rankings"


@check
def boundaries_are_one_phase_until_somebody_is_out():
    assert phase_boundaries(starters(), None, WEEKS) == [0]
    assert phase_boundaries(starters(), {}, WEEKS) == [0]
    assert phase_boundaries(starters(), {"RB-elite": 5}, WEEKS) == [0, 5]
    assert phase_boundaries(starters(), {"RB-elite": 5, "WR1": 2}, WEEKS) == [0, 2, 5]
    return "one cut per distinct return week, in order"


@check
def a_player_who_never_returns_opens_no_phase():
    assert phase_boundaries(starters(), {"RB-elite": WEEKS}, WEEKS) == [0]
    assert phase_boundaries(starters(), {"RB-elite": 99}, WEEKS) == [0]
    return "out past the horizon is out for good"


@check
def a_phase_holds_a_player_out_of_exactly_the_weeks_he_misses():
    phases = availability_phases(starters(), {"RB-elite": 5}, WEEKS)
    assert [(p.start, p.end) for p in phases] == [(0, 5), (5, WEEKS)]
    assert "RB-elite" not in [p.name for p in phases[0].available]
    assert "RB-elite" in [p.name for p in phases[1].available]
    return "absent for weeks 0-5, back for 5-8"


@check
def phased_lineup_is_best_lineup_when_nobody_is_out():
    """The property that keeps every grade predating this feature unchanged."""
    roster = starters()
    a = phased_lineup(roster, LEAGUE, LEAGUE.scoring, REPL, None, WEEKS)
    b = phased_lineup(roster, LEAGUE, LEAGUE.scoring, REPL, {}, WEEKS)
    assert len(a.phases) == 1
    assert abs(a.points - b.points) < 1e-9
    assert abs(a.points - a.now.points) < 1e-9
    return "one phase, and it is the whole span"


@check
def an_absence_costs_exactly_the_weeks_missed():
    """The gate, as arithmetic. Three eighths of the value -- no more, and
    crucially no less, because for those three weeks he is at full strength."""
    roster = starters()
    healthy = phased_lineup(roster, LEAGUE, LEAGUE.scoring, REPL, None, WEEKS)
    hurt = phased_lineup(roster, LEAGUE, LEAGUE.scoring, REPL, {"RB-elite": 5}, WEEKS)
    expected = (hurt.at(0).points * 5 + hurt.at(1).points * 3) / WEEKS
    assert abs(hurt.points - expected) < 1e-9, (hurt.points, expected)
    assert abs(hurt.at(1).points - healthy.now.points) < 1e-9
    return "weighted by weeks, at full value once back"


@check
def the_elite_player_starts_the_moment_he_returns():
    """Not a scaled-down version of him competing with a healthy lesser player."""
    hurt = phased_lineup(starters(), LEAGUE, LEAGUE.scoring, REPL, {"RB-elite": 5}, WEEKS)
    assert "RB-elite" not in [p.name for _, p in hurt.at(0).slots]
    assert "RB-elite" in [p.name for _, p in hurt.at(1).slots]
    return "benched while out, starting when back"


def _star() -> Player:
    return player("RB-star", "RB", 3400)


@check
def a_trade_is_worth_less_the_longer_the_player_is_out():
    roster = starters()
    give = [next(p for p in roster if p.name == "WR4")]
    grades = [
        grade_trade(roster, give, [_star()], LEAGUE, REPL,
                    weeks_covered=WEEKS, availability=a).delta_per_week
        for a in (None, {"RB-star": 2}, {"RB-star": 6})
    ]
    assert grades[0] > grades[1] > grades[2], grades
    return " > ".join(f"{g:.2f}" for g in grades)


@check
def the_sentence_describes_the_stretch_the_trade_changes():
    """The bug before the two sides shared phase boundaries: in week one nothing
    moves, so `explain` reported "your starting lineup does not change" for a
    trade that upgrades your best slot the moment he is back."""
    roster = starters()
    give = [next(p for p in roster if p.name == "WR4")]
    g = grade_trade(roster, give, [_star()], LEAGUE, REPL,
                    weeks_covered=WEEKS, availability={"RB-star": 5})
    assert "does not change" not in g.explanation, g.explanation
    assert "RB-star misses 5 of the next 8 weeks" in g.explanation
    assert "RB-star" in [p.name for _, p in g.after.slots]
    assert "RB-star" not in [p.name for _, p in g.after_now.slots]
    return "headline phase is the one after he returns"


@check
def out_for_the_season_is_said_that_way():
    roster = starters()
    give = [next(p for p in roster if p.name == "WR4")]
    g = grade_trade(roster, give, [_star()], LEAGUE, REPL,
                    weeks_covered=WEEKS, availability={"RB-star": WEEKS})
    assert "RB-star is out for the season" in g.explanation
    assert "misses" not in g.explanation
    return "no counting to the horizon"


@check
def the_guard_reproduces_the_healthy_grade_exactly():
    """End to end: if the rankings already knew, the grade must be identical to
    one with no absence declared at all -- same number, same sentence."""
    roster = starters()
    give = [next(p for p in roster if p.name == "WR4")]
    healthy = grade_trade(roster, give, [_star()], LEAGUE, REPL, weeks_covered=WEEKS)
    guarded = grade_trade(roster, give, [_star()], LEAGUE, REPL, weeks_covered=WEEKS,
                          availability={"RB-star": 5}, ranks_knew=True)
    assert abs(guarded.delta_season - healthy.delta_season) < 1e-9
    assert guarded.verdict == healthy.verdict
    assert guarded.explanation == healthy.explanation
    assert guarded.phases == 1
    return "identical number and identical sentence"


@check
def an_absence_does_not_decide_who_gets_cut():
    """Who is worth keeping is a question about the season; who plays this week is
    not. A team does not release its best back because he is hurt in October."""
    tight = League(scoring=dict(HALF_PPR), bench_slots=0)
    full = starters() + [player("WR-spare", "WR", 1500), player("WR-junk", "WR", 900)]
    g = grade_trade(full, [], [], tight, REPL,
                    weeks_covered=WEEKS, availability={"RB-elite": 6})
    assert "RB-elite" not in [p.name for p in g.cuts], [p.name for p in g.cuts]
    return "the injured star survives the roster crunch"


def main() -> int:
    failures = 0
    for fn in CHECKS:
        try:
            note = fn()
            print(f"PASS  {fn.__name__:<50} {note}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {fn.__name__:<50} {e}")

    print(f"\n{len(CHECKS) - failures}/{len(CHECKS)} availability properties held")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
