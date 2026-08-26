/**
 * Behavioural tests for the engine, written against synthetic players so each
 * one states a property rather than encoding today's rankings.
 *
 * The 2-for-1 test is the reason this file exists. Everything else is guard rail.
 */

import { describe, expect, it } from 'vitest'

import {
  COMPONENTS,
  HALF_PPR,
  band,
  bestLineup,
  curveAt,
  gradeTrade,
  makeLeague,
  parseDocument,
  playerPoints,
  replacementForSlot,
  replacementPoints,
  replacementRank,
  score,
  slotStem,
  vor,
} from '../index.js'

/** A player whose only production is receiving yards, so points are predictable. */
function player(name, pos, recYd, posRank = 1) {
  const proj = Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
  proj.rec_yd = recYd
  return { id: name, name, pos, team: 'FA', pos_adp_rank: posRank, adp: posRank, proj }
}

/** A curve that falls off linearly, so replacement level is easy to reason about. */
function linearCurve(depth, top, step) {
  return Array.from({ length: depth }, (_, i) => {
    const row = Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
    row.rec_yd = top - i * step
    return row
  })
}

// Slopes are steep enough that replacement level lands *below* the players who
// would actually start. A flatter curve puts replacement above the flex starter,
// which cannot happen with real data and makes fixtures impossible to reason
// about.
const CURVES = {
  QB: linearCurve(40, 4000, 40),
  RB: linearCurve(80, 3000, 30),
  WR: linearCurve(100, 3000, 30),
  TE: linearCurve(40, 2000, 40),
}

const LEAGUE = makeLeague()
const REPL = replacementPoints(CURVES, LEAGUE)

describe('score', () => {
  it('is a dot product of components and rules', () => {
    expect(score({ rec: 10, rec_yd: 100, rec_td: 1 }, HALF_PPR)).toBeCloseTo(21, 9)
  })

  it('treats missing components as zero rather than NaN', () => {
    expect(score({}, HALF_PPR)).toBe(0)
    expect(Number.isNaN(score({ rec_yd: 100 }, {}))).toBe(false)
  })

  it('respects the scoring format', () => {
    const line = { rec: 100, rec_yd: 1000 }
    const ppr = score(line, { ...HALF_PPR, rec: 1 })
    const standard = score(line, { ...HALF_PPR, rec: 0 })
    expect(ppr - standard).toBeCloseTo(100, 9)
  })
})

describe('curveAt', () => {
  // Derived from the curve rather than hardcoded, so tuning the fixture slope
  // cannot silently invalidate the expectations.
  const wrAt = (rank) => CURVES.WR[rank - 1].rec_yd

  it('returns the exact row at an integer rank', () => {
    expect(curveAt(CURVES, 'WR', 1).rec_yd).toBeCloseTo(wrAt(1), 9)
    expect(curveAt(CURVES, 'WR', 10).rec_yd).toBeCloseTo(wrAt(10), 9)
  })

  it('interpolates between ranks', () => {
    const midpoint = (wrAt(10) + wrAt(11)) / 2
    expect(curveAt(CURVES, 'WR', 10.5).rec_yd).toBeCloseTo(midpoint, 9)
    expect(curveAt(CURVES, 'WR', 10.25).rec_yd)
      .toBeCloseTo(wrAt(10) + (wrAt(11) - wrAt(10)) * 0.25, 9)
  })

  it('clamps rather than extrapolating past the end of the curve', () => {
    const last = curveAt(CURVES, 'WR', 100).rec_yd
    expect(curveAt(CURVES, 'WR', 500).rec_yd).toBeCloseTo(last, 9)
    expect(curveAt(CURVES, 'WR', 0).rec_yd).toBeCloseTo(3000, 9)
  })
})

