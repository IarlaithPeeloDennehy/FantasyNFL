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
  bestLineup, buildMarket, daysSince, parseDocument, replacementPoints, rosterLimit,
} from './engine/index.js'
import { describeSpec, normaliseSpec, toLeague } from './league.js'
import { EMPTY, loadState, saveState } from './state.js'
import { BuyLow } from './BuyLow.jsx'
import { Finder } from './Finder.jsx'
import { Methodology } from './Methodology.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { TradePanel } from './TradePanel.jsx'
import { Code, LineupView, PlayerSearch, RuleHead, WeeksOut } from './ui.jsx'

const STALE_AFTER_DAYS = 14

/**
 * The ribbon.
 *
 * Rendered in every state -- loading, broken, working -- so the page never
 * assembles itself in front of the reader. The status strip is the honest half
 * of a free tool built on somebody else's data: it says how old the numbers are
 * before it says anything about them.
 */
function Ribbon({ meta }) {
  const age = meta ? daysSince(meta.generatedAt) : null
  const stale = age !== null && age > STALE_AFTER_DAYS

  return (
    <header className="ribbon">
      <div className="wrap ribbon-in">
        <h1 className="wordmark"><b>Trade</b><i>Grader</i></h1>

        {meta && (
          <p className="readout">
            <span>
              {!stale && <span className="pulse" aria-hidden="true" />}
              Data <b>{new Date(meta.generatedAt).toLocaleDateString()}</b>
            </span>
            {meta.ranksAsOf && <span>Ranks <b>{meta.ranksAsOf}</b></span>}
            <span>{meta.basis === 'rest_of_season' ? 'Rest of season' : 'Full season'}</span>
            {stale && <span className="flag">{age} days old · refresh overdue</span>}
          </p>
        )}
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="footer">
      <div className="wrap">
        <p>
          Not affiliated with the NFL or any fantasy platform. Player names and
          statistics are used descriptively.
        </p>
      </div>
    </footer>
  )
}

/**
 * Wins and losses, or nothing at all.
 *
 * Empty means empty, not 0-0. A team that has played no games and a team whose
 * record nobody entered want different answers, and only the second one should
 * leave the grade exactly as it was.
 */
