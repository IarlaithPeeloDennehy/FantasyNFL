/**
 * Trade grading and the plain-English explanation.
 *
 * The number convinces nobody on its own, so the explanation is not decoration
 * here -- it is the part of the output people actually read.
 */

import { GAMES_PER_SEASON, playerPoints } from './scoring.js'
import {
  bySlot, depthValue, enforceLimit, phaseBoundaries, phasedLineup,
  replacementForSlot, rosterLimit, slotStem, uncoveredPositions, weeksOut,
} from './lineup.js'
import { describeScarcity, tradedTiers } from './market.js'

export const EVEN_THRESHOLD = 0.5

// Per week, in the user's own scoring. Opening guesses -- tune against real trades.
export const BANDS = [
  [2.0, 'Slight edge', 'Slight loss'],
  [5.0, 'Clear win', 'Clear loss'],
  [Infinity, 'Lopsided win', 'Lopsided loss'],
]

// How much bench-depth movement is worth a sentence. Unlike the bands above this
// is a *season-scale* quantity, so it has to be rescaled for a rest-of-season
// file or the sentence appears and disappears depending on what week it is.
export const DEPTH_NOTE_THRESHOLD = 3.0

const COUNTS = ['no', 'one', 'two', 'three', 'four', 'five', 'six']

/** Small numbers read better as words in the middle of a sentence. */
function count(n) {
  return n < COUNTS.length ? COUNTS[n] : String(n)
}

