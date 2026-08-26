# Trade Grader — MVP Build Plan

Revised 26 Aug 2026. A free fantasy football trade grader, built in a weekend,
deployed static, running at zero cost.

Principles this plan answers to: **operability** (weekly cron, loud failures),
**simplicity** (one script, one file, one client, no database), **evolvability**
(ship components not points, so league format is a dropdown not a rebuild).

---

## 1. What changed from the first draft

- **Projections now have a source.** The old plan ranked by "projected points"
  without producing projections. ADP supplies the ordering; historical
  positional curves supply the shape.
- **Trades are graded at the lineup level**, not by summing player values.
  Summing tells users three WR4s beat an elite RB.
- **Scoring moves to the browser.** The build script ships stat components.
- **Lineup slots arrive in the MVP.** The old step 3 deferred them; step 4
  needed them.
- **Build order inverts.** Deploy hour one, validate the model before any UI.

---

## 2. Architecture

    build_players.py  →  players.json  →  browser (React)
    (Python, weekly)     (the contract)   (per request)

    fetch ADP + stats    ~250 players     apply scoring rules
    resolve player IDs   raw components   find replacement level
    fit position curves  no points/ranks  optimise lineups
    emit components      versioned+dated  grade the trade

The seam sits later than you'd expect. The build script produces *facts*.
Everything opinionated and league-specific happens client-side. If points were
baked into the JSON, supporting PPR + standard + superflex would mean three
rebuilds. With components it's a `<select>`.

---

## 3. Value model

### ADP gives the ordering

Average draft position already prices in rookies, injuries, holdouts and role
changes — every case where last season's box score lies. Source:
Fantasy Football Calculator public JSON (no key, no signup, no ToS problem).
Sleeper's API is a free second opinion.

Do **not** scrape FantasyPros — their API needs a key with real limits and
scraping the rankings pages is against their terms.

### History gives the shape

Last three completed seasons via `nflreadpy`. For each season: score every
player under one reference format, rank within position, record the *component
vector* at each positional rank. Average across seasons, smooth with a rolling
median over neighbouring ranks.

    curve[pos][rank] = mean over last 3 seasons of
      { rec, rec_yd, rec_td, rush_att, rush_yd, rush_td,
        pass_yd, pass_td, int, fum_lost }
      for the player finishing #rank at that position

    proj[player] = curve[player.pos][player.pos_adp_rank]

The WR drafted 12th among WRs gets the average component line of a WR12 finish.

> **Limitation to publish on the methodology page:** every player at the same
> positional ADP rank gets the same projection. No player-specific signal beyond
> the market's. Saying so costs nothing and buys credibility the first time
> someone disagrees with a number — and someone will, on day one.

### Value above replacement (client-side)

    points[p]        = dot(proj[p], scoringRules)
    replRank[pos]    = teams × (starters[pos] + flexShare[pos] × flexSlots)
    replacement[pos] = points at curve[pos][replRank[pos]]
    VOR[p]           = points[p] − replacement[p.pos]

    flexShare defaults → RB .45 · WR .45 · TE .10   (tunable constant)

Replacement level is a function of the user's league, not a guessed constant.

---

## 4. Grading a trade

    bestLineup(roster):
      fill QB → TE → RB → WR → FLEX → SUPERFLEX
      greedily, highest projected points remaining

    Δlineup = lineupPoints(after) − lineupPoints(before)
    Δdepth  = 0.2 × Σ max(VOR, 0) of bench, after − before

Fill most-constrained slots first. Greedy isn't provably optimal but at
15-man rosters it's indistinguishable; swap in a bipartite match later if ever
needed.

**This is what fixes the 2-for-1.** Receive two receivers, only one cracks the
lineup, the second contributes nothing to the headline. Positional scarcity
falls out for free.

**Report depth separately, never folded into the headline.** Bench players
aren't worthless (byes, injuries) but aren't worth raw value either. One line:
"you also pick up bench depth worth about X." Summing it in re-creates the bug
you just fixed.

### Verdict bands (per week, user's scoring — tune during Phase 1)

| Δ lineup / week | Verdict           | Tone                              |
|-----------------|-------------------|-----------------------------------|
| < 0.5           | Essentially even  | Take it if you like the players   |
| 0.5 – 2.0       | Slight edge       | Fine, not a windfall              |
| 2.0 – 5.0       | Clear win         | Accept                            |
| > 5.0           | Lopsided          | Expect them to back out           |

### The explanation is the product

Template around the single biggest slot change:

> "You gain 4.2 points a week. Almost all of it is at RB2: Tony Pollard
> (RB27-level) becomes Bucky Irving (RB13-level). You're giving up WR depth to
> do it — fine if you're starting three receivers you trust."

> **The QB problem:** in 1QB leagues elite QBs have almost no VOR. Arithmetically
> correct, socially explosive — users read it as the app being broken. The
> explanation string must carry the scarcity argument explicitly, not just report
> a delta.

---

## 5. Data contract

Freeze before writing any React. This is the seam, and the first thing a future
engineer reads.

