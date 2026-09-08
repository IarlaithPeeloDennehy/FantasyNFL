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


def smooth(values: list[float], window: int = SMOOTH_WINDOW) -> list[float]:
    """Centred moving average whose window shrinks to fit near either end.

    The obvious implementation -- a fixed-width centred window that simply
    averages whatever falls inside it -- is badly wrong at the top of the curve,
    which is the one place the curve most needs to be right.

    At rank 1 a five-wide centred window has nothing to its left, so it averages
    ranks 1, 2 and 3 and calls the result rank 1. The curve is at its steepest
    there, so this is not a small correction: measured against the 2023-25
    seasons it pulled RB1 down 32 points, TE1 down 28, and compressed the gap
    between rank 1 and rank 5 by 35-47% at every position. A one-sided average
    of a falling curve is a biased estimate of its endpoint, and the bias is
    largest exactly where the slope is.

    Shrinking the window keeps it symmetric about the point being smoothed, so
    the estimate stays unbiased all the way to the edge. Rank 1 is left alone
    entirely: with no neighbours on one side there is no symmetric window, and
    the honest answer is the historical average itself. That gives up noise
    reduction on a single value to avoid a systematic error many times larger.

    Widths run 1, 3, 5, 5, ... from each end.
    """
    half = window // 2
    n = len(values)
    out = []
    for i in range(n):
        # min(i, n - 1 - i) is the distance to the nearer end, and so the widest
        # half-window that still has neighbours on both sides.
        w = min(half, i, n - 1 - i)
        chunk = values[i - w : i + w + 1]
        out.append(sum(chunk) / len(chunk))
    return out


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
    # large; the underlying shape is not. Done component by component in plain
    # Python rather than as a polars rolling expression, because the edge
    # handling is the whole point here and `smooth` can be read and tested on
    # its own.
    data: dict[str, list[dict[str, float]]] = {}
    for pos in MAX_RANK:
        rows = averaged.filter(pl.col("pos") == pos).sort("finish_rank")
        columns = {c: smooth(rows[c].to_list()) for c in COMPONENTS}
        data[pos] = [
            {c: columns[c][i] for c in COMPONENTS} for i in range(rows.height)
        ]

    return Curves(data=data, seasons=seasons, reference_scoring=label)
