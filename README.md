# Trade Grader — Phases 1–3 (model, data contract, engine)

See [PLAN.md](PLAN.md) for the full build plan. Phase 4 adds the UI; right now
there is a placeholder shell that proves the pieces connect.

## Run it

```bash
pip install -r requirements.txt

python3 validate.py            # Phase 1 gate: do the verdicts look right?
python3 build_players.py       # Phase 2: emit web/public/players.json
python3 test_schema.py         # does the validator catch a broken file?
python3 export_golden.py       # Phase 3: fixtures for the JS parity test

cd web && npm install
npm test                       # 362 tests: engine behaviour + Python parity
npm run dev                    # placeholder shell
```

**After any rebuild of `players.json`, re-run `export_golden.py`.** The parity
fixtures are computed from that file; if they drift apart the test goes red for
the wrong reason.

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
    web/src/App.jsx             placeholder shell — Phase 4 replaces this

The engine imports no React and touches no DOM. It is the only part of the app
worth testing properly, and it stays testable by staying pure.

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

## Edit trades.py

The `expected` verdicts currently in `trades.py` are a stand-in. The gate is that
the model agrees with **your** read, not mine. Replace them with trades you have
an opinion on — real ones from your leagues are ideal — then re-run.

`VALUE_ASSERTIONS` is separate and should not need editing. Those are properties
of the model itself (elite WR beats elite QB in 1QB, the reverse in superflex,
deeper leagues raise everyone's value) rather than judgements about players.

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
  name. Implemented but untested against the live API: FFC is unreachable from
  the sandbox and from the local VM (egress allowlist). CI has no such
  restriction, so verify it there.

The two are a real trade-off, not a formality: one costs you licensing comfort,
the other costs you an exact join. `--probe-name-matching` measures the second
cost before you pay it.

## What Phases 1–2 found

Four real problems, all caught by running the thing rather than by reading code:

1. **Verdict bands had no direction.** A 5-point *loss* was being labelled a
   "clear win", because the band lookup used only magnitude.

2. **Unfilled starting slots scored zero.** Trading away your only tight end
   looked like a 10-point-per-week catastrophe. In reality you stream a
   replacement off waivers, so an empty slot now scores at replacement level.
   That one change moved the affected trade from −10.1 to −3.3 per week.

3. **The client could not rebuild the curve from `players`.** Replacement level
   lands at a fractional rank (a 12-team league replaces RB at 29.4), so the
   client needs `curve[pos][rank]`. Reconstructing it from the shipped players
   looked free — until dropping id-less players left gaps at RB137, TE54 and
   TE66, and a deep league can push replacement past the last ranked player. The
   curve now ships explicitly. Cost: 37 KB.

4. **Name matching drops real players.** The dry run showed a name-only join
   missing Hollywood Brown, Chig Okonkwo, Kenny Gainwell, Mitch Tinsley and Juice
   Wells — nickname and formal-name mismatches, all of them draftable. That took
   name matching from 98.2% to 99.3% once `sources.ALIASES` was populated from
   the probe output. If you switch to FFC, re-run the probe first and expect to
   extend that table; the misses that remain are genuinely absent from the
   crosswalk.

## What the Phase 1-3 review found

A second pass over the finished phases, running every gate rather than reading
code. Everything below is fixed, and each one has a test that fails without the
fix.

1. **The curve-depth floor was set below the leagues v1 offers.** `MIN_CURVE_DEPTH`
   required 24 QB ranks and 24 TE ranks, but a 14-team superflex league replaces
   QB at rank 26.6, and a 14-team two-TE league replaces TE at 31.1. `Curves.at`
   clamps past the end of the curve rather than raising, so a conforming-but-short
   file would not have errored — it would have priced replacement level off the
   wrong rank and been wrong about every grade in that league, quietly. Floors are
   now derived from the worst in-scope league, with the arithmetic in a comment.

2. **`weeks_remaining` was unvalidated.** A `rest_of_season` file scales every
   projection by `weeks_remaining / 17`. Nothing checked that the divisor was
   present or sane, so a file claiming rest-of-season with a null divisor passed
   `--check` clean. Now both directions are checked, including a `full_season`
   file that still carries one.

3. **The two engines disagreed on a missing replacement position.** Python's
   `_replacement_for` folds an absent position in as `0.0` inside its `max`;
   the JavaScript skipped it. Same inputs, different flex replacement level, and
   the golden fixtures could not see it because they never produce a partial
   replacement map. The port now matches, with a unit test that pins it.

4. **`Player` compared by value, JavaScript by identity.** A plain `@dataclass`
   generates `__eq__`, so `p not in give` in `grade_trade` matched on field
   values while the port's `Set` matched on object identity. `eq=False` makes the
   reference implementation behave the way the port does.

5. **"You gain 0.0 points a week."** Reachable with the shipped data: a delta of
   +0.034 renders as `0.0`, and a headline that reads that way looks like a bug
   to the reader whatever the arithmetic says. Both engines now branch on the
   rendered string — so they cannot drift at a rounding boundary — and say
   "shifts by less than a tenth of a point a week" instead. The follow-on
   "Almost all of it is at WR3" had nothing to refer back to in that case either,
   so it becomes "The move is at WR3".

6. **`--probe-name-matching` could not fail.** It computed `top100_misses` from
   the first 100 entries of the miss list rather than misses inside rank 100, and
   then returned `0` on both branches. A readiness check that cannot say no is a
   readiness check nobody should trust. It now gates on consensus rank, using the
   same cutoff the build uses.

7. **A fixture asserted a property the model contradicts.** `FORMAT_SENSITIVITY`
   claimed the QB-for-WR verdict "should flip" in superflex. It does not, and it
   should not — this roster starts Bo Nix at superflex, so trading Burrow empties
   a slot rather than just downgrading one, and superflex is 5.0 pts/wk *worse*
   than 1QB. The note was wrong, not the model. The corrected claim is now
   asserted and gated rather than printed into a table nobody checks.

Two smaller ones: `App.jsx` fetched `players.json` page-relative, which 404s
anywhere but the site root; and `sources.ALIASES` carried a self-mapping entry
that did nothing.

## Known gap for Phase 5

The explanation names the slot that moved most, which is not always the slot the
acquired player landed in. Trade for a better RB1 and the largest single change
can be at RB2 — your old RB1 sliding down — so the sentence describes the cascade
and never mentions the player you just acquired. The arithmetic is right and the
sentence is true; it just may not read like an answer to the question asked.
There is a test documenting this (`KNOWN COPY GAP`). Fix it in Phase 5, against a
real reader, rather than guessing at the copy now.