describe('replacement level', () => {
  it('scales with league size', () => {
    const shallow = replacementRank('RB', makeLeague({ teams: 8 }))
    const deep = replacementRank('RB', makeLeague({ teams: 14 }))
    expect(deep).toBeGreaterThan(shallow)
  })

  it('makes every startable player more valuable in a deeper league', () => {
    const p = player('Back', 'RB', 2500, 5)
    const shallow = makeLeague({ teams: 8 })
    const deep = makeLeague({ teams: 14 })
    expect(vor(p, deep, replacementPoints(CURVES, deep)))
      .toBeGreaterThan(vor(p, shallow, replacementPoints(CURVES, shallow)))
  })

  it('accounts for flex usage, not just dedicated slots', () => {
    const noFlex = replacementRank('RB', makeLeague({ flexSlots: 0 }))
    const withFlex = replacementRank('RB', makeLeague({ flexSlots: 1 }))
    expect(withFlex).toBeGreaterThan(noFlex)
  })

  it('pushes QB replacement much deeper in superflex', () => {
    const oneQb = replacementRank('QB', makeLeague())
    const superflex = replacementRank('QB', makeLeague({ superflexSlots: 1 }))
    expect(superflex).toBeGreaterThan(oneQb * 1.5)
  })
})

describe('bestLineup', () => {
  const roster = [
    player('QB-good', 'QB', 4000), player('QB-bad', 'QB', 3000),
    player('RB-a', 'RB', 2000), player('RB-b', 'RB', 1800), player('RB-c', 'RB', 1500),
    player('WR-a', 'WR', 2200), player('WR-b', 'WR', 2100),
    player('WR-c', 'WR', 1900), player('WR-d', 'WR', 1700),
    player('TE-a', 'TE', 1600),
  ]

  it('starts the best player at each dedicated slot', () => {
    const { slots } = bestLineup(roster, LEAGUE, HALF_PPR, REPL)
    const filled = Object.fromEntries(slots.map(([s, p]) => [s, p.name]))
    expect(filled.QB).toBe('QB-good')
    expect(filled.RB1).toBe('RB-a')
    expect(filled.WR1).toBe('WR-a')
    expect(filled.TE).toBe('TE-a')
  })

  it('gives FLEX to the best remaining eligible player', () => {
    const { slots } = bestLineup(roster, LEAGUE, HALF_PPR, REPL)
    expect(Object.fromEntries(slots.map(([s, p]) => [s, p.name])).FLEX).toBe('WR-d')
  })

  it('never starts a quarterback at FLEX', () => {
    const { slots } = bestLineup(roster, LEAGUE, HALF_PPR, REPL)
    const flex = slots.find(([s]) => s === 'FLEX')
    expect(flex[1].pos).not.toBe('QB')
  })

  it('allows a quarterback at SUPERFLEX', () => {
    const league = makeLeague({ superflexSlots: 1 })
    const { slots } = bestLineup(roster, league, HALF_PPR, REPL)
    const sf = slots.find(([s]) => s === 'SUPERFLEX')
    expect(sf[1].name).toBe('QB-bad')
  })

  it('benches everyone who does not fit', () => {
    const { slots, bench } = bestLineup(roster, LEAGUE, HALF_PPR, REPL)
    expect(slots.length + bench.length).toBe(roster.length)
  })

  it('scores an unfilled slot at replacement level, not zero', () => {
    const noTe = roster.filter((p) => p.pos !== 'TE')
    const withRepl = bestLineup(noTe, LEAGUE, HALF_PPR, REPL)
    const withoutRepl = bestLineup(noTe, LEAGUE, HALF_PPR, null)
    expect(withRepl.unfilled).toContain('TE')
    expect(withRepl.points - withoutRepl.points).toBeCloseTo(REPL.TE, 9)
    expect(REPL.TE).toBeGreaterThan(0)
  })

  it('is order-independent', () => {
    const shuffled = [...roster].reverse()
    expect(bestLineup(shuffled, LEAGUE, HALF_PPR, REPL).points)
      .toBeCloseTo(bestLineup(roster, LEAGUE, HALF_PPR, REPL).points, 9)
  })
})

