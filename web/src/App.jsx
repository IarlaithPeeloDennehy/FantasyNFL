/**
 * Phase 4: the roster picker.
 *
 * Search the player pool, build a roster, see the lineup the engine would start.
 * Phase 5 adds the trade grader on top of this; the roster is its input, so this
 * screen exists to make that input cheap to produce and impossible to lose.
 *
 * All arithmetic lives in ./engine. Nothing in this file computes a point total
 * of its own -- if a number appears on screen, the engine produced it.
 */

import { useEffect, useMemo, useState } from 'react'

import {
  bestLineup,
  daysSince,
  makeLeague,
  parseDocument,
  playerPoints,
  replacementForSlot,
  replacementPoints,
  slotStem,
  vor,
} from './engine/index.js'
import { loadRoster, saveRoster } from './roster.js'

const STALE_AFTER_DAYS = 14
const POSITIONS = ['ALL', 'QB', 'RB', 'WR', 'TE']
const MAX_RESULTS = 50

export default function App() {
  const [doc, setDoc] = useState({ status: 'loading' })
  const [rosterIds, setRosterIds] = useState([])
  const [restored, setRestored] = useState(false)
  const [query, setQuery] = useState('')
  const [pos, setPos] = useState('ALL')

  useEffect(() => {
    // Base-relative, not page-relative: a bare 'players.json' resolves against
    // the current path, so it 404s the moment the app is served from anything
    // but the site root or is reached on a route with a trailing segment.
    fetch(`${import.meta.env.BASE_URL}players.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`players.json returned ${r.status}`)
        return r.json()
      })
      .then((body) => setDoc({ status: 'ready', ...parseDocument(body) }))
      .catch((error) => setDoc({ status: 'error', error }))
  }, [])

  const players = doc.status === 'ready' ? doc.players : null

  // Restore only once the pool is known, so a stale id in the URL can be
  // reconciled away rather than rendered as an undefined row.
  useEffect(() => {
    if (!players || restored) return
    setRosterIds(loadRoster(new Set(players.map((p) => p.id))))
    setRestored(true)
  }, [players, restored])

  // Mirror every change. Guarded on `restored` so the first render cannot
  // overwrite a shared link with an empty roster before it has been read.
  useEffect(() => {
    if (restored) saveRoster(rosterIds)
  }, [rosterIds, restored])

  if (doc.status === 'loading') return <p className="page meta">Loading player data…</p>

  if (doc.status === 'error') {
    return (
      <div className="page">
        <h1>Trade Grader</h1>
        <p className="meta stale">Could not load player data: {doc.error.message}</p>
      </div>
    )
  }

  return <Picker doc={doc} rosterIds={rosterIds} setRosterIds={setRosterIds}
                 query={query} setQuery={setQuery} pos={pos} setPos={setPos} />
}

function Picker({ doc, rosterIds, setRosterIds, query, setQuery, pos, setPos }) {
  const { players, curves, meta } = doc

  // Phase 6 turns this into a settings panel. Until then a 12-team half-PPR
  // default still demonstrates the whole model, which is what the plan asks for.
  const league = useMemo(() => makeLeague(), [])
  const replacement = useMemo(() => replacementPoints(curves, league), [curves, league])

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const roster = useMemo(
    () => rosterIds.map((id) => byId.get(id)).filter(Boolean),
    [rosterIds, byId],
  )

  const lineup = useMemo(
    () => bestLineup(roster, league, league.scoring, replacement),
    [roster, league, replacement],
  )

  const onRoster = useMemo(() => new Set(rosterIds), [rosterIds])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return players
      .filter((p) => !onRoster.has(p.id))
      .filter((p) => pos === 'ALL' || p.pos === pos)
      .filter((p) => !needle || p.name.toLowerCase().includes(needle)
                     || p.team.toLowerCase() === needle)
      .slice(0, MAX_RESULTS)
  }, [players, onRoster, pos, query])

  const add = (id) => setRosterIds((ids) => (ids.includes(id) ? ids : [...ids, id]))
  const drop = (id) => setRosterIds((ids) => ids.filter((x) => x !== id))

  const age = daysSince(meta.generatedAt)
  const stale = age > STALE_AFTER_DAYS

  return (
    <div className="page">
      <h1>Trade Grader</h1>
      <p className={stale ? 'meta stale' : 'meta'}>
        Data as of {new Date(meta.generatedAt).toLocaleDateString()}
        {meta.ranksAsOf && <> · ranks {meta.ranksAsOf}</>}
        {' · '}{meta.basis === 'rest_of_season' ? 'rest of season' : 'full season'}
        {stale && <> · {age} days old</>}
      </p>
      <p className="meta">
        12-team half-PPR · 1QB/2RB/3WR/1TE/1FLEX · league settings arrive in a later phase
      </p>

      <div className="cols">
        <section className="panel" aria-labelledby="add-h">
          <h2 id="add-h">Add players</h2>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or team…"
            aria-label="Search players by name or team"
          />

          <div className="filters">
            {POSITIONS.map((p) => (
              <button key={p} type="button" className="chip"
                      aria-pressed={pos === p} onClick={() => setPos(p)}>
                {p}
              </button>
            ))}
          </div>

          {results.length === 0 ? (
            <p className="empty-note">No players match. Try a different name or position.</p>
          ) : (
            <ul className="rows">
              {results.map((p) => (
                <PlayerRow key={p.id} player={p} league={league} replacement={replacement}
                           action={<button type="button" className="btn"
                                           onClick={() => add(p.id)}
                                           aria-label={`Add ${p.name}`}>Add</button>} />
              ))}
            </ul>
          )}
        </section>

        <div>
          <section className="panel" aria-labelledby="line-h">
            <h2 id="line-h">Starting lineup</h2>
            <Lineup lineup={lineup} league={league} replacement={replacement} />
          </section>

          <section className="panel" aria-labelledby="ros-h" style={{ marginTop: '1.25rem' }}>
            <h2 id="ros-h">Your roster ({roster.length})</h2>
            {roster.length === 0 ? (
              <p className="empty-note">
                Nothing yet. Add players on the left — your roster is saved to this
                browser and to the address bar, so the link is shareable.
              </p>
            ) : (
              <ul className="rows">
                {roster.map((p) => (
                  <PlayerRow key={p.id} player={p} league={league} replacement={replacement}
                             action={<button type="button" className="btn ghost"
                                             onClick={() => drop(p.id)}
                                             aria-label={`Remove ${p.name}`}>Remove</button>} />
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      <footer>
        Not affiliated with the NFL or any fantasy platform. Projections are a
        market-consensus rank mapped onto historical positional finishes, so every
        player at the same positional rank shares a projection.
      </footer>
    </div>
  )
}

function PlayerRow({ player, league, replacement, action }) {
  const value = vor(player, league, replacement)
  return (
    <li className="row">
      <span className="name">{player.name}</span>
      <span className="tag">{player.pos}{player.pos_adp_rank} · {player.team}</span>
      <span className={value >= 0 ? 'vor pos' : 'vor neg'}>{value.toFixed(0)}</span>
      {action}
    </li>
  )
}

function Lineup({ lineup, league, replacement }) {
  // An empty roster still scores, because an unfilled slot streams a replacement
  // rather than scoring zero. That is right for grading a trade -- it is the
  // delta that matters -- but "1207 projected points" next to an empty roster
  // reads as a broken app. Show the shape of the lineup, not a total nobody
  // asked for, until there is at least one real player in it.
  if (lineup.slots.length === 0) {
    return <p className="empty-note">Add players to see the lineup they would start.</p>
  }

  return (
    <>
      <ul className="slots">
        {lineup.slots.map(([label, p]) => (
          <li className="slot" key={label}>
            <span className="label">{label}</span>
            <span className="who">{p.name} <span className="tag">{p.pos}{p.pos_adp_rank}</span></span>
            <span className="pts">{playerPoints(p, league.scoring).toFixed(0)}</span>
          </li>
        ))}
        {lineup.unfilled.map((stem, i) => (
          <li className="slot empty" key={`${stem}-${i}`}>
            <span className="label">{stem}</span>
            {/* An empty slot is not zero: you stream someone off waivers. */}
            <span className="who">empty — streaming a replacement</span>
            <span className="pts">
              {replacementForSlot(slotStem(stem), replacement).toFixed(0)}
            </span>
          </li>
        ))}
      </ul>

      <div className="total">
        <span className="meta">Projected season · per week</span>
        <span className="big">
          {lineup.points.toFixed(0)} · {(lineup.points / 17).toFixed(1)}
        </span>
      </div>
    </>
  )
}
