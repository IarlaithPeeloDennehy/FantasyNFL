/**
 * Phase 7: the methodology page.
 *
 * The plan is blunt about why this exists: publish the limitation, because
 * "saying so costs nothing and buys credibility the first time someone disagrees
 * with a number — and someone will, on day one."
 *
 * So the biggest weakness of the model is stated in the second paragraph, not
 * buried at the bottom.
 */

export function Methodology({ meta }) {
  const seasons = meta.curveMeta?.seasons_used ?? []

  return (
    <details className="panel methodology">
      <summary>How these numbers are made — and what they cannot tell you</summary>

      <h3 className="sub">The short version</h3>
      <p>
        Market consensus decides the <em>order</em> of players. Recent history
        decides the <em>shape</em> of what a player at that position and rank
        actually produces. Your league settings decide what any of it is
        <em> worth</em>.
      </p>

      <h3 className="sub">The limitation, up front</h3>
      <p>
        <strong>Every player at the same positional rank shares a projection.</strong>{' '}
        The receiver ranked 12th among receivers gets the average component line of
        a WR12 finish{seasons.length > 0 && <> over {seasons.join(', ')}</>}. There
        is no player-specific signal here beyond the market's own — no injury
        model, no strength of schedule, no opinion about a coaching change. If you
        think the market is wrong about someone, this tool cannot agree with you,
        because it starts from that market.
      </p>
      <p>
        What it can do is price scarcity properly, which is where most trade
        arguments actually go wrong.
      </p>

      <h3 className="sub">Why the projections have no points in them</h3>
      <p>
        The data file ships stat <em>components</em> — receptions, yards,
        touchdowns — and never points or ranks. Points are computed in your browser
        from your scoring rules. That is why PPR, standard and superflex are a
        dropdown rather than three different builds, and why changing your league
        re-prices every player instantly.
      </p>

      <h3 className="sub">Value above replacement</h3>
      <p>
        A player is worth what he gives you over the man you could start instead.
        Replacement level is derived from your league — the number of teams, the
        starting slots, and how a flex spot actually gets used — rather than being
        a guessed constant. In a 12-team league that puts replacement around the
        29th running back. Deeper leagues push it later and make everyone more
        valuable.
      </p>

      <h3 className="sub">Why the top of each position is worth so much more</h3>
      <p>
        The drop from the best running back to the fifth is far steeper than the
        drop from the tenth to the twenty-fifth, and that shape comes from the
        history rather than from any adjustment applied on top of it. It is not
        the same shape at every position: quarterback falls at a steady rate well
        past the tenth, because only thirty-two of them start anywhere.
      </p>
      <p>
        Each rank is averaged over recent seasons and then smoothed against its
        neighbours, because the difference between the third and fourth finisher
        in any one year is mostly noise. The smoothing window narrows at the ends
        so the very top is never averaged with the ranks below it — doing that
        flattens exactly the gap that makes elite players worth trading for.
      </p>

      <h3 className="sub">Tiers, and what the points cannot tell you</h3>
      <p>
        A tier here is a run of players close enough that you would not care
        which one you had — specifically, within two points a week of the best
        player in the tier, which is the same gap that separates a slight edge
        from a clear win at a starting slot. Tiers are cut from the curve, so
        they come out narrow at the top and wide in the middle for running backs,
        receivers and tight ends, and roughly even all the way down for
        quarterbacks. None of those shapes is written down anywhere; they fall
        out of the history.
      </p>
      <p>
        Tier depth is the one thing here that the points genuinely cannot say.
        Two mid-range backs can out-score one elite back on paper and still be a
        bad trade, because you can find another mid-range back and you cannot
        find another elite one. That is reported beside the verdict and never
        added to it — it is an argument about the trade, not a number.
      </p>

      <h3 className="sub">Why trades are graded on lineups, not totals</h3>
      <p>
        Summing player values is how trade calculators end up saying three WR4s
        beat an elite running back. A trade is graded here by what it does to the
        lineup you would actually start: receive two receivers and only one cracks
        the lineup, and the second contributes nothing to the headline. Positional
        scarcity falls out of that for free.
      </p>
      <p>
        Bench players are not worthless — byes and injuries happen — so depth is
        reported on its own line and deliberately never added to the headline
        number. Adding it back would re-create the bug.
      </p>
      <p>
        An unfilled starting slot scores at replacement level rather than zero.
        Trading away your only tight end does not leave the position empty in real
        life; you stream whoever is on waivers.
      </p>

      <h3 className="sub">What is deliberately missing</h3>
      <p>
        Kickers and defences: replacement level at those positions is roughly the
        starter, so value above replacement is meaningless and publishing a number
        would be false precision. Dynasty, keeper and IDP formats are out of scope.
        So is anything requiring a league login.
      </p>

      <h3 className="sub">Sources</h3>
      <ul className="sources">
        <li>Ranks: {meta.sources?.ranks ?? 'consensus'}{meta.ranksAsOf && <> · as of {meta.ranksAsOf}</>}</li>
        <li>Historical stats: {meta.sources?.stats ?? 'nflverse'}</li>
        <li>Player ids: {meta.sources?.ids ?? 'DynastyProcess crosswalk'} — joined on id, never on name</li>
        <li>
          Basis: {meta.basis === 'rest_of_season'
            ? `rest of season${meta.weeksRemaining ? `, ${meta.weeksRemaining} weeks remaining` : ''}`
            : 'full season'}
        </li>
      </ul>
    </details>
  )
}