describe('gradeTrade: consolidation', () => {
  // Deep at receiver, thin at back -- the roster shape that makes the 2-for-1
  // question interesting.
  const roster = [
    player('QB1', 'QB', 4000),
    player('RB-weak-1', 'RB', 1400, 30), player('RB-weak-2', 'RB', 1300, 34),
    player('WR-elite', 'WR', 2900, 2),
    player('WR-good-1', 'WR', 2300, 10), player('WR-good-2', 'WR', 2200, 12),
    player('WR-good-3', 'WR', 2100, 14), player('WR-good-4', 'WR', 2050, 16),
    player('WR-good-5', 'WR', 2000, 18),
    player('TE1', 'TE', 1600),
  ]

  it('THE KEY TEST: two mid receivers do not beat one elite receiver', () => {
    const graded = gradeTrade(
      roster,
      [roster.find((p) => p.name === 'WR-elite')],
      [player('WR-mid-1', 'WR', 1900, 22), player('WR-mid-2', 'WR', 1850, 24)],
      LEAGUE,
      REPL,
    )
    // A sum-of-values model returns +850 yards here and calls it a win.
    expect(graded.deltaPerWeek).toBeLessThan(0)
    expect(graded.direction).toBe('loss')
  })

  it('a player who cannot crack the lineup adds nothing to the headline', () => {
    const graded = gradeTrade(roster, [], [player('WR-bench', 'WR', 1000, 60)], LEAGUE, REPL)
    expect(graded.deltaPerWeek).toBeCloseTo(0, 9)
  })

  it('but does show up in the depth line if it beats replacement', () => {
    // Above replacement, below the flex starter: a real bench asset.
    const graded = gradeTrade(roster, [], [player('WR-useful', 'WR', 1950, 20)], LEAGUE, REPL)
    expect(graded.deltaPerWeek).toBeCloseTo(0, 9)
    expect(graded.deltaDepth).toBeGreaterThan(0)
  })

  it('rewards consolidating surplus receivers into a needed back', () => {
    const graded = gradeTrade(
      roster,
      [roster.find((p) => p.name === 'WR-good-4'), roster.find((p) => p.name === 'WR-good-5')],
      [player('RB-elite', 'RB', 2800, 2)],
      LEAGUE,
      REPL,
    )
    expect(graded.deltaPerWeek).toBeGreaterThan(0)
  })

  it('never reports depth inside the headline number', () => {
    const graded = gradeTrade(roster, [], [player('WR-useful', 'WR', 1950, 20)], LEAGUE, REPL)
    expect(graded.deltaPerWeek).not.toBeCloseTo(graded.deltaDepth, 3)
  })
})

