/**
 * Value targets. The claim being tested is narrow on purpose: the list surfaces
 * players whose value above replacement ranks them higher than the market does,
 * and that disagreement comes from positional scarcity rather than from any
 * player-specific insight the model does not have.
 */

import { describe, expect, it } from 'vitest'

import { COMPONENTS, makeLeague, replacementPoints, valueTargets, vor } from '../index.js'

function player(id, pos, recYd, adp, posRank) {
  const proj = Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
  proj.rec_yd = recYd
  return { id, name: id, pos, team: 'FA', adp, pos_adp_rank: posRank, proj }
}

function linearCurve(depth, top, step) {
  return Array.from({ length: depth }, (_, i) => {
    const row = Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
    row.rec_yd = top - i * step
    return row
  })
}

const CURVES = {
  QB: linearCurve(40, 4000, 40),
  RB: linearCurve(80, 3000, 30),
  WR: linearCurve(100, 3000, 30),
  TE: linearCurve(40, 2000, 40),
}

const LEAGUE = makeLeague()
const REPL = replacementPoints(CURVES, LEAGUE)

describe('valueTargets', () => {
  // A scarce-position player drafted late, and an abundant-position player
  // drafted early, with the same raw production.
  const pool = [
    player('EarlyWR', 'WR', 2000, 10, 8),
    player('LateTE', 'TE', 2000, 60, 2),
    player('Filler1', 'WR', 1500, 20, 30),
    player('Filler2', 'RB', 1500, 30, 30),
    player('Scrub', 'WR', 100, 40, 95),
  ]

  it('surfaces the scarce-position player the market drafts late', () => {
    const out = valueTargets(pool, LEAGUE, REPL)
    expect(out[0].player.id).toBe('LateTE')
    expect(out[0].edge).toBeGreaterThan(0)
  })

  it('reports where the market has him and where the model does', () => {
    const [top] = valueTargets(pool, LEAGUE, REPL)
    expect(top.marketRank).toBeGreaterThan(top.modelRank)
    expect(top.edge).toBe(top.marketRank - top.modelRank)
  })

  it('never surfaces a player below replacement, however cheap', () => {
    // Scrub is the latest pick in the pool, so his market-vs-model gap is large;
    // he is still not a buy-low, he is a player you should not roster.
    const ids = valueTargets(pool, LEAGUE, REPL, { limit: 99 }).map((r) => r.player.id)
    expect(ids).not.toContain('Scrub')
    expect(vor(pool.find((p) => p.id === 'Scrub'), LEAGUE, REPL)).toBeLessThan(0)
  })

  it('respects the limit', () => {
    expect(valueTargets(pool, LEAGUE, REPL, { limit: 1 })).toHaveLength(1)
  })

  it('is deterministic when two players tie on value', () => {
    const tied = [player('A', 'WR', 2000, 5, 8), player('B', 'WR', 2000, 6, 8)]
    const once = valueTargets(tied, LEAGUE, REPL).map((r) => r.player.id)
    const twice = valueTargets([...tied].reverse(), LEAGUE, REPL).map((r) => r.player.id)
    expect(once).toEqual(twice)
  })

  it('returns nothing rather than throwing on an empty pool', () => {
    expect(valueTargets([], LEAGUE, REPL)).toEqual([])
  })

  it('changes with the league, because replacement level does', () => {
    // The whole point: a superflex league re-prices quarterbacks, so the list
    // that falls out of it is a different list.
    const qbPool = [...pool, player('LateQB', 'QB', 3800, 70, 3)]
    const sf = makeLeague({ superflexSlots: 1 })
    const oneQb = valueTargets(qbPool, LEAGUE, REPL, { limit: 99 }).map((r) => r.player.id)
    const superflex = valueTargets(qbPool, sf, replacementPoints(CURVES, sf), { limit: 99 })
      .map((r) => r.player.id)
    expect(superflex).not.toEqual(oneQb)
  })
})
