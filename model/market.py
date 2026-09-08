"""Tiers: how many players you would not meaningfully choose between.

The finish curve already prices the fact that the drop from the best running back
to the fifth is steeper than the drop from the tenth to the twenty-fifth. What it
cannot say is the thing a fantasy player actually says out loud -- that those two
receivers are "the same tier" and this one is not.

A tier here is a run of consecutive finish ranks whose points span less than one
band's worth of a starting slot. That definition does two jobs at once:

  * It names the shape. Tiers come out narrow at the top and wide in the middle
    for RB, WR and TE, and roughly constant all the way down for QB -- because
    only thirty-two quarterbacks start anywhere, so that curve never flattens.
    Nothing here encodes those shapes; they fall out of the history.

  * It measures replaceability, which is the part the points genuinely cannot
    express. Two RB20s can out-score one RB5 on paper and still be a bad trade,
    because an RB20 is one of nine interchangeable players and an RB5 is one of
    three. The size of a player's tier *is* that number, so it needs no second
    threshold and no second concept.

Everything here is a pure function of the curve, the scoring rules and the
horizon, so it lives client-side for the same reason scoring does: tier
boundaries move with the scoring format, and baking them into players.json would
freeze one league's answer into the data file.
"""

from __future__ import annotations

from dataclasses import dataclass

from .value import GAMES_PER_SEASON

# How far apart two players have to be before they stop being interchangeable,
# in points per week of the user's own scoring.
#
# Anchored to the verdict bands rather than picked: 2.0 is the Slight edge /
# Clear win boundary in `lineup.BANDS`, so crossing one tier at a single starting
# slot is about the difference between those two verdicts. Kept as its own
# constant rather than imported, because `lineup` already depends on this module's
# concerns and the cycle is not worth the shared literal -- `test_market.py`
# asserts the two agree so they cannot drift apart quietly.
TIER_WIDTH_PER_WEEK = 2.0


@dataclass(frozen=True)
class Tier:
    """A run of finish ranks, 1-based and inclusive at both ends."""

    index: int
    start: int
    end: int

    @property
    def size(self) -> int:
        return self.end - self.start + 1


def position_tiers(
    curves,
    pos: str,
    scoring: dict[str, float],
    weeks_covered: float = GAMES_PER_SEASON,
) -> list[Tier]:
    """Cut one position's curve into tiers, best first.

    A tier runs until somebody is more than `TIER_WIDTH_PER_WEEK` a week worse
    than the best player in it -- measured against the tier's own leader rather
    than the previous rank, so a long shallow slope eventually starts a new tier
    instead of drifting forever inside one.

    The width scales with the horizon, so a rest-of-season file produces exactly
    the same tiers as a full-season one. Both the curve and the width are in
    points over the same span, and the two scalings cancel.
    """
    rows = curves.data.get(pos) if hasattr(curves, "data") else curves.get(pos)
    if not rows:
        return []

    points = [curves.points_at(pos, r, scoring) for r in range(1, len(rows) + 1)]
    width = TIER_WIDTH_PER_WEEK * weeks_covered

    tiers: list[Tier] = []
    start = 0
    for i in range(1, len(points)):
        if points[start] - points[i] > width:
            tiers.append(Tier(len(tiers), start + 1, i))
            start = i
    tiers.append(Tier(len(tiers), start + 1, len(points)))
    return tiers


def build_market(curves, league, weeks_covered: float = GAMES_PER_SEASON) -> dict:
    """Tiers for every position the curve knows about, in one object.

    Computed once per league the way replacement level is, and passed alongside
    it. Nothing in here depends on a roster.
    """
    positions = curves.positions if hasattr(curves, "positions") else list(curves)
    return {
        pos: position_tiers(curves, pos, league.scoring, weeks_covered)
        for pos in positions
    }


def tier_at(tiers: list[Tier], rank: int) -> Tier | None:
    """Which tier a positional finish rank falls in.

    Ranks past the end of the curve clamp to the last tier, matching what
    `Curves.at` already does with the projection itself. Pretending to know that
    WR140 is his own tier would be worse than saying he is in the last one.
    """
    if not tiers:
        return None
    for tier in tiers:
        if tier.start <= rank <= tier.end:
            return tier
    return tiers[-1] if rank > tiers[-1].end else tiers[0]


# What counts as a scarce tier, and how lopsided the two sides have to be before
# saying anything. Tuned against the trades in `trades.py`: at 4 and 2.0 the
# sentence fired on 65% of graded cases, which is not a point being made, it is
# background noise. At 3 and 3.0 it fires on the four where replaceability really
# is the argument -- swapping an elite receiver for two good ones, an elite tight
# end for a similarly ranked receiver, and either direction of a bench-for-star
# robbery -- and stays quiet on even swaps, bench shuffles and rank-adjacent
# upgrades.
SCARCE_TIER_SIZE = 3
SCARCITY_RATIO = 3.0

PLURALS = {
    "QB": "quarterbacks",
    "RB": "running backs",
    "WR": "receivers",
    "TE": "tight ends",
}


def _one_of(player, tier, plural: bool) -> str:
    """A tier of one is not "one of 1" -- it is the whole tier."""
    where = f" {PLURALS.get(player.pos, player.pos)}" if plural else ""
    if tier.size == 1:
        return f"{player.name} is alone in his tier"
    return f"{player.name} is one of {tier.size}{where} in his tier"


def describe_scarcity(give, receive, market, scoring, league=None) -> str:
    """One sentence on which side of the trade is harder to replace.

    Deliberately not a number added to anything. The points already say who
    scores more; this says which of them you could go out and find again, and
    that is the part the points genuinely cannot express -- the reason two good
    players are not always worth one great one even when the arithmetic says so.

    Stays quiet unless the asymmetry is real: one side has to sit in a genuinely
    scarce tier and the other in a tier at least twice as deep. On the trades
    where replaceability is not the argument, saying nothing is the right output.
    """
    if not market or not give or not receive:
        return ""

    def headline(players):
        best = max(players, key=lambda p: p.points(scoring))
        return best, tier_at(market.get(best.pos, []), best.pos_rank)

    out_p, out_t = headline(list(give))
    in_p, in_t = headline(list(receive))
    if out_t is None or in_t is None:
        return ""

    small, large = sorted((out_t.size, in_t.size))
    if small > SCARCE_TIER_SIZE or large < small * SCARCITY_RATIO:
        return ""

    # Not at quarterback in a one-QB league. Tier depth says how hard a player is
    # to replace with another rostered player, and at quarterback you do not have
    # to: the next one on waivers is nearly as good, which is exactly what the QB
    # note already tells the reader. Saying both produces two sentences that argue
    # with each other -- "quarterbacks are worth less than their rank suggests"
    # followed by "you are giving up the scarcer player".
    one_qb = league is not None and league.superflex_slots == 0
    if one_qb and "QB" in (out_p.pos, in_p.pos):
        return ""

    lead = (
        "You are giving up the scarcer player"
        if out_t.size < in_t.size
        else "You are getting the scarcer player"
    )
    same_pos = out_p.pos == in_p.pos
    return (
        f" {lead}: {_one_of(out_p, out_t, True)},"
        f" {_one_of(in_p, in_t, not same_pos)}."
    )
