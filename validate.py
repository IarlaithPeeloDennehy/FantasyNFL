"""Phase 1 gate: does the value model agree with an experienced player's read?

Run:  python3 validate.py
"""

from __future__ import annotations

import sys

from model.build import build_universe
from model.lineup import grade_trade
from model.value import HALF_PPR, League, PRESETS, replacement_points, vor
from trades import FORMAT_SENSITIVITY, ROSTER, TRADES, VALUE_ASSERTIONS

PASS, FAIL = "PASS", "FAIL"


def main() -> int:
    print("Loading data...\n")
    u = build_universe()

    league = League()
    repl = replacement_points(u.curves, league)

    print("=" * 78)
    print("DATA")
    print("=" * 78)
    print(f"  consensus ranks   {u.scrape_date}  ({len(u.players)} skill players)")
    print(f"  curve seasons     {u.curves.seasons}")
    print(f"  id match rate     {u.id_match_rate:6.1%}")
    print(f"  unmatched top-100 {len(u.unmatched_top100)}")
    if u.unmatched_top100:
        print(f"    {', '.join(u.unmatched_top100[:8])}...")

    print()
    print("=" * 78)
    print("REPLACEMENT LEVEL  (12 teams, half-PPR, 1QB/2RB/3WR/1TE/1FLEX)")
    print("=" * 78)
    for pos in ("QB", "RB", "WR", "TE"):
        print(f"  {pos:<3} rank {u.curves.data[pos] and '':<1}"
              f"{_rank_label(pos, league):>6}   {repl[pos]:7.1f} pts")

    print()
    print("=" * 78)
    print("TOP VALUE ABOVE REPLACEMENT")
    print("=" * 78)
    ranked = sorted(u.players, key=lambda p: -vor(p, league, repl))[:12]
    for i, p in enumerate(ranked, 1):
        print(f"  {i:>2}. {p.name:<22} {p.pos}{p.pos_rank:<3} "
              f"{p.points(HALF_PPR):6.1f} pts   VOR {vor(p, league, repl):6.1f}")

    print()
    print("=" * 78)
    print("TRADE VALIDATION  (roster is WR-deep, RB-thin by design)")
    print("=" * 78)

    roster = [u.by_name(n) for n in ROSTER]
    base = None
    passes = 0

    for t in TRADES:
        try:
            give = [u.by_name(n) for n in t["give"]]
            receive = [u.by_name(n) for n in t["receive"]]
        except KeyError as exc:
            print(f"\n  {FAIL}  {t['id']}: {exc}")
            continue

        g = grade_trade(roster, give, receive, league, repl)
        if base is None:
            base = g.before.points

        ok, why = _check(t, g)
        passes += ok
        mark = PASS if ok else FAIL

        print(f"\n  [{mark}] {t['id']}")
        print(f"        give     {', '.join(p.name for p in give)}")
        print(f"        receive  {', '.join(p.name for p in receive)}")
        print(f"        {g.delta_per_week:+.2f} pts/wk   {g.verdict.lower()}"
              f"   (depth {g.delta_depth:+.1f})")
        print(f"        expected {t['expected']}  ->  {why}")
        print(f"        \"{g.explanation}\"")

    print()
    print("=" * 78)
    print("VALUE MODEL ASSERTIONS  (roster-independent)")
    print("=" * 78)
    apasses = 0
    for a in VALUE_ASSERTIONS:
        ok, detail = _check_assertion(a, u)
        apasses += ok
        print(f"  [{PASS if ok else FAIL}] {a['id']:<32} {detail}")

    print()
    print("=" * 78)
    print("FORMAT SENSITIVITY")
    print("=" * 78)
    t = FORMAT_SENSITIVITY
    give = [u.by_name(n) for n in t["give"]]
    receive = [u.by_name(n) for n in t["receive"]]
    by_format: dict[str, float] = {}
    for label, lg in (
        ("1QB   ", League()),
        ("SUPERFLEX", League(superflex_slots=1)),
    ):
        r = replacement_points(u.curves, lg)
        g = grade_trade(roster, give, receive, lg, r)
        by_format[label.strip()] = g.delta_per_week
        print(f"  {label:<10} {g.delta_per_week:+6.2f} pts/wk   {g.verdict.lower()}")

    for label, name in (("PPR      ", "ppr"), ("STANDARD ", "standard")):
        lg = League(scoring=dict(PRESETS[name]))
        r = replacement_points(u.curves, lg)
        g = grade_trade(roster, give, receive, lg, r)
        print(f"  {label:<10} {g.delta_per_week:+6.2f} pts/wk   {g.verdict.lower()}")

    # Printing a table nobody asserts on is how a claim quietly stops being true.
    gap = by_format["1QB"] - by_format["SUPERFLEX"]
    need = t["expect"]["superflex_worse_than_1qb_by"]
    format_ok = gap >= need
    print()
    print(f"  [{PASS if format_ok else FAIL}] {t['id']:<32} "
          f"superflex is {gap:+.2f} pts/wk worse than 1QB (need >= {need:.1f})")

    print()
    print("=" * 78)
    total = len(TRADES)
    print(f"GATE:  {passes}/{total} trades matched the expected verdict")
    print(f"       {apasses}/{len(VALUE_ASSERTIONS)} value-model assertions held")
    print(f"       format sensitivity {'held' if format_ok else 'FAILED'}")
    print("=" * 78)
    print("\nThe expected verdicts in trades.py are a stand-in for your own read.")
    print("Overwrite them with trades you have an opinion on before trusting this.")

    ok = (
        passes >= int(0.8 * total)
        and apasses == len(VALUE_ASSERTIONS)
        and format_ok
    )
    return 0 if ok else 1


