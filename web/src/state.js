/**
 * App state persistence: localStorage for coming back, the URL for sharing.
 *
 * The plan calls these ten lines each, and it is right about why they matter:
 * without them every refresh wipes five minutes of the user's work, which is the
 * fastest way to make a tool feel disposable. The trade sits in the URL too, so
 * "look what he offered me" is a link rather than a screenshot.
 *
 * The pure half (parse / format / reconcile) is separated from the half that
 * touches `window` so it can be tested in a node environment, and so a browser
 * with storage disabled degrades to "your roster does not persist" rather than
 * to a blank screen.
 */

import { decodeSpec, encodeSpec, normaliseSpec } from './league.js'

const STORAGE_KEY = 'trade-grader.state'

// A season is 17 weeks, so nobody misses more than that. Clamped rather than
// rejected: a hand-edited URL saying 99 means "out for the year", not an error.
const MAX_WEEKS_OUT = 17

const PARAMS = {
  roster: 'r', give: 'g', get: 't', league: 'l', out: 'o', knew: 'k', record: 'w',
}

/** Split a comma-separated id list. Tolerant of spaces, empties and trailing commas. */
export function parseIds(raw) {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export function formatIds(ids) {
  return ids.join(',')
}

/**
 * Weeks-out, as `id:weeks` pairs.
 *
 * Kept out of the league spec on purpose: how long somebody is hurt is a fact
 * about this week, not a setting, and it has no business surviving in
 * localStorage next to a scoring format. It does belong in a shared link, which
 * is the whole reason a leaguemate can be sent "here is why I want him cheap".
 */
/**
 * A win-loss record, as `wins-losses`.
 *
 * Absent means absent, not 0-0: a team that has played no games and a team whose
 * record nobody entered are different states, and only the second one should
 * leave the grade untouched.
 */
export function parseRecord(raw) {
  if (!raw) return null
  const [w, l] = String(raw).split('-').map(Number)
  if (!Number.isFinite(w) || !Number.isFinite(l)) return null
  const wins = Math.min(Math.max(Math.trunc(w), 0), MAX_WEEKS_OUT)
  const losses = Math.min(Math.max(Math.trunc(l), 0), MAX_WEEKS_OUT)
  return { wins, losses }
}

export function formatRecord(record) {
  return record ? `${record.wins}-${record.losses}` : ''
}

export function parseOut(raw, known) {
  const out = {}
  if (!raw) return out
  for (const chunk of String(raw).split(',')) {
    const [id, weeks] = chunk.split(':')
    const n = Math.trunc(Number(weeks))
    if (!id || !known.has(id) || !Number.isFinite(n) || n <= 0) continue
    out[id] = Math.min(n, MAX_WEEKS_OUT)
  }
  return out
}

export function formatOut(out) {
  return Object.entries(out)
    .filter(([, weeks]) => weeks > 0)
    .map(([id, weeks]) => `${id}:${weeks}`)
    .join(',')
}

/**
 * Drop ids this data file does not know, and any duplicates, preserving order.
 *
 * A saved roster outlives the players.json it was built against. The weekly
 * rebuild drops players who lose their nflverse id, so a link shared in
 * September can name someone who is simply gone by October. Silently dropping
 * them beats rendering `undefined` into the lineup.
 */
export function reconcileIds(ids, known) {
  const seen = new Set()
  const out = []
  for (const id of ids) {
    if (seen.has(id) || !known.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/**
 * A trade may only give away players you actually hold, and may not ask for one
 * you already have. Enforced here rather than in the component, because a shared
 * URL is user input like any other and `gradeTrade` throws on a give that is not
 * on the roster.
 */
export function reconcileTrade({ roster, give, get }) {
  const held = new Set(roster)
  const giving = give.filter((id) => held.has(id))
  const giveSet = new Set(giving)
  return { give: giving, get: get.filter((id) => !held.has(id) || giveSet.has(id)) }
}

export const EMPTY = {
  roster: [], give: [], get: [], league: normaliseSpec(null), out: {}, ranksKnew: false,
  record: null,
}

function fromParams(params, known) {
  const roster = reconcileIds(parseIds(params.get(PARAMS.roster)), known)
  const { give, get } = reconcileTrade({
    roster,
    give: reconcileIds(parseIds(params.get(PARAMS.give)), known),
    get: reconcileIds(parseIds(params.get(PARAMS.get)), known),
  })
  // Only players you actually hold can be hurt in a way that matters here, so a
  // stale entry for someone dropped from the roster is discarded rather than
  // carried around invisibly.
  const held = new Set(roster)
  const parsed = parseOut(params.get(PARAMS.out), known)
  const out = Object.fromEntries(
    Object.entries(parsed).filter(([id]) => held.has(id) || get.includes(id)),
  )

  return {
    roster,
    give,
    get,
    league: decodeSpec(params.get(PARAMS.league)) ?? normaliseSpec(null),
    out,
    ranksKnew: params.get(PARAMS.knew) === '1',
    record: parseRecord(params.get(PARAMS.record)),
  }
}

/**
 * Where state comes from on load.
 *
 * The URL wins over localStorage. If someone opens a shared link, they must see
 * the sender's roster and trade, not whatever they last built themselves --
 * otherwise the share link silently does nothing and looks broken.
 */
export function loadState(known) {
  if (typeof window === 'undefined') return EMPTY

  const params = new URLSearchParams(window.location.search)
  if ([...Object.values(PARAMS)].some((k) => params.has(k))) return fromParams(params, known)

  try {
    const saved = window.localStorage.getItem(STORAGE_KEY)
    if (saved) return fromParams(new URLSearchParams(saved), known)
  } catch {
    /* private mode, or storage blocked by policy */
  }
  return EMPTY
}

function toParams({ roster, give, get, league, out, ranksKnew, record }) {
  const params = new URLSearchParams()
  if (roster.length) params.set(PARAMS.roster, formatIds(roster))
  if (give.length) params.set(PARAMS.give, formatIds(give))
  if (get.length) params.set(PARAMS.get, formatIds(get))
  params.set(PARAMS.league, encodeSpec(league))
  const outStr = formatOut(out ?? {})
  if (outStr) params.set(PARAMS.out, outStr)
  if (ranksKnew) params.set(PARAMS.knew, '1')
  if (record) params.set(PARAMS.record, formatRecord(record))
  return params
}

/** Mirror state to both places. Never throws: persistence is a convenience. */
export function saveState(state) {
  if (typeof window === 'undefined') return
  const encoded = toParams(state).toString()

  try {
    window.localStorage.setItem(STORAGE_KEY, encoded)
  } catch {
    /* storage unavailable; the URL below is still updated */
  }

  try {
    const url = new URL(window.location.href)
    url.search = encoded
    // replaceState, not pushState: building a roster should not fill the back
    // button with fifteen entries the user has to click through to leave.
    window.history.replaceState(null, '', url)
  } catch {
    /* non-browser host */
  }
}

export const _internals = { STORAGE_KEY, PARAMS, MAX_WEEKS_OUT, toParams, fromParams }
