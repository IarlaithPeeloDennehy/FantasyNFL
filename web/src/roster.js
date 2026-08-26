/**
 * Roster persistence: localStorage for coming back, the URL for sharing.
 *
 * The plan calls these ten lines each, and it is right about why they matter:
 * without them every refresh wipes five minutes of the user's work, which is the
 * fastest way to make a tool feel disposable.
 *
 * The pure half (parse / format / reconcile) is separated from the half that
 * touches `window` so it can be tested in a node environment, and so a browser
 * with storage disabled degrades to "your roster does not persist" rather than
 * to a blank screen.
 */

const STORAGE_KEY = 'trade-grader.roster'
const URL_PARAM = 'r'

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
 * Where the roster comes from on load.
 *
 * The URL wins over localStorage. If someone opens a shared link, they must see
 * the sender's roster, not whatever they last built themselves -- otherwise the
 * share link silently does nothing and looks broken.
 */
export function loadRoster(known) {
  if (typeof window === 'undefined') return []

  const fromUrl = parseIds(new URLSearchParams(window.location.search).get(URL_PARAM))
  if (fromUrl.length) return reconcileIds(fromUrl, known)

  try {
    return reconcileIds(parseIds(window.localStorage.getItem(STORAGE_KEY)), known)
  } catch {
    return [] // private mode, or storage blocked by policy
  }
}

/** Mirror the roster to both places. Never throws: persistence is a convenience. */
export function saveRoster(ids) {
  if (typeof window === 'undefined') return

  try {
    window.localStorage.setItem(STORAGE_KEY, formatIds(ids))
  } catch {
    /* storage unavailable; the URL below is still updated */
  }

  try {
    const url = new URL(window.location.href)
    if (ids.length) url.searchParams.set(URL_PARAM, formatIds(ids))
    else url.searchParams.delete(URL_PARAM)
    // replaceState, not pushState: building a roster should not fill the back
    // button with fifteen entries the user has to click through to leave.
    window.history.replaceState(null, '', url)
  } catch {
    /* non-browser host */
  }
}

export const _internals = { STORAGE_KEY, URL_PARAM }
