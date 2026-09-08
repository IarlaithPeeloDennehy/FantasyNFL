#!/usr/bin/env python3
"""Playoff odds, week weights, and the second number they produce.

The thing being guarded here is not accuracy -- every game is a coin flip and the
model says so -- but honesty of shape. A record has to change which weeks count
and nothing else. If a future change starts scaling players instead, or lets the
situational number quietly replace the fair one, these fail.

Run: python3 test_odds.py
"""

from __future__ import annotations

import sys

from model.lineup import grade_trade
from model.odds import (
    at_least,
    cutline,
    is_degenerate,
    outlook,
    playoff_start,
    weighted_weeks,
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
WEEKS = 14


def starters() -> list[Player]:
    return [
        player("QB1", "QB", 2000),
        player("RB-elite", "RB", 3000), player("RB-ok", "RB", 1800),
        player("WR1", "WR", 2400), player("WR2", "WR", 2000),
        player("WR3", "WR", 1800), player("WR4", "WR", 1600),
        player("TE1", "TE", 2000),
    ]


@check
def at_least_is_an_exact_binomial_tail():
    assert at_least(0, 0) == 1.0
    assert at_least(4, 0) == 1.0
    assert at_least(4, 5) == 0.0
    assert at_least(4, 4) == 1 / 16
    assert at_least(4, 2) == 11 / 16
    assert abs(at_least(10, 5) - 0.623046875) < 1e-12
    return "exact fractions, no approximation"


@check
def the_cutline_moves_with_how_many_qualify():
    """Six of twelve is about a .500 season; four of twelve is not. Hardcoding
    "eight wins" would be right for one league and wrong for the next."""
    assert cutline(12, 6, 14) == 8
    assert cutline(12, 4, 14) == 9
    assert cutline(12, 10, 14) < cutline(12, 4, 14)
    return "8 wins for 6 of 12, 9 for 4 of 12"


@check
def a_worse_record_means_worse_odds():
    odds = [outlook(w, l).odds for w, l in ((3, 0), (2, 1), (1, 2), (0, 3))]
    assert odds == sorted(odds, reverse=True), odds
    return " > ".join(f"{o:.0%}" for o in odds)


@check
def a_contender_values_january_and_a_straggler_values_now():
    """The whole point. Not asserted as thresholds -- asserted as the comparison
    between two teams, because the claim is that they differ."""
    losing = outlook(0, 3)
    winning = outlook(3, 0)
    assert losing.leans_win_now, losing
    assert not winning.leans_win_now, winning
    ratio_l = losing.playoff_weight / losing.regular_weight
    ratio_w = winning.playoff_weight / winning.regular_weight
    assert ratio_w > ratio_l * 3, (ratio_l, ratio_w)
    return f"January is worth {ratio_l:.1f}x a regular week at 0-3, {ratio_w:.1f}x at 3-0"


@check
def leverage_vanishes_once_the_season_is_settled():
    """A team that has clinched has nothing left to win, and one eliminated has
    nothing left to lose. Both have zero regular-season leverage, for opposite
    reasons, and neither is a bug."""
    clinched = outlook(12, 1)
    dead = outlook(1, 12)
    assert clinched.regular_weight == 0.0, clinched
    assert dead.regular_weight == 0.0, dead
    assert clinched.odds == 1.0 and dead.odds == 0.0
    return "0 leverage at 12-1 and at 1-12"


@check
def the_playoff_split_always_adds_up():
    """Including the mildly contradictory input where a full-season file is
    graded against a team that has already played three games."""
    for weeks, rec in ((17, (0, 0)), (17, (0, 3)), (14, (0, 3)), (8, (5, 4)),
                       (3, (9, 5)), (1, (13, 0)), (14, (13, 1))):
        start = playoff_start(weeks, *rec)
        assert 0 <= start <= weeks, (weeks, rec, start)
    return "no split falls outside the span"


@check
def a_dead_season_is_degenerate_rather_than_a_nan():
    """Both weights zero means the weighting has no opinion. Dividing by it would
    report NaN as a recommendation."""
    dead = outlook(1, 12)
    assert is_degenerate(dead, 14, playoff_start(14, 1, 12))
    healthy = outlook(2, 1)
    assert not is_degenerate(healthy, 14, playoff_start(14, 2, 1))
    return "eliminated -> fall back, mid-season -> weight"


def _sell_injured_star():
    """Your original scenario: a high-value player who is hurt until January."""
    roster = starters()
    star = next(p for p in roster if p.name == "RB-elite")
    return roster, [star], [player("WR-in", "WR", 2100)], {"RB-elite": 11}


@check
def the_same_trade_lands_on_opposite_sides_of_even():
    """The gate. Selling a star who is back only for January is a good trade for
    a team that will not be there and a bad one for a team that will."""
    roster, give, recv, avail = _sell_injured_star()
    grades = {}
    for rec in ((0, 3), (3, 0)):
        g = grade_trade(roster, give, recv, LEAGUE, REPL, weeks_covered=WEEKS,
                        availability=avail, record=rec)
        grades[rec] = g
    losing, winning = grades[(0, 3)], grades[(3, 0)]

    # The trade has not changed -- only who is being offered it.
    assert abs(losing.delta_per_week - winning.delta_per_week) < 1e-9
    assert losing.situational_per_week > winning.situational_per_week
    return (f"fair {losing.delta_per_week:+.2f} for both; "
            f"{losing.situational_per_week:+.2f} at 0-3 vs "
            f"{winning.situational_per_week:+.2f} at 3-0")


@check
def january_matters_more_the_likelier_you_are_to_be_there():
    """Monotone in the odds. A model that merely flipped around would pass the
    test above by accident."""
    roster, give, recv, avail = _sell_injured_star()
    values = []
    for rec in ((0, 3), (1, 2), (2, 1), (3, 0)):
        g = grade_trade(roster, give, recv, LEAGUE, REPL, weeks_covered=WEEKS,
                        availability=avail, record=rec)
        values.append(g.situational_per_week)
    assert values == sorted(values, reverse=True), values
    return " > ".join(f"{v:+.2f}" for v in values)


@check
def no_record_changes_absolutely_nothing():
    """The default. A record is not something to invent on the user's behalf."""
    roster, give, recv, avail = _sell_injured_star()
    plain = grade_trade(roster, give, recv, LEAGUE, REPL, weeks_covered=WEEKS,
                        availability=avail)
    assert plain.situational_per_week is None
    assert plain.situational_verdict is None
    assert plain.outlook is None
    with_rec = grade_trade(roster, give, recv, LEAGUE, REPL, weeks_covered=WEEKS,
                           availability=avail, record=(2, 1))
    assert abs(with_rec.delta_season - plain.delta_season) < 1e-9
    assert with_rec.verdict == plain.verdict
    return "fair value and verdict are untouched by a record"


@check
def an_eliminated_team_gets_the_fair_number_and_no_second_one():
    roster, give, recv, avail = _sell_injured_star()
    g = grade_trade(roster, give, recv, LEAGUE, REPL, weeks_covered=WEEKS,
                    availability=avail, record=(1, 12))
    assert g.outlook is not None and g.outlook.odds == 0.0
    assert g.situational_per_week is None, g.situational_per_week
    assert g.verdict is not None
    return "no NaN, no second opinion, the fair grade stands"


@check
def a_clinched_team_is_graded_on_january_alone():
    """Regular-season leverage is zero once you are in, so only the playoff weeks
    carry any weight -- and a player who returns for exactly those weeks is worth
    his full value to that team."""
    roster, give, recv, avail = _sell_injured_star()
    g = grade_trade(roster, give, recv, LEAGUE, REPL, weeks_covered=WEEKS,
                    availability=avail, record=(12, 1))
    healthy = grade_trade(roster, give, recv, LEAGUE, REPL, weeks_covered=WEEKS)
    assert abs(g.situational_per_week - healthy.delta_per_week) < 1e-9, (
        g.situational_per_week, healthy.delta_per_week
    )
    return "selling him costs a clinched team his full value"


def main() -> int:
    failures = 0
    for fn in CHECKS:
        try:
            note = fn()
            print(f"PASS  {fn.__name__:<48} {note}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {fn.__name__:<48} {e}")

    print(f"\n{len(CHECKS) - failures}/{len(CHECKS)} record properties held")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
