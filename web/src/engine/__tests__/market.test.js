/**
 * Tiers, and the scarcity argument they support.
 *
 * The first attempt at this looked for unusually large rank-over-rank drops
 * against a local median. It found nothing, and the reason is worth keeping:
 * Phase 1 smoothed the curve on purpose, so there are no cliffs left to detect.
 * A tier is not a gap in the data. It is a statement about indifference -- these
 * players are close enough that you would not care which you had -- and that has
 * to be defined in points, not found in slopes.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  BANDS,
  COMPONENTS,
  GAMES_PER_SEASON,
  HALF_PPR,
  PPR,
  SCARCE_TIER_SIZE,
  STANDARD,
  TIER_WIDTH_PER_WEEK,
  buildMarket,
  curvePoints,
  describeScarcity,
  makeLeague,
  positionTiers,
  tierAt,
} from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const doc = JSON.parse(readFileSync(join(here, '../../../public/players.json'), 'utf8'))

const LEAGUE = makeLeague()
const POSITIONS = ['QB', 'RB', 'WR', 'TE']

function player(name, pos, rank, recYd) {
  const proj = Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
  proj.rec_yd = recYd
  return { id: name, name, pos, team: 'FA', pos_adp_rank: rank, adp: rank, proj }
}

describe('the tier width is anchored, not picked', () => {
  // Defined in market.js rather than imported from trade.js, because trade.js
  // imports from market.js and the cycle is not worth the shared literal. This
  // is the guard that stops the two drifting apart in silence.
  it('is the Slight edge / Clear win boundary', () => {
    expect(TIER_WIDTH_PER_WEEK).toBe(BANDS[0][0])
  })
})

describe('positionTiers', () => {
  it.each(POSITIONS)('%s: tiers partition the curve exactly', (pos) => {
    const tiers = positionTiers(doc.curves, pos, HALF_PPR)
    expect(tiers[0].start).toBe(1)
    expect(tiers[tiers.length - 1].end).toBe(doc.curves[pos].length)
    tiers.forEach((t, i) => {
      expect(t.size).toBe(t.end - t.start + 1)
      expect(t.index).toBe(i)
      if (i > 0) expect(t.start).toBe(tiers[i - 1].end + 1)
    })
  })

  it.each(POSITIONS)('%s: nobody in a tier is more than the width off its best', (pos) => {
    const width = TIER_WIDTH_PER_WEEK * GAMES_PER_SEASON
    for (const t of positionTiers(doc.curves, pos, HALF_PPR)) {
      const best = curvePoints(doc.curves, pos, t.start, HALF_PPR)
      const worst = curvePoints(doc.curves, pos, t.end, HALF_PPR)
      expect(best - worst).toBeLessThanOrEqual(width + 1e-9)
    }
  })

  // The Phase 0 lesson, applied. A rest-of-season file scales the curve and the
  // width by the same factor, so the two cancel and the tiers do not move. If
  // they did, a trade would change tier in week 10 for no football reason.
  it.each([14, 8, 3, 1])('is the same shape over %i weeks as over a season', (weeks) => {
    const k = weeks / GAMES_PER_SEASON
    const scaled = Object.fromEntries(
      Object.entries(doc.curves).map(([pos, rows]) => [
        pos,
        rows.map((r) => Object.fromEntries(Object.entries(r).map(([c, v]) => [c, v * k]))),
      ]),
    )
    for (const pos of POSITIONS) {
      expect(positionTiers(scaled, pos, HALF_PPR, weeks).map((t) => [t.start, t.end]))
        .toEqual(positionTiers(doc.curves, pos, HALF_PPR).map((t) => [t.start, t.end]))
    }
  })

  // This is why tiers are computed in the browser rather than shipped in
  // players.json: the boundaries are a function of the scoring rules, so baking
  // them into the data file would freeze one league's answer for everybody.
  it('moves with the scoring format', () => {
    const ppr = positionTiers(doc.curves, 'WR', PPR).map((t) => t.end)
    const std = positionTiers(doc.curves, 'WR', STANDARD).map((t) => t.end)
    expect(ppr).not.toEqual(std)
  })

  it('survives a curve it knows nothing about', () => {
    expect(positionTiers(doc.curves, 'K', HALF_PPR)).toEqual([])
    expect(positionTiers({ WR: [] }, 'WR', HALF_PPR)).toEqual([])
  })
})

// The gate for this phase, stated as a claim about the data. Nothing in the code
// knows that running backs and quarterbacks have different shapes.
describe('the shapes come out of the history, not out of a constant', () => {
  const tiersFor = (pos) => positionTiers(doc.curves, pos, HALF_PPR)

  // How much wider the tiers get between the top of a position and its middle.
  // A big number means the position has a scarce elite and a long interchangeable
  // tail; a small one means it keeps falling all the way down.
  const widening = (pos) => {
    const sizes = tiersFor(pos).map((t) => t.size)
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length
    return mean(sizes.slice(3, 5)) / mean(sizes.slice(0, 2))
  }

  it.each(['RB', 'WR', 'TE'])('%s tiers get much wider further down', (pos) => {
    expect(widening(pos)).toBeGreaterThan(3)
  })

  // Only thirty-two quarterbacks start anywhere, so that curve keeps falling and
  // its tiers widen far less than the others. Asserted as a comparison rather
  // than against a threshold of its own: the claim is that the shapes *differ*,
  // and two independent constants could drift until they no longer said that.
  // Measured today: QB 2.0 against RB 3.4, TE 3.7, WR 7.5.
  it('QB is the flattest of the four, by a clear margin', () => {
    const others = ['RB', 'WR', 'TE'].map(widening)
    expect(widening('QB')).toBeLessThan(Math.min(...others))
    expect(Math.min(...others)).toBeGreaterThan(widening('QB') * 1.5)
  })

  it('puts the top of every position in a genuinely scarce tier', () => {
    for (const pos of POSITIONS) {
      expect(tierAt(tiersFor(pos), 1).size).toBeLessThanOrEqual(SCARCE_TIER_SIZE)
    }
  })

  // The user's own example: WR10 and WR25 are close enough to share a tier,
  // while WR1 and WR5 are not.
  it('separates the top five receivers but not ranks ten to twenty-five', () => {
    const tiers = tiersFor('WR')
    expect(tierAt(tiers, 1).index).not.toBe(tierAt(tiers, 5).index)
    expect(tierAt(tiers, 10).index).toBe(tierAt(tiers, 25).index)
  })
})

describe('tierAt', () => {
  const tiers = positionTiers(doc.curves, 'WR', HALF_PPR)

  it('finds the tier a rank sits in', () => {
    expect(tierAt(tiers, 1).start).toBe(1)
    for (const t of tiers) expect(tierAt(tiers, t.end).index).toBe(t.index)
  })

  // Same floor `curveAt` uses. Claiming WR140 is his own tier would be a worse
  // answer than putting him in the last one.
  it('clamps past the end of the curve rather than inventing a tier', () => {
    const last = tiers[tiers.length - 1]
    expect(tierAt(tiers, 999).index).toBe(last.index)
  })

  it('has nothing to say about a position with no curve', () => {
    expect(tierAt([], 1)).toBeNull()
    expect(tierAt(null, 1)).toBeNull()
  })
})

describe('describeScarcity', () => {
  const market = buildMarket(doc.curves, LEAGUE)
  const say = (give, receive) => describeScarcity(give, receive, market, LEAGUE.scoring)

  const wr = (name, rank, pts) => player(name, 'WR', rank, pts)

  it('says nothing when both sides are equally replaceable', () => {
    expect(say([wr('A', 15, 1900)], [wr('B', 16, 1890)])).toBe('')
  })

  it('names the side giving up the scarcer player', () => {
    const out = say([wr('Star', 1, 3000)], [wr('Ordinary', 15, 1900)])
    expect(out).toMatch(/giving up the scarcer player/)
    expect(out).toContain('Star')
    expect(out).toContain('Ordinary')
  })

  it('names the side getting the scarcer player', () => {
    expect(say([wr('Ordinary', 15, 1900)], [wr('Star', 1, 3000)]))
      .toMatch(/getting the scarcer player/)
  })

  it('compares the best player on each side, not the first', () => {
    const out = say([wr('Scrub', 40, 500), wr('Star', 1, 3000)], [wr('Ordinary', 15, 1900)])
    expect(out).toContain('Star')
    expect(out).not.toContain('Scrub')
  })

  it('names the position only once when both sides share it', () => {
    const out = say([wr('Star', 1, 3000)], [wr('Ordinary', 15, 1900)])
    expect(out.match(/receivers/g)).toHaveLength(1)
  })

  it('names both positions when they differ', () => {
    const out = say([wr('Star', 1, 3000)], [player('Back', 'RB', 15, 1900)])
    expect(out).toMatch(/receivers/)
    expect(out).toMatch(/running backs/)
  })

  // Tier depth says how hard a player is to replace with another rostered
  // player. At quarterback in a one-QB league you do not have to -- which is what
  // the QB note already says, and saying both produces two sentences that argue
  // with each other.
  it('says nothing about quarterbacks in a one-QB league', () => {
    const qb = player('Passer', 'QB', 1, 4000)
    expect(describeScarcity([qb], [wr('Ord', 15, 1900)], market, LEAGUE.scoring, LEAGUE))
      .toBe('')
  })

  it('does speak about quarterbacks in superflex, where scarcity is real', () => {
    const sf = makeLeague({ superflexSlots: 1 })
    const qb = player('Passer', 'QB', 1, 4000)
    expect(describeScarcity([qb], [wr('Ord', 15, 1900)], market, sf.scoring, sf))
      .toMatch(/scarcer player/)
  })

  it('stays quiet without a market rather than guessing', () => {
    expect(describeScarcity([wr('Star', 1, 3000)], [wr('B', 15, 1900)], null, LEAGUE.scoring))
      .toBe('')
    expect(say([], [wr('B', 15, 1900)])).toBe('')
  })
})
