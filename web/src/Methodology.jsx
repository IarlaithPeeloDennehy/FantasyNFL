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
    <details className="sheet methodology">
      <summary>
        <span className="rule-idx" aria-hidden="true">06</span>
        How these numbers are made — and what they cannot tell you
        <span className="marker" aria-hidden="true">+</span>
      </summary>

      <div className="sheet-body">
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

      <h3 className="sub">Two numbers, and why they are not merged</h3>
      <p>
        Enter a record and the verdict gains a second number beside it. The first
        is what the trade is worth, full stop. The second is what it is worth to a
        team in your position — and the gap between them is the premium you would
        be paying, which is the only part you actually need in order to decide.
        Collapsing them into one adjusted number would be easier and much worse:
        it would launder a bad trade instead of pricing one.
      </p>
      <p>
        Nothing about a player is scaled. What changes is <em>which weeks
        count</em>. A regular-season week is worth however much that game still
        decides your season — the gap between winning it and losing it — and a
        playoff week is worth however likely you are to be playing at all. A team
        at 3-0 is probably going to January, so January is what it is buying; a
        team at 0-3 probably is not, so a player who only helps then is worth
        little to it. That is the whole mechanism, and it is why the same trade
        can be a clear win for one team and a loss for another.
      </p>
      <p>
        <strong>What this does not know.</strong> Every remaining game is treated
        as a coin flip. Nobody's strength is modelled beyond the record itself,
        the schedule is ignored, and the odds are approximate by construction —
        but the difference between 18% and 22% does not change a recommendation,
        and the shape is what matters here. A team that is mathematically out gets
        no second number at all, because at that point the weighting has no
        opinion left to offer.
      </p>

      <h3 className="sub">Injuries are your input, not ours</h3>
      <p>
        Nothing here knows who is hurt. If you mark a player as out for a number
        of weeks, the remaining run is split at the week he returns and a lineup
        is built for each stretch — so a back who misses five of eight weeks is
        priced as an elite back for three weeks and an absence for five, rather
        than as a mediocre back for eight. Those are different teams, and only
        the second one would bench him behind somebody worse.
      </p>
      <p>
        <strong>One thing to watch.</strong> Consensus rankings already price in
        an injury everyone knows about — a player who got hurt last month has
        already fallen down the board, so his projection here is discounted
        once already. Marking him out again charges for the same injury twice.
        The checkbox above your roster is there for exactly that: tick it when
        the absence was already public on the ranking date, and nothing further
        is deducted.
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

      <h3 className="sub">Finding a trade, and the half of it that is a guess</h3>
      <p>
        Naming a player you want turns the problem around: instead of grading a
        trade somebody already thought of, it searches every combination of up
        to three players on your roster for the ones that clear his value
        without paying more than half again over it, then grades each of those
        the ordinary way and keeps only the ones that improve the lineup you
        would actually start.
      </p>
      <p>
        <strong>The two halves are not equally solid, and they are never added
        together.</strong> What an offer does to your lineup is the same
        calculation as everywhere else here and is as reliable as anything on
        this page. What it costs is not: the other manager's roster is invisible
        to this tool, so his side is priced in value above replacement, which is
        roughly how somebody without a tool would price it anyway.
      </p>
      <p>
        Even there the arithmetic refuses to simply add up. A package is worth
        its best player in full and progressively less for each body after him,
        because the same argument that stops three WR4s beating an elite back on
        your side of the table applies on his. The rate is not a taste setting —
        it is the share of roster spots in your league that are starting spots,
        so a second player counts about what he is likely to displace, and a
        league with deeper benches discounts extra pieces harder. That is
        correct: the deeper the benches, the more easily he finds that fourth
        receiver himself.
      </p>
      <p>
        So an offer that looks fair here can still be refused, and the reason
        will usually be positional rather than numerical — a team already three
        deep at receiver does not want your fourth, whatever the value says. Read
        the price as an opening position, not as a verdict on whether he will
        say yes.
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
      </div>
    </details>
  )
}
