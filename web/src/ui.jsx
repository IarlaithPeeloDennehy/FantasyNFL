/**
 * Small shared pieces. Nothing here computes a number of its own -- if a figure
 * appears on screen, the engine produced it.
 */

import { useEffect, useRef, useState } from 'react'

import { playerPoints, replacementForSlot, slotStem, vor } from './engine/index.js'

/**
 * The section rule: an index, a title, and a count sitting on a heavy stroke.
 *
 * Numbering the sections is not decoration. This is a page you work down in
 * order -- roster, lineup, trade -- and a running index says so in the one place
 * a reader is already looking.
 */
export function RuleHead({ index, title, meta, metaClass, id }) {
  return (
    <div className="rule-head">
      <span className="rule-idx" aria-hidden="true">{index}</span>
      <h2 className="rule-title" id={id}>{title}</h2>
      {meta != null && (
        <span className={metaClass ? `rule-meta ${metaClass}` : 'rule-meta'}>{meta}</span>
      )}
    </div>
  )
}

/** Position, positional rank and club, set as a shirt code. */
export function Code({ player }) {
  return (
    <>
      <span className="code">{player.pos}{player.pos_adp_rank}</span>
      <span className="tag team">{player.team}</span>
    </>
  )
}

/**
 * Weeks a player misses. Lives on the row rather than in a mode, and colours
 * itself the moment it is non-zero so a hurt roster can be read rather than
 * audited.
 */
export function WeeksOut({ player, weeks, max, onChange }) {
  return (
    <label className={weeks > 0 ? 'weeks-out hurt' : 'weeks-out'}>
      <span className="sr-only">Weeks {player.name} is out</span>
      <input
        type="number" inputMode="numeric" min={0} max={max}
        value={weeks}
        onChange={(e) => onChange(player.id, Math.trunc(Number(e.target.value)))}
        title={`Weeks ${player.name} is out`}
      />
      <span aria-hidden="true">wks out</span>
    </label>
  )
}

export function PlayerRow({ player, league, replacement, children }) {
  const value = vor(player, league, replacement)
  return (
    <li className="row">
      <span className="name">{player.name}</span>
      <Code player={player} />
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

      {/* One control with several settings, so it looks like one control. */}
      <div className="filters" role="group" aria-label="Filter by position">
        {positions.map((p) => (
          <button key={p} type="button" className="chip"
                  aria-pressed={pos === p} onClick={() => setPos(p)}>
            {p}
          </button>
        ))}
      </div>

      {results.length === 0 ? (
        <p className="empty">
          <b>No match</b>
          Nothing at {pos === 'ALL' ? 'any position' : pos} answers to “{query.trim()}”.
          Try a surname, or a three-letter club code.
        </p>
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
export function LineupView({ lineup, league, replacement, weeks, compact = false }) {
  // An empty roster still scores, because an unfilled slot streams a replacement
  // rather than scoring zero. That is right for grading a trade -- it is the
  // delta that matters -- but "1207 projected points" next to an empty roster
  // reads as a broken app, so the total waits for a real player.
  if (lineup.slots.length === 0) {
    return (
      <p className="empty">
        <b>No team sheet yet</b>
        Add players and this fills with the eleven the engine would actually
        start, and what each of them is projected to bring.
      </p>
    )
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
          <div>
            <span className="k">Projected season</span>
            <span className="total-val">{lineup.points.toFixed(0)}</span>
          </div>
          <div>
            <span className="k">Per week</span>
            <span className="total-val">{(lineup.points / weeks).toFixed(1)}</span>
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Tween a figure when it changes, the way a broadcast graphic settles onto a
 * score rather than cutting to it.
 *
 * Used in exactly one place -- the verdict -- because the point of the movement
 * is to say "this number just changed because of what you did", and a page where
 * everything animates says nothing at all. Reduced motion gets the value flat.
 */
export function useCountUp(value, duration = 420) {
  // Starts at zero so the first board counts onto its number as it arrives.
  // After that it tweens from wherever it was, which is what says "that changed
  // because of what you just did".
  const [shown, setShown] = useState(0)
  const from = useRef(0)
  const raf = useRef(0)

  useEffect(() => {
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

    if (reduced || !Number.isFinite(value) || !Number.isFinite(from.current)) {
      from.current = value
      setShown(value)
      return undefined
    }

    const start = performance.now()
    const origin = from.current
    const step = (now) => {
      const t = Math.min(1, (now - start) / duration)
      // Quartic ease-out: fast off the mark, settles rather than drifts.
      const eased = 1 - (1 - t) ** 4
      const next = origin + (value - origin) * eased
      setShown(next)
      from.current = next
      if (t < 1) raf.current = requestAnimationFrame(step)
      else from.current = value
    }

    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [value, duration])

  return shown
}
