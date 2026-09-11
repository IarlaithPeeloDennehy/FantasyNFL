/**
 * Tests for the offer finder.
 *
 * The finder is the one part of the engine that *searches* rather than scores,
 * so most of these state a property of the search rather than a value: every
 * offer must be legal, must clear the asking price, must improve the lineup, and
 * must grade identically to the same trade typed in by hand. That last one is the
 * important one — a finder that disagrees with the grader is worse than no
 * finder, because the user checks it and the two numbers do not match.
 */

import { describe, expect, it } from 'vitest'

import {
  COMPONENTS,
  EVEN_THRESHOLD,
  MAX_OVERPAY,
  REASONS,
  combinations,
  findOffers,
  gradeTrade,
  makeLeague,
  packageValue,
  replacementPoints,
  rosterLimit,
  startShare,
  startingSlots,
  vor,
} from '../index.js'

/** A player whose only production is receiving yards, so points are predictable. */
function player(name, pos, recYd, posRank = 1) {
  const proj = Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
  proj.rec_yd = recYd
  return { id: name, name, pos, team: 'FA', pos_adp_rank: posRank, adp: posRank, proj }
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
const V = (p) => vor(p, LEAGUE, REPL)

/**
 * A roster with a real positional surplus: four receivers good enough to start,
 * a fifth who never will, and a running back spot held together with tape. This
 * is the shape the finder exists for — value sitting on the bench that the
 * lineup cannot use.
 */
function surplusRoster() {
  return [
    player('QB1', 'QB', 3800, 1),
    player('RB-weak', 'RB', 1400, 40),
    player('WR-a', 'WR', 2900, 2),
    player('WR-b', 'WR', 2700, 5),
    player('WR-c', 'WR', 2500, 9),
    player('WR-d', 'WR', 2300, 14),
    player('WR-e', 'WR', 2200, 18),
    player('TE1', 'TE', 1900, 2),
  ]
}

const eliteRb = player('RB-elite', 'RB', 2850, 3)

describe('startShare', () => {
  it('is the share of the roster that starts, not a chosen constant', () => {
    expect(startShare(LEAGUE)).toBeCloseTo(startingSlots(LEAGUE) / rosterLimit(LEAGUE), 12)
  })

  it('discounts extra pieces harder as benches get deeper', () => {
    const shallow = makeLeague({ benchSlots: 2 })
    const deep = makeLeague({ benchSlots: 12 })
    expect(startShare(deep)).toBeLessThan(startShare(shallow))
  })

  it('never credits a package more than its face value', () => {
    expect(startShare(LEAGUE)).toBeLessThanOrEqual(1)
  })
})

describe('packageValue', () => {
  it('prices a single player at exactly his value above replacement', () => {
    const p = player('one', 'WR', 2600, 6)
    expect(packageValue([p], LEAGUE, REPL)).toBeCloseTo(V(p), 9)
  })

  it('prices two players below the sum of their parts', () => {
    const [a, b] = [player('a', 'WR', 2800, 3), player('b', 'WR', 2600, 6)]
    const bundled = packageValue([a, b], LEAGUE, REPL)
    expect(bundled).toBeLessThan(V(a) + V(b))
    expect(bundled).toBeGreaterThan(Math.max(V(a), V(b)))
  })

  it('orders by value, so the best piece always counts in full', () => {
    const [a, b] = [player('a', 'WR', 2800, 3), player('b', 'WR', 2600, 6)]
    expect(packageValue([a, b], LEAGUE, REPL))
      .toBeCloseTo(packageValue([b, a], LEAGUE, REPL), 9)
    expect(packageValue([a, b], LEAGUE, REPL)).toBeGreaterThanOrEqual(V(a))
  })

  it('gives no credit at all for a player at or below replacement level', () => {
    const good = player('good', 'WR', 2800, 3)
    const scrub = player('scrub', 'WR', 400, 90)
    expect(V(scrub)).toBeLessThanOrEqual(0)
    expect(packageValue([good, scrub], LEAGUE, REPL))
      .toBeCloseTo(packageValue([good], LEAGUE, REPL), 9)
  })

  it('is zero for an empty package', () => {
    expect(packageValue([], LEAGUE, REPL)).toBe(0)
  })
})

describe('combinations', () => {
  const items = ['a', 'b', 'c', 'd']

  it('produces every subset up to the cap and no duplicates', () => {
    const out = combinations(items, 2)
    expect(out).toHaveLength(4 + 6)
    expect(new Set(out.map((c) => c.join(',')))).toHaveProperty('size', out.length)
  })

  it('never repeats a member inside one combination', () => {
    for (const combo of combinations(items, 3)) {
      expect(new Set(combo).size).toBe(combo.length)
    }
  })

  it('is stable, so two identical searches rank identically', () => {
    expect(combinations(items, 3)).toEqual(combinations(items, 3))
  })
})

describe('findOffers', () => {
  const find = (roster, target, opts) => findOffers(roster, target, LEAGUE, REPL, opts)

  it('finds a trade when surplus receivers can buy a starting back', () => {
    const { offers, reason } = find(surplusRoster(), eliteRb)
    expect(reason).toBeNull()
    expect(offers.length).toBeGreaterThan(0)
  })

  it('only ever offers players from your own roster', () => {
    const roster = surplusRoster()
    const held = new Set(roster.map((p) => p.id))
    for (const offer of find(roster, eliteRb).offers) {
      for (const p of offer.give) expect(held.has(p.id)).toBe(true)
    }
  })

  it('never offers the player it is trying to acquire', () => {
    for (const offer of find(surplusRoster(), eliteRb).offers) {
      expect(offer.give.map((p) => p.id)).not.toContain(eliteRb.id)
    }
  })

  it('never repeats a player inside one offer', () => {
    for (const offer of find(surplusRoster(), eliteRb).offers) {
      expect(new Set(offer.give.map((p) => p.id)).size).toBe(offer.give.length)
    }
  })

  it('only returns offers that actually improve the starting lineup', () => {
    for (const offer of find(surplusRoster(), eliteRb).offers) {
      expect(offer.gain).toBeGreaterThan(EVEN_THRESHOLD)
    }
  })

  it('clears the asking price without blowing past the overpay ceiling', () => {
    const { ask, offers } = find(surplusRoster(), eliteRb)
    for (const offer of offers) {
      expect(offer.offered).toBeGreaterThanOrEqual(ask)
      expect(offer.offered).toBeLessThanOrEqual(ask * (1 + MAX_OVERPAY))
      expect(offer.surplus).toBeCloseTo(offer.offered - ask, 9)
    }
  })

  // The invariant the whole feature rests on. A user who takes a suggested offer
  // into the grader must see the same number there.
  it('grades identically to the same trade entered by hand', () => {
    const roster = surplusRoster()
    for (const offer of find(roster, eliteRb).offers) {
      const byHand = gradeTrade(roster, offer.give, [eliteRb], LEAGUE, REPL, {})
      expect(offer.gain).toBeCloseTo(byHand.deltaPerWeek, 12)
      expect(offer.grade.verdict).toBe(byHand.verdict)
    }
  })

  it('forwards its options to the grader rather than grading a different trade', () => {
    const roster = surplusRoster()
    const record = { wins: 5, losses: 1 }
    const { offers } = find(roster, eliteRb, { record })
    expect(offers.length).toBeGreaterThan(0)
    for (const offer of offers) {
      const byHand = gradeTrade(roster, offer.give, [eliteRb], LEAGUE, REPL, { record })
      expect(offer.grade.situationalPerWeek).toBeCloseTo(byHand.situationalPerWeek, 12)
    }
  })

  it('ranks by what the trade does to your lineup, best first', () => {
    const { offers } = find(surplusRoster(), eliteRb)
    for (let i = 1; i < offers.length; i += 1) {
      expect(offers[i - 1].gain).toBeGreaterThanOrEqual(offers[i].gain)
    }
  })

  it('drops offers another offer already covers', () => {
    const { offers } = find(surplusRoster(), eliteRb)
    for (let i = 0; i < offers.length; i += 1) {
      for (let j = i + 1; j < offers.length; j += 1) {
        const [a, b] = [offers[i], offers[j]]
        // A later offer must beat an earlier one on price or on piece count,
        // or it had nothing to add.
        const covered = a.gain >= b.gain && a.surplus <= b.surplus && a.pieces <= b.pieces
        expect(covered).toBe(false)
      }
    }
  })

  it('respects the piece cap', () => {
    for (const offer of find(surplusRoster(), eliteRb, { maxPieces: 1 }).offers) {
      expect(offer.give).toHaveLength(1)
    }
  })

  it('respects the result limit', () => {
    expect(find(surplusRoster(), eliteRb, { limit: 2 }).offers.length).toBeLessThanOrEqual(2)
  })

  it('is deterministic', () => {
    const a = find(surplusRoster(), eliteRb)
    const b = find(surplusRoster(), eliteRb)
    expect(a.offers.map((o) => o.give.map((p) => p.id).join('+')))
      .toEqual(b.offers.map((o) => o.give.map((p) => p.id).join('+')))
  })
})

describe('findOffers: why there is nothing to show', () => {
  const find = (roster, target, opts) => findOffers(roster, target, LEAGUE, REPL, opts)

  it('says so when there is no roster to trade from', () => {
    expect(find([], eliteRb).reason).toBe('no-roster')
  })

  it('says so when you already hold him', () => {
    const roster = [...surplusRoster(), eliteRb]
    expect(find(roster, eliteRb).reason).toBe('held')
  })

  it('says so when nobody was named', () => {
    expect(find(surplusRoster(), null).reason).toBe('no-target')
  })

  it('refuses to shop for a player below replacement level', () => {
    const scrub = player('RB-scrub', 'RB', 500, 70)
    expect(V(scrub)).toBeLessThanOrEqual(0)
    const { reason, offers } = find(surplusRoster(), scrub)
    expect(reason).toBe('below-replacement')
    expect(offers).toHaveLength(0)
  })

  it('says so when the roster cannot get close to the price', () => {
    const thin = [player('WR-only', 'WR', 2050, 30)]
    const { reason } = find(thin, eliteRb)
    expect(reason).toBe('cannot-afford')
  })

  it('separates cannot-afford from would-not-help', () => {
    // Already strong everywhere, and the overpay ceiling lifted so the price is
    // payable several times over. Every way of paying it takes a better player
    // out of the same lineup the target would join, which is a real answer and
    // a different one from not being able to afford him.
    const stacked = [
      player('QB1', 'QB', 3800, 1),
      player('RB-a', 'RB', 2950, 1),
      player('RB-b', 'RB', 2900, 2),
      player('WR-a', 'WR', 2900, 2),
      player('WR-b', 'WR', 2850, 3),
      player('WR-c', 'WR', 2800, 4),
      player('TE1', 'TE', 2000, 1),
    ]
    const mid = player('RB-mid', 'RB', 2400, 12)
    expect(find(stacked, mid, { maxOverpay: 5 }).reason).toBe('no-gain')
    // Same roster, same player, ceiling back on: now he is simply unaffordable
    // at any price worth paying, which the finder must not confuse with the above.
    expect(find(stacked, mid).reason).toBe('cannot-afford')
  })

  it('has a sentence for every reason it can return', () => {
    const reasons = [
      find([], eliteRb).reason,
      find([...surplusRoster(), eliteRb], eliteRb).reason,
      find(surplusRoster(), null).reason,
      find(surplusRoster(), player('RB-scrub', 'RB', 500, 70)).reason,
      find([player('WR-only', 'WR', 2050, 30)], eliteRb).reason,
    ]
    for (const reason of reasons) expect(REASONS[reason]).toBeTruthy()
  })
})
