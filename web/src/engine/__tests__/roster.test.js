/**
 * The roster limit, the forced drop, and what a bench is actually worth.
 *
 * The bug behind all of this: `afterRoster` used to grow without a cap, and the
 * depth term summed every bench player with positive value above replacement.
 * So a 3-for-1 improved your bench score by counting two players you could not
 * legally keep. That is the same error as summing player values -- the one the
 * lineup model exists to fix -- one level further down.
 *
 * Written against synthetic players so each test states a property rather than
 * encoding today's rankings.
 */

import { describe, expect, it } from 'vitest'

import {
  COMPONENTS,
  bestLineup,
  DEPTH_DECAY,
  DEPTH_WEIGHT,
  depthValue,
  enforceLimit,
  gradeTrade,
  makeLeague,
  replacementForSlot,
  rosterLimit,
  startingSlots,
  uncoveredPositions,
} from '../index.js'

/** Points come only from receiving yards, so they are readable at a glance. */
function player(name, pos, recYd) {
  const proj = Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
  proj.rec_yd = recYd
  return { id: name, name, pos, team: 'FA', pos_adp_rank: 1, adp: 1, proj }
}

// 1QB / 2RB / 3WR / 1TE / 1FLEX = 8 starting slots.
const LEAGUE = makeLeague({ benchSlots: 2 })
const REPL = { QB: 100, RB: 100, WR: 100, TE: 100 }

// Points are recYd/10, so a 2000-yard player is 200 points and 100 above
// replacement. Named for what they are worth, not for anything real.
const starters = () => [
  player('QB-good', 'QB', 2000),
  player('RB-good', 'RB', 2000), player('RB-ok', 'RB', 1800),
  player('WR-best', 'WR', 2400), player('WR-good', 'WR', 2000),
  player('WR-ok', 'WR', 1800), player('WR-flex', 'WR', 1600),
  player('TE-good', 'TE', 2000),
]

describe('rosterLimit', () => {
  it('is the starting slots plus the bench', () => {
    expect(startingSlots(LEAGUE)).toBe(8)
    expect(rosterLimit(LEAGUE)).toBe(10)
    expect(rosterLimit(makeLeague({ benchSlots: 0 }))).toBe(8)
  })

  it('grows with the starting slots, not just the bench', () => {
    const superflex = makeLeague({ superflexSlots: 1, benchSlots: 2 })
    expect(rosterLimit(superflex)).toBe(rosterLimit(LEAGUE) + 1)
  })
})

describe('depthValue', () => {
  it('is worth less per point than a starting slot', () => {
    const one = [player('WR-bench', 'WR', 2000)]
    expect(depthValue(one, LEAGUE, REPL)).toBeCloseTo(DEPTH_WEIGHT * 100, 9)
  })

  it('ignores players below replacement, who are not depth but clutter', () => {
    const scrubs = [player('WR-scrub', 'WR', 500), player('RB-scrub', 'RB', 900)]
    expect(depthValue(scrubs, LEAGUE, REPL)).toBe(0)
  })

  // The property this replaced a flat sum for. Four spare receivers are not four
  // times as useful as one; the fourth is insurance against three things already
  // having gone wrong.
  it('decays down a position depth chart', () => {
    const bench = [
      player('WR-b1', 'WR', 2000), player('WR-b2', 'WR', 2000),
      player('WR-b3', 'WR', 2000),
    ]
    const got = depthValue(bench, LEAGUE, REPL)
    const want = DEPTH_WEIGHT * 100 * (1 + DEPTH_DECAY + DEPTH_DECAY ** 2)
    expect(got).toBeCloseTo(want, 9)
    expect(got).toBeLessThan(DEPTH_WEIGHT * 300)
  })

  it('does not decay across positions — each has its own depth chart', () => {
    const spread = [
      player('WR-b1', 'WR', 2000), player('RB-b1', 'RB', 2000),
      player('TE-b1', 'TE', 2000),
    ]
    expect(depthValue(spread, LEAGUE, REPL)).toBeCloseTo(DEPTH_WEIGHT * 300, 9)
  })

  it('counts the best backup at a position first, whatever order the bench is in', () => {
    const a = [player('WR-big', 'WR', 2400), player('WR-small', 'WR', 2000)]
    const b = [player('WR-small', 'WR', 2000), player('WR-big', 'WR', 2400)]
    expect(depthValue(a, LEAGUE, REPL)).toBeCloseTo(depthValue(b, LEAGUE, REPL), 9)
    // 140 at full weight beats 100 at full weight, so the bigger one leads.
    expect(depthValue(a, LEAGUE, REPL))
      .toBeCloseTo(DEPTH_WEIGHT * (140 + DEPTH_DECAY * 100), 9)
  })
})

