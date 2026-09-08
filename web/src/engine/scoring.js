/**
 * Scoring rules, positional curves, and replacement level.
 *
 * Every function here is pure. The Python in `model/value.py` is the reference
 * implementation and this must agree with it exactly on the same inputs -- see
 * `__tests__/parity.test.js`, which checks that against generated fixtures.
 */

export const GAMES_PER_SEASON = 17

export const COMPONENTS = [
  'pass_yd', 'pass_td', 'int',
  'rush_att', 'rush_yd', 'rush_td',
  'rec', 'rec_yd', 'rec_td',
  'fum_lost',
]

export const HALF_PPR = {
  pass_yd: 0.04, pass_td: 4, int: -2,
  rush_att: 0, rush_yd: 0.1, rush_td: 6,
  rec: 0.5, rec_yd: 0.1, rec_td: 6,
  fum_lost: -2,
}

export const PPR = { ...HALF_PPR, rec: 1 }
export const STANDARD = { ...HALF_PPR, rec: 0 }

export const PRESETS = { ppr: PPR, half_ppr: HALF_PPR, standard: STANDARD }

/**
 * Sensible 12-team defaults. `flexShare` is how a FLEX spot is actually used
 * league-wide -- an opening guess, not a derived truth. Tune it here, in the one
 * named place, rather than scattering magic numbers through the app.
 */
export const DEFAULT_LEAGUE = {
  teams: 12,
  scoring: HALF_PPR,
  starters: { QB: 1, RB: 2, WR: 3, TE: 1 },
  flexSlots: 1,
  superflexSlots: 0,
  // Bench spots for QB/RB/WR/TE only. A real league's roster size also covers
  // kickers and defences, which this model excludes entirely -- so this is the
  // skill-position bench, not the number the platform shows you.
  benchSlots: 7,
  // How the season is shaped. Needed to say which of the weeks left are still
  // being played for and which are January.
  playoffSpots: 6,
  regularSeasonWeeks: 14,
  playoffWeeks: 3,
  flexShare: { RB: 0.45, WR: 0.45, TE: 0.1 },
  superflexShare: { QB: 0.9, RB: 0.04, WR: 0.04, TE: 0.02 },
}

export function makeLeague(overrides = {}) {
  return { ...DEFAULT_LEAGUE, ...overrides }
}

/** Fantasy points for one component vector under one set of rules. */
export function score(components, scoring) {
  let total = 0
  for (const key of COMPONENTS) {
    total += (components[key] ?? 0) * (scoring[key] ?? 0)
  }
  return total
}

/**
 * The component vector at a possibly-fractional finish rank.
 *
 * Ranks past the end of the curve clamp to the last modelled rank. That is a
 * deliberate floor: we do not pretend to know what WR140 does.
 */
export function curveAt(curves, pos, rank) {
  const rows = curves[pos]
  if (!rows || rows.length === 0) {
    return Object.fromEntries(COMPONENTS.map((c) => [c, 0]))
  }
  const idx = Math.max(1, Math.min(rank, rows.length))
  const lo = Math.floor(idx)
  const hi = Math.min(lo + 1, rows.length)
  const frac = idx - lo
  const a = rows[lo - 1]
  const b = rows[hi - 1]
  const out = {}
  for (const c of COMPONENTS) {
    const av = a[c] ?? 0
    out[c] = av + ((b[c] ?? 0) - av) * frac
  }
  return out
}

export function curvePoints(curves, pos, rank, scoring) {
  return score(curveAt(curves, pos, rank), scoring)
}

/** The positional finish rank of the last startable player at this position. */
export function replacementRank(pos, league) {
  const dedicated = league.starters[pos] ?? 0
  const flex = (league.flexShare[pos] ?? 0) * league.flexSlots
  const superflex = (league.superflexShare[pos] ?? 0) * league.superflexSlots
  return league.teams * (dedicated + flex + superflex)
}

export function replacementPoints(curves, league) {
  const out = {}
  for (const pos of Object.keys(curves)) {
    out[pos] = curvePoints(curves, pos, replacementRank(pos, league), league.scoring)
  }
  return out
}

export function playerPoints(player, scoring) {
  return score(player.proj, scoring)
}

export function vor(player, league, replacement) {
  return playerPoints(player, league.scoring) - (replacement[player.pos] ?? 0)
}
