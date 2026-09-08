# Trade model v2 — situational grading

Phase 0 is built (see §6). Everything else is design.

Three things the current grader is blind to:

1. **The shape of value** — the gap between tiers is not uniform, so equal point
   totals are not equal assets.
2. **The user's situation** — a 0-3 team and a 3-0 team should not be told the
   same thing about the same trade.
3. **Roster arithmetic** — receiving more players than you send means cutting
   somebody, and that cost is currently invisible.

Before designing anything I checked what the model already does, because two of
these are partly handled and the naive fix double-counts them.

---

## 0. Where the model stands today

| Piece | File | State |
|---|---|---|
| Lineup-level delta | `web/src/engine/lineup.js` | Sound. This is what kills the 2-for-1 illusion. |
| Verdict bands | `trade.js:14` | Absolute pts/week, fixed at 0.5 / 2.0 / 5.0. Situation-blind. |
| Bench depth | `trade.js:38` | Flat `0.2 × Σ max(VOR, 0)` over the whole bench. Unbounded. |
| Horizon | `scoring.js:9` | Hardcoded `GAMES_PER_SEASON = 17`. No concept of "now" vs "later". |
| Record / standings | — | Does not exist. |
| Roster size cap | — | Does not exist. `afterRoster` grows without limit. |
| Injury / availability | `model/schema.py:44` | Not in the data contract at all. |

Two live defects found while reading, both load-bearing for this work:

**D1 — rest-of-season files report per-week deltas about half what they should.**
*(Fixed. Left here because the reasoning is still the argument for Phases 4–5.)*
`build_players.py:39` scales every projection by `weeks_remaining / 17`, but
`trade.js:59` always divides by `GAMES_PER_SEASON = 17`. With 8 weeks left,
every headline number is multiplied by 8/17. Nobody has hit it because the
shipped file is still `full_season` — but week 1 flips the basis, and the entire
record-awareness feature is about weeks remaining. Fixing this is a prerequisite,
not a nice-to-have.

**D2 — the curve's top tier is flattened by its own smoothing.**
*(Fixed. Measured worse than estimated below: the rank-1→5 gap was compressed
35–47%, not merely "flattened".)*
`model/curves.py:88` applies `rolling_mean(window_size=5, center=True,
min_samples=1)`. At rank 1 the window clips to ranks 1–3, so the shipped RB1
projection is literally the mean of the RB1, RB2 and RB3 historical finishes.
The curve is at its steepest and most convex exactly there, so the smoother
compresses precisely the gap this work is about.

---

## 1. Concern A — the shape of value

### 1.1 The premise, checked against the shipped curve

Half-PPR points from `web/public/players.json`:

| Pos | 5→10 total | per rank | 10→25 total | per rank | ratio |
|---|---|---|---|---|---|
| RB | 48.3 | 9.7 | 62.0 | 4.1 | **2.4×** |
| WR | 36.4 | 7.3 | 33.3 | 2.2 | **3.3×** |
| TE | 27.6 | 5.5 | 46.6 | 3.1 | 1.8× |
| QB | 42.1 | 8.4 | 128.5 | 8.6 | **1.0×** |

So: **per rank moved, you are right, and the model already knows it.** RB5→RB10
costs 2.4× more per rank than RB10→RB25. That convexity is baked into the finish
curve and flows straight through `playerPoints` into the headline delta.

Two things fall out of this that change what I'd build.

**The headline number does not need fixing.** Across the *whole span*,
RB10→RB25 is the larger total drop (62.0 vs 48.3) simply because it covers 15
ranks instead of 5. A trade of RB5-for-RB10 really is worth fewer points than
RB10-for-RB25, and the model is right to say so. If I bolt an "elite tier bonus"
onto a curve that already prices elite tiers, consolidation trades get inflated
twice and the grader starts recommending every 2-for-1. **The convexity belongs
in the points; what's missing is everything the points can't express.**

**A blanket elite bonus would be actively wrong at QB.** Look at the last row:
the QB curve is *linear* through that range and keeps falling hard to rank 30,
because only 32 quarterbacks start anywhere. QB18 is a genuine cliff away from
QB10. Any tier logic has to be derived per position from the curve itself, never
hardcoded as "top 5 is special".

