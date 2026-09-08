#!/usr/bin/env python3
"""Tiers, and the scarcity argument they support.

The first attempt at this looked for unusually large rank-over-rank drops against
a local median. It found nothing, and the reason is worth keeping: Phase 1
smoothed the curve on purpose, so there are no cliffs left to detect. A tier is
not a gap in the data. It is a statement about indifference -- these players are
close enough that you would not care which you had -- and that has to be defined
in points, not found in slopes.

Run: python3 test_market.py
"""

from __future__ import annotations

import pathlib
import sys

from model.fromfile import load_document
from model.lineup import BANDS
from model.market import (
    SCARCE_TIER_SIZE,
    TIER_WIDTH_PER_WEEK,
    build_market,
    describe_scarcity,
    position_tiers,
    tier_at,
)
from model.sources import COMPONENTS
from model.value import GAMES_PER_SEASON, HALF_PPR, PPR, STANDARD, League, Player

SHIPPED = pathlib.Path("web/public/players.json")
POSITIONS = ("QB", "RB", "WR", "TE")

CHECKS = []


def check(fn):
    CHECKS.append(fn)
    return fn


_players, CURVES, _doc = load_document(SHIPPED)
LEAGUE = League()


def player(name: str, pos: str, rank: int, rec_yd: float) -> Player:
    proj = {c: 0.0 for c in COMPONENTS}
    proj["rec_yd"] = rec_yd
    return Player(name=name, pos=pos, team="FA", pos_rank=rank, ecr=float(rank), proj=proj)


@check
def the_width_is_anchored_not_picked():
    """Defined in market.py rather than imported from lineup.py, because lineup
    imports market and the cycle is not worth the shared literal. This is the
    guard that stops the two drifting apart in silence."""
    assert TIER_WIDTH_PER_WEEK == BANDS[0][0], (TIER_WIDTH_PER_WEEK, BANDS[0][0])
    return f"{TIER_WIDTH_PER_WEEK} is the Slight edge / Clear win boundary"


@check
def tiers_partition_each_curve_exactly():
    for pos in POSITIONS:
        tiers = position_tiers(CURVES, pos, HALF_PPR)
        assert tiers[0].start == 1, pos
        assert tiers[-1].end == len(CURVES.data[pos]), pos
        for i, t in enumerate(tiers):
            assert t.index == i and t.size == t.end - t.start + 1
            if i:
                assert t.start == tiers[i - 1].end + 1, (pos, i)
    return "contiguous, 1-based, covering every modelled rank"


@check
def nobody_in_a_tier_is_more_than_the_width_off_its_best():
    width = TIER_WIDTH_PER_WEEK * GAMES_PER_SEASON
    for pos in POSITIONS:
        for t in position_tiers(CURVES, pos, HALF_PPR):
            span = CURVES.points_at(pos, t.start, HALF_PPR) - CURVES.points_at(
                pos, t.end, HALF_PPR
            )
            assert span <= width + 1e-9, (pos, t, span)
    return f"every tier spans at most {width:.0f} points"


@check
def tiers_do_not_move_with_the_horizon():
    """The Phase 0 lesson applied. A rest-of-season file scales the curve and the
    width by the same factor, so the two cancel. If they did not, a trade would
    change tier in week 10 for no football reason."""
    from model.curves import Curves

    for weeks in (14, 8, 3, 1):
        k = weeks / GAMES_PER_SEASON
        scaled = Curves(
            data={
                pos: [{c: v * k for c, v in row.items()} for row in rows]
                for pos, rows in CURVES.data.items()
            },
            seasons=CURVES.seasons,
            reference_scoring=CURVES.reference_scoring,
        )
        for pos in POSITIONS:
            a = [(t.start, t.end) for t in position_tiers(scaled, pos, HALF_PPR, weeks)]
            b = [(t.start, t.end) for t in position_tiers(CURVES, pos, HALF_PPR)]
            assert a == b, (pos, weeks)
    return "14, 8, 3 and 1 weeks give the same tiers as a full season"


@check
def tiers_move_with_the_scoring_format():
    """Which is why they are computed client-side rather than shipped in
    players.json: baking them in would freeze one league's answer for everyone."""
    ppr = [t.end for t in position_tiers(CURVES, "WR", PPR)]
    std = [t.end for t in position_tiers(CURVES, "WR", STANDARD)]
    assert ppr != std
    return f"WR has {len(ppr)} tiers in PPR, {len(std)} in standard"


def _widening(pos: str) -> float:
    """How much wider a position's tiers get between its top and its middle."""
    sizes = [t.size for t in position_tiers(CURVES, pos, HALF_PPR)]
    mean = lambda xs: sum(xs) / len(xs)  # noqa: E731
    return mean(sizes[3:5]) / mean(sizes[:2])