describe('enforceLimit', () => {
  it('leaves a legal roster completely alone', () => {
    const roster = starters()
    const { kept, cut } = enforceLimit(roster, LEAGUE, REPL)
    expect(cut).toEqual([])
    expect(kept).toEqual(roster)
  })

  it('drops the cheapest player when over the limit', () => {
    const roster = [
      ...starters(),
      player('WR-spare', 'WR', 1900),
      player('WR-junk', 'WR', 1100),
      player('WR-extra', 'WR', 1850),
    ]
    const { kept, cut } = enforceLimit(roster, LEAGUE, REPL)
    expect(cut.map((p) => p.name)).toEqual(['WR-junk'])
    expect(kept).toHaveLength(rosterLimit(LEAGUE))
  })

  it('cuts as many as it needs to, worst first', () => {
    const roster = [
      ...starters(),
      player('WR-junk', 'WR', 1100),
      player('WR-worse', 'WR', 1050),
      player('WR-spare', 'WR', 1900),
      player('WR-extra', 'WR', 1850),
    ]
    const { kept, cut } = enforceLimit(roster, LEAGUE, REPL)
    expect(cut.map((p) => p.name)).toEqual(['WR-worse', 'WR-junk'])
    expect(kept).toHaveLength(rosterLimit(LEAGUE))
  })

  it('protects a starting slot before it protects the bench', () => {
    // Only one tight end, and a bench receiver worth more than he is. Dropping
    // the tight end empties a starting slot down to replacement, which costs more
    // than losing a backup -- and nothing had to tell it that tight ends matter.
    const roster = [
      ...starters(),
      player('WR-spare', 'WR', 2200),
      player('WR-extra', 'WR', 2100),
      player('WR-third', 'WR', 2050),
    ]
    const { cut } = enforceLimit(roster, LEAGUE, REPL)
    expect(cut.map((p) => p.pos)).not.toContain('TE')
  })

  it('is deterministic when two players are interchangeable', () => {
    const build = () => [
      ...starters(),
      player('WR-twin-a', 'WR', 1200),
      player('WR-twin-b', 'WR', 1200),
      player('WR-spare', 'WR', 1900),
    ]
    const first = enforceLimit(build(), LEAGUE, REPL).cut.map((p) => p.name)
    const second = enforceLimit(build(), LEAGUE, REPL).cut.map((p) => p.name)
    expect(first).toEqual(second)
  })
})

describe('uncoveredPositions', () => {
  const lineupFor = (roster) => bestLineup(roster, LEAGUE, LEAGUE.scoring, REPL)

  it('names every position when the roster is exactly the starting slots', () => {
    expect(uncoveredPositions(lineupFor(starters()), LEAGUE))
      .toEqual(['QB', 'RB', 'TE', 'WR'])
  })

  it('drops a position once somebody at it is on the bench', () => {
    const withCover = [...starters(), player('QB-back', 'QB', 1500)]
    expect(uncoveredPositions(lineupFor(withCover), LEAGUE)).not.toContain('QB')
  })

  // Counting bodies against `starters` would call this covered: four receivers
  // against a requirement of three. But the fourth is in the flex, so nobody is
  // actually spare -- which is why this reads the bench rather than the count.
  it('is not fooled by a fourth receiver who is filling the flex', () => {
    expect(starters().filter((p) => p.pos === 'WR')).toHaveLength(4)
    expect(LEAGUE.starters.WR).toBe(3)
    expect(uncoveredPositions(lineupFor(starters()), LEAGUE)).toContain('WR')
  })
})

describe('gradeTrade under a roster limit', () => {
  const roster = starters().concat(
    player('WR-bench1', 'WR', 1900),
    player('WR-bench2', 'WR', 1850),
  )

  it('needs no cuts when the trade only sends players away', () => {
    const graded = gradeTrade(
      roster, [roster.find((p) => p.name === 'WR-flex')], [], LEAGUE, REPL,
    )
    expect(graded.cuts).toEqual([])
  })

  // The bug, stated as a test. Three players in for one leaves you two over, and
  // the two you drop are a real cost the old model counted as a gain.
  it('charges a 3-for-1 for the players it cannot keep', () => {
    const give = [roster.find((p) => p.name === 'WR-flex')]
    const receive = [
      player('WR-in1', 'WR', 1700), player('WR-in2', 'WR', 1650),
      player('WR-in3', 'WR', 1620),
    ]
    const graded = gradeTrade(roster, give, receive, LEAGUE, REPL)

    expect(graded.after.slots.length + graded.after.bench.length)
      .toBe(rosterLimit(LEAGUE))
    expect(graded.cuts).toHaveLength(2)
    expect(graded.explanation).toMatch(/two over the roster limit/)
    for (const p of graded.cuts) expect(graded.explanation).toContain(p.name)
  })

  it('says so when a trade frees roster spots instead', () => {
    const give = ['WR-bench1', 'WR-bench2', 'WR-flex'].map((n) =>
      roster.find((p) => p.name === n))
    const graded = gradeTrade(roster, give, [player('WR-star', 'WR', 2600)], LEAGUE, REPL)
    expect(graded.cuts).toEqual([])
    expect(graded.spotsFreed).toBe(2)
    expect(graded.explanation).toMatch(/frees two roster spots/)
  })

  // A roster the user entered over the limit is their problem, not this trade's.
  // Capping both sides means the pre-existing overflow does not land on the grade.
  it('does not charge a trade for an overflow that predates it', () => {
    const over = roster.concat(player('WR-x', 'WR', 1500), player('WR-y', 'WR', 1450))
    const graded = gradeTrade(
      over, [over.find((p) => p.name === 'WR-flex')], [player('WR-in', 'WR', 1700)],
      LEAGUE, REPL,
    )
    expect(graded.overBefore).toBe(2)
    expect(graded.before.slots.length + graded.before.bench.length)
      .toBe(rosterLimit(LEAGUE))
  })

  it('needs no cuts when the bench is deep enough to absorb the trade', () => {
    const roomy = makeLeague({ benchSlots: 8 })
    const give = [roster.find((p) => p.name === 'WR-flex')]
    const receive = [player('WR-in1', 'WR', 1700), player('WR-in2', 'WR', 1650)]
    const graded = gradeTrade(roster, give, receive, roomy, REPL)
    expect(graded.cuts).toEqual([])
    expect(graded.explanation).not.toMatch(/roster limit/)
  })
})

describe('the unfilled-slot floor still holds under a cap', () => {
  it('scores an emptied slot at replacement, not zero', () => {
    // A zero-bench league forced down to eight players, one of whom is the only
    // tight end. Whatever gets cut, the lineup never scores a slot at nothing.
    expect(replacementForSlot('TE', REPL)).toBe(100)
  })
})
