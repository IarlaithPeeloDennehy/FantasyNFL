/**
 * Phase 9: the offer finder.
 *
 * The grader answers "is this trade good?". This answers the question people
 * actually start with — "what would it take to get him?" — and it is a search
 * rather than a score, so it has one honesty problem the rest of the app does
 * not: it has to guess at a roster it cannot see. The engine explains how in
 * `engine/offer.js`; this panel's job is to make sure the guess is never
 * presented as a fact.
 *
 * Hence the two columns on every offer. THE COST is what you hand over and how
 * far past his value that lands — a claim about the other manager, and the soft
 * half. THE GAIN is what it does to the lineup you would actually start — the
 * same lineup-level number the grader produces, and the hard half. They are
 * never added together, for the same reason the verdict and the situational
 * number are never added together.
 */

import { useMemo } from 'react'

import { REASONS, findOffers } from './engine/index.js'
import { Code, PlayerSearch, RuleHead } from './ui.jsx'

/** Nudges the grader into view after an offer is loaded into it. */
function revealGrader() {
  if (typeof document === 'undefined') return
  const el = document.getElementById('trade-h')
  el?.scrollIntoView({
    behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      ? 'auto' : 'smooth',
    block: 'start',
  })
}

/**
 * How hard you are pushing, as a word rather than a number.
 *
 * The surplus is in season points of value above replacement, which is a real
 * quantity but not one anybody has intuition for. What they can act on is
 * whether this is a lowball, a fair opening offer, or already generous.
 */
function pitch(surplus, ask) {
  const over = ask > 0 ? surplus / ask : 0
  if (over <= 0.02) return { key: 'tight', label: 'At his value', tone: 'lean' }
  if (over <= 0.15) return { key: 'fair', label: 'Fair opening offer', tone: 'even' }
  if (over <= 0.3) return { key: 'sweet', label: 'Sweetened', tone: 'even' }
  return { key: 'over', label: 'Generous — hold this one back', tone: 'rich' }
}

function Offer({ offer, ask, target, onLoad }) {
  const { give, grade, gain, surplus } = offer
  const push = pitch(surplus, ask)

  return (
    <li className={`offer ${grade.direction}`}>
      <div className="offer-grid">
        <div className="offer-cost">
          <span className="offer-k">You send</span>
          <ul className="offer-pieces">
            {give.map((p) => (
              <li key={p.id}>
                <span className="name">{p.name}</span>
                <Code player={p} />
              </li>
            ))}
          </ul>
          <p className={`pitch ${push.tone}`}>
            {push.label}
            <span className="pitch-n">
              {surplus >= 0 ? '+' : '−'}{Math.abs(surplus).toFixed(0)} value
            </span>
          </p>
        </div>

        <div className="offer-gain">
          <span className="offer-k">Your lineup</span>
          <span className="offer-delta">
            <span className="sign" aria-hidden="true">{gain >= 0 ? '+' : '−'}</span>
            <span className="sr-only">{gain >= 0 ? 'plus ' : 'minus '}</span>
            {Math.abs(gain).toFixed(1)}
            <span className="unit">pts<br />per week</span>
          </span>
          <span className="offer-band">{grade.verdict}</span>
        </div>
      </div>

      <p className="offer-why">{grade.explanation}</p>

      <div className="offer-actions">
        <button type="button" className="btn primary" onClick={() => onLoad(offer)}>
          Open in the grader
        </button>
        <span className="offer-count">
          {give.length} for 1{grade.cuts.length > 0 && <> · {grade.cuts.length} forced drop</>}
          {grade.spotsFreed > 0 && <> · frees {grade.spotsFreed}</>}
        </span>
      </div>

      <p className="sr-only">
        Send {give.map((p) => p.name).join(', ')} for {target.name}.
      </p>
    </li>
  )
}

export function Finder({
  players, roster, byId, league, replacement, weeksCovered, market,
  availability, ranksKnew, record, want, setWant, onLoad,
  query, setQuery, pos, setPos,
}) {
  const held = new Set(roster.map((p) => p.id))

  // Somebody you already hold is not a target. `reconcileWant` drops him from a
  // shared link, and `addPlayer` clears him on acquisition, but a roster and a
  // target can still collide for one render -- and "going after Jahmyr Gibbs /
  // he is already on your roster" is a broken-looking answer to a question the
  // user did not ask. Fall back to the picker instead.
  const target = want && !held.has(want) ? byId.get(want) ?? null : null

  // A few hundred graded packages is about 30ms on a full roster. That is fine
  // once and far too much on every keystroke in a search box three sections
  // away, so it is pinned to the things that actually change the answer.
  const { offers, ask, reason } = useMemo(
    () => findOffers(roster, target, league, replacement, {
      weeksCovered, market, availability, ranksKnew, record,
    }),
    [roster, target, league, replacement, weeksCovered, market, availability, ranksKnew, record],
  )

  return (
    <section className="sheet" aria-labelledby="find-h">
      <RuleHead index="04" title="Find a trade" id="find-h"
                meta={target ? `${offers.length} offer${offers.length === 1 ? '' : 's'}` : null} />

      <div className="sheet-body">
        {target ? (
          <>
            <div className="want">
              <span className="want-k">Going after</span>
              <span className="want-name">{target.name}</span>
              <Code player={target} />
              <span className="want-ask">
                <b>{Math.max(0, ask).toFixed(0)}</b> value above replacement
              </span>
              <button type="button" className="btn ghost" onClick={() => setWant(null)}>
                Change
              </button>
            </div>

            {offers.length > 0 ? (
              <>
                <ul className="offers">
                  {offers.map((offer) => (
                    <Offer key={offer.give.map((p) => p.id).join('+')}
                           offer={offer} ask={ask} target={target}
                           onLoad={(o) => { onLoad(o, target); revealGrader() }} />
                  ))}
                </ul>

                {/* The limitation, stated where the answer is, not in a footnote.
                    Everything above is a claim about somebody else's roster. */}
                <p className="caveat">
                  <b>What this cannot see.</b> Their roster. The lineup half of
                  each offer is the same calculation the grader runs and is as
                  solid as anything here; the price half is value above
                  replacement, discounted for the fact that a second and third
                  player are worth less than their sum to whoever receives them.
                  Whether they say yes depends on what they already start — a
                  team three deep at receiver will not want your fourth, however
                  the value reads.
                </p>
              </>
            ) : (
              <p className="empty">
                <b>{reason === 'no-gain' ? 'Not worth it' : 'No offer found'}</b>
                {REASONS[reason]}
              </p>
            )}
          </>
        ) : (
          <>
            <p className="prose">
              Name a player you want. This searches every combination of up to
              three players on your roster for the ones that clear his value
              without overpaying — then grades each one against the lineup you
              would actually start, and keeps only the offers that improve it.
            </p>

            {roster.length === 0 ? (
              <p className="empty">
                <b>Build a roster first</b>
                The offer has to come from somewhere. Add your team above,
                bench included — your bench is where the tradeable surplus is.
              </p>
            ) : (
              <>
                <h3 className="sub">Who do you want?</h3>
                <PlayerSearch
                  players={players} exclude={held} league={league} replacement={replacement}
                  query={query} setQuery={setQuery} pos={pos} setPos={setPos}
                  placeholder="Search the player you are after…"
                  label="Search for a player to trade for"
                  action={(p) => (
                    <button type="button" className="btn" onClick={() => setWant(p.id)}
                            aria-label={`Find a trade for ${p.name}`}>Target</button>
                  )}
                />
              </>
            )}
          </>
        )}
      </div>
    </section>
  )
}