def _check_assertion(a: dict, u) -> tuple[bool, str]:
    kind = a["claim"][0]

    def player(pos: str, rank: int):
        return next(p for p in u.players if p.pos == pos and p.pos_rank == rank)

    if kind == "vor":
        _, pos_a, rank_a, op, pos_b, rank_b = a["claim"]
        lg = League(superflex_slots=1) if a["league"] == "superflex" else League()
        repl = replacement_points(u.curves, lg)
        pa, pb = player(pos_a, rank_a), player(pos_b, rank_b)
        va, vb = vor(pa, lg, repl), vor(pb, lg, repl)
        held = va > vb if op == ">" else va < vb
        return held, (f"{pa.name} ({pos_a}{rank_a}) {va:6.1f} vs "
                      f"{pb.name} ({pos_b}{rank_b}) {vb:6.1f}")

    if kind == "league-depth":
        _, pos, rank = a["claim"]
        p = player(pos, rank)
        shallow = League(teams=10)
        deep = League(teams=14)
        vs = vor(p, shallow, replacement_points(u.curves, shallow))
        vd = vor(p, deep, replacement_points(u.curves, deep))
        return vd > vs, f"{p.name}: 10-team {vs:6.1f} < 14-team {vd:6.1f}"

    return False, "unknown assertion kind"


def _rank_label(pos: str, league: League) -> str:
    from model.value import replacement_rank

    return f"{pos}{replacement_rank(pos, league):.1f}"


def _check(t: dict, g) -> tuple[bool, str]:
    want = t["expected"]
    got = g.direction
    if want != got:
        return False, f"got {got}"

    if "min_per_week" in t and abs(g.delta_per_week) < t["min_per_week"]:
        return False, f"got {got} but only {abs(g.delta_per_week):.2f} pts/wk"
    if "max_per_week" in t and abs(g.delta_per_week) > t["max_per_week"]:
        return False, f"got {got} but {abs(g.delta_per_week):.2f} pts/wk is too large"

    return True, f"got {got}"


if __name__ == "__main__":
    sys.exit(main())
