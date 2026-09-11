/**
 * The pure half of persistence, plus the league spec codec.
 *
 * `loadState` / `saveState` touch `window` and are left to the browser; what is
 * worth pinning here is reconciliation and normalisation, because those decide
 * what happens to a link shared against last month's data file or edited by hand.
 */

import { describe, expect, it } from 'vitest'

import {
  _internals, formatIds, formatOut, formatRecord, parseIds, parseOut, parseRecord,
  reconcileIds, reconcileTrade,
} from '../state.js'
import {
  DEFAULT_SPEC, LIMITS, TEAM_OPTIONS, decodeSpec, describeSpec, encodeSpec,
  normaliseSpec, settledValue, teamChoices, toLeague, typedValue,
} from '../league.js'
import { replacementRank } from '../engine/index.js'

describe('parseIds', () => {
  it('splits a comma-separated list', () => {
    expect(parseIds('00-0036900,00-0034796')).toEqual(['00-0036900', '00-0034796'])
  })

  it('tolerates the shapes a hand-edited URL produces', () => {
    expect(parseIds('a, b ,,c,')).toEqual(['a', 'b', 'c'])
    expect(parseIds('')).toEqual([])
    expect(parseIds(null)).toEqual([])
    expect(parseIds(undefined)).toEqual([])
  })
})

describe('formatIds', () => {
  it('round-trips with parseIds', () => {
    const ids = ['00-0036900', '00-0034796', '00-0039337']
    expect(parseIds(formatIds(ids))).toEqual(ids)
  })

  it('produces nothing for an empty roster', () => {
    expect(formatIds([])).toBe('')
  })
})

describe('reconcileIds', () => {
  const known = new Set(['a', 'b', 'c'])

  it('keeps known ids in the order given', () => {
    expect(reconcileIds(['c', 'a'], known)).toEqual(['c', 'a'])
  })

  it('drops ids this data file no longer knows', () => {
    // The weekly rebuild drops players who lose their nflverse id, so a link
    // shared in September can name someone gone by October.
    expect(reconcileIds(['a', 'gone', 'b'], known)).toEqual(['a', 'b'])
  })

  it('drops duplicates rather than starting the same player twice', () => {
    expect(reconcileIds(['a', 'b', 'a'], known)).toEqual(['a', 'b'])
  })

  it('survives a roster that is entirely stale', () => {
    expect(reconcileIds(['x', 'y'], known)).toEqual([])
  })
})

describe('reconcileTrade', () => {
  it('drops a give the roster does not hold, which would throw in gradeTrade', () => {
    const out = reconcileTrade({ roster: ['a', 'b'], give: ['a', 'zzz'], get: [] })
    expect(out.give).toEqual(['a'])
  })

  it('refuses to receive a player you already hold', () => {
    const out = reconcileTrade({ roster: ['a', 'b'], give: [], get: ['b', 'c'] })
    expect(out.get).toEqual(['c'])
  })

  it('allows receiving back a player you are giving away', () => {
    // Degenerate but legal, and the Python fixtures grade exactly this as the
    // identity trade: it must come out at zero rather than being filtered away.
    const out = reconcileTrade({ roster: ['a'], give: ['a'], get: ['a'] })
    expect(out).toEqual({ give: ['a'], get: ['a'] })
  })
})

