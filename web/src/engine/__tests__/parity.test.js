/**
 * The Python model is the reference implementation. These fixtures were produced
 * by `python3 export_golden.py`; if this file goes red, the two halves of the
 * system have drifted and one of them is now lying to users.
 *
 * Regenerate fixtures whenever players.json is rebuilt.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { band, gradeTrade, makeLeague, playerPoints, replacementPoints, vor } from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const golden = JSON.parse(readFileSync(join(here, 'golden.json'), 'utf8'))
const doc = JSON.parse(readFileSync(join(here, '../../../public/players.json'), 'utf8'))

const byName = new Map(doc.players.map((p) => [p.name, p]))
const roster = golden.roster.map((n) => byName.get(n))

const EPS = 1e-9

describe('band boundaries match Python', () => {
  it.each(golden.bands)('$delta -> $verdict', ({ delta, verdict }) => {
    expect(band(delta)).toBe(verdict)
  })
})

describe.each(golden.cases)('league: $name', (testCase) => {
  const league = makeLeague(testCase.league)
  const replacement = replacementPoints(doc.curves, league)

  it('replacement level matches Python', () => {
    for (const [pos, expected] of Object.entries(testCase.replacementPoints)) {
      expect(replacement[pos]).toBeCloseTo(expected, 9)
    }
  })

  it('player points and VOR match Python', () => {
    for (const expected of testCase.topVor) {
      const player = byName.get(expected.name)
      expect(player, `missing ${expected.name}`).toBeTruthy()
      expect(playerPoints(player, league.scoring)).toBeCloseTo(expected.points, 9)
      expect(vor(player, league, replacement)).toBeCloseTo(expected.vor, 9)
    }
  })

  describe.each(testCase.trades)('trade: $id', (t) => {
    const give = t.give.map((n) => byName.get(n))
    const receive = t.receive.map((n) => byName.get(n))
    const graded = gradeTrade(roster, give, receive, league, replacement)

    it('lineup points match before and after', () => {
      expect(graded.before.points).toBeCloseTo(t.beforePoints, 9)
      expect(graded.after.points).toBeCloseTo(t.afterPoints, 9)
    })

    it('picks the same starters', () => {
      expect(graded.before.slots.map(([s, p]) => [s, p.name])).toEqual(t.beforeSlots)
      expect(graded.after.slots.map(([s, p]) => [s, p.name])).toEqual(t.afterSlots)
    })

    it('picks the same forced cuts', () => {
      expect(graded.cuts.map((p) => p.name)).toEqual(t.cuts)
      expect(graded.spotsFreed).toBe(t.spotsFreed)
      expect(graded.overBefore).toBe(t.overBefore)
    })

    it('deltas, verdict and explanation match', () => {
      expect(graded.deltaSeason).toBeCloseTo(t.deltaSeason, 9)
      expect(graded.deltaPerWeek).toBeCloseTo(t.deltaPerWeek, 9)
      expect(graded.deltaDepth).toBeCloseTo(t.deltaDepth, 9)
      expect(graded.verdict).toBe(t.verdict)
      expect(graded.direction).toBe(t.direction)
      expect(graded.explanation).toBe(t.explanation)
    })
  })
})

// The horizon is a divisor, so it is the easiest place for the two
// implementations to drift without either looking wrong on its own.
describe('horizon: the per-week divisor matches Python', () => {
  const league = makeLeague(golden.horizonLeague)
  const replacement = replacementPoints(doc.curves, league)

  it.each(golden.horizons)('$id over $weeksCovered weeks', (t) => {
    const graded = gradeTrade(
      roster,
      t.give.map((n) => byName.get(n)),
      t.receive.map((n) => byName.get(n)),
      league,
      replacement,
      t.weeksCovered,
    )
    expect(graded.deltaSeason).toBeCloseTo(t.deltaSeason, 9)
    expect(graded.deltaPerWeek).toBeCloseTo(t.deltaPerWeek, 9)
    expect(graded.cuts.map((p) => p.name)).toEqual(t.cuts)
    expect(graded.verdict).toBe(t.verdict)
    expect(graded.direction).toBe(t.direction)
    expect(graded.explanation).toBe(t.explanation)
  })
})

describe('the fixtures themselves', () => {
  it('cover more than one league shape', () => {
    expect(golden.cases.length).toBeGreaterThanOrEqual(5)
  })

  it('include a superflex league, or QB scarcity goes untested', () => {
    expect(golden.cases.some((c) => c.league.superflexSlots > 0)).toBe(true)
  })

  it('include a bench short enough to force cuts, or the cut selector goes untested', () => {
    const withCuts = golden.cases.flatMap((c) => c.trades).filter((t) => t.cuts.length > 0)
    expect(withCuts.length).toBeGreaterThan(10)
    expect(withCuts.some((t) => t.cuts.length > 1)).toBe(true)
  })

  it('resolve every roster name against players.json', () => {
    expect(roster.every(Boolean)).toBe(true)
  })

  it('exercise a horizon other than a whole season', () => {
    expect(golden.horizons.some((t) => t.weeksCovered !== 17)).toBe(true)
  })

  it('agree with Python to well under a tenth of a point', () => {
    const worst = golden.cases.flatMap((c) => {
      const league = makeLeague(c.league)
      const replacement = replacementPoints(doc.curves, league)
      return c.trades.map((t) => {
        const g = gradeTrade(
          roster,
          t.give.map((n) => byName.get(n)),
          t.receive.map((n) => byName.get(n)),
          league,
          replacement,
        )
        return Math.abs(g.deltaSeason - t.deltaSeason)
      })
    })
    expect(Math.max(...worst)).toBeLessThan(EPS)
  })
})
