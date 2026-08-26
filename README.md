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
npm test                       # 360 tests: engine behaviour + Python parity
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
    test_schema.py     corrupts a good file ten ways, checks each is caught

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

If that suite goes red, the two halves have drifted and one of them is now lying
to users.

`model/value.py` and `model/lineup.py` are pure functions with no I/O. They are
the reference implementation for the Phase 3 JavaScript port: the two should
produce identical numbers on identical inputs, and that is worth a test.

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

Three real problems, all caught by running the thing rather than by reading code:

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

## Known gap for Phase 5

The explanation names the slot that moved most, which is not always the slot the
acquired player landed in. Trade for a better RB1 and the largest single change
can be at RB2 — your old RB1 sliding down — so the sentence describes the cascade
and never mentions the player you just acquired. The arithmetic is right and the
sentence is true; it just may not read like an answer to the question asked.
There is a test documenting this (`KNOWN COPY GAP`). Fix it in Phase 5, against a
real reader, rather than guessing at the copy now.
