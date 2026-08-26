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
    explanation: explain(before, after, deltaPerWeek, deltaDepth, scoring, replacement),
  }
}

export function explain(before, after, deltaPerWeek, deltaDepth, scoring, replacement) {
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

  let head
  if (deltaPerWeek > 0) head = `You gain ${deltaPerWeek.toFixed(1)} points a week.`
  else if (deltaPerWeek < 0) head = `You lose ${Math.abs(deltaPerWeek).toFixed(1)} points a week.`
  else head = 'Your starting lineup does not change.'

  if (!changes.length) return `${head} Nothing you would start is affected.`

  changes.sort((x, y) => y.magnitude - x.magnitude)
  const { slot, oldP, newP } = changes[0]

  const describe = (p) => (p ? `${p.name} (${p.pos}${p.pos_adp_rank}-level)` : 'a waiver-level starter')

  const lead = changes.length === 1 ? 'Almost all of it' : 'The biggest move'
  const body = ` ${lead} is at ${slot}: ${describe(oldP)} becomes ${describe(newP)}.`

  let tail = ''
  if (deltaDepth < -3) {
    tail = ' You are giving up real bench depth to do it — fine if you are set at your starting spots.'
  } else if (deltaDepth > 3) {
    tail = ' You also pick up useful bench depth for byes and injuries.'
  }

  return head + body + tail
}
