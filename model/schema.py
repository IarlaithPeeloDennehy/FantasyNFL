"""Validation for players.json.

Hand-rolled on purpose: the data contract is the seam between the Python build
and the JavaScript client, so it should be readable by someone who knows neither
jsonschema nor pydantic. No dependencies, no magic, one function.
"""

from __future__ import annotations

SCHEMA_VERSION = 1

REQUIRED_TOP = (
    "schema_version",
    "generated_at",
    "season",
    "basis",
    "curve_meta",
    "curves",
    "sources",
    "players",
)

# Below this, a position's curve is too shallow to price replacement level in a
# deep league (14 teams x 3 WR + flex reaches past WR45).
MIN_CURVE_DEPTH = {"QB": 24, "RB": 50, "WR": 60, "TE": 24}

REQUIRED_PLAYER = ("id", "name", "pos", "team", "adp", "pos_adp_rank", "proj")

COMPONENTS = (
    "pass_yd",
    "pass_td",
    "int",
    "rush_att",
    "rush_yd",
    "rush_td",
    "rec",
    "rec_yd",
    "rec_td",
    "fum_lost",
)

VALID_POS = {"QB", "RB", "WR", "TE"}
VALID_BASIS = {"full_season", "rest_of_season"}

MIN_PLAYERS = 150
TOP_N_MUST_RESOLVE = 100


def _validate_curves(curves) -> list[str]:
    """The curve is what prices replacement level, so a broken one silently
    corrupts every grade in the app rather than throwing."""
    if not isinstance(curves, dict):
        return ["curves is not an object"]

    problems: list[str] = []
    for pos in VALID_POS:
        rows = curves.get(pos)
        if not isinstance(rows, list) or not rows:
            problems.append(f"curves.{pos}: missing or empty")
            continue

        depth = MIN_CURVE_DEPTH.get(pos, 0)
        if len(rows) < depth:
            problems.append(
                f"curves.{pos}: only {len(rows)} ranks; need at least {depth} to price "
                "replacement level in a deep league"
            )

        for i, row in enumerate(rows):
            missing = [c for c in COMPONENTS if c not in row]
            if missing:
                problems.append(f"curves.{pos}[{i}]: missing {missing}")
                break
            if any(not isinstance(row[c], (int, float)) for c in COMPONENTS):
                problems.append(f"curves.{pos}[{i}]: non-numeric component")
                break
        else:
            # Production must fall off as finish rank gets worse. A curve that
            # rises means the ranking or the smoothing has gone wrong.
            first = sum(abs(rows[0][c]) for c in COMPONENTS)
            last = sum(abs(rows[-1][c]) for c in COMPONENTS)
            if last >= first:
                problems.append(
                    f"curves.{pos}: rank {len(rows)} is not below rank 1 "
                    "-- the curve is flat or inverted"
                )

    return problems


def validate(doc: dict) -> list[str]:
    """Return a list of problems. Empty list means the file is good."""
    problems: list[str] = []

    for key in REQUIRED_TOP:
        if key not in doc:
            problems.append(f"missing top-level key: {key}")
    if problems:
        return problems

    if doc["schema_version"] != SCHEMA_VERSION:
        problems.append(
            f"schema_version is {doc['schema_version']}, expected {SCHEMA_VERSION}"
        )

    if doc["basis"] not in VALID_BASIS:
        problems.append(f"basis {doc['basis']!r} not in {sorted(VALID_BASIS)}")

    problems += _validate_curves(doc.get("curves"))

    players = doc["players"]
    if not isinstance(players, list):
        return problems + ["players is not a list"]

    if len(players) < MIN_PLAYERS:
        problems.append(
            f"only {len(players)} players; expected at least {MIN_PLAYERS}. "
            "A source has probably changed shape."
        )

    seen_ids: set[str] = set()
    ranks: dict[str, set[int]] = {}

    for i, p in enumerate(players):
        where = f"players[{i}] ({p.get('name', '?')})"

        for key in REQUIRED_PLAYER:
            if key not in p:
                problems.append(f"{where}: missing {key}")
        if any(key not in p for key in REQUIRED_PLAYER):
            continue

        if p["pos"] not in VALID_POS:
            problems.append(f"{where}: position {p['pos']!r} not in {sorted(VALID_POS)}")

        pid = p["id"]
        if pid is None:
            problems.append(f"{where}: null id")
        elif pid in seen_ids:
            problems.append(f"{where}: duplicate id {pid}")
        else:
            seen_ids.add(pid)

        missing_components = [c for c in COMPONENTS if c not in p["proj"]]
        if missing_components:
            problems.append(f"{where}: proj missing {missing_components}")
        elif all(p["proj"][c] == 0 for c in COMPONENTS):
            problems.append(f"{where}: projection is all zeroes")

        rank = p["pos_adp_rank"]
        if not isinstance(rank, int) or rank < 1:
            problems.append(f"{where}: pos_adp_rank {rank!r} is not a positive integer")
        else:
            bucket = ranks.setdefault(p["pos"], set())
            if rank in bucket:
                problems.append(f"{where}: duplicate {p['pos']} rank {rank}")
            bucket.add(rank)

    # The loud failure that matters most: a missing star is a credibility problem
    # that surfaces a week later as a bug report.
    top = sorted(players, key=lambda p: p.get("adp", 1e9))[:TOP_N_MUST_RESOLVE]
    unresolved = [p["name"] for p in top if not p.get("id")]
    if unresolved:
        problems.append(
            f"{len(unresolved)} of the top {TOP_N_MUST_RESOLVE} players have no id: "
            f"{', '.join(unresolved[:10])}"
        )

    for pos, bucket in ranks.items():
        if bucket and min(bucket) != 1:
            problems.append(f"{pos} ranks start at {min(bucket)}, not 1")

    return problems
