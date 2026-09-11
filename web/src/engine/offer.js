/**
 * The offer finder: name a player you want, and see what it would take.
 *
 * Everything else in this engine grades a trade somebody already thought of.
 * This searches for one. That is a different problem, and it is harder for a
 * reason worth stating at the top, because it is the limitation the whole module
 * has to be honest about:
 *
 *   **We do not know the other manager's roster.**
 *
 * Every grade elsewhere is computed at the lineup level -- what a trade does to
 * the eleven you would actually start -- and that is only possible because your
 * roster is known. The other side of the table is not. So the acceptance half of
 * this cannot be a lineup calculation and must not pretend to be one.
 *
 * What it is instead: value above replacement, discounted for quantity. That is
 * the only roster-independent currency this model has, and it is roughly how a
 * manager without a tool evaluates an offer anyway. The discount is the important
 * part. Summing player values is the exact error the lineup model exists to
 * avoid, and it is no less wrong when it is the other team doing the summing --
 * three WR4s do not become an elite back on their side of the table either.
 *
 * So a package is worth its best player in full, and progressively less for each
 * body after that. The rate is not a taste parameter: it is the share of a roster
 * that actually starts in this league (see `startShare`). A second acquired
 * player is worth what he is likely to displace, and in a league where nine of
 * fifteen spots start, that is a little over half of him.
 *
 * The result is a search for the trades where both things are true at once --
 * they come out ahead on value, and you come out ahead on lineup points. Those
 * exist, and not because anybody is being fooled: they exist because your fourth
 * receiver has real value that your lineup is not using, and theirs might.
 */

import { startingSlots, rosterLimit } from './lineup.js'
import { vor } from './scoring.js'
import { EVEN_THRESHOLD, gradeTrade } from './trade.js'

/**
 * How many players may be bundled into one offer.
 *
 * Three is a real ceiling rather than a performance one. A four-for-one is not a
 * trade anybody sends; it is a salary dump, and the roster limit means the other
 * manager has to cut two players to accept it. Stopping at three also keeps the
 * search at a few hundred candidates on a full roster, which is small enough to
 * run on every keystroke.
 */
export const MAX_PIECES = 3

/**
 * How far above the asking price an offer may go before it stops being shown.
 *
 * Not a fairness rule -- a rule about usefulness. Every package that clears the
 * ask also "works", so without a ceiling the list fills with your whole roster
 * bundled together, ordered by how badly you overpaid. Half again as much as the
 * player is worth is already a generous opening offer, and anything past it is
 * not an option, it is a warning.
 */
export const MAX_OVERPAY = 0.5

/**
 * A safety cap on how many packages get graded properly.
 *
 * The value filter above runs first and is cheap; grading is not. The cheapest
 * offers are graded first, so the cap can only ever discard packages that were
 * already overpaying relative to something else in the list.
 */
export const MAX_GRADED = 300

// How close two offers have to be, per week, before the better-ranked one is
// treated as covering the other. A twentieth of a point is well inside the noise
// of the projections and nowhere near a verdict band boundary.
const EPS_GAIN = 0.05

/**
 * The share of a roster that starts.
 *
 * This is the decay rate for extra bodies in a package, and it is derived rather
 * than chosen. An acquired player is worth what he displaces; the chance that a
 * given player displaces anything is roughly the share of roster spots that are
 * starting spots. In a 12-team league starting eight of fifteen that is 0.53, so
 * the second player in a package counts about half and the third about a
 * quarter.
 *
 * It moves the right way on its own. A league with a deep bench discounts extra
 * pieces harder, which is correct: the deeper the benches, the easier it is for
 * the other manager to find that fourth receiver himself.
 */
export function startShare(league) {
  const limit = rosterLimit(league)
  return limit > 0 ? startingSlots(league) / limit : 1
}

/**
 * What a package of players is worth to somebody whose roster we cannot see.
 *
 * The best piece counts in full and each one after it decays by `startShare`.
 * Players at or below replacement level contribute nothing at all -- not a
 * rounding-down, a statement: a player the other manager could replace off
 * waivers is not a sweetener, he is a roster spot they now have to spend.
 */
export function packageValue(players, league, replacement) {
  const values = players
    .map((p) => vor(p, league, replacement))
    .filter((v) => v > 0)
    .sort((a, b) => b - a)

  const decay = startShare(league)
  return values.reduce((sum, v, i) => sum + v * decay ** i, 0)
}

/** Every combination of `players` from one up to `max`, in a stable order. */
export function combinations(players, max) {
  const out = []
  const walk = (start, picked) => {
    if (picked.length > 0) out.push([...picked])
    if (picked.length === max) return
    for (let i = start; i < players.length; i += 1) {
      picked.push(players[i])
      walk(i + 1, picked)
      picked.pop()
    }
  }
  walk(0, [])
  return out
}