### 1.2 What is actually missing

**A1 — Stop compressing the top (fixes D2). Done.**
The window now shrinks symmetrically toward each end (widths 1, 3, 5, 5, …), so
the estimate stays unbiased at the boundary and rank 1 keeps its historical
average. Monotone splines were the alternative and were not needed: the measured
defect was entirely boundary bias, and this removes it in five lines with no new
dependency. Replacement level did not move at all — every replacement rank sits
deep in the curve interior, where the smoother was already behaving.

**A2 — Tiers, derived not declared. Done — but not the way this said.**
The proposed algorithm was to cut a tier wherever the rank-over-rank drop exceeds
a multiple of the local median drop. That finds nothing, and the reason is Phase
1: the curve is deliberately smoothed, so there are no cliffs left to detect. It
produced a break at rank 1 and then nothing at all.

A tier is not a gap in the data. It is a statement about indifference, and it has
to be defined in points rather than found in slopes: **a run of consecutive ranks
whose points span less than one band's worth of a starting slot** (2.0 a week,
the Slight edge / Clear win boundary). Measured on the shipped curve:

| | tiers |
|---|---|
| RB | 1-2 \| 3-5 \| 6-9 \| 10-17 \| 18-26 |
| WR | 1-2 \| 3-4 \| 5-9 \| 10-25 \| 26-39 |
| QB | 1-2 \| 3-5 \| 6-10 \| 11-15 \| 16-20 \| 21-24 |
| TE | 1-2 \| 3-7 \| 8-14 \| 15-28 |

Tiers are **not** added to the number. They are used for two things:

- *Language.* "You are trading down a tier at RB and across within a tier at
  WR" is the sentence a fantasy player actually thinks in. `explain()` already
  says "(RB27-level)"; tier names make that legible.
- *Replaceability.* Which leads to the real gap:

**A3 — Acquisition scarcity. Done, and it needed no second concept.**
The plan called for a separate signal: players within X% of each traded player's
projection, with its own threshold. That turned out to be the tier size measured
a second way. **The size of a player's tier is how many players are
interchangeable with him**, so the tier machinery answers both questions and
there is one threshold to defend instead of two.

Reported beside the verdict and never folded in, same discipline as bench depth.
Two constants govern when it speaks: at a scarce-tier size of 4 and a ratio of
2.0 it fired on 65% of graded cases, which is background noise rather than a
point. At 3 and 3.0 it fires on exactly the four trades where replaceability is
the argument and stays silent on even swaps, bench shuffles and rank-adjacent
upgrades.

It is also suppressed at quarterback in a one-QB league, which the plan did not
anticipate. Tier depth measures how hard a player is to replace *from a roster*,
and at quarterback you do not have to — the next one on waivers is nearly as
good. That is exactly what the existing QB note says, so printing both produced
two sentences arguing with each other: "quarterbacks are worth less than their
rank suggests" immediately followed by "you are giving up the scarcer player".

**A4 — Make the bands relative.**
`BANDS` are absolute pts/week. A +2.0/week gain is a rounding error to a stacked
roster and a season-saver to a thin one. Scale the thresholds by the spread of
the user's own starting lineup, so "Clear win" means the same thing to both.

---

## 2. Concern B — the record

This is the biggest change, and the one most likely to go wrong by being
dishonest, so the architecture matters more than the maths.

### 2.1 Two numbers, never merged

The grader keeps producing today's record-blind number, unchanged, labelled
**fair value**. Record-awareness produces a second number beside it, labelled
**value to you, at 0-3**. The verdict line becomes something like:

> **Clear loss on value — but the right trade for a 0-3 team.**
> You give up 2.6 points a week of fair value. Over the next four weeks, the
> window that decides whether you make the playoffs, you *gain* 3.1.

Collapsing these into one adjusted number would be easier and much worse. The
user needs to know they are paying a premium and roughly how much, or the tool
is just laundering a bad trade. This mirrors the existing rule about never
folding depth into the headline.

### 2.2 The mechanism: weight weeks, don't fudge points

The temptation is a multiplier — "you're 0-3, multiply win-now assets by 1.3".
That is unfalsifiable and unexplainable. Instead, change **which weeks get
counted**.

Today: `deltaPerWeek = deltaSeason / 17`. Every week weighted equally.

