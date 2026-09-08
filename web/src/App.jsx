/**
 * The app shell: load the contract, hold the state, hand numbers to the engine.
 *
 * All arithmetic lives in ./engine. Nothing in this tree computes a point total
 * of its own -- if a number appears on screen, the engine produced it. That is
 * what keeps the tested half tested and leaves the untested half with nothing in
 * it worth testing.
 */

import { useEffect, useMemo, useState } from 'react'

import {
  bestLineup, buildMarket, daysSince, parseDocument, replacementPoints,
} from './engine/index.js'
import { describeSpec, normaliseSpec, toLeague } from './league.js'
import { EMPTY, loadState, saveState } from './state.js'
import { BuyLow } from './BuyLow.jsx'
import { Methodology } from './Methodology.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { TradePanel } from './TradePanel.jsx'
import { LineupView, PlayerSearch } from './ui.jsx'

const STALE_AFTER_DAYS = 14

export default function App() {
  const [doc, setDoc] = useState({ status: 'loading' })
  const [state, setState] = useState(EMPTY)
  const [restored, setRestored] = useState(false)

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

  // Restore only once the pool is known, so a stale id in a shared link can be
  // reconciled away rather than rendered as an undefined row.
  useEffect(() => {
    if (!players || restored) return
    setState(loadState(new Set(players.map((p) => p.id))))
    setRestored(true)
  }, [players, restored])

  // Mirror every change. Guarded on `restored` so the first render cannot
  // overwrite a shared link with an empty roster before it has been read.
  useEffect(() => {
    if (restored) saveState(state)
  }, [state, restored])

  if (doc.status === 'loading') return <p className="page meta">Loading player data…</p>

  if (doc.status === 'error') {
    return (
      <div className="page">
        <h1>Trade Grader</h1>
        <p className="meta stale">Could not load player data: {doc.error.message}</p>
      </div>
    )
  }

  return <Workbench doc={doc} state={state} setState={setState} />
}

