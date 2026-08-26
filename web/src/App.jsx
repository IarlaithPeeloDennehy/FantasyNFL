/**
 * Placeholder shell. Phase 4 replaces this with the roster picker.
 *
 * It exists now to prove the pieces connect end to end in a browser: the data
 * file loads, the schema version is checked, and the engine computes replacement
 * level from real numbers. Nothing here is meant to be looked at.
 */

import { useEffect, useState } from 'react'
import {
  daysSince,
  makeLeague,
  parseDocument,
  replacementPoints,
  vor,
} from './engine/index.js'

const STALE_AFTER_DAYS = 14

export default function App() {
  const [state, setState] = useState({ status: 'loading' })

  useEffect(() => {
    fetch('players.json')
      .then((r) => {
        if (!r.ok) throw new Error(`players.json returned ${r.status}`)
        return r.json()
      })
      .then((doc) => setState({ status: 'ready', ...parseDocument(doc) }))
      .catch((error) => setState({ status: 'error', error }))
  }, [])

  if (state.status === 'loading') return <p style={S.page}>Loading player data…</p>

  if (state.status === 'error') {
    return (
      <div style={S.page}>
        <h1 style={S.h1}>Trade Grader</h1>
        <p>Could not load player data: {state.error.message}</p>
      </div>
    )
  }

  const { players, curves, meta } = state
  const league = makeLeague()
  const replacement = replacementPoints(curves, league)
  const top = [...players].sort((a, b) => vor(b, league, replacement) - vor(a, league, replacement))

  const age = daysSince(meta.generatedAt)
  const stale = age > STALE_AFTER_DAYS

  return (
    <div style={S.page}>
      <h1 style={S.h1}>Trade Grader</h1>

      <p style={stale ? S.stale : S.meta}>
        Data as of {new Date(meta.generatedAt).toLocaleDateString()}
        {' · '}ranks {meta.ranksAsOf}
        {' · '}{meta.basis === 'rest_of_season' ? 'rest of season' : 'full season'}
        {stale && ` · ${age} days old`}
      </p>

      <p style={S.meta}>
        {players.length} players · replacement level{' '}
        {Object.entries(replacement)
          .map(([pos, pts]) => `${pos} ${pts.toFixed(0)}`)
          .join(' / ')}
      </p>

      <ol style={S.list}>
        {top.slice(0, 10).map((p) => (
          <li key={p.id}>
            {p.name} <span style={S.meta}>({p.pos}{p.pos_adp_rank})</span>{' '}
            {vor(p, league, replacement).toFixed(1)} VOR
          </li>
        ))}
      </ol>
    </div>
  )
}

const S = {
  page: { fontFamily: 'system-ui, sans-serif', maxWidth: '42rem', margin: '3rem auto', padding: '0 1rem', lineHeight: 1.5 },
  h1: { fontSize: '1.5rem', marginBottom: '0.25rem' },
  meta: { color: '#666', fontSize: '0.875rem' },
  stale: { color: '#a5501c', fontSize: '0.875rem' },
  list: { marginTop: '1.5rem' },
}