/**
 * Find offers that would land `target`.
 *
 * Returns offers sorted best-first, where "best" is what the trade does to your
 * starting lineup, with ties broken towards the offer that costs less. Dominated
 * offers are dropped: if one package gets you the same points for no more value
 * and no more players, the other one is noise.
 *
 * `reason` says why the list is empty, because "no results" is four different
 * situations here and the difference is the whole answer. See `REASONS`.
 *
 * Options past `replacement` mirror `gradeTrade`, and are forwarded to it
 * unchanged so a found offer grades identically to the same offer typed in by
 * hand -- which `offer.test.js` asserts, because a finder that disagrees with the
 * grader is worse than no finder.
 */
export function findOffers(
  roster, target, league, replacement,
  {
    weeksCovered, market = null, availability = null, ranksKnew = false, record = null,
    maxPieces = MAX_PIECES, maxOverpay = MAX_OVERPAY, limit = 6,
  } = {},
) {
  const gradeOpts = { weeksCovered, market, availability, ranksKnew, record }
  const empty = (reason) => ({ target, ask: 0, offers: [], reason, considered: 0 })

  if (!target) return empty('no-target')
  if (roster.some((p) => p.id === target.id)) return empty('held')
  if (roster.length === 0) return empty('no-roster')

  const ask = vor(target, league, replacement)
  // The same rule `valueTargets` applies: a player below replacement is not
  // someone to go and get, he is someone you should not be rostering. There is
  // no offer to find here and saying so is more use than a list.
  if (ask <= 0) return { ...empty('below-replacement'), ask }

  // Only players who are worth something are worth bundling. A throw-in at or
  // below replacement adds nothing to their side and multiplies the number of
  // packages that differ only by which scrub is attached.
  const chips = roster.filter((p) => vor(p, league, replacement) > 0)
  if (chips.length === 0) return { ...empty('no-chips'), ask }

  const ceiling = ask * (1 + maxOverpay)

  const affordable = combinations(chips, maxPieces)
    .map((give) => ({ give, offered: packageValue(give, league, replacement) }))
    .filter(({ offered }) => offered >= ask && offered <= ceiling)
    .map((c) => ({ ...c, surplus: c.offered - ask }))
    // Cheapest first, so the cap below can only ever discard an overpayment.
    .sort((a, b) => a.surplus - b.surplus || a.give.length - b.give.length)

  if (affordable.length === 0) return { ...empty('cannot-afford'), ask }

  const graded = affordable.slice(0, MAX_GRADED).map((c) => {
    const grade = gradeTrade(roster, c.give, [target], league, replacement, gradeOpts)
    return { ...c, grade, gain: grade.deltaPerWeek, pieces: c.give.length }
  })

  // Ranked on the gain as it will be *rendered*, to a tenth of a point a week.
  // Sorting on the raw float makes +4.03 outrank +3.99 and pushes the cheaper,
  // simpler offer below a padded one the reader cannot tell apart from it.
  const rank = (c) => Math.round(c.gain * 10)
  const winners = graded
    .filter((c) => c.gain > EVEN_THRESHOLD)
    .sort((a, b) => rank(b) - rank(a) || a.surplus - b.surplus
                    || a.pieces - b.pieces || b.gain - a.gain)

  if (winners.length === 0) {
    return { ...empty('no-gain'), ask, considered: affordable.length }
  }

  // Keep only offers nothing already on the list covers. Walking a sorted list
  // and comparing against what has been accepted keeps this deterministic and
  // free of the cycles a pairwise sweep can produce on near-equal values.
  const offers = []
  for (const c of winners) {
    const covered = offers.some(
      (a) => a.gain + EPS_GAIN >= c.gain && a.surplus <= c.surplus && a.pieces <= c.pieces,
    )
    if (!covered) offers.push(c)
    if (offers.length === limit) break
  }

  return { target, ask, offers, reason: null, considered: affordable.length }
}

/**
 * Why a search came back empty. The UI needs the difference: "nothing you have
 * gets there" and "you could afford him but he would not improve your lineup"
 * are opposite problems with opposite next moves.
 */
export const REASONS = {
  'no-target': 'Pick a player to go and get.',
  'no-roster': 'Build a roster first — the offer has to come from somewhere.',
  held: 'He is already on your roster.',
  'below-replacement':
    'He is below replacement level in this league, so there is nothing here worth '
    + 'trading for. Whoever is on waivers does the same job.',
  'no-chips':
    'Nobody on your roster is above replacement level, so there is nothing to '
    + 'offer that the other manager could not pick up for free.',
  'cannot-afford':
    'Nothing you could bundle from this roster gets close to his value without '
    + 'handing over more than he is worth.',
  'no-gain':
    'You could afford him, but every package that gets there costs you more in '
    + 'the lineup than he adds to it. That is the answer, not a failure to find one.',
}
