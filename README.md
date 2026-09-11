# Trade Grader

A free fantasy football trade grader. Static, no accounts, no database, no cost.

**Live: https://trade-grader-bay.vercel.app**

See [PLAN.md](PLAN.md) for the build plan this follows.

## What it does

You build a roster, propose a trade, and it tells you what the trade does to the
lineup you would actually start — in a sentence, not just a number.

You can also work the other way round: name a player you want, and it searches
every combination of up to three players on your roster for the ones that clear
his value without overpaying, grades each against your real lineup, and keeps
only the offers that improve it. The lineup half of that is exact; the price half
is a guess about a roster it cannot see, and the UI says so where the answer is.

Trades are graded at the **lineup** level, never by summing player values.
Summing is how trade calculators end up telling people that three WR4s beat an
elite running back. Receive two receivers and only one cracks your lineup, and
the second contributes nothing to the headline; positional scarcity falls out of
that for free.

## Run it

```bash
pip install -r requirements.txt

python3 validate.py            # Phase 1 gate: do the verdicts look right?
python3 build_players.py       # emit web/public/players.json
python3 test_schema.py         # does the validator catch a broken file?
python3 export_golden.py       # fixtures for the JS parity test

cd web && npm install
npm test                       # 391 tests: engine, persistence, Python parity
npm run dev
```

**After any rebuild of `players.json`, re-run `export_golden.py`.** The parity
fixtures are computed from that file; if they drift apart the test goes red for
the wrong reason. The refresh workflow does both in the right order.

First run pulls ~30MB and takes a couple of minutes. Everything caches to
`.cache/`; later runs are instant.

### build_players.py

```bash
python3 build_players.py                          # default: consensus ECR source
python3 build_players.py --source ffc             # Fantasy Football Calculator ADP
python3 build_players.py --check web/public/players.json
python3 build_players.py --probe-name-matching    # readiness check for id-less sources
python3 build_players.py --basis rest_of_season --weeks-remaining 11
```

`--probe-name-matching` is a gate, not a report: it exits non-zero if a name-only
join would miss anyone inside consensus rank 100, which is the bar the build
itself refuses to ship below.

Exits non-zero on any validation failure, and writes nothing when it does. In CI
that leaves the last good file live, because stale data beats wrong data.

## Layout

    model/sources.py   network + caching. The only module that does I/O.
    model/curves.py    positional finish curves, in component space
    model/value.py     scoring rules, replacement level, VOR
    model/lineup.py    best_lineup, grade_trade, plain-English explanation
    model/schema.py    the data contract, as a readable validator
    model/fromfile.py  reads players.json back in, so Python and JS see the same numbers
    build_players.py   emits players.json
    export_golden.py   emits the parity fixtures
    trades.py          validation fixtures — EDIT THESE
    validate.py        the Phase 1 harness
    test_schema.py     corrupts a good file fourteen ways, checks each is caught

    web/src/engine/scoring.js   scoring rules, curves, replacement level
    web/src/engine/lineup.js    bestLineup
    web/src/engine/trade.js     gradeTrade, band, explain
    web/src/engine/targets.js   where the model disagrees with the market
    web/src/state.js            localStorage + shareable URL
    web/src/league.js           league spec, its bounds, and its URL codec
    web/src/App.jsx             shell; the panels live beside it

The engine imports no React and touches no DOM. Nothing in the component tree
computes a point total of its own — if a number is on screen, the engine produced
it. That keeps the tested half tested and leaves the untested half with nothing
in it worth testing.

## Two implementations, one answer

`model/value.py` + `model/lineup.py` are the reference implementation.
`web/src/engine/` must reproduce them exactly. `export_golden.py` writes what
Python computes for 8 league shapes x 12 trades, and `parity.test.js` asserts the
JavaScript matches to within 1e-9 — points, replacement level, VOR, chosen
starters, deltas, verdicts and explanation strings.

The fixtures only cover inputs the fixtures happen to contain, so anywhere the
two implementations could disagree on an input the fixtures never produce gets a
named unit test instead — `replacementForSlot` against a replacement map with a
position missing is the current example. `Player` is `@dataclass(eq=False)` for
the same reason: JavaScript compares roster members by identity, so Python must
too, and a value-comparing dataclass silently does not.

If that suite goes red, the two halves have drifted and one of them is now lying
to users.

`valueTargets` is client-only and has no Python counterpart. It is presentation
built on `vor`, not part of the value model, and it is tested on its own terms.

## Two places, one decision

The settings panel caps in `web/src/league.js` and `MIN_CURVE_DEPTH` in
`model/schema.py` are the same decision written twice. Replacement level is read
off the shipped curve and `curveAt` **clamps** past the end of it rather than
raising — so a league deep enough to run off the curve gets a silently wrong
replacement level and therefore a silently wrong grade for every trade in it.

