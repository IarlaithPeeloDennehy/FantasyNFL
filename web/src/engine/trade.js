/**
 * Trade grading and the plain-English explanation.
 *
 * The number convinces nobody on its own, so the explanation is not decoration
 * here -- it is the part of the output people actually read.
 */

import { GAMES_PER_SEASON, playerPoints, vor } from './scoring.js'
import { bestLineup, bySlot, replacementForSlot, slotStem } from './lineup.js'

export const EVEN_THRESHOLD = 0.5

// Per week, in the user's own scoring. Opening guesses -- tune against real trades.
export const BANDS = [
  [2.0, 'Slight edge', 'Slight loss'],
  [5.0, 'Clear win', 'Clear loss'],
  [Infinity, 'Lopsided win', 'Lopsided loss'],
]

const DEPTH_WEIGHT = 0.2

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
 * Bench players are not worthless -- byes and injuries happen -- but they are
 * not worth face value either. Reported separately, never folded into the
 * headline, because folding it back in re-creates the 2-for-1 bug.
 */
function depthValue(bench, league, replacement) {
  let total = 0
  for (const p of bench) total += Math.max(vor(p, league, replacement), 0)
  return DEPTH_WEIGHT * total
}

export function gradeTrade(roster, give, receive, league, replacement) {
  const { scoring } = league

  const giveSet = new Set(give)
  const missing = give.filter((p) => !roster.includes(p))
  if (missing.length) {
    throw new Error(`not on the roster: ${missing.map((p) => p.name).join(', ')}`)
  }

  const afterRoster = roster.filter((p) => !giveSet.has(p)).concat(receive)

  const before = bestLineup(roster, league, scoring, replacement)
  const after = bestLineup(afterRoster, league, scoring, replacement)

  const deltaSeason = after.points - before.points
  const deltaPerWeek = deltaSeason / GAMES_PER_SEASON
  const deltaDepth =
    depthValue(after.bench, league, replacement) -
    depthValue(before.bench, league, replacement)

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
    explanation: explain(
      before, after, deltaPerWeek, deltaDepth, scoring, replacement,
      league, give, receive,
    ),
  }
}

export function explain(
  before, after, deltaPerWeek, deltaDepth, scoring, replacement,
  league = null, give = [], receive = [],
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
  if (!changes.length) {
    return 'Your starting lineup does not change. Nothing you would start is affected.'
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

  // The QB problem. In a one-QB league an elite quarterback carries almost no
  // value above replacement, which is arithmetically right and socially
  // explosive -- users read it as the app being broken. Carry the scarcity
  // argument in the sentence rather than leaving the number to defend itself.
  let tail = ''
  const oneQb = league !== null && league.superflexSlots === 0
  if (oneQb && [...give, ...receive].some((p) => p.pos === 'QB')) {
    tail +=
      ' Quarterbacks are worth less here than their rankings suggest: only one' +
      ' starts per team, so the next one on waivers is much closer to yours' +
      ' than the gap in rank implies.'
  }

  if (deltaDepth < -3) {
    tail += ' You are giving up real bench depth to do it — fine if you are set at your starting spots.'
  } else if (deltaDepth > 3) {
    tail += ' You also pick up useful bench depth for byes and injuries.'
  }

  return head + body + tail
}
