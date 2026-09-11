/**
 * League settings: the shape the UI edits, and the bounds it may not leave.
 *
 * The engine takes a league object with a resolved scoring table. The UI edits a
 * *spec* instead -- scoring by name, not by table -- because a name survives a
 * URL and a localStorage round-trip and a table does not.
 */

import { makeLeague, scoringPreset } from './engine/index.js'

export const SCORING_OPTIONS = [
  ['half_ppr', 'Half PPR'],
  ['ppr', 'PPR'],
  ['standard', 'Standard'],
]

/**
 * Hard bounds on what a user may build.
 *
 * These are not taste. Replacement level is read off the shipped curve, and
 * `curveAt` clamps past the end of it rather than raising -- so a league deep
 * enough to run off the end of the curve gets a quietly wrong replacement level
 * and therefore a quietly wrong grade for every trade. These caps are the same
 * decision as MIN_CURVE_DEPTH in model/schema.py; the derivation lives there.
 */
export const LIMITS = {
  teams: [8, 14],
  QB: [1, 1],
  RB: [1, 3],
  WR: [1, 4],
  TE: [1, 2],
  flexSlots: [0, 3],
  superflexSlots: [0, 1],
  // Not a curve constraint like the others -- a roster nobody could field. Zero
  // bench is legal (some leagues really do it); the ceiling is generous because
  // being wrong here only costs a cut suggestion, not a mispriced grade.
  benchSlots: [0, 14],
  // How the season is shaped. Playoff spots decide how many wins it takes to
  // qualify, which is what turns a record into odds.
  playoffSpots: [2, 8],
  regularSeasonWeeks: [8, 17],
  playoffWeeks: [0, 4],
}

/**
 * The league sizes the settings panel offers.
 *
 * A short list rather than the full 8-14 range `LIMITS.teams` allows, because
 * these are the three sizes almost every league actually runs, and a typed
 * number field could not be used on a phone at all: reaching 10 means passing
 * through 1, which clamps to the minimum before the second digit arrives.
 *
 * `LIMITS.teams` deliberately stays wider. It is the validation bound that keeps
 * a league inside the shipped curve, and narrowing it would silently re-size
 * every 13- and 14-team link already in circulation.
 */
export const TEAM_OPTIONS = [8, 10, 12]

/**
 * The sizes to show, given the size currently set.
 *
 * A league that is already some other legal size keeps its own entry on the
 * list. Dropping it would leave the control with nothing matching to display
 * and quietly re-size a shared link on first render, which is the one thing a
 * settings control must never do.
 */
export function teamChoices(current) {
  const teams = normaliseSpec({ teams: current }).teams
  if (TEAM_OPTIONS.includes(teams)) return [...TEAM_OPTIONS]
  return [...TEAM_OPTIONS, teams].sort((a, b) => a - b)
}

/**
 * What a half-typed number field means, while it is still being typed.
 *
 * Returns the value to commit, or `null` for "not a number yet -- hold what they
 * wrote". Clamping instead of holding is what made a two-digit field unusable:
 * 10 has to pass through 1, and 1 clamped to the minimum before the second digit
 * could arrive.
 */
export function typedValue(raw, [min, max]) {
  const n = Number(raw)
  if (raw !== '' && Number.isInteger(n) && n >= min && n <= max) return n
  return null
}

/**
 * What a field settles on once focus leaves it.
 *
 * Out-of-range entries are clamped here, on the way out, rather than on the way
 * in -- the difference between a field that corrects you and one that fights
 * you. Anything that is not a number at all returns `null`, meaning "keep the
 * value you already had" rather than inventing one.
 */
export function settledValue(raw, [min, max]) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const n = Number(raw)
  if (!Number.isFinite(n)) return null
  return Math.min(max, Math.max(min, Math.round(n)))
}

export const DEFAULT_SPEC = {
  teams: 12,
  scoring: 'half_ppr',
  starters: { QB: 1, RB: 2, WR: 3, TE: 1 },
  flexSlots: 1,
  superflexSlots: 0,
  benchSlots: 7,
  playoffSpots: 6,
  regularSeasonWeeks: 14,
  playoffWeeks: 3,
}

const clamp = (n, [lo, hi]) => Math.min(hi, Math.max(lo, n))

