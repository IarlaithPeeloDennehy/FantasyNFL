/**
 * Small shared pieces. Nothing here computes a number of its own -- if a figure
 * appears on screen, the engine produced it.
 */

import { playerPoints, replacementForSlot, slotStem, vor } from './engine/index.js'

export function PlayerRow({ player, league, replacement, children }) {
  const value = vor(player, league, replacement)
  return (
    <li className="row">
      <span className="name">{player.name}</span>
      <span className="tag">{player.pos}{player.pos_adp_rank} · {player.team}</span>
      <span className={value >= 0 ? 'vor pos' : 'vor neg'}>{value.toFixed(0)}</span>
      {children}
    </li>
  )
}

/**
 * A search box over the player pool. Used twice -- building a roster, and
 * choosing what you get back in a trade -- with a different action each time.
 */
export function PlayerSearch({
  players, exclude, league, replacement, query, setQuery, pos, setPos, action,
  positions = ['ALL', 'QB', 'RB', 'WR', 'TE'], limit = 40, placeholder, label,
}) {
  const needle = query.trim().toLowerCase()
  const results = players
    .filter((p) => !exclude.has(p.id))
    .filter((p) => pos === 'ALL' || p.pos === pos)
    .filter((p) => !needle || p.name.toLowerCase().includes(needle)
                   || p.team.toLowerCase() === needle)
    .slice(0, limit)

  return (
    <>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={placeholder ?? 'Search by name or team…'}
        aria-label={label ?? 'Search players by name or team'}
      />

      <div className="filters">
        {positions.map((p) => (
          <button key={p} type="button" className="chip"
                  aria-pressed={pos === p} onClick={() => setPos(p)}>
            {p}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <p className="empty-note">No players match. Try a different name or position.</p>
      ) : (
        <ul className="rows">
          {results.map((p) => (
            <PlayerRow key={p.id} player={p} league={league} replacement={replacement}>
              {action(p)}
            </PlayerRow>
          ))}
        </ul>
      )}
    </>
  )
}

/** The lineup the engine would start, with empty slots priced at streaming value. */
export function LineupView({ lineup, league, replacement, compact = false }) {
  // An empty roster still scores, because an unfilled slot streams a replacement
  // rather than scoring zero. That is right for grading a trade -- it is the
  // delta that matters -- but "1207 projected points" next to an empty roster
  // reads as a broken app, so the total waits for a real player.
  if (lineup.slots.length === 0) {
    return <p className="empty-note">Add players to see the lineup they would start.</p>
  }

  return (
    <>
      <ul className="slots">
        {lineup.slots.map(([label, p]) => (
          <li className="slot" key={label}>
            <span className="label">{label}</span>
            <span className="who">
              {p.name} <span className="tag">{p.pos}{p.pos_adp_rank}</span>
            </span>
            <span className="pts">{playerPoints(p, league.scoring).toFixed(0)}</span>
          </li>
        ))}
        {lineup.unfilled.map((stem, i) => (
          <li className="slot empty" key={`${stem}-${i}`}>
            <span className="label">{stem}</span>
            <span className="who">empty — streaming a replacement</span>
            <span className="pts">
              {replacementForSlot(slotStem(stem), replacement).toFixed(0)}
            </span>
          </li>
        ))}
      </ul>

      {!compact && (
        <div className="total">
          <span className="meta">Projected season · per week</span>
          <span className="big">
            {lineup.points.toFixed(0)} · {(lineup.points / 17).toFixed(1)}
          </span>
        </div>
      )}
    </>
  )
}
