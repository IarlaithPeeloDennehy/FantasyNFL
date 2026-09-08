#!/usr/bin/env python3
"""Does the smoother preserve the shape it is supposed to preserve?

The finish curve is what prices every player in the app, and the top of it is
what prices the players anyone argues about. A smoother that quietly flattens
rank 1 does not fail anything -- it just makes elite players cheaper than they
are, everywhere, forever. So the properties get asserted directly.

Run: python3 test_curves.py
"""

from __future__ import annotations

import json
import pathlib
import sys

from model.curves import SMOOTH_WINDOW, smooth
from model.sources import COMPONENTS
from model.value import HALF_PPR, score

SHIPPED = pathlib.Path("web/public/players.json")

CHECKS = []


def check(fn):
    CHECKS.append(fn)
    return fn


def approx(a: float, b: float, tol: float = 1e-9) -> bool:
    return abs(a - b) <= tol


# ---------------------------------------------------------------- the function


@check
def leaves_the_endpoints_alone():
    """The whole bug. A centred window with nothing to its left averaged rank 1
    with ranks 2 and 3 and called the result rank 1, which on a falling curve is
    biased low by roughly half the local slope."""
    values = [100.0, 80.0, 70.0, 65.0, 63.0, 62.0, 61.0]
    out = smooth(values)
    assert approx(out[0], 100.0), f"rank 1 moved: {out[0]}"
    assert approx(out[-1], 61.0), f"last rank moved: {out[-1]}"
    return "rank 1 and the last rank are untouched"


@check
def widens_symmetrically_from_each_end():
    """Widths run 1, 3, 5, 5, ... A window that is not symmetric about the point
    being smoothed is a biased estimate of it."""
    values = [100.0, 80.0, 70.0, 65.0, 63.0, 62.0, 61.0]
    out = smooth(values)
    assert approx(out[1], sum(values[0:3]) / 3), out[1]
    assert approx(out[2], sum(values[0:5]) / 5), out[2]
    assert approx(out[3], sum(values[1:6]) / 5), out[3]
    return "windows are 1, 3, 5, 5, ... from each end"


@check
def preserves_a_straight_line():
    """A moving average of a linear sequence returns it unchanged, at every
    position including the ends. The old smoother failed this at rank 1, which is
    what made it biased rather than merely noisy."""
    values = [100.0 - 7.0 * i for i in range(20)]
    for i, (got, want) in enumerate(zip(smooth(values), values)):
        assert approx(got, want), f"index {i}: {got} != {want}"
    return "a straight line survives smoothing exactly"


@check
def preserves_the_mean_of_a_flat_line():
    values = [42.0] * 10
    assert all(approx(v, 42.0) for v in smooth(values))
    return "a flat line survives smoothing exactly"


@check
def actually_smooths_the_interior():
    """It still has to do its job: a single spike must be pulled down toward its
    neighbours, or this is a no-op that happens to pass the tests above."""
    values = [10.0, 10.0, 10.0, 60.0, 10.0, 10.0, 10.0]
    out = smooth(values)
    assert out[3] < 30.0, f"spike not pulled down: {out[3]}"
    assert out[3] > 10.0, f"spike flattened away entirely: {out[3]}"
    assert out[2] > 10.0 and out[4] > 10.0, "spike did not spread to its neighbours"
    return f"a spike of 60 is pulled to {out[3]:.0f}"


@check
def survives_sequences_shorter_than_the_window():
    for n in range(1, SMOOTH_WINDOW + 2):
        values = [float(10 - i) for i in range(n)]
        out = smooth(values)
        assert len(out) == n, f"length changed at n={n}"
        assert approx(out[0], values[0]) and approx(out[-1], values[-1])
    return f"lengths 1..{SMOOTH_WINDOW + 1} keep their endpoints"


# ------------------------------------------------------------- the shipped file


def shipped_points(curves, pos):
    return [score(row, HALF_PPR) for row in curves[pos]]


@check
def shipped_curve_falls_at_every_rank():
    """Replacement level is read off this curve at a fractional rank, and value
    above replacement is only meaningful if the curve is monotone. A rise means
    the ranking or the smoothing has gone wrong."""
    curves = json.loads(SHIPPED.read_text(encoding="utf-8"))["curves"]
    for pos in ("QB", "RB", "WR", "TE"):
        pts = shipped_points(curves, pos)
        rises = [i + 1 for i in range(len(pts) - 1) if pts[i + 1] >= pts[i]]
        assert not rises, f"{pos} does not fall at rank(s) {rises[:5]}"
    return "QB/RB/WR/TE all fall at every modelled rank"


@check
def shipped_curve_is_steepest_at_the_top():
    """The property this phase exists to restore, stated as a claim about the
    data rather than about the code: the drop per rank between 1 and 5 is larger
    than between 10 and 25. It was still true before the fix, but only just --
    the smoother had taken 35-47% out of the rank 1-5 gap."""
    curves = json.loads(SHIPPED.read_text(encoding="utf-8"))["curves"]
    for pos in ("RB", "WR", "TE"):
        pts = shipped_points(curves, pos)
        top = (pts[0] - pts[4]) / 4
        mid = (pts[9] - pts[24]) / 15
        assert top > mid * 1.5, f"{pos}: top {top:.1f}/rank vs mid {mid:.1f}/rank"
    return "RB/WR/TE fall >1.5x faster per rank at the top than in the middle"


@check
def shipped_components_are_all_present_and_finite():
    curves = json.loads(SHIPPED.read_text(encoding="utf-8"))["curves"]
    for pos, rows in curves.items():
        for i, row in enumerate(rows):
            missing = [c for c in COMPONENTS if c not in row]
            assert not missing, f"{pos}[{i}] missing {missing}"
            bad = [c for c in COMPONENTS if not isinstance(row[c], (int, float))]
            assert not bad, f"{pos}[{i}] non-numeric {bad}"
    return "every curve row carries every component as a number"


def main() -> int:
    if not SHIPPED.exists():
        print(f"run build_players.py first — {SHIPPED} not found")
        return 1

    failures = 0
    for fn in CHECKS:
        try:
            note = fn()
            print(f"PASS  {fn.__name__:<40} {note}")
        except AssertionError as e:
            failures += 1
            print(f"FAIL  {fn.__name__:<40} {e}")

    print(f"\n{len(CHECKS) - failures}/{len(CHECKS)} curve properties held")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
