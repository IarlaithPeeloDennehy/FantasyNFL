/**
 * Phase 5: the trade grader.
 *
 * "The explanation is the product." The number is the headline, but the sentence
 * underneath it is the thing a person actually reads, argues with, and forwards
 * to a leaguemate -- so the sentence gets the prominence, and the lineups are
 * there to be checked rather than to be read.
 *
 * Bench depth is reported on its own line and never folded into the headline.
 * Folding it back in re-creates exactly the bug the lineup model was built to
 * fix: three WR4s beating an elite back because their values summed.
 */

import { gradeTrade, rosterLimit } from './engine/index.js'
import { LineupView, PlayerSearch, RuleHead, useCountUp, WeeksOut } from './ui.jsx'

const TONE = {
  'Essentially even': 'Take it if you like the players better. The points say it is a wash.',
  'Slight edge': 'Fine, but not a windfall.',
  'Slight loss': 'Slightly against you. Worth a counter rather than a refusal.',
  'Clear win': 'Accept.',
  'Clear loss': 'Ask for more.',
  'Lopsided win': 'Expect them to back out.',
  'Lopsided loss': 'Turn this down.',
}

/**
 * The score, tweened.
 *
 * The one animated figure in the interface. It moves because it is the only
 * number on the page that is a direct answer to something the reader just did,
 * and a broadcast graphic settles onto a score rather than cutting to it.
 */
function Delta({ value }) {
  const shown = useCountUp(value)
  return (
    <span className="board-delta">
      <span className="sign" aria-hidden="true">{value >= 0 ? '+' : '−'}</span>
      <span className="sr-only">{value >= 0 ? 'plus ' : 'minus '}</span>
      {Math.abs(shown).toFixed(1)}
      <span className="unit">pts<br />per week</span>
    </span>
  )
}

/**
 * Where a player sits in his position's depth, as a track with a marker.
 *
 * Tier two of nine and tier seven of nine are a different argument entirely, and
 * the sentence beside this takes a second to parse while this takes none.
 */
const MARK = 3 // px, and the marker has to stay inside the track at both ends

function Track({ tier, of }) {
  const at = of > 1 ? ((tier - 1) / (of - 1)) * 100 : 0
  return (
    <span className="track" aria-hidden="true">
      <i style={{ left: `calc(${at}% - ${(at / 100) * MARK}px)` }} />
    </span>
  )
}

