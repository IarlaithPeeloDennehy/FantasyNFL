/**
 * The engine: everything that turns players.json plus a league into a verdict.
 *
 * Nothing in here imports React or touches the DOM. That is deliberate — it is
 * the only part of the app worth testing properly, and it stays testable by
 * staying pure.
 */

export * from './scoring.js'
export * from './lineup.js'
export * from './trade.js'
export * from './market.js'
export * from './odds.js'
export * from './targets.js'

import { GAMES_PER_SEASON, PRESETS } from './scoring.js'

export const SCHEMA_VERSION = 1

/**
 * Split a players.json document into the pieces the engine takes.
 *
 * Throws on a version it does not understand rather than silently
 * misinterpreting fields — a data file and a client that disagree about shape
 * produce wrong grades, not errors, which is the worst failure mode available.
 */
export function parseDocument(doc) {
  if (doc?.schema_version !== SCHEMA_VERSION) {
    throw new Error(
      `players.json is schema_version ${doc?.schema_version}, this client speaks ${SCHEMA_VERSION}`,
    )
  }

  return {
    players: doc.players,
    curves: doc.curves,
    meta: {
      generatedAt: doc.generated_at,
      season: doc.season,
      basis: doc.basis,
      weeksRemaining: doc.weeks_remaining ?? null,
      weeksCovered: weeksCovered(doc),
      ranksAsOf: doc.sources?.ranks_as_of ?? null,
      sources: doc.sources ?? {},
      curveMeta: doc.curve_meta ?? {},
    },
  }
}

/**
 * How many weeks of football the projections in this document span.
 *
 * A full-season file covers all 17. A rest-of-season file is scaled down by
 * `weeks_remaining / 17` at build time (see `build_players.py`) -- every player
 * projection *and* every curve row -- so its numbers describe only the weeks
 * that are left.
 *
 * This is the divisor for anything reported per week. Using 17 regardless is not
 * a rounding error: in week 10 it understates every per-week figure by more than
 * half, and does it silently, which is the worst way to be wrong.
 *
 * Throws rather than guessing, for the same reason `parseDocument` throws on an
 * unknown schema version: a client that misreads the horizon produces plausible
 * wrong numbers instead of an error.
 */
export function weeksCovered(doc) {
  if (doc?.basis !== 'rest_of_season') return GAMES_PER_SEASON

  const weeks = doc.weeks_remaining
  if (!Number.isInteger(weeks) || weeks < 1 || weeks > GAMES_PER_SEASON) {
    throw new Error(
      `basis is rest_of_season but weeks_remaining is ${JSON.stringify(weeks)}; ` +
      `expected an integer from 1 to ${GAMES_PER_SEASON}`,
    )
  }
  return weeks
}

/** How stale is this data? The UI should say so out loud. */
export function daysSince(generatedAt, now = new Date()) {
  const then = new Date(generatedAt)
  return Math.floor((now - then) / 86_400_000)
}

export function scoringPreset(name) {
  const preset = PRESETS[name]
  if (!preset) throw new Error(`unknown scoring preset ${name}`)
  return { ...preset }
}
