/**
 * Lineup construction.
 *
 * A trade is worth what it does to your starting lineup, not what it does to the
 * sum of your players' values. That distinction is the whole reason this file
 * exists rather than a one-line `players.reduce((a, p) => a + p.value, 0)`.
 */

import { playerPoints } from './scoring.js'

export const FLEX_ELIGIBLE = ['RB', 'WR', 'TE']
export const SUPERFLEX_ELIGIBLE = ['QB', 'RB', 'WR', 'TE']

const DEDICATED_ORDER = ['QB', 'TE', 'RB', 'WR']

/** 'WR3' -> 'WR', 'FLEX2' -> 'FLEX'. */
export function slotStem(slot) {
  return slot.replace(/\d+$/, '') || slot
}

/**
 * What a freely-available player at this slot is worth.
 *
 * A position absent from `replacement` counts as zero rather than being skipped,
 * which is what the Python reference does (`replacement.get(pos, 0.0)` inside a
 * max). Skipping it instead would return a negative replacement level for a flex
 * slot whose other positions are simply missing from the map -- a divergence the
 * fixtures never happen to cover.
 */
export function replacementForSlot(stem, replacement) {
  let eligible
  if (stem === 'FLEX') eligible = FLEX_ELIGIBLE
  else if (stem === 'SUPERFLEX') eligible = SUPERFLEX_ELIGIBLE
  else eligible = [stem]

  if (eligible.length === 0) return 0
  let best = -Infinity
  for (const pos of eligible) {
    const v = replacement[pos] ?? 0
    if (v > best) best = v
  }
  return best
}

/**
 * Fill the most constrained slots first; that ordering is optimal here.
 *
 * Dedicated slots can only take their own position, so they take the best
 * available at that position. FLEX then takes the best leftover it is allowed,
 * and SUPERFLEX -- the least constrained slot -- goes last.
 *
 * An unfilled slot scores at replacement level, not zero. Trading away your only
 * tight end does not leave the position empty in real life; you stream whoever
 * is on waivers. Scoring it as zero makes such trades look catastrophic and is
 * the easiest way to produce a grade nobody believes.
 */
export function bestLineup(roster, league, scoring, replacement = null) {
  // Stable sort by descending points, matching the Python reference. Ties keep
  // roster order in both implementations, so the two agree exactly.
  const remaining = roster
    .map((p, i) => ({ p, i, pts: playerPoints(p, scoring) }))
    .sort((a, b) => b.pts - a.pts || a.i - b.i)

  const slots = []
  const unfilled = []
  const taken = new Set()

  for (const pos of DEDICATED_ORDER) {
    const count = league.starters[pos] ?? 0
    const picked = remaining.filter((r) => r.p.pos === pos && !taken.has(r.i)).slice(0, count)
    picked.forEach((r, n) => {
      taken.add(r.i)
      slots.push([count === 1 ? pos : `${pos}${n + 1}`, r.p])
    })
    for (let n = picked.length; n < count; n += 1) unfilled.push(pos)
  }

  for (const [count, eligible, stem] of [
    [league.flexSlots, FLEX_ELIGIBLE, 'FLEX'],
    [league.superflexSlots, SUPERFLEX_ELIGIBLE, 'SUPERFLEX'],
  ]) {
    for (let n = 0; n < count; n += 1) {
      const pick = remaining.find((r) => !taken.has(r.i) && eligible.includes(r.p.pos))
      if (!pick) { unfilled.push(stem); continue }
      taken.add(pick.i)
      slots.push([count === 1 ? stem : `${stem}${n + 1}`, pick.p])
    }
  }

  const bench = remaining.filter((r) => !taken.has(r.i)).map((r) => r.p)

  let points = 0
  for (const [, p] of slots) points += playerPoints(p, scoring)
  if (replacement) {
    for (const stem of unfilled) points += replacementForSlot(stem, replacement)
  }

  return { slots, bench, points, unfilled }
}

export function bySlot(lineup) {
  return Object.fromEntries(lineup.slots)
}