export function TradePanel({
  roster, byId, give, get, setGive, setGet, league, replacement, players,
  query, setQuery, pos, setPos, weeksCovered, market, availability, ranksKnew,
  setWeeksOut, record,
}) {
  const giving = give.map((id) => byId.get(id)).filter(Boolean)
  const getting = get.map((id) => byId.get(id)).filter(Boolean)
  const active = giving.length > 0 || getting.length > 0

  const grade = active
    ? gradeTrade(roster, giving, getting, league, replacement,
                 { weeksCovered, market, availability, ranksKnew, record })
    : null

  // Who is still sidelined on the roster you would end up with. Named rather
  // than counted: "two players are out" is not something anyone can act on.
  const afterRoster = roster.filter((p) => !give.includes(p.id)).concat(getting)
  const sidelined = ranksKnew
    ? []
    : afterRoster.filter((p) => (availability?.[p.id] ?? 0) > 0)

  const limit = rosterLimit(league)
  const held = new Set(roster.map((p) => p.id))
  const excluded = new Set([...held, ...get])

  return (
    <section className="sheet" aria-labelledby="trade-h">
      <RuleHead index="03" title="Grade a trade" id="trade-h"
                meta={active ? `${giving.length} out · ${getting.length} in` : null} />

      <div className="sheet-body">
        {/* Two sides, and they never look alike: red leaves, green arrives. */}
        <div className="trade-cols">
          <div>
            <h3 className="sub out">You give {giving.length > 0 && <span className="n">{giving.length}</span>}</h3>
            {roster.length === 0 ? (
              <p className="empty-inline">Build a roster first.</p>
            ) : giving.length === 0 ? (
              <p className="empty-inline">Pick from your roster above.</p>
            ) : (
              <ul className="chips">
                {giving.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="pill out"
                            onClick={() => setGive(give.filter((x) => x !== p.id))}
                            aria-label={`Stop giving ${p.name}`}>
                      {p.name} <span className="x" aria-hidden="true">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h3 className="sub in">You get {getting.length > 0 && <span className="n">{getting.length}</span>}</h3>
            {getting.length === 0 ? (
              <p className="empty-inline">Search for players below.</p>
            ) : (
              <ul className="chips">
                {getting.map((p) => (
                  <li key={p.id}>
                    <button type="button" className="pill in"
                            onClick={() => setGet(get.filter((x) => x !== p.id))}
                            aria-label={`Stop receiving ${p.name}`}>
                      {p.name} <span className="x" aria-hidden="true">×</span>
                    </button>
                    <WeeksOut player={p} weeks={availability?.[p.id] ?? 0}
                              max={weeksCovered} onChange={setWeeksOut} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {grade && (
          <>
            {/* The board. Flush to the edges of the sheet, dark in both themes,
                because a verdict inset with matching padding reads as one more
                paragraph and this is the answer to the question. */}
            <div className={`board ${grade.direction}`}>
              <div className="board-head">
                <span>
                  <span className="board-kicker">Verdict</span>
                  <span className="board-band">{grade.verdict}</span>
                </span>
                <Delta value={grade.deltaPerWeek} />
              </div>

              {/* Two numbers, never merged. One adjusted number would be easier
                  and much worse: it hides the premium being paid, which is the
                  only thing the user actually needs in order to decide. */}
              {grade.situationalPerWeek !== null && (
                <div className={`board-sit ${grade.situationalPerWeek >= 0 ? 'gain' : 'loss'}`}>
                  <span className="k">
                    To a team at <b>{record.wins}&ndash;{record.losses}</b>
                    {grade.outlook && <> · <b>{Math.round(grade.outlook.odds * 100)}%</b> to make the playoffs</>}
                  </span>
                  <span className="band">{grade.situationalVerdict}</span>
                  <span className="v">
                    {grade.situationalPerWeek >= 0 ? '+' : '−'}
                    {Math.abs(grade.situationalPerWeek).toFixed(1)}
                    {' '}<span className="unit">pts/wk</span>
                  </span>
                </div>
              )}
            </div>

            {/* The product. Everything else on this panel supports this sentence. */}
            <p className="explanation">{grade.explanation}</p>
            <p className="tone">{TONE[grade.verdict]}</p>

            {/* With somebody hurt, the two lineups below are the weeks everyone is
                available -- and their totals are further apart than the headline,
                which is averaged over the whole run. A reader who adds up the two
                columns and gets a different number is right to, so say why rather
                than leaving them to find it. */}
            {grade.phases > 1 && (
              <p className="phase-note">
                {sidelined.length > 0 && (
                  <>
                    <strong>
                      {sidelined.map((p) => p.name).join(', ')}
                    </strong>{' '}
                    {sidelined.length === 1 ? 'is' : 'are'} still out, so the lineups
                    below are the weeks after {sidelined.length === 1 ? 'he returns' : 'they return'}.{' '}
                  </>
                )}
                The headline is averaged across the whole run, so it is smaller than
                those two totals suggest.
              </p>
            )}

            {/* Replaceability, beside the headline and never inside it. A tier
                two deep means there is nobody to go and get; sixteen deep means
                the player is a commodity however well he scores. */}
            {(grade.tiers.give?.length > 0 || grade.tiers.receive?.length > 0) && (
              <ul className="tiers">
                {['give', 'receive'].flatMap((side) =>
                  (grade.tiers[side] ?? []).map((r) => (
                    <li key={`${side}-${r.player.id}`} className={side}>
                      <span className="name">{r.player.name}</span>
                      <span className="tier-meta">
                        {r.player.pos} tier {r.tier} of {r.of}
                      </span>
                      <Track tier={r.tier} of={r.of} />
                      <span className="depth-note">
                        {r.size === 1
                          ? 'alone in his tier'
                          : `one of ${r.size} in his tier`}
                      </span>
                    </li>
                  )),
                )}
              </ul>
            )}

            {/* The forced drop. Above the depth line because it is the concrete
                half of the same cost: "you would cut these two" lands, "bench
                depth worsens by 4.1" does not. */}
            {grade.cuts.length > 0 && (
              <p className="cuts">
                <span className="k">Roster crunch.</span>{' '}
                {grade.overBefore === 0 ? (
                  <>You would be {grade.cuts.length} over the limit of {limit}. To fit
                    {grade.cuts.length === 1 ? ' them' : ' them all'} you would drop{' '}</>
                ) : grade.cuts.length > grade.overBefore ? (
                  <>Your roster is already {grade.overBefore} over the limit of {limit},
                    and this would put you {grade.cuts.length} over. You would drop{' '}</>
                ) : (
                  <>Your roster is already {grade.overBefore} over the limit of {limit},
                    whatever you do here. You would drop{' '}</>
                )}
                {grade.cuts.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && (i === grade.cuts.length - 1 ? ' and ' : ', ')}
                    <strong>{p.name}</strong> ({p.pos}{p.pos_adp_rank})
                  </span>
                ))}.
              </p>
            )}

            {/* Reported separately, on purpose, and never added to the headline. */}
            <p className="depth">
              Bench depth {grade.deltaDepth >= 0 ? 'improves' : 'worsens'} by about{' '}
              <b>{Math.abs(grade.deltaDepth).toFixed(1)}</b> points of value — byes and
              injuries only, not weekly starting points.
            </p>

            <div className="compare">
              <div className="before">
                <div className="compare-head">
                  <span className="k">
                    {grade.phases > 1 ? 'Once everyone is back' : 'Lineup now'}
                  </span>
                  <span className="v">{grade.before.points.toFixed(0)}</span>
                </div>
                <LineupView lineup={grade.before} league={league}
                            replacement={replacement} compact />
              </div>
              <div className="after">
                <div className="compare-head">
                  <span className="k">After the trade</span>
                  <span className="v">{grade.after.points.toFixed(0)}</span>
                </div>
                <LineupView lineup={grade.after} league={league}
                            replacement={replacement} compact />
              </div>
            </div>
          </>
        )}

        <h3 className="sub">Add players you would get back</h3>
        <PlayerSearch
          players={players} exclude={excluded} league={league} replacement={replacement}
          query={query} setQuery={setQuery} pos={pos} setPos={setPos}
          placeholder="Search players to receive…"
          label="Search players to receive"
          action={(p) => (
            <button type="button" className="btn" onClick={() => setGet([...get, p.id])}
                    aria-label={`Receive ${p.name}`}>Get</button>
          )}
        />
      </div>
    </section>
  )
}
