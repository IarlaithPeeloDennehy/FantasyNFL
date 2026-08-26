#!/usr/bin/env python3
"""Did the rebuild actually change anything?

`generated_at` moves on every run, so players.json is textually dirty after every
build whether the ranks moved or not. It is also minified onto a single line,
which rules out any line-based filter: the whole document is one line, and that
line contains the timestamp -- so filtering lines that mention `generated_at`
would discard every real change along with it.

Compare the parsed documents instead, with the timestamp removed. Writes
`changed=true|false` to $GITHUB_OUTPUT, and is safe to run locally, where it just
prints the answer.

    python .github/scripts/data_changed.py
"""

from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys

PATH = "web/public/players.json"
VOLATILE = ("generated_at",)


def committed(path: str) -> dict | None:
    """The version in HEAD, or None on the very first build."""
    result = subprocess.run(
        ["git", "show", f"HEAD:{path}"], capture_output=True, text=True
    )
    if result.returncode != 0:
        return None
    return json.loads(result.stdout)


def strip(doc: dict) -> dict:
    return {k: v for k, v in doc.items() if k not in VOLATILE}


def main() -> int:
    fresh = json.loads(pathlib.Path(PATH).read_text(encoding="utf-8"))
    old = committed(PATH)

    if old is None:
        changed, why = True, f"{PATH} is not in HEAD yet"
    elif strip(fresh) != strip(old):
        changed, why = True, "ranks or projections moved"
    else:
        changed, why = False, "identical apart from the timestamp"

    print(f"changed={str(changed).lower()} — {why}")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"changed={str(changed).lower()}\n")

    return 0


if __name__ == "__main__":
    sys.exit(main())
