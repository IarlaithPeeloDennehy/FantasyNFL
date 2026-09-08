/**
 * Tiers: how many players you would not meaningfully choose between.
 *
 * The finish curve already prices the fact that the drop from the best running
 * back to the fifth is steeper than the drop from the tenth to the twenty-fifth.
 * What it cannot say is the thing a fantasy player actually says out loud -- that
 * those two receivers are "the same tier" and this one is not.
 *
 * A tier here is a run of consecutive finish ranks whose points span less than
 * one band's worth of a starting slot. That definition does two jobs at once:
 *
 *   - It names the shape. Tiers come out narrow at the top and wide in the middle
 *     for RB, WR and TE, and roughly constant all the way down for QB -- because
 *     only thirty-two quarterbacks start anywhere, so that curve never flattens.
 *     Nothing here encodes those shapes; they fall out of the history.
 *
 *   - It measures replaceability, which is the part the points genuinely cannot
 *     express. Two RB20s can out-score one RB5 on paper and still be a bad trade,
 *     because an RB20 is one of nine interchangeable players and an RB5 is one of
 *     two. The size of a player's tier *is* that number, so it needs no second
 *     threshold and no second concept.
 *
 * Everything here is a pure function of the curve, the scoring rules and the
 * horizon, so it lives client-side for the same reason scoring does: tier
 * boundaries move with the scoring format, and baking them into players.json
 * would freeze one league's answer into the data file.
 */

import { GAMES_PER_SEASON, curvePoints, playerPoints } from './scoring.js'

/**
 * How far apart two players have to be before they stop being interchangeable,
 * in points per week of the user's own scoring.
 *
 * Anchored to the verdict bands rather than picked: 2.0 is the Slight edge /
 * Clear win boundary in `trade.js` BANDS, so crossing one tier at a single
 * starting slot is about the difference between those two verdicts. Kept as its
 * own constant rather than imported, because `trade.js` already imports from
 * here and the cycle is not worth the shared literal -- `market.test.js` asserts
 * the two agree so they cannot drift apart quietly.
 */
export const TIER_WIDTH_PER_WEEK = 2.0

/**
 * Cut one position's curve into tiers, best first.
 *
 * A tier runs until somebody is more than `TIER_WIDTH_PER_WEEK` a week worse than
 * the best player in it -- measured against the tier's own leader rather than the
 * previous rank, so a long shallow slope eventually starts a new tier instead of
 * drifting forever inside one.
 *
 * The width scales with the horizon, so a rest-of-season file produces exactly
 * the same tiers as a full-season one. Both the curve and the width are in points
 * over the same span, and the two scalings cancel.
 *
 * @returns `[{ index, start, end, size }]`, ranks 1-based and inclusive.
 */
export function positionTiers(curves, pos, scoring, weeksCovered = GAMES_PER_SEASON) {
  const rows = curves[pos]
  if (!rows || rows.length === 0) return []

  const points = rows.map((_, i) => curvePoints(curves, pos, i + 1, scoring))
  const width = TIER_WIDTH_PER_WEEK * weeksCovered

  const tiers = []
  let start = 0
  for (let i = 1; i < points.length; i += 1) {
    if (points[start] - points[i] > width) {
      tiers.push({ index: tiers.length, start: start + 1, end: i, size: i - start })
      start = i
    }
  }
  tiers.push({
    index: tiers.length,
    start: start + 1,
    end: points.length,
    size: points.length - start,
  })
  return tiers
}

/**
 * Tiers for every position the curve knows about, in one object.
 *
 * Computed once per league the way replacement level is, and passed alongside it.
 * Nothing in here depends on a roster.
 */
export function buildMarket(curves, league, weeksCovered = GAMES_PER_SEASON) {
  return Object.fromEntries(
    Object.keys(curves).map((pos) => [
      pos,
      positionTiers(curves, pos, league.scoring, weeksCovered),
    ]),
  )
}

