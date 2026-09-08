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

import {
  band, buildMarket, gradeTrade, makeLeague, outlook, playerPoints, replacementPoints, vor,
} from '../index.js'

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
  const market = buildMarket(doc.curves, league, golden.weeksCovered)

  it('cuts the same tiers as Python', () => {
    for (const [pos, expected] of Object.entries(testCase.tiers)) {
      expect(market[pos].map((t) => [t.start, t.end])).toEqual(expected)
    }
  })

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
    const graded = gradeTrade(
      roster, give, receive, league, replacement,
      { weeksCovered: golden.weeksCovered, market },
    )

    it('lineup points match before and after', () => {
      expect(graded.before.points).toBeCloseTo(t.beforePoints, 9)
      expect(graded.after.points).toBeCloseTo(t.afterPoints, 9)
    })

    it('picks the same starters', () => {
      expect(graded.before.slots.map(([s, p]) => [s, p.name])).toEqual(t.beforeSlots)
      expect(graded.after.slots.map(([s, p]) => [s, p.name])).toEqual(t.afterSlots)
    })

    it('places both sides in the same tiers as Python', () => {
      for (const side of ['give', 'receive']) {
        expect(graded.tiers[side].map((r) => ({
          name: r.player.name, tier: r.tier, size: r.size, of: r.of,
        }))).toEqual(t.tiers[side])
      }
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
      { weeksCovered: t.weeksCovered, market: buildMarket(doc.curves, league, t.weeksCovered) },
    )
    expect(graded.deltaSeason).toBeCloseTo(t.deltaSeason, 9)
    expect(graded.deltaPerWeek).toBeCloseTo(t.deltaPerWeek, 9)
    expect(graded.cuts.map((p) => p.name)).toEqual(t.cuts)
    expect(graded.verdict).toBe(t.verdict)
    expect(graded.direction).toBe(t.direction)
    expect(graded.explanation).toBe(t.explanation)
  })
})

// Absence is the one place where a per-week model and a season-total model give
// different answers, so it is pinned rather than left to the behavioural suites.
describe('availability: the phase split matches Python', () => {
  const league = makeLeague(golden.horizonLeague)
  const replacement = replacementPoints(doc.curves, league)
  const market = buildMarket(doc.curves, league, golden.availabilityWeeks)

  it.each(golden.availability)('$id', (t) => {
    const graded = gradeTrade(
      roster,
      t.give.map((n) => byName.get(n)),
      t.receive.map((n) => byName.get(n)),
      league,
      replacement,
      {
        weeksCovered: t.weeksCovered,
        market,
        availability: t.out,
        ranksKnew: t.ranksKnew,
      },
    )
    expect(graded.phases).toBe(t.phases)
    expect(graded.deltaSeason).toBeCloseTo(t.deltaSeason, 9)
    expect(graded.deltaPerWeek).toBeCloseTo(t.deltaPerWeek, 9)
    expect(graded.verdict).toBe(t.verdict)
    expect(graded.direction).toBe(t.direction)
    expect(graded.explanation).toBe(t.explanation)
    expect(graded.after.slots.map(([s, p]) => [s, p.name])).toEqual(t.headlineSlots)
    expect(graded.afterNow.slots.map(([s, p]) => [s, p.name])).toEqual(t.nowSlots)
  })
})

// The record model is pure arithmetic over binomial coefficients, which is
// exactly the kind of thing that drifts between two implementations without
// either looking wrong on its own.
describe('record: the outlook matches Python', () => {
  const league = makeLeague(golden.horizonLeague)

  it.each(golden.outlooks)('$wins-$losses', (o) => {
    const got = outlook(o.wins, o.losses, league.teams, league.playoffSpots,
                        league.regularSeasonWeeks)
    expect(got.odds).toBeCloseTo(o.odds, 12)
    expect(got.regularWeight).toBeCloseTo(o.regularWeight, 12)
    expect(got.playoffWeight).toBeCloseTo(o.playoffWeight, 12)
    expect(got.cutline).toBe(o.cutline)
    expect(got.gamesLeft).toBe(o.gamesLeft)
    expect(got.leansWinNow).toBe(o.leansWinNow)
  })
})