/** Force any spec -- hand-edited URL included -- back inside the bounds. */
export function normaliseSpec(raw) {
  const spec = { ...DEFAULT_SPEC, ...(raw ?? {}) }
  const starters = { ...DEFAULT_SPEC.starters, ...(raw?.starters ?? {}) }

  return {
    teams: clamp(Math.round(Number(spec.teams) || DEFAULT_SPEC.teams), LIMITS.teams),
    scoring: SCORING_OPTIONS.some(([k]) => k === spec.scoring) ? spec.scoring : 'half_ppr',
    starters: Object.fromEntries(
      ['QB', 'RB', 'WR', 'TE'].map((pos) => [
        pos,
        clamp(Math.round(Number(starters[pos]) || DEFAULT_SPEC.starters[pos]), LIMITS[pos]),
      ]),
    ),
    flexSlots: clamp(Math.round(Number(spec.flexSlots) || 0), LIMITS.flexSlots),
    superflexSlots: clamp(Math.round(Number(spec.superflexSlots) || 0), LIMITS.superflexSlots),
    benchSlots: clamp(Math.round(Number(spec.benchSlots) || 0), LIMITS.benchSlots),
    playoffSpots: clamp(
      Math.round(Number(spec.playoffSpots) || DEFAULT_SPEC.playoffSpots), LIMITS.playoffSpots,
    ),
    regularSeasonWeeks: clamp(
      Math.round(Number(spec.regularSeasonWeeks) || DEFAULT_SPEC.regularSeasonWeeks),
      LIMITS.regularSeasonWeeks,
    ),
    playoffWeeks: clamp(Math.round(Number(spec.playoffWeeks) || 0), LIMITS.playoffWeeks),
  }
}

/** Spec -> the object the engine actually takes. */
export function toLeague(spec) {
  const s = normaliseSpec(spec)
  return makeLeague({
    teams: s.teams,
    scoring: scoringPreset(s.scoring),
    starters: s.starters,
    flexSlots: s.flexSlots,
    superflexSlots: s.superflexSlots,
    benchSlots: s.benchSlots,
    playoffSpots: s.playoffSpots,
    regularSeasonWeeks: s.regularSeasonWeeks,
    playoffWeeks: s.playoffWeeks,
  })
}

// Compact enough to sit in a URL next to fifteen player ids without the whole
// thing looking like a stack trace: 12-half_ppr-1.2.3.1-1-0-7
export function encodeSpec(spec) {
  const s = normaliseSpec(spec)
  const { QB, RB, WR, TE } = s.starters
  return [
    s.teams, s.scoring, `${QB}.${RB}.${WR}.${TE}`, s.flexSlots, s.superflexSlots, s.benchSlots,
    s.playoffSpots, s.regularSeasonWeeks, s.playoffWeeks,
  ].join('-')
}

/**
 * Tolerant of a field count it does not recognise, rather than all-or-nothing.
 *
 * Fields have been appended twice now -- bench slots, then the shape of the
 * season -- so five, six and nine are all formats real URLs carry. Rejecting the
 * short ones outright, which is what a strict length check did, silently resets
 * the entire league to defaults and grades the trade in the wrong format without
 * saying so. Any trailing field that is absent takes its default; the fields that
 * are present are still honoured.
 */
const SPEC_FIELDS = 9
const SPEC_FIELDS_MIN = 5

export function decodeSpec(raw) {
  if (!raw) return null
  const parts = String(raw).split('-')
  if (parts.length < SPEC_FIELDS_MIN || parts.length > SPEC_FIELDS) return null
  const [
    teams, scoring, starters, flexSlots, superflexSlots, benchSlots,
    playoffSpots, regularSeasonWeeks, playoffWeeks,
  ] = parts
  const [QB, RB, WR, TE] = starters.split('.').map(Number)
  return normaliseSpec({
    teams: Number(teams),
    scoring,
    starters: { QB, RB, WR, TE },
    flexSlots: Number(flexSlots),
    superflexSlots: Number(superflexSlots),
    benchSlots: benchSlots === undefined ? DEFAULT_SPEC.benchSlots : Number(benchSlots),
    playoffSpots:
      playoffSpots === undefined ? DEFAULT_SPEC.playoffSpots : Number(playoffSpots),
    regularSeasonWeeks:
      regularSeasonWeeks === undefined
        ? DEFAULT_SPEC.regularSeasonWeeks
        : Number(regularSeasonWeeks),
    playoffWeeks:
      playoffWeeks === undefined ? DEFAULT_SPEC.playoffWeeks : Number(playoffWeeks),
  })
}

/** One-line summary for the header, so the settings are visible without opening them. */
export function describeSpec(spec) {
  const s = normaliseSpec(spec)
  const { QB, RB, WR, TE } = s.starters
  const scoring = SCORING_OPTIONS.find(([k]) => k === s.scoring)[1]
  const slots = [`${QB}QB`, `${RB}RB`, `${WR}WR`, `${TE}TE`]
  if (s.flexSlots) slots.push(`${s.flexSlots}FLEX`)
  if (s.superflexSlots) slots.push(`${s.superflexSlots}SF`)
  return `${s.teams}-team ${scoring} · ${slots.join('/')} · ${s.benchSlots} bench`
}
