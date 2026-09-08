/**
 * Playoff odds, and what they say about which weeks are worth anything.
 *
 * The point of this module is to make a trade grade differently for a team that
 * is 0-3 than for one that is 3-0, without inventing a fudge factor to do it.
 * The plan is blunt about why that matters: a multiplier -- "you are 0-3, so
 * multiply win-now assets by 1.3" -- is unfalsifiable and unexplainable, and it
 * launders a bad trade instead of pricing one.
 *
 * So nothing here scales a player. What changes is **which weeks count**, and by
 * how much, and both weights are probabilities with a plain-English meaning:
 *
 *     regular-season week   how much this game still decides your season
 *                           = P(playoffs | you win it) - P(playoffs | you lose it)
 *
 *     playoff week          how likely you are to be playing at all
 *                           = P(playoffs)
 *
 * A contender has little left to settle in the regular season and is very likely
 * to play in January, so its playoff weeks dominate. A team fighting to stay
 * alive has every regular-season game swinging its odds and is unlikely to see
 * the playoffs at all, so the two come out close to level -- which is the same
 * thing as saying a player who only helps you in January is worth much less to
 * it.
 *
 * Everything is a coin flip. Team strength beyond the record is not modelled,
 * and saying so is cheaper than pretending: with three games played, a record is
 * mostly noise, and the difference between 18% and 22% odds does not change any
 * recommendation.
 */

// A fantasy regular season is usually fourteen weeks with three of playoffs, but
// both are league settings rather than facts, so these are only the defaults.
export const REGULAR_SEASON_WEEKS = 14
export const PLAYOFF_WEEKS = 3

/** n choose k, exactly. n never exceeds a season, so this stays well inside 2^53. */
function choose(n, k) {
  if (k < 0 || k > n) return 0
  let result = 1
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i
  return Math.round(result)
}

/**
 * P(at least `wins` from `games` coin flips).
 *
 * Written as an exact sum of binomial terms rather than an approximation. At
 * seventeen games that is eighteen terms, the coefficients are small integers,
 * and the divisor is a power of two -- so every term is exactly representable and
 * this produces bit-identical results to the Python reference by summing in the
 * same order.
 */
export function atLeast(games, wins) {
  if (wins <= 0) return 1
  if (wins > games) return 0
  let total = 0
  for (let k = wins; k <= games; k += 1) total += choose(games, k)
  return total / 2 ** games
}

/**
 * How many wins it takes to make the playoffs.
 *
 * The smallest win total at which no more than `spots` teams are expected to
 * reach it. Derived from the same coin-flip assumption as everything else,
 * rather than hardcoded, because the answer genuinely differs: six of twelve is
 * about a .500 season, four of twelve is not.
 */
export function cutline(teams, spots, games) {
  for (let wins = 0; wins <= games; wins += 1) {
    if (teams * atLeast(games, wins) <= spots) return wins
  }
  return games + 1
}

/**
 * Playoff odds and week weights for one record.
 *
 * `gamesLeft` is derived from the record rather than from the data file. A team
 * that says it is 0-3 has played three games, whatever basis the shipped
 * projections happen to use, and taking its word is more robust than trying to
 * reconcile the two.
 */
export function outlook(
  wins, losses, teams = 12, spots = 6, regularWeeks = REGULAR_SEASON_WEEKS,
) {
  const played = Math.max(0, wins + losses)
  const left = Math.max(0, regularWeeks - played)
  const line = cutline(teams, spots, regularWeeks)

  const odds = atLeast(left, line - wins)
  // The value of the game in front of you: the gap between winning it and losing
  // it. Zero for a team that has already clinched and for one already eliminated,
  // largest for a team whose season is genuinely in the balance.
  const regular = left > 0
    ? atLeast(left - 1, line - wins - 1) - atLeast(left - 1, line - wins)
    : 0

  return {
    odds,
    regularWeight: regular,
    playoffWeight: odds,
    cutline: line,
    gamesLeft: left,
    // True when the regular season is worth more per week than January.
    leansWinNow: regular > odds,
  }
}

/**
 * Weeks elapsed at which the remaining span turns into the playoffs.
 *
 * Everything before this is a regular-season week and everything from here on is
 * a playoff week. Derived from the record for the same reason `outlook` is, and
 * clamped so that any combination of a record and a horizon produces a split that
 * adds up -- including the mildly contradictory one where a full-season file is
 * graded against a team that has already played three.
 */
export function playoffStart(
  weeksCovered, wins, losses,
  regularWeeks = REGULAR_SEASON_WEEKS, playoffWeeks = PLAYOFF_WEEKS,
) {
  const total = Math.trunc(weeksCovered)
  const regularLeft = Math.min(
    Math.max(regularWeeks - Math.max(0, wins + losses), 0), total,
  )
  const playoffLeft = Math.min(playoffWeeks, total - regularLeft)
  return total - playoffLeft
}

/** The weight of a stretch of weeks [start, end), split at the playoff line. */
export function weightedWeeks(start, end, playoffsAt, view) {
  const regular = Math.max(0, Math.min(end, playoffsAt) - start)
  return regular * view.regularWeight + (end - start - regular) * view.playoffWeight
}

/**
 * True when every week left is worth exactly nothing.
 *
 * Two real records do this. A team already eliminated has no odds and nothing
 * left to play for, so both weights are zero. A team already clinched has nothing
 * left to settle in the regular season, so if the horizon holds no playoff weeks
 * its weights are zero too.
 *
 * Neither means "this trade is worth nothing" -- it means the weighting has no
 * opinion, and the caller should fall back to counting every week equally rather
 * than dividing by zero and reporting a NaN as a recommendation.
 */
export function isDegenerate(view, weeksCovered, playoffsAt) {
  return weightedWeeks(0, Math.trunc(weeksCovered), playoffsAt, view) <= 0
}