describe('record: situational value matches Python', () => {
  const league = makeLeague(golden.horizonLeague)
  const replacement = replacementPoints(doc.curves, league)
  const market = buildMarket(doc.curves, league, golden.recordWeeks)

  it.each(golden.records)('$id', (t) => {
    const graded = gradeTrade(
      roster,
      t.give.map((n) => byName.get(n)),
      t.receive.map((n) => byName.get(n)),
      league,
      replacement,
      {
        weeksCovered: t.weeksCovered,
        market,
        availability: t.out,
        record: { wins: t.wins, losses: t.losses },
      },
    )
    expect(graded.playoffsAt).toBe(t.playoffsAt)
    expect(graded.deltaPerWeek).toBeCloseTo(t.deltaPerWeek, 9)
    if (t.situationalPerWeek === null) {
      expect(graded.situationalPerWeek).toBeNull()
    } else {
      expect(graded.situationalPerWeek).toBeCloseTo(t.situationalPerWeek, 9)
    }
    expect(graded.verdict).toBe(t.verdict)
    expect(graded.situationalVerdict).toBe(t.situationalVerdict)
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

  // The gate for this phase: the same trade has to land on opposite sides for a
  // team fighting to stay alive and one already looking at January.
  it('contain a trade that flips between a 0-3 team and a 3-0 one', () => {
    // Selling your own injured star, who is back only for January. A team with
    // an 11% chance of playing then should take the deal; one at 73% should not.
    const at = (w, l) => golden.records.find(
      (t) => t.wins === w && t.losses === l && t.id === `${w}-${l}/star-out-till-january/trap`,
    )
    const losing = at(0, 3)
    const winning = at(3, 0)
    expect(losing.situationalPerWeek).toBeGreaterThan(0)
    expect(winning.situationalPerWeek).toBeLessThan(0)
    expect(losing.situationalVerdict).toBe('Clear win')
    expect(winning.situationalVerdict).not.toBe('Clear win')

    // And the fair number is identical for both, which is the point: the trade
    // has not changed, only who is being offered it.
    expect(losing.deltaPerWeek).toBeCloseTo(winning.deltaPerWeek, 9)
  })

  // Monotone in the odds. A model that flipped around without ordering would
  // pass the test above by accident.
  it('value January more the likelier you are to be playing in it', () => {
    const sellers = golden.records
      .filter((t) => t.id.includes('star-out-till-january/trap') && t.situationalPerWeek !== null)
      .sort((a, b) => a.odds - b.odds)
    for (let i = 1; i < sellers.length; i += 1) {
      expect(sellers[i].situationalPerWeek).toBeLessThanOrEqual(
        sellers[i - 1].situationalPerWeek + 1e-9,
      )
    }
  })

  // An eliminated team has no weeks worth anything, and 0/0 is not a grade.
  it('include a record with nothing left to play for', () => {
    const dead = golden.records.filter((t) => t.odds === 0)
    expect(dead.length).toBeGreaterThan(0)
    for (const t of dead) expect(t.situationalPerWeek).toBeNull()
  })

  it('exercise a real absence, and the guard that cancels one', () => {
    expect(golden.availability.some((t) => t.phases > 1)).toBe(true)
    expect(golden.availability.some((t) => t.ranksKnew)).toBe(true)
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
          {
            weeksCovered: golden.weeksCovered,
            market: buildMarket(doc.curves, league, golden.weeksCovered),
          },
        )
        return Math.abs(g.deltaSeason - t.deltaSeason)
      })
    })
    expect(Math.max(...worst)).toBeLessThan(EPS)
  })
})
