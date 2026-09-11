/**
 * Phase 6: league settings.
 *
 * This panel is the whole argument for shipping components rather than points in
 * players.json. Nothing here refetches anything: changing scoring or league size
 * re-scores the same component vectors in the browser, which is why PPR, standard
 * and superflex are a `<select>` and not three builds.
 *
 * It opens as a drawer under the rail rather than as another card in the column,
 * because it belongs to the format declaration that summons it.
 */

import { LIMITS, SCORING_OPTIONS, toLeague } from './league.js'
import { cutline, replacementRank, rosterLimit } from './engine/index.js'

const SLOTS = [
  ['QB', 'QB'],
  ['RB', 'RB'],
  ['WR', 'WR'],
  ['TE', 'TE'],
]

function Stepper({ label, value, onChange, min, max, disabled }) {
  return (
    <label className="stepper">
      <span>{label}</span>
      <input
        type="number" inputMode="numeric"
        value={value} min={min} max={max} disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function SettingsPanel({ spec, setSpec, curves }) {
  const set = (patch) => setSpec({ ...spec, ...patch })
  const setStarter = (pos, n) => set({ starters: { ...spec.starters, [pos]: n } })

  // The caps in league.js are meant to keep every league inside the shipped
  // curve. If a data file ever ships shallower curves than the contract promises,
  // replacement level would be read off a clamped rank and every grade in that
  // league would be quietly wrong -- so say so rather than silently mispricing.
  const league = toLeague(spec)
  const overrun = ['QB', 'RB', 'WR', 'TE'].filter((pos) => {
    const depth = curves[pos]?.length ?? 0
    return depth > 0 && replacementRank(pos, league) > depth
  })

  return (
    <div className="drawer">
      <div className="wrap">
        <h2 className="sub">League format</h2>

        <div className="settings-grid">
          <label className="stepper">
            <span>Teams</span>
            <input type="number" inputMode="numeric" value={spec.teams}
                   min={LIMITS.teams[0]} max={LIMITS.teams[1]}
                   onChange={(e) => set({ teams: Number(e.target.value) })} />
          </label>

          <label className="stepper wide">
            <span>Scoring</span>
            <select value={spec.scoring} onChange={(e) => set({ scoring: e.target.value })}>
              {SCORING_OPTIONS.map(([key, name]) => (
                <option key={key} value={key}>{name}</option>
              ))}
            </select>
          </label>

          {SLOTS.map(([pos, label]) => (
            <Stepper
              key={pos} label={label} value={spec.starters[pos]}
              min={LIMITS[pos][0]} max={LIMITS[pos][1]}
              disabled={LIMITS[pos][0] === LIMITS[pos][1]}
              onChange={(n) => setStarter(pos, n)}
            />
          ))}

          <Stepper label="FLEX" value={spec.flexSlots}
                   min={LIMITS.flexSlots[0]} max={LIMITS.flexSlots[1]}
                   onChange={(n) => set({ flexSlots: n })} />

          <Stepper label="Bench" value={spec.benchSlots}
                   min={LIMITS.benchSlots[0]} max={LIMITS.benchSlots[1]}
                   onChange={(n) => set({ benchSlots: n })} />

          <Stepper label="Playoff spots" value={spec.playoffSpots}
                   min={LIMITS.playoffSpots[0]} max={LIMITS.playoffSpots[1]}
                   onChange={(n) => set({ playoffSpots: n })} />

          <Stepper label="Regular weeks" value={spec.regularSeasonWeeks}
                   min={LIMITS.regularSeasonWeeks[0]} max={LIMITS.regularSeasonWeeks[1]}
                   onChange={(n) => set({ regularSeasonWeeks: n })} />

          <Stepper label="Playoff weeks" value={spec.playoffWeeks}
                   min={LIMITS.playoffWeeks[0]} max={LIMITS.playoffWeeks[1]}
                   onChange={(n) => set({ playoffWeeks: n })} />

          <label className="stepper wide">
            <span>Superflex</span>
            <select value={spec.superflexSlots}
                    onChange={(e) => set({ superflexSlots: Number(e.target.value) })}>
              <option value={0}>No</option>
              <option value={1}>Yes (QB eligible)</option>
            </select>
          </label>
        </div>

        <p className="prose">
          Kickers and defences are deliberately absent: replacement level at those
          positions is the starter, so value above replacement is meaningless there.
          {' '}One quarterback slot is the maximum — use superflex for a 2QB league,
          which is what the scarcity maths actually describes.
          {' '}<strong>Bench</strong> is the spots you have for these four positions,
          so subtract any your league makes you spend on a kicker or a defence.
          That gives {rosterLimit(league)} roster spots in total, which is what a
          trade has to fit inside.
          {' '}<strong>Playoff spots</strong> and the length of the season decide how
          many wins it takes to qualify — {cutline(league.teams, league.playoffSpots,
          league.regularSeasonWeeks)} in this one — which is what turns your record
          into odds.
        </p>

        {overrun.length > 0 && (
          <p className="prose flag">
            This league reaches past the {overrun.join(', ')} curve in the current
            data file, so replacement level there is a floor rather than a real
            rank. Grades in this league are approximate.
          </p>
        )}
      </div>
    </div>
  )
}
