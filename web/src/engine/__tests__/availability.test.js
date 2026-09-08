/**
 * Absence, and the guard against charging for it twice.
 *
 * The naive version of this feature scales an injured player's projection down by
 * the fraction of weeks he misses. That says the wrong thing: a back who misses
 * five of eight weeks is not a mediocre back for eight weeks, he is an elite back
 * for three and absent for five. Scaled flat, he can lose his starting slot to a
 * worse player who plays throughout — which is exactly backwards, because for
 * three weeks he is the best player on the roster.
 *
 * So the span is cut where the available set changes and a lineup is built per
 * piece. The tests below are mostly about that distinction holding.
 */

import { describe, expect, it } from 'vitest'

import {
  COMPONENTS,
  availabilityPhases,
  gradeTrade,
  makeLeague,
  phaseBoundaries,
  phasedLineup,
  weeksOut,
} from '../index.js'

function player(name, pos, recYd) {
  const proj = Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
  proj.rec_yd = recYd
  return { id: name, name, pos, team: 'FA', pos_adp_rank: 1, adp: 1, proj }
}

const LEAGUE = makeLeague({ benchSlots: 4 })
const REPL = { QB: 100, RB: 100, WR: 100, TE: 100 }
const WEEKS = 8

// Points are recYd/10. 2000 yards is 200 points, 100 above replacement.
const starters = () => [
  player('QB1', 'QB', 2000),
  player('RB-elite', 'RB', 3000), player('RB-ok', 'RB', 1800),
  player('WR1', 'WR', 2400), player('WR2', 'WR', 2000),
  player('WR3', 'WR', 1800), player('WR4', 'WR', 1600),
  player('TE1', 'TE', 2000),
]

describe('weeksOut', () => {
  it('is zero for a player nobody said anything about', () => {
    expect(weeksOut(player('A', 'WR', 1000), null)).toBe(0)
    expect(weeksOut(player('A', 'WR', 1000), {})).toBe(0)
  })

  it('reads the map by player id', () => {
    expect(weeksOut(player('A', 'WR', 1000), { A: 5 })).toBe(5)
  })

  it('refuses to treat nonsense as an absence', () => {
    const p = player('A', 'WR', 1000)
    expect(weeksOut(p, { A: -3 })).toBe(0)
    expect(weeksOut(p, { A: 2.7 })).toBe(2)
  })

  // The double-count guard. ADP already prices a known injury: a player who tore
  // something in week 2 has already fallen down the board, so his rank maps to a
  // lower curve row and the projection is discounted once already.
  it('applies nothing when the rankings already knew', () => {
    expect(weeksOut(player('A', 'WR', 1000), { A: 5 }, true)).toBe(0)
  })
})

describe('phaseBoundaries', () => {
  it('is a single phase when everyone is available', () => {
    expect(phaseBoundaries(starters(), null, WEEKS)).toEqual([0])
    expect(phaseBoundaries(starters(), {}, WEEKS)).toEqual([0])
  })

  it('cuts the span where somebody returns', () => {
    expect(phaseBoundaries(starters(), { 'RB-elite': 5 }, WEEKS)).toEqual([0, 5])
  })

  it('cuts once per distinct return week, in order', () => {
    expect(phaseBoundaries(starters(), { 'RB-elite': 5, WR1: 2, WR2: 5 }, WEEKS))
      .toEqual([0, 2, 5])
  })

  // Out past the horizon is out for good; there is no phase after the end.
  it('does not open a phase for a player who never returns', () => {
    expect(phaseBoundaries(starters(), { 'RB-elite': WEEKS }, WEEKS)).toEqual([0])
    expect(phaseBoundaries(starters(), { 'RB-elite': 99 }, WEEKS)).toEqual([0])
  })
})

describe('availabilityPhases', () => {
  it('leaves everyone available in a single phase', () => {
    const [only] = availabilityPhases(starters(), null, WEEKS)
    expect(only).toMatchObject({ start: 0, end: WEEKS, weeks: WEEKS })
    expect(only.available).toHaveLength(starters().length)
  })

  it('holds a player out of exactly the weeks he misses', () => {
    const phases = availabilityPhases(starters(), { 'RB-elite': 5 }, WEEKS)
    expect(phases.map((p) => [p.start, p.end])).toEqual([[0, 5], [5, WEEKS]])
    expect(phases[0].available.map((p) => p.name)).not.toContain('RB-elite')
    expect(phases[1].available.map((p) => p.name)).toContain('RB-elite')
  })

  it('accepts shared boundaries so two rosters can be compared week for week', () => {
    const bounds = [0, 3, 5]
    const phases = availabilityPhases(starters(), { 'RB-elite': 5 }, WEEKS, false, bounds)
    expect(phases.map((p) => p.start)).toEqual([0, 3, 5])
    // The extra cut at 3 does not invent an absence: he is out at 0 and 3 alike.
    expect(phases[1].available.map((p) => p.name)).not.toContain('RB-elite')
  })
})

