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

import { gradeTrade } from './engine/index.js'
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
  query, setQuery, pos, setPos,
}) {
  const giving = give.map((id) => byId.get(id)).filter(Boolean)
  const getting = get.map((id) => byId.get(id)).filter(Boolean)
  const active = giving.length > 0 || getting.length > 0

  const grade = active
    ? gradeTrade(roster, giving, getting, league, replacement)
    : null

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

          {/* The product. Everything else on this panel supports this sentence. */}
          <p className="explanation">{grade.explanation}</p>
          <p className="tone">{TONE[grade.verdict]}</p>

          {/* Reported separately, on purpose, and never added to the headline. */}
          <p className="depth">
            Bench depth {grade.deltaDepth >= 0 ? 'improves' : 'worsens'} by about{' '}
            {Math.abs(grade.deltaDepth).toFixed(1)} points of value — byes and
            injuries only, not weekly starting points.
          </p>

          <div className="trade-cols compare">
            <div>
              <h3 className="sub">Lineup now — {grade.before.points.toFixed(0)}</h3>
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
