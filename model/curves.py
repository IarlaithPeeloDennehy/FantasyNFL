"""Positional finish curves in component space.

For each position and each finish rank, what did the player who finished there
actually do? Averaged over recent seasons and smoothed.

Building the curve in *component* space rather than points space is what lets the
browser re-score for any league format. A points-space curve would bake half-PPR
into the data file forever.
"""

from __future__ import annotations

from dataclasses import dataclass

import polars as pl

from .sources import COMPONENTS
from .value import score

# How deep to model each position. Past these ranks the sample is noise and
# nobody is trading the players anyway.
MAX_RANK = {"QB": 40, "RB": 80, "WR": 100, "TE": 40}

SMOOTH_WINDOW = 5


@dataclass
class Curves:
    """curve[pos][rank] -> component vector. Ranks are 1-based and contiguous."""

    data: dict[str, list[dict[str, float]]]
    seasons: list[int]
    reference_scoring: str

    @property
    def positions(self) -> list[str]:
        return list(self.data.keys())

    def at(self, pos: str, rank: float) -> dict[str, float]:
        """Component vector at a possibly-fractional rank, linearly interpolated.

        Ranks past the end of the curve clamp to the last modelled rank. That is a
        deliberate floor: we do not pretend to know what WR140 does.
        """
        rows = self.data[pos]
        if not rows:
            return {c: 0.0 for c in COMPONENTS}
        idx = max(1.0, min(float(rank), float(len(rows))))
        lo = int(idx)
        hi = min(lo + 1, len(rows))
        frac = idx - lo
        a, b = rows[lo - 1], rows[hi - 1]
        return {c: a[c] + (b[c] - a[c]) * frac for c in COMPONENTS}

    def points_at(self, pos: str, rank: float, scoring: dict[str, float]) -> float:
        return score(self.at(pos, rank), scoring)


def build_curves(stats: pl.DataFrame, scoring: dict[str, float], label: str) -> Curves:
    seasons = sorted(stats["season"].unique().to_list())

    ranked = (
        stats.with_columns(
            sum(pl.col(c) * scoring.get(c, 0.0) for c in COMPONENTS).alias("ref_points")
        )
        .with_columns(
            pl.col("ref_points")
            .rank("ordinal", descending=True)
            .over(["season", "pos"])
            .cast(pl.Int32)
            .alias("finish_rank")
        )
        .filter(
            pl.col("finish_rank")
            <= pl.col("pos").replace_strict(MAX_RANK, default=0).cast(pl.Int32)
        )
    )

    # Average each component across seasons at the same finish rank.
    averaged = (
        ranked.group_by(["pos", "finish_rank"])
        .agg([pl.col(c).mean().alias(c) for c in COMPONENTS])
        .sort(["pos", "finish_rank"])
    )

    # Smooth across neighbouring ranks. Season-to-season noise at a single rank is
    # large; the underlying shape is not.
    smoothed = averaged.with_columns(
        [
            pl.col(c)
            .rolling_mean(window_size=SMOOTH_WINDOW, min_samples=1, center=True)
            .over("pos")
            .alias(c)
            for c in COMPONENTS
        ]
    )

    data: dict[str, list[dict[str, float]]] = {}
    for pos in MAX_RANK:
        rows = smoothed.filter(pl.col("pos") == pos).sort("finish_rank")
        data[pos] = [
            {c: float(r[c]) for c in COMPONENTS} for r in rows.iter_rows(named=True)
        ]

    return Curves(data=data, seasons=seasons, reference_scoring=label)
