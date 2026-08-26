"""Assemble the player universe: consensus ordering + historical shape.

The join to nflverse ids happens here, and it is the part most likely to break
quietly. It never matches on raw display names -- it prefers a shared id, and
falls back to a normalized name key only when the ranking source carries no id.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import polars as pl

from . import sources
from .curves import Curves, build_curves
from .sources import COMPONENTS
from .value import HALF_PPR, Player

CURVE_SEASONS = [2023, 2024, 2025]
LAST_SEASON = 2025


@dataclass
class JoinReport:
    total: int
    by_id: int
    by_name: int
    unmatched: list[str]
    unmatched_top100: list[str]

    @property
    def matched(self) -> int:
        return self.by_id + self.by_name

    @property
    def rate(self) -> float:
        return self.matched / max(self.total, 1)


@dataclass
class Universe:
    players: list[Player]
    curves: Curves
    scrape_date: str
    source: str
    join: JoinReport
    last_season: dict[str, dict[str, float]] = field(default_factory=dict)

    # Kept for the Phase 1 harness, which predates JoinReport.
    @property
    def id_match_rate(self) -> float:
        return self.join.rate

    @property
    def unmatched_top100(self) -> list[str]:
        return self.join.unmatched_top100

    def by_name(self, name: str) -> Player:
        for p in self.players:
            if p.name == name:
                return p
        hits = [p.name for p in self.players if name.lower() in p.name.lower()]
        raise KeyError(f"no player named {name!r}" + (f"; did you mean {hits[:5]}?" if hits else ""))


def _attach_ids(rankings: pl.DataFrame, crosswalk: pl.DataFrame) -> tuple[pl.DataFrame, JoinReport]:
    """Prefer the shared id; fall back to normalized name + position."""
    have_ids = (
        "fantasypros_id" in rankings.columns
        and rankings["fantasypros_id"].null_count() < rankings.height
    )

    if have_ids:
        xw_id = crosswalk.filter(pl.col("fantasypros_id").is_not_null()).unique(
            subset=["fantasypros_id"], keep="first"
        )
        joined = rankings.join(
            xw_id.select("fantasypros_id", pl.col("gsis_id").alias("gsis_by_id")),
            on="fantasypros_id",
            how="left",
        )
    else:
        joined = rankings.with_columns(pl.lit(None, dtype=pl.Utf8).alias("gsis_by_id"))

    xw_name = crosswalk.unique(subset=["match_key", "xw_pos"], keep="first")
    joined = joined.join(
        xw_name.select(
            "match_key",
            pl.col("xw_pos").alias("pos"),
            pl.col("gsis_id").alias("gsis_by_name"),
        ),
        on=["match_key", "pos"],
        how="left",
    ).with_columns(
        pl.coalesce(pl.col("gsis_by_id"), pl.col("gsis_by_name")).alias("gsis_id")
    )

    by_id = int(joined["gsis_by_id"].is_not_null().sum())
    by_name = int(
        (joined["gsis_by_id"].is_null() & joined["gsis_by_name"].is_not_null()).sum()
    )

    unmatched_df = joined.filter(pl.col("gsis_id").is_null())
    unmatched = unmatched_df["name"].to_list()
    top100 = joined.sort("ecr").head(100)
    unmatched_top100 = top100.filter(pl.col("gsis_id").is_null())["name"].to_list()

    report = JoinReport(
        total=joined.height,
        by_id=by_id,
        by_name=by_name,
        unmatched=unmatched,
        unmatched_top100=unmatched_top100,
    )
    return joined.drop("gsis_by_id", "gsis_by_name"), report


def name_match_quality(
    rankings: pl.DataFrame, crosswalk: pl.DataFrame
) -> tuple[int, int, list[dict]]:
    """How well would a name-only join do?

    A dry run of the strategy an id-less source (like FFC ADP) would be forced
    into. Run against a source that HAS ids, so the id join is ground truth.

    Misses come back with their consensus rank attached, because *where* a miss
    sits is the whole question: 40 misses past rank 300 is a shrug, one inside
    the top 100 is a blocker.
    """
    xw_name = crosswalk.unique(subset=["match_key", "xw_pos"], keep="first")
    probe = rankings.join(
        xw_name.select("match_key", pl.col("xw_pos").alias("pos"), "gsis_id"),
        on=["match_key", "pos"],
        how="left",
    )
    matched = int(probe["gsis_id"].is_not_null().sum())
    misses = [
        {"name": r["name"], "pos": r["pos"], "ecr": float(r["ecr"])}
        for r in probe.filter(pl.col("gsis_id").is_null())
        .sort("ecr")
        .select("name", "pos", "ecr")
        .iter_rows(named=True)
    ]
    return matched, probe.height, misses


def build_universe(
    curve_seasons: list[int] | None = None,
    source: str = "fantasypros",
    scoring_for_adp: str = "half-ppr",
    teams: int = 12,
) -> Universe:
    seasons = curve_seasons or CURVE_SEASONS

    if source == "ffc":
        rankings = sources.load_adp_ffc(scoring=scoring_for_adp, teams=teams)
    elif source == "fantasypros":
        rankings = sources.load_rankings()
    else:
        raise ValueError(f"unknown ranking source {source!r}")

    stats = sources.load_season_stats(seasons)
    curves = build_curves(stats, HALF_PPR, "half_ppr")

    crosswalk = sources.load_player_ids()
    rankings, report = _attach_ids(rankings, crosswalk)

    last = (
        sources.load_season_stats([LAST_SEASON])
        .select("gsis_id", "games", *COMPONENTS)
        .unique(subset=["gsis_id"], keep="first")
    )
    last_by_id = {
        r["gsis_id"]: {k: float(r[k]) for k in ("games", *COMPONENTS)}
        for r in last.iter_rows(named=True)
    }

    players = [
        Player(
            name=r["name"],
            pos=r["pos"],
            team=r["team"],
            pos_rank=int(r["pos_rank"]),
            ecr=float(r["ecr"]),
            proj=curves.at(r["pos"], int(r["pos_rank"])),
            gsis_id=r.get("gsis_id"),
            bye=int(r["bye"]) if r.get("bye") is not None else None,
        )
        for r in rankings.iter_rows(named=True)
    ]

    scrape = rankings["scrape_date"][0] if rankings.height else ""

    return Universe(
        players=players,
        curves=curves,
        scrape_date=str(scrape),
        source=source,
        join=report,
        last_season=last_by_id,
    )