describe('gradeTrade: basics', () => {
  // Named so nothing collides with a slot label — a player called "RB2" makes
  // "the biggest move is at RB2: RB2 becomes ..." impossible to read.
  const roster = [
    player('Passer', 'QB', 4000, 2),
    player('Ace', 'RB', 2400, 4), player('Deuce', 'RB', 2000, 12),
    player('Alpha', 'WR', 2500, 4), player('Bravo', 'WR', 2200, 10),
    player('Charlie', 'WR', 2000, 16), player('Delta', 'WR', 1900, 20),
    player('Tight', 'TE', 1700, 3),
    player('Scrub', 'WR', 900, 70),
  ]
  const find = (name) => roster.find((p) => p.name === name)

  it('a player for himself is exactly zero', () => {
    const alpha = find('Alpha')
    const graded = gradeTrade(roster, [alpha], [alpha], LEAGUE, REPL)
    expect(graded.deltaSeason).toBe(0)
    expect(graded.direction).toBe('even')
  })

  it('refuses to grade a trade with players you do not own', () => {
    expect(() => gradeTrade(roster, [player('Stranger', 'WR', 2000)], [], LEAGUE, REPL))
      .toThrow(/not on the roster/)
  })

  it('is antisymmetric: what you gain, they lose', () => {
    const ace = find('Ace')
    const incoming = player('Rocket', 'RB', 2700, 2)
    const forward = gradeTrade(roster, [ace], [incoming], LEAGUE, REPL)

    const mirrored = roster.map((p) => (p === ace ? incoming : p))
    const backward = gradeTrade(mirrored, [incoming], [ace], LEAGUE, REPL)

    expect(forward.deltaSeason).toBeCloseTo(-backward.deltaSeason, 9)
  })

  it('names the slot that moved and both players in it', () => {
    // Acquiring a better RB pushes Ace down to RB2, so the biggest single-slot
    // change is at RB2 and the sentence describes THAT slot. The acquired player
    // is not necessarily the one named — see the note below.
    const graded = gradeTrade(roster, [find('Deuce')], [player('Rocket', 'RB', 2600, 3)], LEAGUE, REPL)
    expect(graded.explanation).toMatch(/You gain [\d.]+ points a week\./)
    expect(graded.explanation).toMatch(/is at RB[12]:/)
    expect(graded.explanation).toMatch(/becomes \w+ \(RB\d+-level\)/)
  })

  it('KNOWN COPY GAP: the acquired player can be absent from the sentence', () => {
    // Documented, not asserted as desirable. When an incoming player displaces
    // someone who then displaces someone else, the largest slot delta is the
    // downstream one, and the explanation names the cascade rather than the
    // trade. Revisit in Phase 5 when the copy meets a real reader.
    const graded = gradeTrade(roster, [find('Deuce')], [player('Rocket', 'RB', 2600, 3)], LEAGUE, REPL)
    expect(graded.explanation).not.toContain('Rocket')
    expect(graded.deltaPerWeek).toBeGreaterThan(0)
  })

  it('says nothing changed when nothing changed', () => {
    const graded = gradeTrade(roster, [find('Scrub')], [player('Scrub2', 'WR', 890, 72)], LEAGUE, REPL)
    expect(graded.explanation).toContain('Nothing you would start is affected')
  })
})

describe('band', () => {
  it('is direction-aware — a loss is never called a win', () => {
    expect(band(-6)).toBe('Lopsided loss')
    expect(band(6)).toBe('Lopsided win')
    expect(band(-3)).toBe('Clear loss')
    expect(band(3)).toBe('Clear win')
  })

  it('calls small moves even in both directions', () => {
    expect(band(0.4)).toBe('Essentially even')
    expect(band(-0.4)).toBe('Essentially even')
    expect(band(0)).toBe('Essentially even')
  })

  it('is symmetric in magnitude', () => {
    for (const d of [0.6, 1.9, 2.1, 4.9, 5.1, 20]) {
      expect(band(d).split(' ').slice(0, -1)).toEqual(band(-d).split(' ').slice(0, -1))
    }
  })
})

describe('slot helpers', () => {
  it('strips slot numbering', () => {
    expect(slotStem('WR3')).toBe('WR')
    expect(slotStem('FLEX2')).toBe('FLEX')
    expect(slotStem('QB')).toBe('QB')
  })

  it('prices FLEX at the best replacement it is allowed to use', () => {
    const repl = { QB: 300, RB: 150, WR: 120, TE: 100 }
    expect(replacementForSlot('FLEX', repl)).toBe(150)
    expect(replacementForSlot('SUPERFLEX', repl)).toBe(300)
    expect(replacementForSlot('TE', repl)).toBe(100)
  })
})

describe('parseDocument', () => {
  const good = {
    schema_version: 1,
    generated_at: '2026-08-26T00:00:00Z',
    season: 2026,
    basis: 'full_season',
    curves: CURVES,
    players: [],
    sources: { ranks_as_of: '2026-08-21' },
    curve_meta: { seasons_used: [2023, 2024, 2025] },
  }

  it('pulls out the pieces the engine needs', () => {
    const { curves, meta } = parseDocument(good)
    expect(curves.WR).toHaveLength(100)
    expect(meta.ranksAsOf).toBe('2026-08-21')
    expect(meta.basis).toBe('full_season')
  })

  it('throws on a schema version it does not speak', () => {
    expect(() => parseDocument({ ...good, schema_version: 2 })).toThrow(/schema_version/)
    expect(() => parseDocument(null)).toThrow(/schema_version/)
  })
})
