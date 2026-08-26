/**
 * Phase 8: value targets.
 *
 * The plan's reasoning, kept in view: "best players you don't have" is a ranking
 * page and every site has one. The only list worth building here is the one where
 * this model's ordering disagrees with the market's — and the honest framing of
 * that disagreement is positional scarcity, not secret knowledge. The copy says
 * so out loud, because the first person who checks will work it out anyway.
 */

import { valueTargets } from './engine/index.js'

export function BuyLow({ players, league, replacement, rosterIds, onAdd }) {
  const held = new Set(rosterIds)
  const rows = valueTargets(players.filter((p) => !held.has(p.id)), league, replacement)

  if (rows.length === 0) return null

  return (
    <section className="panel" aria-labelledby="buy-h" style={{ marginTop: '1.25rem' }}>
      <h2 id="buy-h">Where this model disagrees with the market</h2>

      <p className="meta">
        Players worth more in <em>your</em> league than their draft position says.
        The gap is positional scarcity, not inside information: every projection
        here is the market's own positional rank mapped onto a historical finish
        curve, then re-sorted by how replaceable each position is in your settings.
        Change your league and this list changes with it.
      </p>

      <ul className="rows targets">
        {rows.map(({ player, value, marketRank, modelRank, edge }) => (
          <li className="row" key={player.id}>
            <span className="name">{player.name}</span>
            <span className="tag">{player.pos}{player.pos_adp_rank} · {player.team}</span>
            <span className="tag rank">
              market #{marketRank} → model #{modelRank}
            </span>
            <span className="vor pos">+{edge}</span>
            <span className="tag">{value.toFixed(0)} VOR</span>
            <button type="button" className="btn" onClick={() => onAdd(player.id)}
                    aria-label={`Add ${player.name} to your roster`}>Add</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