/**
 * Which tier a positional finish rank falls in.
 *
 * Ranks past the end of the curve clamp to the last tier, matching what
 * `curveAt` already does with the projection itself. Pretending to know that
 * WR140 is his own tier would be worse than saying he is in the last one.
 */
export function tierAt(tiers, rank) {
  if (!tiers || tiers.length === 0) return null
  for (const tier of tiers) {
    if (rank >= tier.start && rank <= tier.end) return tier
  }
  return rank > tiers[tiers.length - 1].end ? tiers[tiers.length - 1] : tiers[0]
}

// What counts as a scarce tier, and how lopsided the two sides have to be before
// saying anything. Tuned against the trades in `trades.py`: at 4 and 2.0 the
// sentence fired on 65% of graded cases, which is not a point being made, it is
// background noise. At 3 and 3.0 it fires on the four where replaceability really
// is the argument -- swapping an elite receiver for two good ones, an elite tight
// end for a similarly ranked receiver, and either direction of a bench-for-star
// robbery -- and stays quiet on even swaps, bench shuffles and rank-adjacent
// upgrades.
export const SCARCE_TIER_SIZE = 3
export const SCARCITY_RATIO = 3.0

export const PLURALS = {
  QB: 'quarterbacks',
  RB: 'running backs',
  WR: 'receivers',
  TE: 'tight ends',
}

function oneOf(player, tier, plural) {
  const where = plural ? ` ${PLURALS[player.pos] ?? player.pos}` : ''
  return `${player.name} is one of ${tier.size}${where} in his tier`
}

/**
 * One sentence on which side of the trade is harder to replace.
 *
 * Deliberately not a number added to anything. The points already say who scores
 * more; this says which of them you could go out and find again, and that is the
 * part the points genuinely cannot express -- the reason two good players are not
 * always worth one great one even when the arithmetic says so.
 *
 * Stays quiet unless the asymmetry is real: one side has to sit in a genuinely
 * scarce tier and the other in a tier at least twice as deep. On the trades where
 * replaceability is not the argument, saying nothing is the right output.
 */
export function describeScarcity(give, receive, market, scoring, league = null) {
  if (!market || !give.length || !receive.length) return ''

  const headline = (players) => {
    const best = players.reduce((a, b) =>
      playerPoints(b, scoring) > playerPoints(a, scoring) ? b : a)
    return [best, tierAt(market[best.pos] ?? [], best.pos_adp_rank)]
  }

  const [outP, outT] = headline(give)
  const [inP, inT] = headline(receive)
  if (!outT || !inT) return ''

  const [small, large] = [outT.size, inT.size].sort((a, b) => a - b)
  if (small > SCARCE_TIER_SIZE || large < small * SCARCITY_RATIO) return ''

  // Not at quarterback in a one-QB league. Tier depth says how hard a player is
  // to replace with another rostered player, and at quarterback you do not have
  // to: the next one on waivers is nearly as good, which is exactly what the QB
  // note already tells the reader. Saying both produces two sentences that argue
  // with each other -- "quarterbacks are worth less than their rank suggests"
  // followed by "you are giving up the scarcer player".
  const oneQb = league !== null && league.superflexSlots === 0
  if (oneQb && (outP.pos === 'QB' || inP.pos === 'QB')) return ''

  const lead =
    outT.size < inT.size
      ? 'You are giving up the scarcer player'
      : 'You are getting the scarcer player'
  const samePos = outP.pos === inP.pos
  return ` ${lead}: ${oneOf(outP, outT, true)}, ${oneOf(inP, inT, !samePos)}.`
}

/** Tier and tier depth for every player on both sides, for the UI to render. */
export function tradedTiers(give, receive, market) {
  if (!market) return {}
  const rows = (players) =>
    players
      .map((player) => {
        const tier = tierAt(market[player.pos] ?? [], player.pos_adp_rank)
        return tier
          ? { player, tier: tier.index + 1, size: tier.size, of: (market[player.pos] ?? []).length }
          : null
      })
      .filter(Boolean)
  return { give: rows(give), receive: rows(receive) }
}
