/**
 * The pure half of roster persistence.
 *
 * `loadRoster` / `saveRoster` touch `window` and are left to the browser; what
 * is worth pinning here is the reconciliation, because that is the part that
 * decides what happens to a link shared against last month's data file.
 */

import { describe, expect, it } from 'vitest'

import { formatIds, parseIds, reconcileIds } from '../roster.js'

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
