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
}

export const DEFAULT_SPEC = {
  teams: 12,
  scoring: 'half_ppr',
  starters: { QB: 1, RB: 2, WR: 3, TE: 1 },
  flexSlots: 1,
  superflexSlots: 0,
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
  })
}

// Compact enough to sit in a URL next to fifteen player ids without the whole
// thing looking like a stack trace: 12-half_ppr-1.2.3.1-1-0
export function encodeSpec(spec) {
  const s = normaliseSpec(spec)
  const { QB, RB, WR, TE } = s.starters
  return [s.teams, s.scoring, `${QB}.${RB}.${WR}.${TE}`, s.flexSlots, s.superflexSlots].join('-')
}

export function decodeSpec(raw) {
  if (!raw) return null
  const parts = String(raw).split('-')
  if (parts.length !== 5) return null
  const [teams, scoring, starters, flexSlots, superflexSlots] = parts
  const [QB, RB, WR, TE] = starters.split('.').map(Number)
  return normaliseSpec({
    teams: Number(teams),
    scoring,
    starters: { QB, RB, WR, TE },
    flexSlots: Number(flexSlots),
    superflexSlots: Number(superflexSlots),
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
  return `${s.teams}-team ${scoring} · ${slots.join('/')}`
}