function RecordInput({ record, setRecord }) {
  const set = (part, raw) => {
    const n = Math.max(0, Math.trunc(Number(raw) || 0))
    setRecord({ wins: 0, losses: 0, ...record, [part]: n })
  }

  return (
    <div className="record">
      <span aria-hidden="true">Record</span>
      <label>
        <span className="sr-only">Wins</span>
        <input type="number" inputMode="numeric" min={0} max={17} placeholder="W"
               value={record ? record.wins : ''} title="Wins"
               onChange={(e) => set('wins', e.target.value)} />
      </label>
      <span className="sep" aria-hidden="true">&ndash;</span>
      <label>
        <span className="sr-only">Losses</span>
        <input type="number" inputMode="numeric" min={0} max={17} placeholder="L"
               value={record ? record.losses : ''} title="Losses"
               onChange={(e) => set('losses', e.target.value)} />
      </label>
      {record && (
        <button type="button" className="btn ghost" onClick={() => setRecord(null)}
                title="Grade without a record">clear</button>
      )}
    </div>
  )
}

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

  // Both non-ready states keep the ribbon and the section rules exactly where
  // they will end up, so the page settles into itself rather than jumping.
  if (doc.status === 'loading') {
    return (
      <div className="app">
        <Ribbon />
        <main className="main wrap" aria-busy="true">
          <p className="sr-only">Loading player data…</p>
          <div className="cols">
            {[['01', 'Your roster'], ['02', 'Starting lineup']].map(([i, title]) => (
              <section className="sheet" key={i}>
                <RuleHead index={i} title={title} />
                <div className="sheet-body">
                  <div className="skeleton" aria-hidden="true">
                    {Array.from({ length: 7 }, (_, n) => <i key={n} />)}
                  </div>
                </div>
              </section>
            ))}
          </div>
        </main>
        <Footer />
      </div>
    )
  }

  if (doc.status === 'error') {
    return (
      <div className="app">
        <Ribbon />
        <main className="main wrap">
          <div className="failure">
            <h2>No data</h2>
            <p>
              The player file did not load, so there is nothing here to grade a
              trade against. Nothing you saved has been lost.
            </p>
            <code>{doc.error.message}</code>
            <p>
              A reload usually settles it. If it does not, the published file is
              being rebuilt — the refresh runs weekly and leaves the last good
              file live while it works.
            </p>
          </div>
        </main>
        <Footer />
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
  const [findQuery, setFindQuery] = useState('')
  const [findPos, setFindPos] = useState('ALL')

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
      : {
        ...s,
        roster: [...s.roster, id],
        get: s.get.filter((x) => x !== id),
        // You now hold him, so there is nothing left to go and find.
        want: s.want === id ? null : s.want,
      }))

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

  // Which slot each rostered player would actually fill. The bench half is the
  // point of showing it: that is where the surplus the finder spends lives.
  const roleById = useMemo(() => {
    const roles = new Map()
    for (const [label, p] of lineup.slots) roles.set(p.id, label)
    for (const p of lineup.bench) roles.set(p.id, 'BENCH')
    return roles
  }, [lineup])

  const limit = rosterLimit(league)
  const starters = lineup.slots.length + lineup.unfilled.length

  return (
    <div className="app">
      <Ribbon meta={meta} />

      {/* The format and the record sit on a rail that follows you down the page.
          Both change every number below them, so both stay in sight. */}
      <div className="rail">
        <div className="wrap rail-in">
          <button type="button" className="spec-toggle"
                  aria-expanded={showSettings} aria-controls="league-settings"
                  onClick={() => setShowSettings((v) => !v)}>
            {describeSpec(spec)}
            <span className="caret" aria-hidden="true">▾</span>
          </button>
          <RecordInput record={state.record} setRecord={(record) => patch({ record })} />
        </div>
      </div>

      <div id="league-settings" hidden={!showSettings}>
        {showSettings && (
          <SettingsPanel spec={spec} curves={curves}
                         setSpec={(next) => patch({ league: normaliseSpec(next) })} />
        )}
      </div>

      <main className="main wrap stack">
        <div className="cols">
          <section className="sheet" aria-labelledby="ros-h">
            <RuleHead index="01" title="Your roster" id="ros-h"
                      meta={`${roster.length} / ${limit}`}
                      metaClass={roster.length > limit ? 'over' : null} />

            <div className="sheet-body">
              {roster.length === 0 ? (
                <p className="empty">
                  <b>Empty squad</b>
                  Add players below. Your roster is kept in this browser and in
                  the address bar, so the link is shareable as it stands.
                </p>
              ) : (
                <ul className="rows">
                  {roster.map((p) => (
                    <li className="row" key={p.id}>
                      <span className={roleById.get(p.id) === 'BENCH' ? 'role bench' : 'role'}>
                        {roleById.get(p.id) ?? '—'}
                      </span>
                      <span className="name">{p.name}</span>
                      <Code player={p} />
                      <WeeksOut player={p} weeks={state.out[p.id] ?? 0}
                                max={meta.weeksCovered} onChange={setWeeksOut} />
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
                <label className="knew">
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
            </div>
          </section>

          <section className="sheet" aria-labelledby="line-h">
            <RuleHead index="02" title="Starting lineup" id="line-h"
                      meta={starters > 0 ? `${lineup.slots.length} / ${starters} filled` : null} />
            <div className="sheet-body">
              <LineupView lineup={lineup} league={league} replacement={replacement}
                          weeks={meta.weeksCovered} />
            </div>
          </section>
        </div>

        <TradePanel
          roster={roster} byId={byId} players={players}
          give={state.give} get={state.get}
          setGive={(give) => patch({ give })} setGet={(get) => patch({ get })}
          league={league} replacement={replacement}
          weeksCovered={meta.weeksCovered} market={market}
          availability={state.out} ranksKnew={state.ranksKnew}
          setWeeksOut={setWeeksOut} record={state.record}
          query={tradeQuery} setQuery={setTradeQuery}
          pos={tradePos} setPos={setTradePos}
        />

        <Finder
          players={players} roster={roster} byId={byId}
          league={league} replacement={replacement}
          weeksCovered={meta.weeksCovered} market={market}
          availability={state.out} ranksKnew={state.ranksKnew} record={state.record}
          want={state.want} setWant={(want) => patch({ want })}
          onLoad={(offer, wanted) => patch({
            give: offer.give.map((p) => p.id),
            get: [wanted.id],
          })}
          query={findQuery} setQuery={setFindQuery}
          pos={findPos} setPos={setFindPos}
        />

        <BuyLow players={players} league={league} replacement={replacement}
                rosterIds={state.roster} onAdd={addPlayer} />

        <Methodology meta={meta} />
      </main>

      <Footer />
    </div>
  )
}