describe('league spec', () => {
  it('round-trips through the URL encoding', () => {
    const spec = normaliseSpec({
      teams: 14, scoring: 'ppr',
      starters: { QB: 1, RB: 3, WR: 4, TE: 2 }, flexSlots: 3, superflexSlots: 1,
    })
    expect(decodeSpec(encodeSpec(spec))).toEqual(spec)
  })

  it('stays short enough to share', () => {
    expect(encodeSpec(DEFAULT_SPEC)).toBe('12-half_ppr-1.2.3.1-1-0-7-6-14-3')
  })

  // Bench slots were added to the end of this string after links had already
  // been shared. A five-field URL is a real thing people still hold, and the
  // strict length check that used to be here rejected them -- which silently
  // reset the whole league to defaults and graded the trade in the wrong format.
  it('still reads a link shared before bench slots existed', () => {
    const old = decodeSpec('14-ppr-1.3.2.1-2-1')
    expect(old).not.toBeNull()
    expect(old.teams).toBe(14)
    expect(old.scoring).toBe('ppr')
    expect(old.starters).toEqual({ QB: 1, RB: 3, WR: 2, TE: 1 })
    expect(old.flexSlots).toBe(2)
    expect(old.superflexSlots).toBe(1)
    expect(old.benchSlots).toBe(DEFAULT_SPEC.benchSlots)
  })

  it('rejects a field count it cannot place', () => {
    expect(decodeSpec('12-half_ppr-1.2.3.1')).toBeNull()
    expect(decodeSpec('12-half_ppr-1.2.3.1-1-0-7-6-14-3-99')).toBeNull()
  })

  // Fields have been appended twice. Every length in between is a real format
  // somebody's saved link still carries, and all of them have to survive.
  it('reads every shape of link it has ever written', () => {
    const six = decodeSpec('12-half_ppr-1.2.3.1-1-0-9')
    expect(six.benchSlots).toBe(9)
    expect(six.playoffSpots).toBe(DEFAULT_SPEC.playoffSpots)
    expect(six.regularSeasonWeeks).toBe(DEFAULT_SPEC.regularSeasonWeeks)

    const seven = decodeSpec('12-half_ppr-1.2.3.1-1-0-9-4')
    expect(seven.playoffSpots).toBe(4)
    expect(seven.regularSeasonWeeks).toBe(DEFAULT_SPEC.regularSeasonWeeks)

    const full = decodeSpec(encodeSpec({ ...DEFAULT_SPEC, playoffSpots: 4, playoffWeeks: 2 }))
    expect(full.playoffSpots).toBe(4)
    expect(full.playoffWeeks).toBe(2)
  })

  it('falls back rather than throwing on a mangled spec', () => {
    expect(decodeSpec('nonsense')).toBeNull()
    expect(decodeSpec('')).toBeNull()
    expect(decodeSpec(null)).toBeNull()
  })

  it('clamps a hand-edited URL back inside the limits', () => {
    const wild = decodeSpec('99-vibes-9.9.9.9-9-9')
    expect(wild.teams).toBe(LIMITS.teams[1])
    expect(wild.scoring).toBe('half_ppr')
    expect(wild.starters.WR).toBe(LIMITS.WR[1])
    expect(wild.superflexSlots).toBe(LIMITS.superflexSlots[1])
  })

  it('survives every kind of junk without throwing', () => {
    for (const junk of [undefined, null, {}, { teams: NaN }, { starters: null }, { scoring: 7 }]) {
      expect(() => normaliseSpec(junk)).not.toThrow()
      expect(normaliseSpec(junk).teams).toBeGreaterThanOrEqual(LIMITS.teams[0])
    }
  })

  it('describes itself for the header', () => {
    expect(describeSpec(DEFAULT_SPEC))
      .toBe('12-team Half PPR · 1QB/2RB/3WR/1TE/1FLEX · 7 bench')
  })
})

describe('the limits and the shipped curve agree', () => {
  // The settings caps and MIN_CURVE_DEPTH in model/schema.py are one decision in
  // two places. If a league the panel can build reaches past the curve, the
  // client prices replacement off a clamped rank and every grade in that league
  // is quietly wrong -- no error, just bad numbers.
  const FLOORS = { QB: 28, RB: 62, WR: 76, TE: 34 }

  it('cannot build a league that outruns the guaranteed curve depth', () => {
    const worst = toLeague({
      teams: LIMITS.teams[1],
      scoring: 'half_ppr',
      starters: { QB: LIMITS.QB[1], RB: LIMITS.RB[1], WR: LIMITS.WR[1], TE: LIMITS.TE[1] },
      flexSlots: LIMITS.flexSlots[1],
      superflexSlots: LIMITS.superflexSlots[1],
    })
    for (const pos of ['QB', 'RB', 'WR', 'TE']) {
      expect(replacementRank(pos, worst), `${pos} outruns its floor`)
        .toBeLessThanOrEqual(FLOORS[pos])
    }
  })
})

describe('weeks out survive a round trip', () => {
  const known = new Set(['a', 'b', 'c'])

  it('parses id:weeks pairs', () => {
    expect(parseOut('a:3,b:5', known)).toEqual({ a: 3, b: 5 })
  })

  it('drops ids this data file does not know', () => {
    // Same reasoning as reconcileIds: a link shared in September can name
    // somebody the October rebuild dropped, and an absence for a player who no
    // longer exists is invisible state.
    expect(parseOut('a:3,zzz:5', known)).toEqual({ a: 3 })
  })

  it('treats zero, negative and nonsense as healthy rather than as an error', () => {
    expect(parseOut('a:0,b:-2,c:x', known)).toEqual({})
    expect(parseOut('', known)).toEqual({})
    expect(parseOut(null, known)).toEqual({})
  })

  it('clamps a hand-edited number to a season', () => {
    expect(parseOut('a:99', known)).toEqual({ a: _internals.MAX_WEEKS_OUT })
  })

  it('writes nothing at all for a healthy roster', () => {
    expect(formatOut({})).toBe('')
    expect(formatOut({ a: 0 })).toBe('')
  })

  it('round-trips through the URL', () => {
    const out = { a: 3, c: 17 }
    expect(parseOut(formatOut(out), known)).toEqual(out)
  })
})

