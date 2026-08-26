/**
 * Value targets: players the model rates well above where the market drafts them.
 *
 * The plan is specific about why this exists. "Best players you don't have" is a
 * ranking page and every site has one. What only this model can produce is the
 * list where *its* ordering disagrees with the market's.
 *
 * Be honest about where the disagreement comes from. A projection here is the
 * market's own positional rank mapped onto a historical finish curve, so there is
 * no player-specific insight in it -- the model cannot know something about a
 * player that ADP does not. The edge is entirely positional scarcity: the market
 * drafts in one overall order, and value above replacement re-sorts that order by
 * how replaceable each position is. A tight end going 40th overall can be TE3 and
 * therefore worth far more than the receiver drafted beside him.
 *
 * That is a real, defensible signal, and it is the only one being claimed.
 */

import { vor } from './scoring.js'

function rankMap(rows, compare) {
  const sorted = [...rows].sort(compare)
  const out = new Map()
  sorted.forEach((row, i) => out.set(row.player.id, i + 1))
  return out
}

/**
 * @returns rows sorted by edge, biggest first. `edge` is how many places higher
 * the model ranks a player than the market does.
 */
export function valueTargets(players, league, replacement, { limit = 12, minEdge = 1 } = {}) {
  const rows = players.map((player) => ({ player, value: vor(player, league, replacement) }))

  const byMarket = rankMap(rows, (a, b) => a.player.adp - b.player.adp)
  // Ties broken by market order so the ranking is total and deterministic --
  // otherwise two players on identical curve rows could swap between renders.
  const byModel = rankMap(rows, (a, b) => b.value - a.value || a.player.adp - b.player.adp)

  return rows
    // Must be startable. A player below replacement is not a buy-low, he is a
    // player you should not roster, however cheap the market has him.
    .filter((row) => row.value > 0)
    .map((row) => {
      const marketRank = byMarket.get(row.player.id)
      const modelRank = byModel.get(row.player.id)
      return { ...row, marketRank, modelRank, edge: marketRank - modelRank }
    })
    .filter((row) => row.edge >= minEdge)
    .sort((a, b) => b.edge - a.edge || a.player.adp - b.player.adp)
    .slice(0, limit)
}