function andList(items) {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Verdicts have a direction. A five-point loss is not a 'clear win'. */
export function band(deltaPerWeek) {
  const magnitude = Math.abs(deltaPerWeek)
  if (magnitude < EVEN_THRESHOLD) return 'Essentially even'
  for (const [threshold, gainName, lossName] of BANDS) {
    if (magnitude < threshold) return deltaPerWeek > 0 ? gainName : lossName
  }
  const last = BANDS[BANDS.length - 1]
  return deltaPerWeek > 0 ? last[1] : last[2]
}

/**
 * Grade a trade against a roster.
 *
 * Everything past `replacement` arrives in one options object, and every option
 * defaults to the behaviour of not having it. That is deliberate: this signature
 * has grown once per phase, and positional extras were already at seven when the
 * sixth and seventh were being passed by position in four different files.
 *
 * `weeksCovered` is how many weeks the projections span -- 17 for a full-season
 * file, `weeks_remaining` for a rest-of-season one. Read it off the document with
 * `weeksCovered(doc)` rather than passing a literal.
 *
 * `market` carries the tier structure from `buildMarket`. Without it the grade is
 * unchanged but says nothing about replaceability.
 *
 * `availability` maps a player id to how many of the remaining weeks he misses,
 * and `ranksKnew` says whether the rankings already priced those absences in. See
 * `weeksOut` for why that second flag exists.
 */
export function gradeTrade(
  roster, give, receive, league, replacement,
  {
    weeksCovered = GAMES_PER_SEASON, market = null,
    availability = null, ranksKnew = false,
  } = {},
) {
  const { scoring } = league

  const giveSet = new Set(give)
  const missing = give.filter((p) => !roster.includes(p))
  if (missing.length) {
    throw new Error(`not on the roster: ${missing.map((p) => p.name).join(', ')}`)
  }

  const afterRoster = roster.filter((p) => !giveSet.has(p)).concat(receive)

  // Both sides are cut down to a legal roster before anything is measured. Only
  // capping the after-roster would charge this trade for an overflow the user
  // already had; capping both means a pre-existing one mostly cancels, and the
  // delta stays a comparison between two rosters that could actually be fielded.
  const beforeCap = enforceLimit(roster, league, replacement)
  const afterCap = enforceLimit(afterRoster, league, replacement)

  // Availability is applied to the *lineup*, not to the roster cut above. Who is
  // worth keeping is a question about the season; who plays this week is not. A
  // team does not release its best running back because he is hurt in October.
  const bounds = phaseBoundaries(
    [...beforeCap.kept, ...afterCap.kept], availability, weeksCovered, ranksKnew,
  )
  const beforePhased = phasedLineup(
    beforeCap.kept, league, scoring, replacement,
    availability, weeksCovered, ranksKnew, bounds,
  )
  const afterPhased = phasedLineup(
    afterCap.kept, league, scoring, replacement,
    availability, weeksCovered, ranksKnew, bounds,
  )

  // Describe the stretch the trade actually changes, not the stretch that happens
  // to come first. Trading for a player who is out five weeks moves nothing in
  // week one, and "your starting lineup does not change" is a false summary of a
  // trade that upgrades your best slot the moment he is back.
  let headline = 0
  for (let i = 1; i < bounds.length; i += 1) {
    const here = Math.abs(afterPhased.at(i).points - beforePhased.at(i).points)
    const best = Math.abs(afterPhased.at(headline).points - beforePhased.at(headline).points)
    if (here > best) headline = i
  }
  const before = beforePhased.at(headline)
  const after = afterPhased.at(headline)

  const deltaSeason = afterPhased.points - beforePhased.points
  const deltaPerWeek = deltaSeason / weeksCovered
  const deltaDepth =
    depthValue(after.bench, league, replacement) -
    depthValue(before.bench, league, replacement)

  const absent = [...give, ...receive].filter(
    (p) => weeksOut(p, availability, ranksKnew) > 0,
  )

  const limit = rosterLimit(league)
  const spotsFreed = Math.max(
    0,
    Math.max(0, limit - afterCap.kept.length) - Math.max(0, limit - beforeCap.kept.length),
  )

  let direction = 'even'
  if (Math.abs(deltaPerWeek) >= EVEN_THRESHOLD) {
    direction = deltaPerWeek > 0 ? 'gain' : 'loss'
  }

  return {
    deltaSeason,
    deltaPerWeek,
    deltaDepth,
    verdict: band(deltaPerWeek),
    direction,
    before,
    after,
    // What you would field this week, which is not the same thing once somebody is
    // hurt. A weighted average of lineups is a number, not a team.
    beforeNow: beforePhased.now,
    afterNow: afterPhased.now,
    phases: bounds.length,
    // Who you would have to drop to fit the incoming players, worst first, how
    // many spots you would free if the trade goes the other way, and whether the
    // roster was already past the limit before any of this.
    cuts: afterCap.cut,
    // Which tier each traded player sits in, and how deep that tier is. Reported
    // beside the headline, never folded into it: replaceability is an argument
    // about the trade, not a number to add to the points.
    tiers: tradedTiers(give, receive, market),
    spotsFreed,
    overBefore: beforeCap.cut.length,
    explanation: explain(
      before, after, deltaPerWeek, deltaDepth, scoring, replacement,
      league, give, receive, weeksCovered, afterCap.cut, spotsFreed, beforeCap.cut.length,
      market, absent, availability, ranksKnew,
    ),
  }
}

export function explain(
  before, after, deltaPerWeek, deltaDepth, scoring, replacement,
  league = null, give = [], receive = [], weeksCovered = GAMES_PER_SEASON,
  cuts = [], spotsFreed = 0, overBefore = 0, market = null,
  absent = [], availability = null, ranksKnew = false,
) {
  const b = bySlot(before)
  const a = bySlot(after)

  const slotPoints = (slot, p) =>
    p ? playerPoints(p, scoring) : replacementForSlot(slotStem(slot), replacement)

  const changes = []
  for (const slot of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const oldP = b[slot] ?? null
    const newP = a[slot] ?? null
    if (oldP === newP) continue
    changes.push({
      magnitude: Math.abs(slotPoints(slot, newP) - slotPoints(slot, oldP)),
      slot,
      oldP,
      newP,
    })
  }

  // No slot changed hands, so the delta is exactly zero and there is nothing to
  // describe. Said plainly, without a number.
  // No slot changed hands, so the delta is exactly zero and there is nothing to
  // describe. Said plainly, without a number -- but the roster crunch and the
  // depth note still apply, and a bench-for-bench trade that forces two drops is
  // precisely the case that must not fall silent here.
  if (!changes.length) {
    return (
      'Your starting lineup does not change. Nothing you would start is affected.' +
      consequences(
        deltaDepth, weeksCovered, cuts, after, league, spotsFreed, give, receive, overBefore,
        market, scoring, absent, availability, ranksKnew,
      )
    )
  }

  // Branch on the *rendered* number, not the raw one. A delta of +0.034 renders
  // as "0.0", and "You gain 0.0 points a week" reads as a bug to the user even
  // though the arithmetic is right. Both implementations branch on the string so
  // they cannot disagree about a rounding boundary.
  const shown = Math.abs(deltaPerWeek).toFixed(1)
  let head
  if (shown === '0.0') head = 'Your starting lineup shifts by less than a tenth of a point a week.'
  else if (deltaPerWeek > 0) head = `You gain ${shown} points a week.`
  else head = `You lose ${shown} points a week.`

  changes.sort((x, y) => y.magnitude - x.magnitude)

  // Name the slot the *trade* moved, not merely the slot that moved most.
  //
  // Trading for a better RB1 pushes your old RB1 down to RB2, and that knock-on
  // is often the larger single delta -- so ranking by magnitude alone describes
  // the cascade and never mentions the player you just acquired. The sentence is
  // true and answers a question nobody asked. Prefer the slot an acquired player
  // landed in; failing that, the slot a departing player left.
  // Which end of the trade to describe follows the direction of the verdict. On a
  // gain the reader wants to know where the player they acquired landed; on a
  // loss they want to know what left. Preferring the acquired player either way
  // produces "you lose 3.3 points a week" followed by a description of an
  // upgrade, which reads as the app contradicting itself.
  const received = new Set(receive)
  const given = new Set(give)
  const landed = changes.filter((c) => c.newP && received.has(c.newP))
  const departed = changes.filter((c) => c.oldP && given.has(c.oldP))
  const [primary, secondary] = deltaPerWeek >= 0 ? [landed, departed] : [departed, landed]
  const chosen = (primary.length ? primary : secondary.length ? secondary : changes)[0]
  const cascadeOnly = !landed.length && !departed.length
  const { slot, oldP, newP } = chosen

  const describe = (p) => (p ? `${p.name} (${p.pos}${p.pos_adp_rank}-level)` : 'a waiver-level starter')

  // "Almost all of it" needs a quantity to refer back to, and the sub-tenth head
  // does not give it one.
  let lead = 'The move that matters'
  if (shown === '0.0') lead = 'The move'
  else if (cascadeOnly) lead = 'The knock-on'
  else if (changes.length === 1) lead = 'Almost all of it'
  const body = ` ${lead} is at ${slot}: ${describe(oldP)} becomes ${describe(newP)}.`

  return head + body + consequences(
    deltaDepth, weeksCovered, cuts, after, league, spotsFreed, give, receive, overBefore,
    market, scoring, absent, availability, ranksKnew,
  )
}

/**
 * Everything true about the trade that is not the slot it moved.
 *
 * Split out because it has to be reachable from both endings of `explain` --
 * including the one where no starting slot changes at all, which is exactly the
 * shape of trade most likely to cost a forced drop.
 */
function consequences(
  deltaDepth, weeksCovered, cuts, after, league, spotsFreed, give = [], receive = [],
  overBefore = 0, market = null, scoring = null,
  absent = [], availability = null, ranksKnew = false,
) {
  let tail = ''

  // The QB problem. In a one-QB league an elite quarterback carries almost no
  // value above replacement, which is arithmetically right and socially
  // explosive -- users read it as the app being broken. Carry the scarcity
  // argument in the sentence rather than leaving the number to defend itself.
  const oneQb = league !== null && league.superflexSlots === 0
  if (oneQb && [...give, ...receive].some((p) => p.pos === 'QB')) {
    tail +=
      ' Quarterbacks are worth less here than their rankings suggest: only one' +
      ' starts per team, so the next one on waivers is much closer to yours' +
      ' than the gap in rank implies.'
  }

  // Who is not playing. Said first, because it changes what every number after it
  // means: a projection for a player who misses most of the run is not a
  // projection of what he does for you.
  if (absent.length) {
    const total = Math.trunc(weeksCovered)
    const parts = absent.map((p) => {
      const out = Math.min(weeksOut(p, availability, ranksKnew), total)
      return out >= total
        ? `${p.name} is out for the season`
        : `${p.name} misses ${out} of the next ${total} weeks`
    })
    const many = absent.length > 1
    tail +=
      ` ${andList(parts)}, so the projection here is only the weeks` +
      ` ${many ? 'they' : 'he'} actually play${many ? '' : 's'}.`
  }

  // Replaceability. The points have already said who scores more; this says
  // which of them you could go and find again, which is the argument the points
  // cannot make and the one that decides whether two good players really beat
  // one great one.
  if (scoring !== null) tail += describeScarcity(give, receive, market, scoring, league)

  // The forced drop. A trade that hands you more players than you send is not
  // free, and the number alone will not stop anyone -- naming the casualties is
  // the part that does. Said before the depth note, because "you would drop
  // Allgeier and Otton" is concrete and "bench depth worsens" is not.
  if (cuts.length) {
    const names = andList(cuts.map((p) => p.name))
    // Who goes is always the full list -- that is the answer to "if I accept
    // this, who do I drop?". Whose fault it is, is a separate question, and
    // blaming the trade for an overflow the roster already had is how a
    // player-for-himself trade ends up reporting five forced cuts.
    if (!overBefore) {
      tail +=
        ` You would be ${count(cuts.length)} over the roster limit:` +
        ` to fit them you would have to drop ${names}.`
    } else if (cuts.length > overBefore) {
      tail +=
        ` Your roster is already ${count(overBefore)} over the limit, and this trade` +
        ` would put you ${count(cuts.length)} over: you would have to drop ${names}.`
    } else {
      // The trade leaves the crunch alone or eases it. Either way it did not
      // cause it, and the count that matters is the one they started with.
      tail +=
        ` Your roster is already ${count(overBefore)} over the limit; this trade` +
        ` does not fix that, and you would still have to drop ${names}.`
    }
    if (league !== null) {
      const thin = uncoveredPositions(after, league).filter(
        (pos) => cuts.some((p) => p.pos === pos),
      )
      if (thin.length) tail += ` That leaves you no cover at ${andList(thin)}.`
    }
  } else if (spotsFreed) {
    tail += ` It also frees ${count(spotsFreed)} roster ${spotsFreed === 1 ? 'spot' : 'spots'}.`
  }

  // `deltaDepth` is measured over whatever span the projections cover, so the
  // threshold has to move with it. A fixed 3.0 would make this sentence roughly
  // twice as hard to trigger on a week-10 file as on a preseason one, for a
  // roster change that is identical in weekly terms.
  const depthNote = DEPTH_NOTE_THRESHOLD * (weeksCovered / GAMES_PER_SEASON)
  if (deltaDepth < -depthNote) {
    tail += ' You are giving up real bench depth to do it — fine if you are set at your starting spots.'
  } else if (deltaDepth > depthNote) {
    tail += ' You also pick up useful bench depth for byes and injuries.'
  }

  return tail
}