describe('a record round-trips, and absent means absent', () => {
  it('parses wins-losses', () => {
    expect(parseRecord('3-1')).toEqual({ wins: 3, losses: 1 })
    expect(parseRecord('0-0')).toEqual({ wins: 0, losses: 0 })
  })

  // A team that has played no games and a team whose record nobody entered are
  // different states. Only the second one leaves the grade untouched, so an
  // absent record must not collapse into 0-0.
  it('is null when nobody said', () => {
    expect(parseRecord('')).toBeNull()
    expect(parseRecord(null)).toBeNull()
    expect(parseRecord('nonsense')).toBeNull()
    expect(formatRecord(null)).toBe('')
  })

  it('clamps a hand-edited record rather than throwing', () => {
    expect(parseRecord('99-99')).toEqual({ wins: 17, losses: 17 })
  })

  it('round-trips through the URL', () => {
    expect(parseRecord(formatRecord({ wins: 2, losses: 5 }))).toEqual({ wins: 2, losses: 5 })
  })
})

describe('teamChoices', () => {
  it('offers the three sizes almost every league runs', () => {
    expect(teamChoices(12)).toEqual([8, 10, 12])
    expect(TEAM_OPTIONS).toEqual([8, 10, 12])
  })

  // The one that matters. A 14-team link predates this control, and a picker
  // with nothing matching to show would resize that league on first render
  // without anybody touching it.
  it('keeps a legal size that is not on the list, so no link is silently resized', () => {
    expect(teamChoices(14)).toEqual([8, 10, 12, 14])
    expect(teamChoices(9)).toEqual([8, 9, 10, 12])
  })

  it('normalises what it is given rather than trusting it', () => {
    expect(teamChoices(99)).toEqual([8, 10, 12, 14])
    expect(teamChoices(2)).toEqual([8, 10, 12])
    expect(teamChoices(undefined)).toEqual([8, 10, 12])
    expect(teamChoices('10')).toEqual([8, 10, 12])
  })

  it('never repeats a size and always climbs', () => {
    for (const current of [8, 9, 10, 11, 12, 13, 14]) {
      const choices = teamChoices(current)
      expect(new Set(choices).size).toBe(choices.length)
      expect([...choices].sort((a, b) => a - b)).toEqual(choices)
      expect(choices).toContain(normaliseSpec({ teams: current }).teams)
    }
  })

  it('only ever offers sizes the engine will accept', () => {
    for (const current of [8, 11, 14]) {
      for (const n of teamChoices(current)) {
        expect(n).toBeGreaterThanOrEqual(LIMITS.teams[0])
        expect(n).toBeLessThanOrEqual(LIMITS.teams[1])
        expect(normaliseSpec({ teams: n }).teams).toBe(n)
      }
    }
  })
})

describe('typing into a bounded number field', () => {
  const WEEKS = LIMITS.regularSeasonWeeks   // [8, 17] -- two digits, minimum above 1
  const BENCH = LIMITS.benchSlots           // [0, 14] -- two digits, minimum at zero

  /** Replays a sequence of field contents and reports what each one commits. */
  const walk = (steps, bounds) => steps.map((raw) => typedValue(raw, bounds))

  // The reported bug, as a test. Every one of these keystrokes used to be
  // clamped on arrival, so the field was 8 before the second digit landed and
  // 10 could not be reached at all on a phone.
  it('lets a two-digit value be typed one digit at a time', () => {
    expect(walk(['', '1', '10'], WEEKS)).toEqual([null, null, 10])
    expect(walk(['', '1', '16'], WEEKS)).toEqual([null, null, 16])
  })

  it('holds an empty field instead of snapping back to a default', () => {
    expect(typedValue('', WEEKS)).toBeNull()
    expect(typedValue('', BENCH)).toBeNull()
  })

  it('commits immediately once the value is legal, so the page keeps up', () => {
    expect(typedValue('12', WEEKS)).toBe(12)
    expect(typedValue('0', BENCH)).toBe(0)
    expect(typedValue('14', BENCH)).toBe(14)
  })

  it('holds anything out of range rather than correcting it mid-keystroke', () => {
    expect(typedValue('1', WEEKS)).toBeNull()
    expect(typedValue('99', WEEKS)).toBeNull()
    expect(typedValue('15', BENCH)).toBeNull()
  })

  it('holds what is not a number at all', () => {
    for (const raw of ['-', '.', 'e', 'abc', '1.5']) {
      expect(typedValue(raw, WEEKS)).toBeNull()
    }
  })

  it('clamps on the way out rather than on the way in', () => {
    expect(settledValue('1', WEEKS)).toBe(8)
    expect(settledValue('99', WEEKS)).toBe(17)
    expect(settledValue('15', BENCH)).toBe(14)
    expect(settledValue('-4', BENCH)).toBe(0)
    expect(settledValue('11.6', WEEKS)).toBe(12)
  })

  it('keeps the last good value when the field is left unusable', () => {
    for (const raw of [null, undefined, '', '   ', '-', 'abc']) {
      expect(settledValue(raw, WEEKS)).toBeNull()
    }
  })

  it('only ever settles on a value the spec would keep', () => {
    for (const raw of ['0', '1', '8', '13', '17', '40', '-9']) {
      const settled = settledValue(raw, WEEKS)
      expect(normaliseSpec({ regularSeasonWeeks: settled }).regularSeasonWeeks).toBe(settled)
    }
  })
})
