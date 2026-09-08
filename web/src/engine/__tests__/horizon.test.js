/**
 * The horizon: how many weeks the projections in a document actually cover.
 *
 * A rest-of-season file is not a different model, it is the same model over a
 * shorter span. `build_players.py` scales every player projection *and* every
 * curve row by `weeks_remaining / 17`, so a week-10 file describes seven weeks
 * of football rather than seventeen.
 *
 * That makes the per-week number a two-part fraction, and until this was fixed
 * the client only scaled one of them: the numerator came from the file and the
 * denominator was a hardcoded 17. The result was a per-week figure understated
 * by exactly `weeksRemaining / 17` -- more than half of it, in season, silently,
 * with every test still green. Hence this file.
 *
 * The property worth asserting is not "the number gets bigger". It is that the
 * horizon cancels: grading the same trade against a full-season file and against
 * its rest-of-season projection must give the *same* points per week, because
 * points per week is what it claims to be.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import {
  GAMES_PER_SEASON,
  gradeTrade,
  makeLeague,
  parseDocument,
  replacementPoints,
} from '../index.js'

const here = dirname(fileURLToPath(import.meta.url))
const golden = JSON.parse(readFileSync(join(here, 'golden.json'), 'utf8'))
const fullSeason = JSON.parse(readFileSync(join(here, '../../../public/players.json'), 'utf8'))

/**
 * The shipped file, rebased onto a shorter span.
 *
 * Scaled exactly rather than rounded to two decimals the way the real build
 * does. The rounding is real but it is not what this file is testing, and
 * carrying it in would put a fuzzy tolerance on a property that should hold to
 * floating-point precision.
 */
function restOfSeason(doc, weeks) {
  const k = weeks / GAMES_PER_SEASON
  const scaleRow = (row) => Object.fromEntries(Object.entries(row).map(([c, v]) => [c, v * k]))

  return {
    ...doc,
    basis: 'rest_of_season',
    weeks_remaining: weeks,
    curves: Object.fromEntries(
      Object.entries(doc.curves).map(([pos, rows]) => [pos, rows.map(scaleRow)]),
    ),
    players: doc.players.map((p) => ({ ...p, proj: scaleRow(p.proj) })),
  }
}

const LEAGUE = makeLeague(golden.horizonLeague)

/** Grade one trade against one document, reading the horizon off the document. */
function grade(doc, give, receive) {
  const { players, curves, meta } = parseDocument(doc)
  const byName = new Map(players.map((p) => [p.name, p]))
  const roster = golden.roster.map((n) => byName.get(n))
  return gradeTrade(
    roster,
    give.map((n) => byName.get(n)),
    receive.map((n) => byName.get(n)),
    LEAGUE,
    replacementPoints(curves, LEAGUE),
    meta.weeksCovered,
  )
}

// One trade with a large, unambiguous delta, so the arithmetic is visible.
const GIVE = ['Michael Wilson']
const RECEIVE = ['Bijan Robinson']

describe('a rest-of-season file grades the same trade the same way', () => {
  const full = grade(fullSeason, GIVE, RECEIVE)

  it.each([14, 8, 3, 1])('%i weeks left: same points per week', (weeks) => {
    const short = grade(restOfSeason(fullSeason, weeks), GIVE, RECEIVE)
    expect(short.deltaPerWeek).toBeCloseTo(full.deltaPerWeek, 9)
  })

  it.each([14, 8, 3, 1])('%i weeks left: same verdict and direction', (weeks) => {
    const short = grade(restOfSeason(fullSeason, weeks), GIVE, RECEIVE)
    expect(short.verdict).toBe(full.verdict)
    expect(short.direction).toBe(full.direction)
  })

  // The season-total delta *should* shrink -- there is less football left to
  // play. Asserting it explicitly separates "the horizon cancelled" from "the
  // scaling never happened", which would also make the test above pass.
  it.each([14, 8, 3, 1])('%i weeks left: the season total shrinks with the span', (weeks) => {
    const short = grade(restOfSeason(fullSeason, weeks), GIVE, RECEIVE)
    expect(short.deltaSeason).toBeCloseTo(full.deltaSeason * (weeks / GAMES_PER_SEASON), 6)
  })
})

describe('the bug this replaced', () => {
  // Pinning the old behaviour so nobody reintroduces it by "simplifying" the
  // divisor back to a constant. In a week-10 file the trade above went from
  // lopsided to slight.
  it('dividing by 17 regardless understates a short horizon', () => {
    const weeks = 7
    const short = grade(restOfSeason(fullSeason, weeks), GIVE, RECEIVE)
    const asIfWholeSeason = short.deltaSeason / GAMES_PER_SEASON

    expect(asIfWholeSeason).toBeCloseTo(short.deltaPerWeek * (weeks / GAMES_PER_SEASON), 9)
    expect(Math.abs(asIfWholeSeason)).toBeLessThan(Math.abs(short.deltaPerWeek) * 0.5)
  })
})

describe('the depth note holds its meaning across horizons', () => {
  // `deltaDepth` is a season-scale quantity, so the threshold that decides
  // whether the sentence appears has to move with the span. A fixed 3.0 made
  // the same roster change worth a sentence in August and not in November.
  const depthTrade = { give: ['Ja\'Marr Chase'], receive: ['Chris Olave', 'Rashee Rice'] }
  const full = grade(fullSeason, depthTrade.give, depthTrade.receive)

  const note = (text) =>
    /bench depth/i.test(text) ? (/giving up real bench depth/.test(text) ? 'loses' : 'gains') : null

  it('says something about depth on the full-season file', () => {
    expect(note(full.explanation)).not.toBeNull()
  })

  it.each([14, 8, 3, 1])('%i weeks left: still says the same thing', (weeks) => {
    const short = grade(restOfSeason(fullSeason, weeks), depthTrade.give, depthTrade.receive)
    expect(note(short.explanation)).toBe(note(full.explanation))
  })
})
