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

# How much bench-depth movement is worth a sentence. Unlike the bands above this
# is a *season-scale* quantity, so it has to be rescaled for a rest-of-season
# file or the sentence appears and disappears depending on what week it is.
DEPTH_NOTE_THRESHOLD = 3.0


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
    weeks_covered: float = GAMES_PER_SEASON,
) -> Grade:
    """`weeks_covered` is how many weeks the projections span -- 17 for a
    full-season file, `weeks_remaining` for a rest-of-season one. Use
    `model.fromfile.weeks_covered` to read it off the document rather than
    passing a literal; the default is here so a full-season caller need not."""
    scoring = league.scoring

    missing = [p.name for p in give if p not in roster]
    if missing:
        raise ValueError(f"not on the roster: {', '.join(missing)}")

    after_roster = [p for p in roster if p not in give] + list(receive)

    before = best_lineup(roster, league, scoring, replacement)
    after = best_lineup(after_roster, league, scoring, replacement)

    delta_season = after.points - before.points
    delta_week = delta_season / weeks_covered
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
        explanation=explain(
            before, after, delta_week, delta_depth, scoring, replacement,
            league, give, receive, weeks_covered,
        ),
    )


def explain(
    before: Lineup,
    after: Lineup,
    delta_week: float,
    delta_depth: float,
    scoring: dict[str, float],
    replacement: dict[str, float],
    league: League | None = None,
    give: list[Player] | tuple = (),
    receive: list[Player] | tuple = (),
    weeks_covered: float = GAMES_PER_SEASON,
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

    if not changes:
        # No slot changed hands, so the delta is exactly zero and there is
        # nothing to describe. Said plainly, without a number.
        return "Your starting lineup does not change. Nothing you would start is affected."

    # Branch on the *rendered* number, not the raw one. A delta of +0.034 renders
    # as "0.0", and "You gain 0.0 points a week" reads as a bug to the user even
    # though the arithmetic is right. Both implementations branch on the string
    # so they cannot disagree about a rounding boundary.
    shown = f"{abs(delta_week):.1f}"
    if shown == "0.0":
        head = "Your starting lineup shifts by less than a tenth of a point a week."
    elif delta_week > 0:
        head = f"You gain {shown} points a week."
    else:
        head = f"You lose {shown} points a week."

    changes.sort(reverse=True, key=lambda c: c[0])

    # Name the slot the *trade* moved, not merely the slot that moved most.
    #
    # Trading for a better RB1 pushes your old RB1 down to RB2, and that
    # knock-on is often the larger single delta -- so ranking by magnitude alone
    # describes the cascade and never mentions the player you just acquired. The
    # sentence is true and answers a question nobody asked. Prefer the slot an
    # acquired player landed in; failing that, the slot a departing player left.
    # Which end of the trade to describe follows the direction of the verdict. On
    # a gain the reader wants to know where the player they acquired landed; on a
    # loss they want to know what left. Preferring the acquired player either way
    # produces "you lose 3.3 points a week" followed by a description of an
    # upgrade, which reads as the app contradicting itself.
    received, given = set(receive), set(give)
    landed = [c for c in changes if c[3] in received]
    departed = [c for c in changes if c[2] in given]
    primary, secondary = (landed, departed) if delta_week >= 0 else (departed, landed)
    _, slot, old, new = (primary or secondary or changes)[0]
    cascade_only = not landed and not departed

    def describe(p: Player | None) -> str:
        return f"{p.name} ({p.pos}{p.pos_rank}-level)" if p else "a waiver-level starter"

    # "Almost all of it" needs a quantity to refer back to, and the sub-tenth
    # head does not give it one.
    if shown == "0.0":
        lead = "The move"
    elif cascade_only:
        lead = "The knock-on"
    elif len(changes) == 1:
        lead = "Almost all of it"
    else:
        lead = "The move that matters"
    body = f" {lead} is at {slot}: {describe(old)} becomes {describe(new)}."

    # The QB problem. In a one-QB league an elite quarterback carries almost no
    # value above replacement, which is arithmetically right and socially
    # explosive -- users read it as the app being broken. Carry the scarcity
    # argument in the sentence rather than leaving the number to defend itself.
    tail = ""
    one_qb = league is not None and league.superflex_slots == 0
    if one_qb and any(p.pos == "QB" for p in list(give) + list(receive)):
        tail += (
            " Quarterbacks are worth less here than their rankings suggest: only one"
            " starts per team, so the next one on waivers is much closer to yours"
            " than the gap in rank implies."
        )

    # `delta_depth` is measured over whatever span the projections cover, so the
    # threshold has to move with it. A fixed 3.0 would make this sentence roughly
    # twice as hard to trigger on a week-10 file as on a preseason one, for a
    # roster change that is identical in weekly terms.
    depth_note = DEPTH_NOTE_THRESHOLD * (weeks_covered / GAMES_PER_SEASON)
    if delta_depth < -depth_note:
        tail += " You are giving up real bench depth to do it — fine if you are set at your starting spots."
    elif delta_depth > depth_note:
        tail += " You also pick up useful bench depth for byes and injuries."

    return head + body + tail