describe('phasedLineup', () => {
  it('is exactly bestLineup when nobody is out', () => {
    const roster = starters()
    const withNone = phasedLineup(roster, LEAGUE, LEAGUE.scoring, REPL, null, WEEKS)
    const withEmpty = phasedLineup(roster, LEAGUE, LEAGUE.scoring, REPL, {}, WEEKS)
    expect(withNone.phases).toHaveLength(1)
    expect(withNone.points).toBeCloseTo(withEmpty.points, 9)
    expect(withNone.points).toBeCloseTo(withNone.now.points, 9)
  })

  // The gate, stated as arithmetic. A player out for five of eight weeks is worth
  // three eighths of what he would be worth playing throughout -- no more, and
  // crucially no less, because for those three weeks he is at full value.
  it('prices an absence as exactly the weeks missed', () => {
    const roster = starters()
    const healthy = phasedLineup(roster, LEAGUE, LEAGUE.scoring, REPL, null, WEEKS)
    const hurt = phasedLineup(roster, LEAGUE, LEAGUE.scoring, REPL, { 'RB-elite': 5 }, WEEKS)

    const outLineup = hurt.at(0)
    const backLineup = hurt.at(1)
    const expected = (outLineup.points * 5 + backLineup.points * 3) / WEEKS
    expect(hurt.points).toBeCloseTo(expected, 9)
    expect(backLineup.points).toBeCloseTo(healthy.now.points, 9)
  })

  it('starts the elite player the moment he is back, not a scaled-down version', () => {
    const hurt = phasedLineup(starters(), LEAGUE, LEAGUE.scoring, REPL, { 'RB-elite': 5 }, WEEKS)
    const namesAt = (i) => hurt.at(i).slots.map(([, p]) => p.name)
    expect(namesAt(0)).not.toContain('RB-elite')
    expect(namesAt(1)).toContain('RB-elite')
  })

  it('reports the lineup you would field this week as `now`', () => {
    const hurt = phasedLineup(starters(), LEAGUE, LEAGUE.scoring, REPL, { 'RB-elite': 5 }, WEEKS)
    expect(hurt.now).toBe(hurt.at(0))
    expect(hurt.now.slots.map(([, p]) => p.name)).not.toContain('RB-elite')
  })
})

describe('gradeTrade with an absence', () => {
  const roster = starters()
  const opts = (availability, ranksKnew = false) => ({
    weeksCovered: WEEKS, availability, ranksKnew,
  })
  const star = () => player('RB-star', 'RB', 3400)
  const give = () => [roster.find((p) => p.name === 'WR4')]

  it('is worth less the longer the incoming player is out', () => {
    const healthy = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts(null))
    const short = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts({ 'RB-star': 2 }))
    const long = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts({ 'RB-star': 6 }))

    expect(healthy.deltaPerWeek).toBeGreaterThan(short.deltaPerWeek)
    expect(short.deltaPerWeek).toBeGreaterThan(long.deltaPerWeek)
  })

  it('scales the gain by the fraction of the run he plays', () => {
    const healthy = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts(null))
    const hurt = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts({ 'RB-star': 5 }))
    // He plays 3 of 8, but the outgoing player leaves for all 8, so the gain is
    // not a clean 3/8 of the healthy one -- only the incoming half is prorated.
    expect(hurt.deltaSeason).toBeLessThan(healthy.deltaSeason * 0.5)
    expect(hurt.deltaSeason).toBeGreaterThan(0)
  })

  it('opens a second phase and says who is missing', () => {
    const hurt = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts({ 'RB-star': 5 }))
    expect(hurt.phases).toBe(2)
    expect(hurt.explanation).toContain('RB-star misses 5 of the next 8 weeks')
  })

  it('says out for the season rather than counting to the horizon', () => {
    const hurt = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts({ 'RB-star': WEEKS }))
    expect(hurt.explanation).toContain('RB-star is out for the season')
    expect(hurt.explanation).not.toMatch(/misses \d+ of/)
  })

  // The sentence that was wrong before phases were shared between the two sides:
  // in week one nothing changes, so `explain` reported "your starting lineup does
  // not change" for a trade that upgrades your best slot the moment he is back.
  it('describes the stretch the trade changes, not the stretch that comes first', () => {
    const hurt = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts({ 'RB-star': 5 }))
    expect(hurt.explanation).not.toMatch(/does not change/)
    expect(hurt.after.slots.map(([, p]) => p.name)).toContain('RB-star')
    expect(hurt.afterNow.slots.map(([, p]) => p.name)).not.toContain('RB-star')
  })

  // The double-count guard, end to end. ADP already priced the injury, so the
  // grade must be identical to the one with no absence declared at all.
  it('changes nothing when the rankings already knew', () => {
    const healthy = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts(null))
    const guarded = gradeTrade(
      roster, give(), [star()], LEAGUE, REPL, opts({ 'RB-star': 5 }, true),
    )
    expect(guarded.deltaSeason).toBeCloseTo(healthy.deltaSeason, 9)
    expect(guarded.verdict).toBe(healthy.verdict)
    expect(guarded.explanation).toBe(healthy.explanation)
    expect(guarded.phases).toBe(1)
  })

  // Who is worth keeping is a season question; who plays this week is not. A team
  // does not release its best back because he is hurt in October.
  it('does not let an absence decide who gets cut', () => {
    const tight = makeLeague({ benchSlots: 0 })
    const extra = [player('WR-spare', 'WR', 1500), player('WR-junk', 'WR', 900)]
    const full = roster.concat(extra)
    const hurtElite = gradeTrade(full, [], [], tight, REPL, opts({ 'RB-elite': 6 }))
    expect(hurtElite.cuts.map((p) => p.name)).not.toContain('RB-elite')
  })

  it('leaves every grade without an absence exactly as it was', () => {
    const a = gradeTrade(roster, give(), [star()], LEAGUE, REPL, { weeksCovered: WEEKS })
    const b = gradeTrade(roster, give(), [star()], LEAGUE, REPL, opts({}))
    expect(b.deltaSeason).toBeCloseTo(a.deltaSeason, 9)
    expect(b.explanation).toBe(a.explanation)
    expect(b.phases).toBe(1)
  })
})
