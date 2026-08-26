"""Data acquisition. Everything here hits the network and caches to disk.

Two free sources, each doing the thing it is good at:
  - nflverse season stats  -> the *shape* of fantasy production by finish rank
  - consensus rankings     -> the *ordering* of players for the coming season
"""

from __future__ import annotations

import io
import pathlib

import polars as pl
import requests

CACHE = pathlib.Path(__file__).resolve().parent.parent / ".cache"
CACHE.mkdir(exist_ok=True)

UA = {"User-Agent": "trade-grader-build/0.1"}

# DynastyProcess mirrors the FantasyPros consensus feed. nflreadpy points at a
# github.com/.../raw/ URL; raw.githubusercontent.com serves the same bytes and is
# the more reliable host.
DP = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/{}.csv"

SKILL_POSITIONS = ("QB", "RB", "WR", "TE")


def _cached_csv(name: str, url: str, max_age_days: float = 1.0) -> pl.DataFrame:
    # These feeds write literal "NA" into otherwise-numeric columns.
    opts = dict(infer_schema_length=20000, null_values=["NA", "N/A", ""])

    path = CACHE / f"{name}.csv"
    if path.exists():
        import time

        age_days = (time.time() - path.stat().st_mtime) / 86400
        if age_days < max_age_days:
            return pl.read_csv(path, **opts)

    resp = requests.get(url, timeout=60, headers=UA)
    resp.raise_for_status()
    path.write_text(resp.text, encoding="utf-8")
    return pl.read_csv(io.StringIO(resp.text), **opts)


def load_rankings() -> pl.DataFrame:
    """Current-season redraft consensus ranks.

    Returns one row per player with pos, team, ecr, and a within-position rank.
    ECR plays the role ADP plays in the plan: it is the market's ordering, and it
    already prices in rookies, injuries, holdouts and role changes.
    """
    raw = _cached_csv("fpecr_latest", DP.format("db_fpecr_latest"))

    df = (
        raw.filter(pl.col("page_type") == "redraft-overall")
        .filter(pl.col("pos").is_in(SKILL_POSITIONS))
        .filter(pl.col("ecr").is_not_null())
        .select(
            pl.col("player").alias("name"),
            pl.col("pos"),
            pl.col("team"),
            pl.col("ecr"),
            pl.col("sd").alias("ecr_sd"),
            pl.col("bye").cast(pl.Int32, strict=False).alias("bye"),
            pl.col("id").cast(pl.Utf8).alias("fantasypros_id"),
            pl.col("scrape_date"),
        )
        .sort("ecr")
    )

    return df.with_columns(
        pl.col("ecr").rank("ordinal").over("pos").cast(pl.Int32).alias("pos_rank"),
        pl.col("name").map_elements(normalize_name, return_dtype=pl.Utf8).alias("match_key"),
    )


SUFFIXES = {"jr", "sr", "ii", "iii", "iv", "v"}

# Nicknames and formal names that normalization alone cannot reconcile. Every
# entry here was found by the --probe-name-matching dry run, not guessed. Keys and
# values are already-normalized forms.
ALIASES = {
    "hollywood brown": "marquise brown",
    "chig okonkwo": "chigoziem okonkwo",
    "kenny gainwell": "kenneth gainwell",
    "mitch tinsley": "mitchell tinsley",
    "juice wells": "antwane wells",
    "gabe davis": "gabriel davis",
    "cam ward": "cameron ward",
    "mike thomas": "michael thomas",
    "josh palmer": "joshua palmer",
}


def normalize_name(name: str) -> str:
    """Fold a display name to a match key.

    "A.J. Brown" / "AJ Brown", "Marvin Harrison Jr." / "Marvin Harrison",
    "Kenneth Walker III" / "Kenneth Walker" all collapse to the same string.
    Only ever used as a *fallback* when a source carries no shared id.
    """
    cleaned = "".join(c for c in name.lower() if c.isalnum() or c.isspace())
    parts = [p for p in cleaned.split() if p not in SUFFIXES]
    key = " ".join(parts)
    return ALIASES.get(key, key)


