"""Playoff odds, and what they say about which weeks are worth anything.

The point of this module is to make a trade grade differently for a team that is
0-3 than for one that is 3-0, without inventing a fudge factor to do it. The plan
is blunt about why that matters: a multiplier -- "you are 0-3, so multiply
win-now assets by 1.3" -- is unfalsifiable and unexplainable, and it launders a
bad trade instead of pricing one.

So nothing here scales a player. What changes is **which weeks count**, and by
how much, and both weights are probabilities with a plain-English meaning:

    regular-season week   how much this game still decides your season
                          = P(playoffs | you win it) - P(playoffs | you lose it)

    playoff week          how likely you are to be playing at all
                          = P(playoffs)

A contender has little left to settle in the regular season and is very likely to
play in January, so its playoff weeks dominate. A team fighting to stay alive has
every regular-season game swinging its odds and is unlikely to see the playoffs
at all, so the two come out close to level -- which is the same thing as saying a
player who only helps you in January is worth much less to it.

Everything is a coin flip. Team strength beyond the record is not modelled, and
saying so is cheaper than pretending: with three games played, a record is mostly
noise, and the difference between 18% and 22% odds does not change any
recommendation.
"""

from __future__ import annotations

from dataclasses import dataclass
from math import comb

# A fantasy regular season is usually fourteen weeks with three of playoffs, but
# both are league settings rather than facts, so these are only the defaults.
REGULAR_SEASON_WEEKS = 14
PLAYOFF_WEEKS = 3


def at_least(games: int, wins: int) -> float:
    """P(at least `wins` from `games` coin flips).

    Written as an exact sum of binomial terms rather than an approximation. At
    seventeen games that is eighteen terms, the coefficients are small integers,
    and the divisor is a power of two -- so every term is exactly representable
    and the JavaScript port produces bit-identical results by summing in the same
    order.
    """
    if wins <= 0:
        return 1.0
    if wins > games:
        return 0.0
    total = 0.0
    for k in range(wins, games + 1):
        total += comb(games, k)
    return total / (2.0**games)


def cutline(teams: int, spots: int, games: int) -> int:
    """How many wins it takes to make the playoffs.

    The smallest win total at which no more than `spots` teams are expected to
    reach it. Derived from the same coin-flip assumption as everything else,
    rather than hardcoded, because the answer genuinely differs: six of twelve is
    about a .500 season, four of twelve is not.
    """
    for wins in range(games + 1):
        if teams * at_least(games, wins) <= spots:
            return wins
    return games + 1


@dataclass(frozen=True)
class Outlook:
    """What a record implies, and what it makes each kind of week worth."""

    odds: float
    regular_weight: float
    playoff_weight: float
    cutline: int
    games_left: int

    @property
    def leans_win_now(self) -> bool:
        """True when the regular season is worth more per week than January."""
        return self.regular_weight > self.playoff_weight


def outlook(
    wins: int,
    losses: int,
    teams: int = 12,
    spots: int = 6,
    regular_weeks: int = REGULAR_SEASON_WEEKS,
) -> Outlook:
    """Playoff odds and week weights for one record.

    `games_left` is derived from the record rather than from the data file. A
    team that says it is 0-3 has played three games, whatever basis the shipped
    projections happen to use, and taking its word is more robust than trying to
    reconcile the two.
    """
    played = max(0, wins + losses)
    left = max(0, regular_weeks - played)
    line = cutline(teams, spots, regular_weeks)

    odds = at_least(left, line - wins)
    # The value of the game in front of you: the gap between winning it and
    # losing it. Zero for a team that has already clinched and for one already
    # eliminated, largest for a team whose season is genuinely in the balance.
    if left > 0:
        won = at_least(left - 1, line - wins - 1)
        lost = at_least(left - 1, line - wins)
        regular = won - lost
    else:
        regular = 0.0

    return Outlook(
        odds=odds,
        regular_weight=regular,
        playoff_weight=odds,
        cutline=line,
        games_left=left,
    )


def playoff_start(
    weeks_covered: float,
    wins: int,
    losses: int,
    regular_weeks: int = REGULAR_SEASON_WEEKS,
    playoff_weeks: int = PLAYOFF_WEEKS,
) -> int:
    """Weeks elapsed at which the remaining span turns into the playoffs.

    Everything before this is a regular-season week and everything from here on
    is a playoff week. Derived from the record for the same reason `outlook` is,
    and clamped so that any combination of a record and a horizon produces a
    split that adds up -- including the mildly contradictory one where a
    full-season file is graded against a team that has already played three.
    """
    total = int(weeks_covered)
    regular_left = min(max(regular_weeks - max(0, wins + losses), 0), total)
    playoff_left = min(playoff_weeks, total - regular_left)
    return total - playoff_left


def week_weight(week: int, start: int, view: Outlook) -> float:
    """What a point in this week is worth, as weeks elapsed."""
    return view.playoff_weight if week >= start else view.regular_weight


def weighted_weeks(start: int, end: int, playoffs_at: int, view: Outlook) -> float:
    """The weight of a stretch of weeks [start, end), split at the playoff line."""
    regular = max(0, min(end, playoffs_at) - start)
    return regular * view.regular_weight + (end - start - regular) * view.playoff_weight


def is_degenerate(view: Outlook, weeks_covered: float, playoffs_at: int) -> bool:
    """True when every week left is worth exactly nothing.

    Two real records do this. A team already eliminated has no odds and nothing
    left to play for, so both weights are zero. A team already clinched has
    nothing left to settle in the regular season, so if the horizon holds no
    playoff weeks its weights are zero too.

    Neither means "this trade is worth nothing" -- it means the weighting has no
    opinion, and the caller should fall back to counting every week equally
    rather than dividing by zero and reporting a NaN as a recommendation.
    """
    return weighted_weeks(0, int(weeks_covered), playoffs_at, view) <= 0
