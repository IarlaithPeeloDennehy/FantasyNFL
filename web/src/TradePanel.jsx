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
import { LineupView, PlayerSearch } from './ui.jsx'

const TONE = {
  'Essentially even': 'Take it if you like the players better. The points say it is a wash.',
  'Slight edge': 'Fine, but not a windfall.',
  'Slight loss': 'Slightly against you. Worth a counter rather than a refusal.',
  'Clear win': 'Accept.',
  'Clear loss': 'Ask for more.',
  'Lopsided win': 'Expect them to back out.',
  'Lopsided loss': 'Turn this down.',
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
    <section className="panel" aria-labelledby="trade-h">
      <h2 id="trade-h">Grade a trade</h2>

      <div className="trade-cols">
        <div>
          <h3 className="sub">You give</h3>
          {roster.length === 0 ? (
            <p className="empty-note">Build a roster first.</p>
          ) : giving.length === 0 ? (
            <p className="empty-note">Pick from your roster below.</p>
          ) : (
            <ul className="chips">
              {giving.map((p) => (
                <li key={p.id}>
                  <button type="button" className="pill out"
                          onClick={() => setGive(give.filter((x) => x !== p.id))}
                          aria-label={`Stop giving ${p.name}`}>
                    {p.name} <span aria-hidden="true">×</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="sub">You get</h3>
          {getting.length === 0 ? (
            <p className="empty-note">Search for players below.</p>
          ) : (
            <ul className="chips">
              {getting.map((p) => (
                <li key={p.id}>
                  <button type="button" className="pill in"
                          onClick={() => setGet(get.filter((x) => x !== p.id))}
                          aria-label={`Stop receiving ${p.name}`}>
                    {p.name} <span aria-hidden="true">×</span>
                  </button>
                  <label className="weeks-out">
                    <span className="sr-only">Weeks {p.name} is out</span>
                    <input
                      type="number" inputMode="numeric" min={0} max={weeksCovered}
                      value={availability?.[p.id] ?? 0}
                      onChange={(e) => setWeeksOut(p.id, Math.trunc(Number(e.target.value)))}
                      title={`Weeks ${p.name} is out`}
                    />
                    <span aria-hidden="true">wks out</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {grade && (
        <div className={`verdict ${grade.direction}`}>
          <div className="verdict-head">
            <span className="band">{grade.verdict}</span>
            <span className="delta">
              {grade.deltaPerWeek >= 0 ? '+' : '−'}
              {Math.abs(grade.deltaPerWeek).toFixed(1)}
              <span className="unit"> pts / week</span>
            </span>
          </div>

          {/* Two numbers, never merged. One adjusted number would be easier and
              much worse: it hides the premium being paid, which is the only
              thing the user actually needs in order to decide. */}
          {grade.situationalPerWeek !== null && (
            <div className="situational">
              <span className="label">
                At {record.wins}&ndash;{record.losses}
                {grade.outlook && <> · {Math.round(grade.outlook.odds * 100)}% to make the playoffs</>}
              </span>
              <span className="band">{grade.situationalVerdict}</span>
              <span className="delta">
                {grade.situationalPerWeek >= 0 ? '+' : '−'}
                {Math.abs(grade.situationalPerWeek).toFixed(1)}
                <span className="unit"> pts / week</span>
              </span>
            </div>
          )}

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
                    <span className="tag">
                      {r.player.pos} tier {r.tier} of {r.of}
                    </span>
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
              <strong>Roster crunch.</strong>{' '}
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
            {Math.abs(grade.deltaDepth).toFixed(1)} points of value — byes and
            injuries only, not weekly starting points.
          </p>

          <div className="trade-cols compare">
            <div>
              <h3 className="sub">
                {grade.phases > 1 ? 'Once everyone is back' : 'Lineup now'} —{' '}
                {grade.before.points.toFixed(0)}
              </h3>
              <LineupView lineup={grade.before} league={league}
                          replacement={replacement} compact />
            </div>
            <div>
              <h3 className="sub">After the trade — {grade.after.points.toFixed(0)}</h3>
              <LineupView lineup={grade.after} league={league}
                          replacement={replacement} compact />
            </div>
          </div>
        </div>
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
    </section>
  )
}
