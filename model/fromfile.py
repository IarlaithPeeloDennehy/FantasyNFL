"""Read players.json back into the Python model.

The Python model is the reference implementation for the JavaScript port, but
only if both sides see the *same* numbers. The build rounds components to two
decimals on the way out, so a golden fixture computed from the in-memory curves
would disagree with the client in the last few digits for no interesting reason.

Loading the shipped file closes that gap: Python and JavaScript both start from
web/public/players.json.
"""

from __future__ import annotations

import json
import pathlib

from .curves import Curves
from .value import GAMES_PER_SEASON, Player


def weeks_covered(doc: dict) -> int:
    """How many weeks of football the projections in this document span.

    A full-season file covers all 17. A rest-of-season file is scaled down by
    ``weeks_remaining / 17`` at build time (see ``build_players.py``) -- every
    player projection *and* every curve row -- so its numbers describe only the
    weeks that are left.

    This is the divisor for anything reported per week. Using 17 regardless is
    not a rounding error: in week 10 it understates every per-week figure by
    more than half, and does it silently, which is the worst way to be wrong.

    Raises rather than guessing. ``model/schema.py`` already refuses to ship a
    rest-of-season file without a usable ``weeks_remaining``, so reaching here
    with one means the file was hand-edited or built by something else, and a
    guess would quietly rescale every number in the app.
    """
    if doc.get("basis") != "rest_of_season":
        return GAMES_PER_SEASON

    weeks = doc.get("weeks_remaining")
    if type(weeks) is not int or not 1 <= weeks <= GAMES_PER_SEASON:
        raise ValueError(
            f"basis is rest_of_season but weeks_remaining is {weeks!r}; "
            f"expected an integer from 1 to {GAMES_PER_SEASON}"
        )
    return weeks


def load_document(path: str | pathlib.Path) -> tuple[list[Player], Curves, dict]:
    doc = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))

    curves = Curves(
        data={pos: rows for pos, rows in doc["curves"].items()},
        seasons=doc["curve_meta"]["seasons_used"],
        reference_scoring=doc["curve_meta"]["reference_scoring"],
    )

    players = [
        Player(
            name=p["name"],
            pos=p["pos"],
            team=p["team"],
            pos_rank=p["pos_adp_rank"],
            ecr=p["adp"],
            proj=p["proj"],
            gsis_id=p["id"],
            bye=p.get("bye"),
        )
        for p in doc["players"]
    ]

    return players, curves, doc