@check
def rb_wr_te_tiers_widen_sharply_down_the_curve():
    ratios = {pos: _widening(pos) for pos in ("RB", "WR", "TE")}
    for pos, r in ratios.items():
        assert r > 3, (pos, r)
    return " ".join(f"{p} {r:.1f}x" for p, r in ratios.items())


@check
def qb_is_the_flattest_of_the_four():
    """The gate. Only thirty-two quarterbacks start anywhere, so that curve keeps
    falling and its tiers never widen the way the others do. Asserted as a
    comparison rather than against a threshold of its own: the claim is that the
    shapes *differ*, and two independent constants could drift until they no
    longer said that. Nothing in the code knows QB is special."""
    qb = _widening("QB")
    others = [_widening(p) for p in ("RB", "WR", "TE")]
    assert qb < min(others), (qb, others)
    assert min(others) > qb * 1.5, (qb, others)
    return f"QB {qb:.1f}x against a next-flattest of {min(others):.1f}x"


@check
def the_top_of_every_position_is_scarce():
    for pos in POSITIONS:
        t = tier_at(position_tiers(CURVES, pos, HALF_PPR), 1)
        assert t.size <= SCARCE_TIER_SIZE, (pos, t)
    return "rank 1 sits in a small tier at QB, RB, WR and TE"


@check
def wr_ten_to_twenty_five_share_a_tier_but_one_to_five_do_not():
    """The user's own example, as a property of the shipped curve."""
    tiers = position_tiers(CURVES, "WR", HALF_PPR)
    assert tier_at(tiers, 1).index != tier_at(tiers, 5).index
    assert tier_at(tiers, 10).index == tier_at(tiers, 25).index
    return "WR1 and WR5 are different tiers; WR10 and WR25 are the same one"


@check
def tier_at_clamps_past_the_end_of_the_curve():
    """Same floor `Curves.at` uses. Claiming WR140 is his own tier would be a
    worse answer than putting him in the last one."""
    tiers = position_tiers(CURVES, "WR", HALF_PPR)
    assert tier_at(tiers, 999).index == tiers[-1].index
    assert tier_at([], 1) is None
    return "rank 999 lands in the last tier, not a new one"


@check
def scarcity_stays_quiet_when_both_sides_are_replaceable():
    market = build_market(CURVES, LEAGUE)
    out = describe_scarcity(
        [player("A", "WR", 15, 1900)], [player("B", "WR", 16, 1890)], market, LEAGUE.scoring
    )
    assert out == "", out
    return "an even swap gets no sentence"


@check
def scarcity_names_the_side_holding_the_rarer_player():
    market = build_market(CURVES, LEAGUE)
    star, ordinary = player("Star", "WR", 1, 3000), player("Ord", "WR", 15, 1900)
    giving = describe_scarcity([star], [ordinary], market, LEAGUE.scoring)
    getting = describe_scarcity([ordinary], [star], market, LEAGUE.scoring)
    assert "giving up the scarcer player" in giving, giving
    assert "getting the scarcer player" in getting, getting
    return "direction follows which side the scarce player is on"


@check
def scarcity_says_nothing_about_quarterbacks_in_a_one_qb_league():
    """Tier depth says how hard a player is to replace with another rostered
    player. At quarterback you do not have to -- the next one on waivers is nearly
    as good, which is what the QB note already says. Both sentences together
    argue with each other."""
    market = build_market(CURVES, LEAGUE)
    qb, ord_ = player("Passer", "QB", 1, 4000), player("Ord", "WR", 15, 1900)
    assert LEAGUE.superflex_slots == 0
    assert describe_scarcity([qb], [ord_], market, LEAGUE.scoring, LEAGUE) == ""
    sf = League(superflex_slots=1)
    assert "scarcer player" in describe_scarcity([qb], [ord_], market, sf.scoring, sf)
    return "silent in 1QB, spoken in superflex"


@check
def scarcity_compares_the_best_player_on_each_side():
    market = build_market(CURVES, LEAGUE)
    out = describe_scarcity(
        [player("Scrub", "WR", 40, 500), player("Star", "WR", 1, 3000)],
        [player("Ord", "WR", 15, 1900)],
        market,
        LEAGUE.scoring,
    )
    assert "Star" in out and "Scrub" not in out, out
    return "a throw-in does not become the headline"


def main() -> int:
    if not SHIPPED.exists():
        print(f"run build_players.py first — {SHIPPED} not found")
        return 1

    failures = 0
    for fn in CHECKS:
        try:
            note = fn()
            print(f"PASS  {fn.__name__:<52} {note}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {fn.__name__:<52} {e}")

    print(f"\n{len(CHECKS) - failures}/{len(CHECKS)} market properties held")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
