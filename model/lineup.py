"""Lineup construction and trade grading.

The central idea: a trade is worth what it does to your *starting lineup*, not
what it does to the sum of your players' values. Summing player values is how
trade calculators end up telling people that three WR4s beat an elite running
back.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .market import describe_scarcity, tier_at
from .odds import Outlook, is_degenerate, outlook, playoff_start, weighted_weeks
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

# What a bench spot is worth relative to a starting one, and how fast that falls
# down a position's depth chart. Opening guesses, tuned in one named place.
DEPTH_WEIGHT = 0.2
DEPTH_DECAY = 0.5

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


def depth_value(bench: list[Player], league: League, replacement: dict[str, float]) -> float:
    """What a bench is actually worth to you.

    Bench players are not worthless -- byes and injuries happen -- but they are
    not worth their face value either, and they are not worth it in equal
    measure. The first backup at a position covers a bye and the first injury.
    The third covers the case where two things have already gone wrong, which is
    most of a season away from mattering. A flat weight over the whole bench says
    a fourth spare receiver is as useful as a first, and that is how a roster gets
    valued for hoarding.

    So the weight decays down each position's own depth chart. Positions are
    walked in name order and each position's values in descending order, so the
    floating-point summation is identical here and in the JavaScript port rather
    than merely close.

    Reported separately, never folded into the headline number.
    """
    by_pos: dict[str, list[float]] = {}
    for p in bench:
        v = vor(p, league, replacement)
        if v > 0:
            by_pos.setdefault(p.pos, []).append(v)

    total = 0.0
    for pos in sorted(by_pos):
        for i, v in enumerate(sorted(by_pos[pos], reverse=True)):
            total += DEPTH_WEIGHT * (DEPTH_DECAY**i) * v
    return total


def weeks_out(player: Player, availability: dict | None, ranks_knew: bool) -> int:
    """How many of the remaining weeks this player misses.

    `ranks_knew` is the double-count guard, and it is the whole reason this is
    not simply a dictionary lookup.

    Average draft position already prices in known injuries -- `PLAN.md` says so
    and it is true. A player who tore something in week 2 has already fallen down
    the consensus board, so his `pos_adp_rank` maps to a lower curve row and his
    projection is *already* discounted for the games he will miss. Zeroing those
    weeks on top of that charges for the same injury twice, and the second charge
    is invisible: the number just comes out too low.

    We cannot detect this from the data. The document records `ranks_as_of` but
    not when anybody got hurt, and no arithmetic recovers a pre-injury rank from a
    post-injury one. So it is asked rather than guessed: the UI shows the ranking
    date beside the control, and if the rankings already knew, the projection is
    left exactly as it is.
    """
    if ranks_knew or not availability:
        return 0
    return max(0, int(availability.get(player.gsis_id or player.name, 0)))


@dataclass(frozen=True)
class Phase:
    """A stretch of weeks over which the same players are available.

    `start` is weeks elapsed, so the first phase always starts at 0.
    """

    start: int
    end: int
    available: tuple

    @property
    def weeks(self) -> int:
        return self.end - self.start


def phase_boundaries(
    players: list[Player],
    availability: dict | None,
    weeks_covered: float,
    ranks_knew: bool = False,
) -> list[int]:
    """The weeks at which the available set changes, as weeks elapsed.

    Computed over both sides of a trade together so the two rosters are cut at the
    same places. Without that the phases do not line up and there is no honest way
    to say which stretch of the season the trade actually changes.
    """
    total = int(weeks_covered)
    cuts = {0}
    for p in players:
        out = min(weeks_out(p, availability, ranks_knew), total)
        if out > 0:
            cuts.add(out)
    return sorted(x for x in cuts if x < total) or [0]


def availability_phases(
    roster: list[Player],
    availability: dict | None,
    weeks_covered: float,
    ranks_knew: bool = False,
    boundaries: list[int] | None = None,
) -> list[Phase]:
    """Split the remaining season where the available set changes.

    A player out for five weeks does not make your roster uniformly worse for the
    whole span -- he makes it much worse for five weeks and no worse afterwards.
    Scaling his projection down by five-eighths would say the first thing when the
    truth is the second, and would let an elite back who misses half the run be
    benched behind a mediocre one who plays throughout.

    So the span is cut at every return date and a lineup is built for each piece.
    Almost always that is one piece, and with a single injury it is two.
    """
    total = int(weeks_covered)
    starts = (
        boundaries
        if boundaries is not None
        else phase_boundaries(roster, availability, weeks_covered, ranks_knew)
    )
    phases = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else total
        phases.append(
            Phase(
                start=start,
                end=end,
                available=tuple(
                    p
                    for p in roster
                    if weeks_out(p, availability, ranks_knew) <= start
                ),
            )
        )
    return phases


@dataclass
class PhasedLineup:
    """What a roster is worth once absences are taken into account.

    `points` is the season total, each phase's lineup weighted by how many weeks
    it covers. `now` is the lineup you would actually field this week, which is
    what the UI shows -- a weighted average of lineups is a number, not a team.
    """

    points: float
    phases: list[tuple[Phase, Lineup]]

    @property
    def now(self) -> Lineup:
        return self.phases[0][1]

    def at(self, index: int) -> Lineup:
        return self.phases[index][1]


def phased_lineup(
    roster: list[Player],
    league: League,
    scoring: dict[str, float],
    replacement: dict[str, float],
    availability: dict | None = None,
    weeks_covered: float = GAMES_PER_SEASON,
    ranks_knew: bool = False,
    boundaries: list[int] | None = None,
) -> PhasedLineup:
    """`best_lineup` over each phase, weighted by the weeks the phase covers.

    With nobody unavailable this is one phase covering the whole span, and the
    result is exactly `best_lineup` -- which is what keeps every grade that
    predates availability unchanged.
    """
    out = []
    total = 0.0
    for phase in availability_phases(
        roster, availability, weeks_covered, ranks_knew, boundaries
    ):
        lineup = best_lineup(list(phase.available), league, scoring, replacement)
        out.append((phase, lineup))
        total += lineup.points * (phase.weeks / weeks_covered)
    return PhasedLineup(points=total, phases=out)


def starting_slots(league: League) -> int:
    return sum(league.starters.values()) + league.flex_slots + league.superflex_slots


def roster_limit(league: League) -> int:
    """How many QB/RB/WR/TE a team may hold at once."""
    return starting_slots(league) + league.bench_slots


def roster_value(
    roster: list[Player], league: League, replacement: dict[str, float]
) -> float:
    """The whole roster in one number: what it starts, plus what its bench is
    worth. Only used to rank one roster against another, never reported."""
    lineup = best_lineup(roster, league, league.scoring, replacement)
    return lineup.points + depth_value(lineup.bench, league, replacement)


def enforce_limit(
    roster: list[Player], league: League, replacement: dict[str, float]
) -> tuple[list[Player], list[Player]]:
    """Cut down to the roster limit, cheapest player first.

    Receiving more players than you send means somebody gets dropped, and until
    this existed the model simply let the roster grow -- so a 3-for-1 improved
    your bench score by counting two players you could not legally keep. That is
    the same error as summing player values, one level down.

    Greedy, and exact rather than heuristic: at each step it actually rebuilds
    the lineup without each candidate and drops whichever loses least. At fifteen
    players and two or three cuts that is a few hundred lineup builds, which is
    nothing, and it means positional insurance needs no special case. Cutting
    your only quarterback empties a starting slot down to replacement level, and
    the arithmetic notices without being told that quarterbacks are special.

    Ties keep the earlier player in roster order, in both implementations.

    :returns: (kept, cut) -- `cut` in the order they were dropped, worst first.
    """
    limit = roster_limit(league)
    kept = list(roster)
    cut: list[Player] = []

    while len(kept) > limit:
        best_i, best_value = 0, None
        for i in range(len(kept)):
            value = roster_value(kept[:i] + kept[i + 1 :], league, replacement)
            if best_value is None or value > best_value:
                best_i, best_value = i, value
        cut.append(kept.pop(best_i))

    return kept, cut


def uncovered_positions(lineup: Lineup, league: League) -> list[str]:
    """Positions with a dedicated starting slot and nobody on the bench.

    Read off the finished lineup rather than counted against `starters`, because
    a flex slot eats a body too: four receivers in a league with three WR spots
    and a flex are all starting, and counting four against a requirement of three
    would call that covered.

    Not a rule the cut selector obeys -- it does not need one -- but worth saying
    out loud when a cut is what left you there.
    """
    benched = {p.pos for p in lineup.bench}
    return [
        pos
        for pos, need in sorted(league.starters.items())
        if need > 0 and pos not in benched
    ]


_COUNTS = ("no", "one", "two", "three", "four", "five", "six")


def _count(n: int) -> str:
    """Small numbers read better as words in the middle of a sentence."""
    return _COUNTS[n] if n < len(_COUNTS) else str(n)


def _and_list(items: list[str]) -> str:
    if len(items) <= 1:
        return items[0] if items else ""
    return f"{', '.join(items[:-1])} and {items[-1]}"


def _traded_tiers(give, receive, market: dict | None) -> dict:
    """Tier and tier depth for every player on both sides, for the UI to render."""
    if not market:
        return {}

    def rows(players):
        out = []
        for p in players:
            tier = tier_at(market.get(p.pos, []), p.pos_rank)
            if tier is not None:
                out.append({"player": p, "tier": tier.index + 1, "size": tier.size,
                            "of": len(market.get(p.pos, []))})
        return out

    return {"give": rows(list(give)), "receive": rows(list(receive))}


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
    # The phase the trade actually moves -- what `explanation` describes.
    before: Lineup
    after: Lineup
    explanation: str
    # What you would field this week, which is not the same thing once somebody
    # is hurt. A weighted average of lineups is a number, not a team.
    before_now: Lineup = None  # type: ignore[assignment]
    after_now: Lineup = None  # type: ignore[assignment]
    phases: int = 1
    # Who you would have to drop to fit the incoming players, worst first, and
    # how many spots you would free if the trade goes the other way.
    cuts: list[Player] = field(default_factory=list)
    spots_freed: int = 0
    # The roster was already past the limit before the trade. Its own problem,
    # not this trade's, but the grade is computed against a legal roster either
    # way so it has to be sayable.
    over_before: int = 0
    # Which tier each traded player sits in, and how deep that tier is. Reported
    # beside the headline, never folded into it: replaceability is an argument
    # about the trade, not a number to add to the points.
    tiers: dict = field(default_factory=dict)
    # What the trade is worth to a team with this record, in the same points per
    # week as `delta_per_week`. None when no record was given, which is the
    # default: a record is not something to invent on the user's behalf.
    situational_per_week: float | None = None
    # The same bands, read off the situational number. Kept beside the headline
    # verdict rather than replacing it: the user needs to see the premium they
    # are paying, not have it quietly folded away.
    situational_verdict: str | None = None
    outlook: object | None = None
    playoffs_at: int | None = None
    # Which tier each traded player sits in, and how deep that tier is. Reported
    # beside the headline, never folded into it: replaceability is an argument
    # about the trade, not a number to add to the points.
    tiers: dict = field(default_factory=dict)
    # What the trade is worth to a team with this record, in the same points per
    # week as `delta_per_week`. None when no record was given, which is the
    # default: a record is not something to invent on the user's behalf.
    situational_per_week: float | None = None
    # The same bands, read off the situational number. Kept beside the headline
    # verdict rather than replacing it: the user needs to see the premium they
    # are paying, not have it quietly folded away.
    situational_verdict: str | None = None
    outlook: object | None = None
    playoffs_at: int | None = None


def grade_trade(
    roster: list[Player],
    give: list[Player],
    receive: list[Player],
    league: League,
    replacement: dict[str, float],
    *,
    weeks_covered: float = GAMES_PER_SEASON,
    market: dict | None = None,
    availability: dict | None = None,
    ranks_knew: bool = False,
    record: tuple[int, int] | None = None,
) -> Grade:
    """Grade a trade against a roster.

    Everything after `replacement` is keyword-only and optional, and every one of
    them defaults to the behaviour of not having it. That is deliberate: this
    signature has grown once per phase, and positional extras were already at
    seven when the sixth and seventh were being passed by position in four
    different files.

    `weeks_covered` is how many weeks the projections span -- 17 for a
    full-season file, `weeks_remaining` for a rest-of-season one. Use
    `model.fromfile.weeks_covered` to read it off the document rather than
    passing a literal.

    `market` carries the tier structure from `model.market.build_market`. Without
    it the grade is unchanged but says nothing about replaceability.

    `availability` maps a player id to how many of the remaining weeks he misses,
    and `ranks_knew` says whether the rankings already priced those absences in.
    See `weeks_out` for why that second flag exists.

    `record` is (wins, losses). With it the grade carries a second number beside
    the first: the same delta, with the weeks weighted by what they are worth to
    a team with that record. Without it nothing changes at all -- a record is not
    something to invent on the user's behalf.
    """
    scoring = league.scoring

    missing = [p.name for p in give if p not in roster]
    if missing:
        raise ValueError(f"not on the roster: {', '.join(missing)}")

    after_roster = [p for p in roster if p not in give] + list(receive)

    # Both sides are cut down to a legal roster before anything is measured. Only
    # capping the after-roster would charge this trade for an overflow the user
    # already had; capping both means a pre-existing one mostly cancels, and the
    # delta stays a comparison between two rosters that could actually be fielded.
    before_kept, before_cut = enforce_limit(roster, league, replacement)
    after_kept, after_cut = enforce_limit(after_roster, league, replacement)

    # Availability is applied to the *lineup*, not to the roster cut above. Who is
    # worth keeping is a question about the season; who plays this week is not.
    # A team does not release its best running back because he is hurt in October.
    bounds = phase_boundaries(
        before_kept + after_kept, availability, weeks_covered, ranks_knew
    )
    before_phased = phased_lineup(
        before_kept, league, scoring, replacement, availability, weeks_covered,
        ranks_knew, bounds,
    )
    after_phased = phased_lineup(
        after_kept, league, scoring, replacement, availability, weeks_covered,
        ranks_knew, bounds,
    )

    # Describe the stretch the trade actually changes, not the stretch that
    # happens to come first. Trading for a player who is out five weeks moves
    # nothing in week one, and "your starting lineup does not change" is a false
    # summary of a trade that upgrades your best slot the moment he is back.
    headline = max(
        range(len(bounds)),
        key=lambda i: abs(after_phased.at(i).points - before_phased.at(i).points),
    )
    before, after = before_phased.at(headline), after_phased.at(headline)
    before_now, after_now = before_phased.now, after_phased.now

    delta_season = after_phased.points - before_phased.points
    delta_week = delta_season / weeks_covered

    # The situational number. Not a different model and not an adjustment to the
    # first one -- the same weighted mean of the same per-week deltas, counting
    # the weeks by what they are worth to this team rather than counting them all
    # the same. Fair value is what the trade is worth; this is what it is worth
    # to you, and both are reported because collapsing them into one hides the
    # premium being paid.
    view = None
    situational_week = None
    playoffs_at = None
    if record is not None:
        wins, losses = record
        view = outlook(wins, losses, league.teams, league.playoff_spots,
                       league.regular_season_weeks)
        playoffs_at = playoff_start(weeks_covered, wins, losses,
                                    league.regular_season_weeks, league.playoff_weeks)
        if not is_degenerate(view, weeks_covered, playoffs_at):
            total_weight = 0.0
            weighted = 0.0
            for (phase, before_lu), (_, after_lu) in zip(
                before_phased.phases, after_phased.phases
            ):
                w = weighted_weeks(phase.start, phase.end, playoffs_at, view)
                rate = (after_lu.points - before_lu.points) / weeks_covered
                weighted += rate * w
                total_weight += w
            situational_week = weighted / total_weight
    delta_depth = depth_value(after.bench, league, replacement) - depth_value(
        before.bench, league, replacement
    )

    absent = [
        p
        for p in list(give) + list(receive)
        if weeks_out(p, availability, ranks_knew) > 0
    ]

    spots_freed = max(0, roster_limit(league) - len(after_kept)) - max(
        0, roster_limit(league) - len(before_kept)
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
        before_now=before_now,
        after_now=after_now,
        phases=len(bounds),
        cuts=after_cut,
        tiers=_traded_tiers(give, receive, market),
        situational_per_week=situational_week,
        situational_verdict=None if situational_week is None else band(situational_week),
        outlook=view,
        playoffs_at=playoffs_at,
        spots_freed=max(spots_freed, 0),
        over_before=len(before_cut),
        explanation=explain(
            before, after, delta_week, delta_depth, scoring, replacement,
            league, give, receive, weeks_covered, after_cut, max(spots_freed, 0),
            len(before_cut), market, absent, availability, ranks_knew,
            situational_week, view,
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
    cuts: list[Player] | tuple = (),
    spots_freed: int = 0,
    over_before: int = 0,
    market: dict | None = None,
    absent: list[Player] | tuple = (),
    availability: dict | None = None,
    ranks_knew: bool = False,
    situational_week: float | None = None,
    view: Outlook | None = None,
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
        # nothing to describe. Said plainly, without a number -- but the roster
        # crunch and the depth note still apply, and a bench-for-bench trade that
        # forces two drops is precisely the case that must not fall silent here.
        return (
            "Your starting lineup does not change. Nothing you would start is"
            " affected." + _consequences(
                delta_depth, weeks_covered, cuts, after, league, spots_freed,
                give, receive, over_before, market, scoring, absent, availability,
                ranks_knew, situational_week, view, delta_week,
            )
        )

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

    return head + body + _consequences(
        delta_depth, weeks_covered, cuts, after, league, spots_freed, give, receive,
        over_before, market, scoring, absent, availability, ranks_knew,
        situational_week, view, delta_week,
    )


def _consequences(
    delta_depth: float,
    weeks_covered: float,
    cuts: list[Player] | tuple,
    after: Lineup,
    league: League | None,
    spots_freed: int,
    give: list[Player] | tuple = (),
    receive: list[Player] | tuple = (),
    over_before: int = 0,
    market: dict | None = None,
    scoring: dict[str, float] | None = None,
    absent: list[Player] | tuple = (),
    availability: dict | None = None,
    ranks_knew: bool = False,
    situational_week: float | None = None,
    view: Outlook | None = None,
    delta_week: float = 0.0,
) -> str:
    """Everything true about the trade that is not the slot it moved.

    Split out because it has to be reachable from both endings of `explain` --
    including the one where no starting slot changes at all, which is exactly the
    shape of trade most likely to cost a forced drop.
    """
    tail = ""

    # The QB problem. In a one-QB league an elite quarterback carries almost no
    # value above replacement, which is arithmetically right and socially
    # explosive -- users read it as the app being broken. Carry the scarcity
    # argument in the sentence rather than leaving the number to defend itself.
    one_qb = league is not None and league.superflex_slots == 0
    if one_qb and any(p.pos == "QB" for p in list(give) + list(receive)):
        tail += (
            " Quarterbacks are worth less here than their rankings suggest: only one"
            " starts per team, so the next one on waivers is much closer to yours"
            " than the gap in rank implies."
        )

    # What the record makes of it. Said only when it disagrees with the headline
    # by enough to matter -- a situational number that echoes the fair one is not
    # a second opinion, it is repetition.
    if (
        situational_week is not None
        and view is not None
        and abs(situational_week - delta_week) >= EVEN_THRESHOLD
    ):
        direction = "better" if situational_week > delta_week else "worse"
        tail += (
            f" Your record puts you at {view.odds:.0%} to make the playoffs, so"
            f" {'January is worth little to you' if view.leans_win_now else 'January is what you are playing for'}:"
            f" to this team the trade is {direction} than that"
            f" — {situational_week:+.1f} a week rather than {delta_week:+.1f}."
        )

    # Who is not playing. Said first, because it changes what every number after
    # it means: a projection for a player who misses most of the run is not a
    # projection of what he does for you.
    if absent:
        total = int(weeks_covered)
        parts = []
        for p in absent:
            out = min(weeks_out(p, availability, ranks_knew), total)
            parts.append(
                f"{p.name} is out for the season"
                if out >= total
                else f"{p.name} misses {out} of the next {total} weeks"
            )
        tail += (
            f" {_and_list(parts)}, so the projection here is only the weeks"
            f" {'they' if len(absent) > 1 else 'he'} actually play"
            f"{'' if len(absent) > 1 else 's'}."
        )

    # Replaceability. The points have already said who scores more; this says
    # which of them you could go and find again, which is the argument the points
    # cannot make and the one that decides whether two good players really beat
    # one great one.
    if scoring is not None:
        tail += describe_scarcity(give, receive, market, scoring, league)

    # The forced drop. A trade that hands you more players than you send is not
    # free, and the number alone will not stop anyone -- naming the casualties is
    # the part that does. Said before the depth note, because "you would drop
    # Allgeier and Otton" is concrete and "bench depth worsens" is not.
    if cuts:
        names = _and_list([p.name for p in cuts])
        # Who goes is always the full list -- that is the answer to "if I accept
        # this, who do I drop?". Whose fault it is, is a separate question, and
        # blaming the trade for an overflow the roster already had is how a
        # player-for-himself trade ends up reporting five forced cuts.
        if not over_before:
            tail += (
                f" You would be {_count(len(cuts))} over the roster limit:"
                f" to fit them you would have to drop {names}."
            )
        elif len(cuts) > over_before:
            tail += (
                f" Your roster is already {_count(over_before)} over the limit, and"
                f" this trade would put you {_count(len(cuts))} over:"
                f" you would have to drop {names}."
            )
        else:
            # The trade leaves the crunch alone or eases it. Either way it did not
            # cause it, and the count that matters is the one they started with.
            tail += (
                f" Your roster is already {_count(over_before)} over the limit;"
                f" this trade does not fix that, and you would still have to"
                f" drop {names}."
            )
        if league is not None:
            thin = [
                pos
                for pos in uncovered_positions(after, league)
                if any(p.pos == pos for p in cuts)
            ]
            if thin:
                tail += f" That leaves you no cover at {_and_list(thin)}."
    elif spots_freed:
        tail += (
            f" It also frees {_count(spots_freed)} roster"
            f" {'spot' if spots_freed == 1 else 'spots'}."
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

    return tail
