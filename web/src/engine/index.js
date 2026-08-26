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
export * from './targets.js'

import { PRESETS } from './scoring.js'

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
      ranksAsOf: doc.sources?.ranks_as_of ?? null,
      sources: doc.sources ?? {},
      curveMeta: doc.curve_meta ?? {},
    },
  }
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