Proposed: `Δ = Σ_t w(t) × ΔlineupPoints(t)`, where `w(t)` is how much a point in
week *t* is worth to *this* team.

- `w(t)` for regular-season weeks ∝ how much a win in week *t* moves your
  playoff probability.
- `w(t)` for playoff weeks ∝ your probability of still being alive to play them.

A 0-3 team has playoff odds that collapse without near-term wins, so its `w(t)`
is heavily front-loaded — weeks 4–7 dominate and week 15 barely registers,
because it is unlikely to matter. A 3-0 team's curve is flatter with a bump at
the playoff weeks. Same arithmetic, opposite conclusions, and both are
explainable in one sentence.

Playoff probability from (wins, losses, weeks left, playoff spots, teams) via a
small lookup table generated offline, not a live simulation. A table is
inspectable, testable, has no runtime cost, and is easily good enough — the
difference between 18% and 22% odds does not change any recommendation.

### 2.3 The injured star, worked properly

This needs one thing the model does not have: **when does he play again.** The
data contract has no injury field (`REQUIRED_PLAYER` in `model/schema.py:44`),
and I would rather not add an injury-report scraper for v2.

**Ship it as user input.** A player chip on the roster gets an availability
control: *healthy / out N weeks / out for the season*. The user already knows —
it is the reason they are grading the trade. Zero new data dependencies, zero
new failure modes in the weekly cron. An automated status feed can land later as
a prefill for the same field.

Availability turns one season projection into a weekly one: zero for weeks he is
out, curve value after, optionally a ramp for the first week or two back.
Combined with `w(t)`, the whole thing falls out without a single fudge factor:

- **0-3 team, star RB out 5 weeks.** His points land in weeks the team probably
  will not be alive for. His situational value collapses. Trading him at 70 cents
  on the dollar for someone who plays *now* scores as correct.
- **3-0 team, same player.** `w(t)` is flat with a playoff bump, his return
  lands inside the window that counts, situational ≈ fair value. The same trade
  is now correctly graded as a loss.

**The double-count trap.** ADP already prices known injuries — `PLAN.md` §3 says
so explicitly, and it is true. A star who tore something in week 2 has already
fallen in the rankings, so his `pos_adp_rank` and therefore his projection are
already discounted. If I zero out his weeks *on top* of that, I have charged for
the injury twice. Mitigation: `ranks_as_of` is already in the data contract
(`sources.ranks_as_of`, read in `engine/index.js:36`). If the injury post-dates
the ranking, apply the availability haircut in full; if the rankings are more
recent than the injury, apply it against the *pre-injury* rank implied by
season-long ADP, or damp it. This is fiddly and it is exactly the kind of thing
that quietly makes a model wrong, so it gets its own test.

### 2.4 Prerequisite

Fix D1 first. A week-weighted horizon is meaningless while the client thinks
every file covers 17 weeks. `GAMES_PER_SEASON` becomes `weeksRemaining` from the
document, defaulting to 17 for `full_season`.

---

## 3. Concern C — uneven trades and the forced drop

### 3.1 What breaks today

`gradeTrade` builds `afterRoster = roster − give + receive` with no cap, and
`depthValue` then sums `max(VOR, 0)` across the *entire* resulting bench. So a
3-for-1 makes your bench look better by counting two players you cannot legally
keep. The model currently **rewards you for players you would have to cut** —
the same category of error as the 2-for-1 bug the lineup model was built to fix,
one layer down.

Two smaller problems sit next to it:

- Depth is linear and unbounded. Your 7th bench receiver counts the same per
  point as your 1st. In reality only the top couple at a position ever start.
- Nothing in the app knows how big a roster is.

### 3.2 The design

**Roster size joins league settings.** Bench slots (and optionally IR slots) in
`SettingsPanel`, bounded in `league.js` `LIMITS`, carried through `encodeSpec`.
Note that `encodeSpec` is a positional 5-field string — adding fields needs a
version marker or old shared URLs decode wrong, and `decodeSpec` returns `null`
on a length mismatch, so a stale link would silently reset to defaults.