def load_player_ids() -> pl.DataFrame:
    """Crosswalk between ranking-source ids and nflverse gsis ids.

    One row per player, most recent season kept. Carries both an id key
    (fantasypros_id) and a name key, so either join strategy can use it.
    """
    raw = _cached_csv("db_playerids", DP.format("db_playerids"), max_age_days=7)

    missing = {"gsis_id", "name", "position"} - set(raw.columns)
    if missing:
        raise RuntimeError(f"crosswalk missing columns {missing}; saw {raw.columns}")

    sort_col = "db_season" if "db_season" in raw.columns else "gsis_id"

    out = (
        raw.filter(pl.col("gsis_id").is_not_null())
        .sort(sort_col, descending=True, nulls_last=True)
        .select(
            pl.col("gsis_id").cast(pl.Utf8),
            pl.col("fantasypros_id").cast(pl.Utf8).alias("fantasypros_id"),
            pl.col("name").cast(pl.Utf8).alias("xw_name"),
            pl.col("position").cast(pl.Utf8).alias("xw_pos"),
        )
        .with_columns(
            pl.col("xw_name")
            .map_elements(normalize_name, return_dtype=pl.Utf8)
            .alias("match_key")
        )
    )

    return out.unique(subset=["gsis_id"], keep="first")


def load_adp_ffc(
    scoring: str = "half-ppr", teams: int = 12, year: int | None = None
) -> pl.DataFrame:
    """Average draft position from Fantasy Football Calculator.

    The intended production source: public JSON, no key, no signup, no
    terms-of-service question. Carries no shared player id, so it joins to
    nflverse by normalized name + position -- which is why the build fails loudly
    on unmatched top-100 players rather than dropping them.

    NOTE: unreachable from the sandbox this was written in (egress allowlist), so
    this path is untested against the live API. CI has no such restriction.
    """
    import datetime as _dt

    year = year or _dt.date.today().year
    url = (
        "https://fantasyfootballcalculator.com/api/v1/adp/"
        f"{scoring}?teams={teams}&year={year}&position=all"
    )
    resp = requests.get(url, timeout=60, headers=UA)
    resp.raise_for_status()
    payload = resp.json()

    rows = payload.get("players")
    if not rows:
        raise RuntimeError(f"FFC returned no players for {year}: {payload!r}"[:400])

    df = (
        pl.DataFrame(rows)
        .filter(pl.col("position").is_in(SKILL_POSITIONS))
        .select(
            pl.col("name").alias("name"),
            pl.col("position").alias("pos"),
            pl.col("team"),
            pl.col("adp").cast(pl.Float64).alias("ecr"),
            pl.col("stdev").cast(pl.Float64).alias("ecr_sd"),
            pl.col("bye").cast(pl.Int32, strict=False).alias("bye"),
            pl.lit(None, dtype=pl.Utf8).alias("fantasypros_id"),
            pl.lit(str(payload.get("meta", {}).get("last_updated", ""))).alias("scrape_date"),
        )
        .sort("ecr")
    )

    return df.with_columns(
        pl.col("ecr").rank("ordinal").over("pos").cast(pl.Int32).alias("pos_rank"),
        pl.col("name").map_elements(normalize_name, return_dtype=pl.Utf8).alias("match_key"),
    )


def load_season_stats(seasons: list[int]) -> pl.DataFrame:
    """Regular-season totals per player, reduced to scoring components."""
    import nflreadpy as nfl

    frames = []
    for season in seasons:
        path = CACHE / f"stats_{season}.parquet"
        if path.exists():
            frames.append(pl.read_parquet(path))
            continue
        df = nfl.load_player_stats(seasons=[season], summary_level="reg")
        df.write_parquet(path)
        frames.append(df)

    stats = pl.concat(frames, how="vertical_relaxed")

    return (
        stats.filter(pl.col("position").is_in(SKILL_POSITIONS))
        .select(
            pl.col("player_id").alias("gsis_id"),
            pl.col("player_display_name").alias("name"),
            pl.col("position").alias("pos"),
            pl.col("season"),
            pl.col("games"),
            pl.col("passing_yards").fill_null(0).alias("pass_yd"),
            pl.col("passing_tds").fill_null(0).alias("pass_td"),
            pl.col("passing_interceptions").fill_null(0).alias("int"),
            pl.col("carries").fill_null(0).alias("rush_att"),
            pl.col("rushing_yards").fill_null(0).alias("rush_yd"),
            pl.col("rushing_tds").fill_null(0).alias("rush_td"),
            pl.col("receptions").fill_null(0).alias("rec"),
            pl.col("receiving_yards").fill_null(0).alias("rec_yd"),
            pl.col("receiving_tds").fill_null(0).alias("rec_td"),
            pl.col("fumbles_lost_total").fill_null(0).alias("fum_lost"),
        )
        .with_columns(pl.col(c).cast(pl.Float64) for c in COMPONENTS)
    )


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