A test in `state.test.js` asserts the deepest league the panel can build stays
inside the depth the contract guarantees. Widen either side and that test tells
you the other has to move.

## Edit trades.py

The `expected` verdicts currently in `trades.py` are a stand-in. The gate is that
the model agrees with **your** read, not mine. Replace them with trades you have
an opinion on — real ones from your leagues are ideal — then re-run.

`VALUE_ASSERTIONS` is separate and should not need editing. Those are properties
of the model itself (elite WR beats elite QB in 1QB, the reverse in superflex,
deeper leagues raise everyone's value) rather than judgements about players.

## Operations

**`.github/workflows/refresh.yml`** rebuilds the data every Tuesday at 11:00 UTC,
runs the schema test and the parity suite, and commits `players.json` only if the
numbers actually moved. Vercel redeploys on that push. A failed run commits
nothing and emails you, leaving the last good file live.

`generated_at` changes on every build and the file is minified onto a single
line, so no line-based diff can tell a real change from a new timestamp.
`.github/scripts/data_changed.py` compares the parsed documents instead.

**`.github/workflows/ci.yml`** runs the engine tests, the build, and a contract
check on every push and pull request.

**One thing is not automated.** From week 1 the projections should be
rest-of-season — a full-season projection in week 10 is actively wrong, because
it credits points already scored. Run the refresh workflow manually with a
`weeks_remaining` input to switch; scheduled runs stay on `full_season`.
Deriving the NFL week from the date was more failure surface than it was worth.

## Data sources

**Historical stats:** nflverse via `nflreadpy`. Free, public, no key.

**Player ids:** the DynastyProcess crosswalk. Joins are made on `gsis_id`, never
on raw display names.

**Ranks:** two sources, selected with `--source`.

- `fantasypros` (default) — the DynastyProcess mirror of the FantasyPros
  consensus feed. Carries a shared player id, so the join is exact. It is
  FantasyPros data redistributed by a third party, which is the licensing grey
  area the plan set out to avoid.
- `ffc` — Fantasy Football Calculator's public ADP JSON. Clean licensing, no key,
  no signup. Carries **no** shared player id, so it must join on a normalized
  name. Implemented but untested against the live API: FFC was unreachable from
  the machines this was built on. CI has no such restriction, so verify it there.

The two are a real trade-off, not a formality: one costs you licensing comfort,
the other costs you an exact join. `--probe-name-matching` measures the second
cost before you pay it.

## What running it found

Problems caught by running the thing rather than by reading code.

1. **Verdict bands had no direction.** A 5-point *loss* was labelled a "clear
   win", because the band lookup used only magnitude.

2. **Unfilled starting slots scored zero.** Trading away your only tight end
   looked like a 10-point-per-week catastrophe. In reality you stream a
   replacement, so an empty slot now scores at replacement level. That moved the
   affected trade from −10.1 to −3.3 per week.

3. **The client could not rebuild the curve from `players`.** Replacement level
   lands at a fractional rank, and dropped players leave gaps. The curve ships
   explicitly. Cost: 37 KB.

4. **Name matching drops real players.** A name-only join missed Hollywood Brown,
   Chig Okonkwo, Kenny Gainwell and others — all draftable. 98.2% to 99.3% once
   `sources.ALIASES` was populated from the probe output.

5. **The curve-depth floor sat below the leagues on offer**, and `weeks_remaining`
   was unvalidated — both able to produce a wrong grade with no error. See the
   Phase 1–3 review commit for the full list of seven.

6. **"You gain 0.0 points a week."** Reachable with real data at +0.034/wk. Both
   engines now branch on the rendered string, so they cannot drift at a rounding
   boundary.

7. **The explanation described the cascade, not the trade.** Acquiring a better
   RB1 pushes your old RB1 to RB2, and that knock-on is the larger delta — so
   ranking slots by magnitude named neither player you traded. Worse, on a losing
   trade it would announce a loss and then describe an upgrade. The lead slot now
   follows the direction of the verdict: where the acquired player landed on a
   gain, what left on a loss.

8. **An empty roster scored 1207.** Correct — unfilled slots stream a replacement
   — but as a standalone total beside an empty roster it reads as broken. The
   total waits for a real player.

## Scope

**In:** redraft, manual rosters, trade grading with plain-English reasoning,
PPR/half/standard, 8–14 teams, superflex, QB/RB/WR/TE, localStorage + shareable
URL, methodology page, value targets.

**Out:** league import, dynasty/keeper/IDP, kickers and defences (replacement
level there is the starter, so VOR is meaningless — excluded and said so in the
UI), accounts, waiver advice, start/sit, opponent rosters.

Not affiliated with the NFL or any fantasy platform.
