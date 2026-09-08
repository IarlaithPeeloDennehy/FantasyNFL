/**
 * Lineup construction.
 *
 * A trade is worth what it does to your starting lineup, not what it does to the
 * sum of your players' values. That distinction is the whole reason this file
 * exists rather than a one-line `players.reduce((a, p) => a + p.value, 0)`.
 */

import { playerPoints, vor } from './scoring.js'

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

// What a bench spot is worth relative to a starting one, and how fast that falls
// down a position's depth chart. Opening guesses, tuned in one named place.
export const DEPTH_WEIGHT = 0.2
export const DEPTH_DECAY = 0.5

/**
 * What a bench is actually worth to you.
 *
 * Bench players are not worthless -- byes and injuries happen -- but they are not
 * worth their face value either, and they are not worth it in equal measure. The
 * first backup at a position covers a bye and the first injury. The third covers
 * the case where two things have already gone wrong, which is most of a season
 * away from mattering. A flat weight over the whole bench says a fourth spare
 * receiver is as useful as a first, and that is how a roster gets valued for
 * hoarding.
 *
 * So the weight decays down each position's own depth chart. Positions are walked
 * in name order and each position's values in descending order, so the
 * floating-point summation is identical here and in the Python reference rather
 * than merely close.
 *
 * Reported separately, never folded into the headline number.
 */
export function depthValue(bench, league, replacement) {
  const byPos = new Map()
  for (const p of bench) {
    const v = vor(p, league, replacement)
    if (v <= 0) continue
    if (!byPos.has(p.pos)) byPos.set(p.pos, [])
    byPos.get(p.pos).push(v)
  }

  let total = 0
  for (const pos of [...byPos.keys()].sort()) {
    const values = byPos.get(pos).sort((a, b) => b - a)
    values.forEach((v, i) => { total += DEPTH_WEIGHT * DEPTH_DECAY ** i * v })
  }
  return total
}

export function startingSlots(league) {
  const dedicated = Object.values(league.starters).reduce((a, b) => a + b, 0)
  return dedicated + league.flexSlots + league.superflexSlots
}

/** How many QB/RB/WR/TE a team may hold at once. */
export function rosterLimit(league) {
  return startingSlots(league) + league.benchSlots
}

/**
 * The whole roster in one number: what it starts, plus what its bench is worth.
 * Only used to rank one roster against another, never reported.
 */
export function rosterValue(roster, league, replacement) {
  const lineup = bestLineup(roster, league, league.scoring, replacement)
  return lineup.points + depthValue(lineup.bench, league, replacement)
}

/**
 * Cut down to the roster limit, cheapest player first.
 *
 * Receiving more players than you send means somebody gets dropped, and until
 * this existed the model simply let the roster grow -- so a 3-for-1 improved your
 * bench score by counting two players you could not legally keep. That is the
 * same error as summing player values, one level down.
 *
 * Greedy, and exact rather than heuristic: at each step it actually rebuilds the
 * lineup without each candidate and drops whichever loses least. At fifteen
 * players and two or three cuts that is a few hundred lineup builds, which is
 * nothing, and it means positional insurance needs no special case. Cutting your
 * only quarterback empties a starting slot down to replacement level, and the
 * arithmetic notices without being told that quarterbacks are special.
 *
 * Ties keep the earlier player in roster order, in both implementations.
 *
 * @returns `{ kept, cut }` -- `cut` in the order they were dropped, worst first.
 */
export function enforceLimit(roster, league, replacement) {
  const limit = rosterLimit(league)
  let kept = [...roster]
  const cut = []

  while (kept.length > limit) {
    let bestIndex = 0
    let bestValue = null
    for (let i = 0; i < kept.length; i += 1) {
      const trial = kept.filter((_, j) => j !== i)
      const value = rosterValue(trial, league, replacement)
      if (bestValue === null || value > bestValue) {
        bestIndex = i
        bestValue = value
      }
    }
    cut.push(kept[bestIndex])
    kept = kept.filter((_, j) => j !== bestIndex)
  }

  return { kept, cut }
}

/**
 * Positions with a dedicated starting slot and nobody on the bench.
 *
 * Read off the finished lineup rather than counted against `starters`, because a
 * flex slot eats a body too: four receivers in a league with three WR spots and a
 * flex are all starting, and counting four against a requirement of three would
 * call that covered.
 *
 * Not a rule the cut selector obeys -- it does not need one -- but worth saying
 * out loud when a cut is what left you there.
 */
export function uncoveredPositions(lineup, league) {
  const benched = new Set(lineup.bench.map((p) => p.pos))
  return Object.keys(league.starters)
    .sort()
    .filter((pos) => league.starters[pos] > 0 && !benched.has(pos))
}
