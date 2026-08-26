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
from .value import Player


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
