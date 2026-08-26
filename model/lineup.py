"""Lineup construction and trade grading.

The central idea: a trade is worth what it does to your *starting lineup*, not
what it does to the sum of your players' values. Summing player values is how
trade calculators end up telling people that three WR4s beat an elite running
back.
"""

from __future__ import annotations

from dataclasses import dataclass

from .value import GAMES_PER_SEASON, League, Player, vor

FLEX_ELIGIBLE = ("RB", "WR", "TE")
SUPERFLEX_ELIGIBLE = ("QB", "RB", "WR", "TE")

# Per week, in the user's own scoring. Opening guesses -- tune against real trades.
EVEN_THRESHOLD = 0.5
BANDS = (
    (2.0, "Slight edge", "Slight loss"),
    (5.0, "Clear win", "Clear loss"),
    (float("inf"), "Lopsided win", "Lopsided loss"),
)


@dataclass
class Lineup:
    slots: list[tuple[str, Player]]
    bench: list[Player]
    points: float
    unfilled: list[str] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.unfilled is None:
            self.unfilled = []

    def by_slot(self) -> dict[str, Player]:
        return {slot: p for slot, p in self.slots}


def best_lineup(
    roster: list[Player],
    league: League,
    scoring: dict[str, float],
    replacement: dict[str, float] | None = None,
) -> Lineup:
    """Fill the most constrained slots first; that ordering is optimal here.

    Dedicated slots can only take their own position, so they take the best
    available at that position. FLEX then takes the best leftover it is allowed,
    and SUPERFLEX -- the least constrained slot -- goes last.

    An unfilled slot scores at *replacement level*, not zero. Trading away your
    only tight end does not leave the position empty in real life; you stream
    whoever is on waivers. Scoring it as zero makes such trades look
    catastrophic and is the single easiest way to produce a grade nobody
    believes.
    """
    remaining = sorted(roster, key=lambda p: -p.points(scoring))
    slots: list[tuple[str, Player]] = []
    unfilled: list[str] = []

    for pos in ("QB", "TE", "RB", "WR"):
        count = league.starters.get(pos, 0)
        picked = [p for p in remaining if p.pos == pos][:count]
        for i, p in enumerate(picked, start=1):
            label = pos if count == 1 else f"{pos}{i}"
            slots.append((label, p))
        for _ in range(count - len(picked)):
            unfilled.append(pos)
        remaining = [p for p in remaining if p not in picked]

    for i, (count, eligible, stem) in enumerate(
        ((league.flex_slots, FLEX_ELIGIBLE, "FLEX"),
         (league.superflex_slots, SUPERFLEX_ELIGIBLE, "SUPERFLEX"))
    ):
        for n in range(count):
            pick = next((p for p in remaining if p.pos in eligible), None)
            label = stem if count == 1 else f"{stem}{n + 1}"
            if pick is None:
                unfilled.append(stem)
                continue
            slots.append((label, pick))
            remaining.remove(pick)

    points = sum(p.points(scoring) for _, p in slots)
    if replacement:
        points += sum(_replacement_for(slot, replacement) for slot in unfilled)

    return Lineup(slots=slots, bench=remaining, points=points, unfilled=unfilled)


def _stem(slot: str) -> str:
    """'WR3' -> 'WR', 'FLEX2' -> 'FLEX'."""
    return slot.rstrip("0123456789") or slot


def _replacement_for(slot: str, replacement: dict[str, float]) -> float:
    """What a freely-available player at this slot is worth."""
    if slot == "FLEX":
        eligible = FLEX_ELIGIBLE
    elif slot == "SUPERFLEX":
        eligible = SUPERFLEX_ELIGIBLE
    else:
        eligible = (slot,)
    return max((replacement.get(p, 0.0) for p in eligible), default=0.0)


def _depth_value(bench: list[Player], league: League, replacement: dict[str, float]) -> float:
    """Bench players are not worthless -- byes and injuries happen -- but they are
    not worth their face value either. Reported separately, never folded into the
    headline number."""
    return 0.2 * sum(max(vor(p, league, replacement), 0.0) for p in bench)


def band(delta_per_week: float) -> str:
    """Verdicts have a direction. A 5-point loss is not a 'clear win'."""
    magnitude = abs(delta_per_week)
    if magnitude < EVEN_THRESHOLD:
        return "Essentially even"
    for threshold, gain_name, loss_name in BANDS:
        if magnitude < threshold:
            return gain_name if delta_per_week > 0 else loss_name
    return BANDS[-1][1] if delta_per_week > 0 else BANDS[-1][2]


@dataclass
class Grade:
    delta_season: float
    delta_per_week: float
    delta_depth: float
    verdict: str
    direction: str
    before: Lineup
    after: Lineup
    explanation: str


def grade_trade(
    roster: list[Player],
    give: list[Player],
    receive: list[Player],
    league: League,
    replacement: dict[str, float],
) -> Grade:
    scoring = league.scoring

    missing = [p.name for p in give if p not in roster]
    if missing:
        raise ValueError(f"not on the roster: {', '.join(missing)}")

    after_roster = [p for p in roster if p not in give] + list(receive)

    before = best_lineup(roster, league, scoring, replacement)
    after = best_lineup(after_roster, league, scoring, replacement)

    delta_season = after.points - before.points
    delta_week = delta_season / GAMES_PER_SEASON
    delta_depth = _depth_value(after.bench, league, replacement) - _depth_value(
        before.bench, league, replacement
    )

    if abs(delta_week) < EVEN_THRESHOLD:
        direction = "even"
    else:
        direction = "gain" if delta_week > 0 else "loss"

    return Grade(
        delta_season=delta_season,
        delta_per_week=delta_week,
        delta_depth=delta_depth,
        verdict=band(delta_week),
        direction=direction,
        before=before,
        after=after,
        explanation=explain(before, after, delta_week, delta_depth, scoring, replacement),
    )


def explain(
    before: Lineup,
    after: Lineup,
    delta_week: float,
    delta_depth: float,
    scoring: dict[str, float],
    replacement: dict[str, float],
) -> str:
    """Plain English. The number convinces nobody on its own."""
    b, a = before.by_slot(), after.by_slot()

    def slot_points(slot: str, p: Player | None) -> float:
        return p.points(scoring) if p else _replacement_for(_stem(slot), replacement)

    changes = []
    for slot in set(b) | set(a):
        old, new = b.get(slot), a.get(slot)
        if old is new:
            continue
        changes.append((abs(slot_points(slot, new) - slot_points(slot, old)), slot, old, new))

    if delta_week > 0:
        head = f"You gain {delta_week:.1f} points a week."
    elif delta_week < 0:
        head = f"You lose {abs(delta_week):.1f} points a week."
    else:
        head = "Your starting lineup does not change."

    if not changes:
        return head + " Nothing you would start is affected."

    changes.sort(reverse=True, key=lambda c: c[0])
    _, slot, old, new = changes[0]

    def describe(p: Player | None) -> str:
        return f"{p.name} ({p.pos}{p.pos_rank}-level)" if p else "a waiver-level starter"

    lead = "Almost all of it" if len(changes) == 1 else "The biggest move"
    body = f" {lead} is at {slot}: {describe(old)} becomes {describe(new)}."

    tail = ""
    if delta_depth < -3:
        tail = " You are giving up real bench depth to do it — fine if you are set at your starting spots."
    elif delta_depth > 3:
        tail = " You also pick up useful bench depth for byes and injuries."

    return head + body + tail
