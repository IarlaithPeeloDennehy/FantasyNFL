/**
 * Phase 8: value targets.
 *
 * The plan's reasoning, kept in view: "best players you don't have" is a ranking
 * page and every site has one. The only list worth building here is the one where
 * this model's ordering disagrees with the market's — and the honest framing of
 * that disagreement is positional scarcity, not secret knowledge. The copy says
 * so out loud, because the first person who checks will work it out anyway.
 *
 * It is laid out as a climbers table: where the market has him, where this model
 * has him, and how far that is. A league table reads left to right and so does
 * this.
 */

import { valueTargets } from './engine/index.js'
import { Code, RuleHead } from './ui.jsx'

export function BuyLow({ players, league, replacement, rosterIds, onAdd }) {
  const held = new Set(rosterIds)
  const rows = valueTargets(players.filter((p) => !held.has(p.id)), league, replacement)

  if (rows.length === 0) return null

  return (
    <section className="sheet" aria-labelledby="buy-h">
      <RuleHead index="04" title="Where this model disagrees with the market"
                id="buy-h" meta={`${rows.length} players`} />

      <div className="sheet-body">
        <p className="prose">
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
              <Code player={player} />
              <span className="move" title="Market rank, then this model's rank">
                #{marketRank}
                <span className="arrow" aria-hidden="true">→</span>
                <span className="to">#{modelRank}</span>
              </span>
              <span className="edge" title={`${edge} places higher than the market`}>
                +{edge}
              </span>
              <span className="vor pos" title="Value above replacement">
                {value.toFixed(0)}
              </span>
              <button type="button" className="btn" onClick={() => onAdd(player.id)}
                      aria-label={`Add ${player.name} to your roster`}>Add</button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
