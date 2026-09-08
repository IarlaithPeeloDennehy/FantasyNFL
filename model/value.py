"""Scoring rules, replacement level, and value above replacement.

Everything in this module is pure: dicts in, dicts out, no I/O. It is the
reference implementation of what the browser will do in Phase 3, so the JS port
should produce identical numbers on the same inputs.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .sources import COMPONENTS

GAMES_PER_SEASON = 17

# Reference format used to rank historical seasons when building the curves.
# Any consistent format works; half-PPR sits between the extremes.
HALF_PPR = {
    "pass_yd": 0.04,
    "pass_td": 4.0,
    "int": -2.0,
    "rush_att": 0.0,
    "rush_yd": 0.1,
    "rush_td": 6.0,
    "rec": 0.5,
    "rec_yd": 0.1,
    "rec_td": 6.0,
    "fum_lost": -2.0,
}

PPR = {**HALF_PPR, "rec": 1.0}
STANDARD = {**HALF_PPR, "rec": 0.0}

PRESETS = {"ppr": PPR, "half_ppr": HALF_PPR, "standard": STANDARD}


@dataclass(frozen=True)
class League:
    teams: int = 12
    scoring: dict[str, float] = field(default_factory=lambda: dict(HALF_PPR))
    # Dedicated starting slots per position.
    starters: dict[str, int] = field(
        default_factory=lambda: {"QB": 1, "RB": 2, "WR": 3, "TE": 1}
    )
    flex_slots: int = 1
    superflex_slots: int = 0

    # Bench spots for QB/RB/WR/TE only. A real league's roster size also covers
    # kickers and defences, which this model excludes entirely -- so this is the
    # skill-position bench, not the number the platform shows you.
    bench_slots: int = 7

    # How the season is shaped. Needed to say which of the weeks left are still
    # being played for and which are January.
    playoff_spots: int = 6
    regular_season_weeks: int = 14
    playoff_weeks: int = 3

    # How a FLEX spot is actually used, league-wide. An opening guess, not a
    # derived truth -- tune it, but tune it here, in one named place.
    flex_share: dict[str, float] = field(
        default_factory=lambda: {"RB": 0.45, "WR": 0.45, "TE": 0.10}
    )
    # Superflex spots go to a QB the overwhelming majority of the time.
    superflex_share: dict[str, float] = field(
        default_factory=lambda: {"QB": 0.90, "RB": 0.04, "WR": 0.04, "TE": 0.02}
    )


def score(components: dict[str, float], scoring: dict[str, float]) -> float:
    """Fantasy points for one component vector under one set of rules."""
    return sum(components.get(k, 0.0) * scoring.get(k, 0.0) for k in COMPONENTS)


def replacement_rank(pos: str, league: League) -> float:
    """The positional finish rank of the last startable player at this position."""
    dedicated = league.starters.get(pos, 0)
    flex = league.flex_share.get(pos, 0.0) * league.flex_slots
    superflex = league.superflex_share.get(pos, 0.0) * league.superflex_slots
    return league.teams * (dedicated + flex + superflex)


def curve_points(curve, pos: str, rank: float, scoring: dict[str, float]) -> float:
    """Points for a (possibly fractional) positional finish rank."""
    return score(curve.at(pos, rank), scoring)


def replacement_points(curve, league: League) -> dict[str, float]:
    return {
        pos: curve_points(curve, pos, replacement_rank(pos, league), league.scoring)
        for pos in curve.positions
    }


# eq=False on purpose. The JavaScript port compares roster members by object
# identity (`Set`, `includes`), and lineup.py leans on `in` / `not in` to move
# players between roster, slots and bench. A generated __eq__ compares by value,
# so two rows that happen to be identical would be indistinguishable to Python
# and distinct to JavaScript -- a divergence between the reference implementation
# and the port, in the one place the parity fixtures cannot see. Identity in both.
# It also makes Player hashable again, which a value-comparing dataclass is not.
@dataclass(eq=False)
class Player:
    name: str
    pos: str
    team: str
    pos_rank: int
    ecr: float
    proj: dict[str, float]
    gsis_id: str | None = None
    bye: int | None = None

    def points(self, scoring: dict[str, float]) -> float:
        return score(self.proj, scoring)


def vor(player: Player, league: League, replacement: dict[str, float]) -> float:
    return player.points(league.scoring) - replacement.get(player.pos, 0.0)