**When over the cap, compute the cuts.** Greedily drop the lowest *marginal*
player until legal, where marginal value is: contribution to the best lineup
first, then discounted depth value, then positional insurance. Insurance matters
— never cut the last body at a position with a dedicated starter slot, or the
model happily cuts your only QB to keep a 4th receiver and reports it as an
upgrade.

**Charge the trade for what it costs.** The delta becomes lineup change *plus*
what the forced cuts remove. This is where a 3-for-1 stops flattering itself.

**Say it out loud.** The explanation names the casualties:

> "You would be two over the roster limit. To fit them you would cut Tyler
> Allgeier and Cade Otton — Otton is your only backup tight end."

That sentence is the feature. The number alone will not stop anyone.

**Diminishing depth.** Replace the flat 0.2 with a per-position decay — first
bench player at a position counts most, third counts little — so depth cannot be
farmed by hoarding. Both this and the cut-selector need the same "what is this
bench player actually worth" function, so build it once.

**The reverse case.** Sending more than you receive opens roster spots, which
have real but small option value (waiver claims, streaming). Easy to overstate.
I would price it as a small named constant with a comment saying it is a guess —
the same treatment `flexShare` gets — rather than pretending to model the waiver
wire.

**Byes.** `build_players.py:73` already emits a `bye` field that nothing
consumes. Once weeks are modelled, a bye is just a zero week, and "these three
players all bye in week 9" comes free.

### 3.3 What the gate got wrong

The gate said *"the 3-for-1 that currently grades as a win grades as a loss"*.
It does not, and on reflection it should not. Two things I had not reconciled
when writing it:

- **Depth is deliberately kept out of the headline**, and a forced cut almost
  always removes a bench player. So the cut cost lands in `deltaDepth`, not in
  the verdict. Making it move the headline would mean folding bench value back
  into the headline — the exact bug the lineup model exists to prevent. Keeping
  the rule and losing the gate is the right trade.
- **A normal roster has room.** Eight starting slots and seven bench spots means
  a 3-for-1 drops your two worst bench players, who by construction are the two
  the lineup never uses. The verdict *should* be unmoved.

Measured on the default league: **zero** of 96 golden verdicts changed. What did
change is what the fix was actually for — `deltaDepth` on `consolidation-trap`
fell from 7.2 to 3.2 and on `obvious-robbery` from 6.4 to 3.1, because the old
flat sum was counting players the roster could not keep and counting a fourth
spare receiver as though he were a first. The verdict moves only where a cut
reaches into the starting lineup, which is what the `tight-bench-12` and
`no-bench-12` fixtures exist to cover.

The real gate, met: cuts are computed, named in the explanation, correctly
attributed between the trade and a pre-existing overflow, and the roster after a
trade is always legal.

### 3.4 Two bugs the tests found

**`explain` fell silent on exactly the trades that needed it.** It returned early
when no starting slot changed — and a bench-for-bench 3-for-1 changes no slot, so
the one shape of trade most likely to force a drop was the one that never
mentioned it. The consequences of a trade are now built separately from the
description of it, and both endings carry them.

**Pre-existing overflow was blamed on the trade.** Grading a player against
himself on an over-full roster reported five forced cuts as though the trade had
caused them. Whose fault the crunch is turns out to be a different question from
who has to go, and the sentence now distinguishes them.

---

## 4. The three compound — worked end to end

Your example, run through the proposed model.

**Setup.** 0-3. Roster is 15 with 15 slots. You hold a top-3 RB who is out 5
weeks. Offered: your injured RB for their RB14 + WR30 + a TE.

**Fair value (what the app says today, still shown):**
The elite RB's curve projection is high; the return sums to less. The lineup
model correctly refuses to let three mid players beat one great one. Verdict:
*clear loss, −3.4 pts/week.*

**Then each of the three concerns fires:**

1. **Shape.** You are moving down two tiers at RB and the incoming RB14 sits mid
   tier. Scarcity line: *"comparable RB14s: nine available in a league this
   size; the RB you are sending: none."* This makes the trade look **worse**,
   correctly — this is a genuine premium you are paying, not a hidden bonus.

2. **Record.** `w(t)` is front-loaded onto weeks 4–7. Your star scores zero
   across all four. The three incoming players play every one of them and two
   crack your lineup immediately. Over the window that decides your season the
   delta flips **positive**.