```json
{
  "schema_version": 1,
  "generated_at": "2026-08-26T09:00:00Z",
  "season": 2026,
  "basis": "full_season",
  "curve_meta": { "seasons_used": [2023, 2024, 2025],
                  "reference_scoring": "half_ppr" },
  "sources": { "adp": "fantasyfootballcalculator.com",
               "stats": "nflverse" },
  "players": [
    {
      "id": "00-0036389",
      "name": "Ja'Marr Chase",
      "pos": "WR",
      "team": "CIN",
      "adp": 3.2,
      "pos_adp_rank": 1,
      "proj":        { "rec": 108, "rec_yd": 1487, "rec_td": 11,
                       "rush_att": 4, "rush_yd": 22, "rush_td": 0,
                       "pass_yd": 0, "pass_td": 0, "int": 0, "fum_lost": 1 },
      "last_season": { "games": 17, "rec": 100, "rec_yd": 1391 }
    }
  ]
}
```

No points. No value scores. No ranks beyond the ADP rank the projection came
from.

### Join on IDs, never names

"Marvin Harrison Jr.", "A.J. Brown" vs "AJ Brown", "Kenneth Walker III" — name
matching is where a weekend build loses its Saturday. nflverse ships a players
crosswalk with gsis / sleeper / espn / pfr IDs.

> **Fail loudly.** Build script exits non-zero if fewer than 150 players
> resolve, or if *any* top-100 ADP player fails to match. A silently dropped
> star surfaces a week later as a bug report; a build error is a five-minute
> fix. Stale data live always beats wrong data live.

---

## 6. Build order

Deploy before building anything — deploy surprises are annoying at hour two and
demoralising at hour twenty. Validate the model before any UI — if the numbers
don't match what an experienced player would say, no amount of React rescues it.

| # | Phase | Time | Gate |
|---|-------|------|------|
| 00 | Deploy an empty shell | 30 min | A live URL you can send to someone |
| 01 | Validate the model in a spreadsheet | 3 hrs | Agrees with your gut on ≥8 of 10 known trades |
| 02 | Ship `build_players.py` | 2 hrs | Clean run, valid file, zero unmatched top-100 |
| 03 | Scoring engine as pure functions | 3 hrs | Tests pass, incl. explicit 2-for-1 case |
| 04 | Roster picker | 3 hrs | — |
| 05 | Trade grader UI | 3 hrs | A fantasy player reads the sentence and understands it |
| 06 | League settings panel | 1 hr | — |
| 07 | Trust and refresh | 90 min | — |
| 08 | Buy-low targets (if time) | 2 hrs | — |

**Phase 01** — build the curve and VOR in a scratch script. Take 10–15 real
trades you already have an opinion on, run them, compare. No UI, no styling.
Cheapest hour in the build to discover the concept doesn't work.

**Phase 03** — `score()`, `replacementLevel()`, `bestLineup()`, `gradeTrade()`.
Plain functions, no components, unit tested. Only part of the codebase genuinely
worth testing.

**Phase 04** — persist to `localStorage` and mirror to the URL. Ten lines each;
without them every refresh wipes five minutes of the user's work.

**Phase 08** — not "best players you don't have" (any ranking page gives that).
Surface players whose *model value materially exceeds their ADP*. That's a list
only your model can produce, and the one reason someone comes back next week.

Seventeen hours is two solid days, not a Saturday. If it slips, cut Phase 08
first, then Phase 06 (a hardcoded 12-team half-PPR default still demos it).
Never cut Phase 01 or Phase 07.

---

## 7. Operability

**Automate the refresh.** GitHub Actions cron, Tuesday mornings in season: runs
the build script, commits `players.json` if changed, Vercel auto-deploys on
push. Free for public repos. A failed run emails you and leaves the last good
file live.

**Switch to rest-of-season at week 1.** A full-season projection in week 10 is
actively wrong — it credits points already scored. Scale by remaining games,
flip `basis` to `rest_of_season`, label it in the UI. Blending in season-to-date
performance is the main v1.1 item.

**Make staleness visible.** Render `generated_at` as a persistent "Data as of
26 Aug" badge; warn if more than 14 days old. Users forgive old data they can
see. They don't forgive old data presented as current.

**Trademark.** No "NFL" in the product name, no team logos or marks. Footer:
"Not affiliated with the NFL or any fantasy platform."

---

## 8. Scope

**In v1:** redraft only · manual roster building · trade grading with
plain-English reasoning · PPR/half/standard, 8–14 teams, superflex ·
QB/RB/WR/TE · localStorage + shareable URL · methodology page.

**Explicitly out:** league import · dynasty, keeper, IDP · kickers and defences
(VOR is meaningless when replacement level equals the starter — exclude and say
so in the UI) · accounts, waiver advice, start/sit · opponent rosters.

---

## 9. Open decisions

**Next.js or Vite?** Recommend **Vite + React, static, on Vercel**. With no
server, routing or SSR, Next.js is mostly ceremony and a larger thing for a new
engineer to hold in their head. Not a big deal either way if you know Next well.

**Flex-share constants.** RB .45 / WR .45 / TE .10 is an opening guess, not a
derived truth. Tune in Phase 01, keep it a single named constant with a comment.

**One ADP source or two?** Start with FFC alone. Averaging in Sleeper is ~20
lines and reduces single-source risk but doubles the ID-matching surface. v1.1
if FFC proves noisy.

**Product name.** Still unnamed. Avoid "NFL" and any implied platform
affiliation. Decide before the first public link — the URL is the hardest thing
to change later.