function Workbench({ doc, state, setState }) {
  const { players, curves, meta } = doc
  const [showSettings, setShowSettings] = useState(false)
  const [rosterQuery, setRosterQuery] = useState('')
  const [rosterPos, setRosterPos] = useState('ALL')
  const [tradeQuery, setTradeQuery] = useState('')
  const [tradePos, setTradePos] = useState('ALL')

  const spec = useMemo(() => normaliseSpec(state.league), [state.league])
  const league = useMemo(() => toLeague(spec), [spec])
  const replacement = useMemo(() => replacementPoints(curves, league), [curves, league])
  // Tiers are a pure function of the curve, the scoring and the horizon, so they
  // are computed once beside replacement level rather than per trade.
  const market = useMemo(
    () => buildMarket(curves, league, meta.weeksCovered),
    [curves, league, meta.weeksCovered],
  )

  const byId = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const roster = useMemo(
    () => state.roster.map((id) => byId.get(id)).filter(Boolean),
    [state.roster, byId],
  )

  const lineup = useMemo(
    () => bestLineup(roster, league, league.scoring, replacement),
    [roster, league, replacement],
  )

  const patch = (next) => setState((s) => ({ ...s, ...next }))

  const addPlayer = (id) =>
    setState((s) => (s.roster.includes(id)
      ? s
      : { ...s, roster: [...s.roster, id], get: s.get.filter((x) => x !== id) }))

  // Dropping a player has to drop him from the trade too, or `gradeTrade` is
  // handed a give that is no longer on the roster and throws. His injury goes
  // with him: an absence for somebody you no longer hold is invisible state that
  // would quietly follow the link around.
  const dropPlayer = (id) =>
    setState((s) => {
      const out = { ...s.out }
      delete out[id]
      return {
        ...s,
        roster: s.roster.filter((x) => x !== id),
        give: s.give.filter((x) => x !== id),
        out,
      }
    })

  // How many of the remaining weeks a player misses. Zero is stored as absent
  // rather than as a zero, so a healthy roster produces no URL noise at all.
  const setWeeksOut = (id, weeks) =>
    setState((st) => {
      const next = { ...st.out }
      if (weeks > 0) next[id] = Math.min(weeks, meta.weeksCovered)
      else delete next[id]
      return { ...st, out: next }
    })

  const toggleGive = (id) =>
    setState((s) => ({
      ...s,
      give: s.give.includes(id) ? s.give.filter((x) => x !== id) : [...s.give, id],
    }))

  const onRoster = useMemo(() => new Set(state.roster), [state.roster])
  const age = daysSince(meta.generatedAt)
  const stale = age > STALE_AFTER_DAYS

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>Trade Grader</h1>
          <p className={stale ? 'meta stale' : 'meta'}>
            Data as of {new Date(meta.generatedAt).toLocaleDateString()}
            {meta.ranksAsOf && <> · ranks {meta.ranksAsOf}</>}
            {' · '}{meta.basis === 'rest_of_season' ? 'rest of season' : 'full season'}
            {stale && <> · {age} days old — a refresh is overdue</>}
          </p>
        </div>
        <button type="button" className="btn" aria-expanded={showSettings}
                onClick={() => setShowSettings((v) => !v)}>
          {describeSpec(spec)} ▾
        </button>
      </header>

      {showSettings && (
        <SettingsPanel spec={spec} curves={curves}
                       setSpec={(next) => patch({ league: normaliseSpec(next) })} />
      )}

      <div className="cols">
        <section className="panel" aria-labelledby="ros-h">
          <h2 id="ros-h">Your roster ({roster.length})</h2>

          {roster.length === 0 ? (
            <p className="empty-note">
              Nothing yet. Add players below — your roster is saved to this browser
              and to the address bar, so the link is shareable.
            </p>
          ) : (
            <ul className="rows">
              {roster.map((p) => (
                <li className="row" key={p.id}>
                  <span className="name">{p.name}</span>
                  <span className="tag">{p.pos}{p.pos_adp_rank} · {p.team}</span>
                  <label className="weeks-out">
                    <span className="sr-only">Weeks {p.name} is out</span>
                    <input
                      type="number" inputMode="numeric" min={0} max={meta.weeksCovered}
                      value={state.out[p.id] ?? 0}
                      onChange={(e) => setWeeksOut(p.id, Math.trunc(Number(e.target.value)))}
                      title={`Weeks ${p.name} is out`}
                    />
                    <span aria-hidden="true">wks out</span>
                  </label>
                  <button type="button"
                          className={state.give.includes(p.id) ? 'btn giving' : 'btn'}
                          aria-pressed={state.give.includes(p.id)}
                          onClick={() => toggleGive(p.id)}>
                    {state.give.includes(p.id) ? 'Giving' : 'Trade'}
                  </button>
                  <button type="button" className="btn ghost"
                          onClick={() => dropPlayer(p.id)}
                          aria-label={`Remove ${p.name}`}>Remove</button>
                </li>
              ))}
            </ul>
          )}

          {Object.keys(state.out).length > 0 && (
            <label className="ranks-knew">
              <input
                type="checkbox" checked={state.ranksKnew}
                onChange={(e) => patch({ ranksKnew: e.target.checked })}
              />
              <span>
                These absences were already known on{' '}
                {meta.ranksAsOf ?? 'the ranking date'}, so the rankings price them in
                {' '}— do not discount again.
              </span>
            </label>
          )}

          <h3 className="sub">Add to your roster</h3>
          <PlayerSearch
            players={players} exclude={onRoster} league={league} replacement={replacement}
            query={rosterQuery} setQuery={setRosterQuery}
            pos={rosterPos} setPos={setRosterPos}
            action={(p) => (
              <button type="button" className="btn" onClick={() => addPlayer(p.id)}
                      aria-label={`Add ${p.name}`}>Add</button>
            )}
          />
        </section>

        <section className="panel" aria-labelledby="line-h">
          <h2 id="line-h">Starting lineup</h2>
          <LineupView lineup={lineup} league={league} replacement={replacement} />
        </section>
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <TradePanel
          roster={roster} byId={byId} players={players}
          give={state.give} get={state.get}
          setGive={(give) => patch({ give })} setGet={(get) => patch({ get })}
          league={league} replacement={replacement}
          weeksCovered={meta.weeksCovered} market={market}
          availability={state.out} ranksKnew={state.ranksKnew}
          setWeeksOut={setWeeksOut}
          query={tradeQuery} setQuery={setTradeQuery}
          pos={tradePos} setPos={setTradePos}
        />
      </div>

      <BuyLow players={players} league={league} replacement={replacement}
              rosterIds={state.roster} onAdd={addPlayer} />

      <div style={{ marginTop: '1.25rem' }}>
        <Methodology meta={meta} />
      </div>

      <footer>
        Not affiliated with the NFL or any fantasy platform. Player names and
        statistics are used descriptively.
      </footer>
    </div>
  )
}
