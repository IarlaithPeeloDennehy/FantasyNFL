#!/usr/bin/env python3
"""Does the validator actually catch a broken file?

A validator nobody has tried to fool is decoration. Run: python3 test_schema.py
"""

from __future__ import annotations

import copy
import json
import pathlib
import sys

from model import schema

GOOD = pathlib.Path("web/public/players.json")


def corrupt_missing_key(doc):
    doc.pop("generated_at")
    return "missing top-level key"


def corrupt_wrong_version(doc):
    doc["schema_version"] = 99
    return "schema_version"


def corrupt_bad_basis(doc):
    doc["basis"] = "vibes"
    return "basis"


def corrupt_truncated(doc):
    doc["players"] = doc["players"][:20]
    return "expected at least"


def corrupt_duplicate_id(doc):
    doc["players"][1]["id"] = doc["players"][0]["id"]
    return "duplicate id"


def corrupt_null_star_id(doc):
    doc["players"][0]["id"] = None
    return "null id"


def corrupt_zero_projection(doc):
    for k in doc["players"][5]["proj"]:
        doc["players"][5]["proj"][k] = 0
    return "all zeroes"


def corrupt_missing_component(doc):
    doc["players"][3]["proj"].pop("rec_yd")
    return "proj missing"


def corrupt_bad_position(doc):
    doc["players"][7]["pos"] = "LB"
    return "not in"


def corrupt_duplicate_rank(doc):
    target = doc["players"][0]
    twin = next(p for p in doc["players"][1:] if p["pos"] == target["pos"])
    twin["pos_adp_rank"] = target["pos_adp_rank"]
    return "duplicate"


CASES = [
    corrupt_missing_key,
    corrupt_wrong_version,
    corrupt_bad_basis,
    corrupt_truncated,
    corrupt_duplicate_id,
    corrupt_null_star_id,
    corrupt_zero_projection,
    corrupt_missing_component,
    corrupt_bad_position,
    corrupt_duplicate_rank,
]


def main() -> int:
    if not GOOD.exists():
        print(f"run build_players.py first — {GOOD} not found")
        return 1

    base = json.loads(GOOD.read_text(encoding="utf-8"))

    problems = schema.validate(base)
    if problems:
        print("FAIL  the real file does not validate:")
        for p in problems:
            print(f"        {p}")
        return 1
    print(f"PASS  clean file validates ({len(base['players'])} players)")

    failures = 0
    for case in CASES:
        doc = copy.deepcopy(base)
        expect = case(doc)
        found = schema.validate(doc)
        caught = any(expect in p for p in found)
        print(f"{'PASS' if caught else 'FAIL'}  {case.__name__:<28} "
              f"{'caught' if caught else 'MISSED'}: {expect}")
        failures += not caught

    print(f"\n{len(CASES) - failures}/{len(CASES)} corruptions caught")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
