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

const PARAMS = { roster: 'r', give: 'g', get: 't', league: 'l' }

/** Split a comma-separated id list. Tolerant of spaces, empties and trailing commas. */
export function parseIds(raw) {
  if (!raw) return []
  return raw.split(',').map((s) => s.trim()).filter(Boolean)
}

export function formatIds(ids) {
  return ids.join(',')
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

export const EMPTY = { roster: [], give: [], get: [], league: normaliseSpec(null) }

function fromParams(params, known) {
  const roster = reconcileIds(parseIds(params.get(PARAMS.roster)), known)
  const { give, get } = reconcileTrade({
    roster,
    give: reconcileIds(parseIds(params.get(PARAMS.give)), known),
    get: reconcileIds(parseIds(params.get(PARAMS.get)), known),
  })
  return { roster, give, get, league: decodeSpec(params.get(PARAMS.league)) ?? normaliseSpec(null) }
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

function toParams({ roster, give, get, league }) {
  const params = new URLSearchParams()
  if (roster.length) params.set(PARAMS.roster, formatIds(roster))
  if (give.length) params.set(PARAMS.give, formatIds(give))
  if (get.length) params.set(PARAMS.get, formatIds(get))
  params.set(PARAMS.league, encodeSpec(league))
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

export const _internals = { STORAGE_KEY, PARAMS, toParams, fromParams }