3. **Roster.** 15 − 1 + 3 = 17 against a 15 cap. Two cuts. The cut-selector
   takes your WR5 and your backup TE — and flags that the incoming TE is now
   your only one, so if he is the bye-week casualty you are streaming. Some of
   the apparent gain is given straight back.

**Output:**

> **Clear loss on value — but defensible at 0-3.**
> Fair value: you lose 3.4 points a week. Over the next four weeks — the window
> that decides your season — you gain 2.1, because the player you are sending
> does not play in any of them.
> You would be two over the roster limit and would cut Jaylen Wright and Cade
> Otton. You are paying a real premium: the RB you are sending has no comparable
> replacement available, the RB14 you are getting has nine. That is the price of
> needing wins now.

The three effects genuinely pull in different directions, which is the point.
Anything that always resolves to "trade it" is a fudge factor with a story.

---

## 5. New inputs

| Input | Where | Notes |
|---|---|---|
| Wins / losses | New standings control | Also weeks played, to derive weeks left. |
| Playoff spots | League settings | Usually 6 of 12. Needed for the odds table. |
| Roster size, bench, IR | League settings | Bounded like the existing `LIMITS`. |
| Per-player availability | Roster chip control | healthy / out N weeks / out for season. |
| Playoff-odds table | Generated offline, shipped | Small, inspectable, testable. |
| `weeks_remaining` respected | Already in the contract | Currently ignored by the client — that is D1. |

Everything except the odds table is user input, so nothing here adds a source
that can break the weekly cron. `bye` and `ranks_as_of` already exist in the
contract and start being used. All of this has to survive the URL round-trip,
which is where `encodeSpec` needs its version marker.

---

## 6. Phases and gates

| # | Phase | Gate |
|---|---|---|
| 0 | Fix D1: weeks-aware horizon | **Done.** Gate met and strengthened: a `rest_of_season` file now gives the *same* per-week number as the full-season one, at 14/8/3/1 weeks. `web/src/engine/__tests__/horizon.test.js`. |
| 1 | Fix D2: curve smoothing at the top | **Done.** Rank 1 rises 23–32 pts per position, rank 2 by 5–13; ranks 3+ unchanged; still monotone at every rank; schema validation and the 12/12 trade gate pass. `test_curves.py`. |
| 2 | Roster cap + forced cuts + diminishing depth | **Done, but the gate as written was wrong** — see below. Cuts are computed, named, and correctly attributed; depth no longer counts unkeepable players. No headline verdict moved. `test_roster.py`, `roster.test.js`. |
| 3 | Tiers + acquisition scarcity | **Done.** Tiers widen 3.4–7.5× down the curve at RB/WR/TE and only 2.0× at QB, entirely from the data. Tier depth doubles as the replaceability measure, so A3 needed no second concept. `test_market.py`, `market.test.js`. |
| 4 | Weekly horizon + availability | Star out 5 weeks scores near zero over weeks 1–5 and full value after. Double-count guard tested against `ranks_as_of`. |
| 5 | Record → `w(t)` → situational value | Same trade, 0-3 vs 3-0, produces opposite recommendations with both numbers shown. |
| 6 | Explanation rewrite | A fantasy player reads it and can restate the reasoning without seeing the numbers. Same gate Phase 05 had, and the only one that matters. |
| 7 | Methodology page | Every new assumption written down, including the ones I am least sure of. |

Phases 0–2 are corrections and stand alone — worth landing whatever happens to
the rest. 3–5 are the new model. 6 is the product.

---

## 7. What I would not build

- **A single adjusted number.** Fair value and situational value stay side by
  side. One number hides the premium being paid, which is the only thing the
  user actually needs in order to decide.
- **A hardcoded elite-tier bonus.** The curve already prices convexity. Adding a
  bonus double-counts it, and would be flatly wrong at QB.
- **A live playoff simulation.** A generated table is inspectable and easily
  accurate enough.
- **An injury scraper, for now.** New weekly failure mode, and the user knows
  better than the feed does. Prefill later.
- **Opponent-roster modelling.** Explicitly out of scope in `PLAN.md` §8 and
  still the right call — it is a much bigger product.
- **Trade *suggestions*.** Grading what you are offered is a defensible claim.
  Generating offers is a different, much weaker one.
