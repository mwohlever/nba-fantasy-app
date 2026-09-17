import "server-only";

import { NBA_PROJECTION_V2 } from "@/lib/analytics/nba/projectionGeneration.server";
import type { NbaProjectionStatCacheRecord } from "@/lib/analytics/nba/projectionInfrastructure";
import {
  NFL_PROJECTION_V2,
  type NflProjectionCacheRecord,
} from "@/lib/analytics/nfl/projectionInfrastructure";
import { nflSeasonForSlate } from "@/lib/lineups/nflDraftStats";
import {
  scoreNbaDraftProjection,
  scoreNflDraftProjection,
} from "@/lib/lineups/draftProjections";
import type { DraftProjection } from "@/lib/lineups/draftProjectionTypes";
import { getPlayerProjectionsForSeason } from "@/lib/playerProjections";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const PAGE_SIZE = 500;

type DraftProjectionSlate = {
  sport: "nba" | "nfl";
  date: string | null;
  start_date: string | null;
  display_name: string | null;
  rules_snapshot: Record<string, unknown> | null;
};

function fail(label: string, error: { message: string } | null) {
  if (error) throw new Error(`${label}: ${error.message}`);
}

function appSeason(slate: DraftProjectionSlate) {
  const date = slate.start_date ?? slate.date;
  const year = Number(date?.slice(0, 4));
  return Number.isInteger(year) && year >= 2000 ? String(year) : String(new Date().getUTCFullYear());
}

async function loadNbaV2Rows() {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await supabaseAdmin
      .from("nba_projection_stat_cache")
      .select("player_id,model_version,projected_stats,confidence")
      .eq("model_version", NBA_PROJECTION_V2)
      .order("player_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    fail("NBA Draft V2 projection lookup failed", result.error);
    const page = (result.data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

async function loadNflV2Rows(season: number) {
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await supabaseAdmin
      .from("nfl_projection_stat_cache")
      .select("local_player_id,model_version,projected_stats,confidence")
      .eq("season", season)
      .eq("model_version", NFL_PROJECTION_V2)
      .order("local_player_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    fail("NFL Draft V2 projection lookup failed", result.error);
    const page = (result.data ?? []) as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/**
 * Reads only global raw-stat cache rows and applies the requested slate's
 * frozen rules snapshot in memory. It does not persist fantasy points.
 */
export async function getDraftProjectionsForSlate(slate: DraftProjectionSlate) {
  const projections: Record<number, DraftProjection> = {};

  if (slate.sport === "nfl") {
    const season = Number(nflSeasonForSlate({
      date: slate.date ?? "",
      start_date: slate.start_date ?? undefined,
      display_name: slate.display_name,
    }, appSeason(slate)));
    for (const row of await loadNflV2Rows(season)) {
      const playerId = Number(row.local_player_id);
      if (!Number.isSafeInteger(playerId) || playerId <= 0) continue;
      try {
        const projection = scoreNflDraftProjection(
          { projected_stats: row.projected_stats as NflProjectionCacheRecord["projected_stats"] },
          slate.rules_snapshot,
        );
        if (!Number.isFinite(projection)) continue;
        projections[playerId] = {
          projection,
          source: "nfl_v2",
          modelVersion: String(row.model_version),
          confidence: row.confidence === null ? null : String(row.confidence),
        };
      } catch {
        // An invalid raw cache row is unavailable to the Draft, not coerced.
      }
    }
    return { sport: slate.sport, modelVersion: NFL_PROJECTION_V2, projections };
  }

  const cacheRows = await loadNbaV2Rows();
  const v2PlayerIds = new Set<number>();
  for (const row of cacheRows) {
    const playerId = Number(row.player_id);
    if (!Number.isSafeInteger(playerId) || playerId <= 0) continue;
    try {
      const projection = scoreNbaDraftProjection(
        { projected_stats: row.projected_stats as NbaProjectionStatCacheRecord["projected_stats"] },
        slate.rules_snapshot,
      );
      if (!Number.isFinite(projection)) continue;
      v2PlayerIds.add(playerId);
      projections[playerId] = {
        projection,
        source: "nba_v2",
        modelVersion: String(row.model_version),
        confidence: row.confidence === null ? null : String(row.confidence),
      };
    } catch {
      // Keep the legacy read path available for an invalid or incomplete row.
    }
  }

  try {
    const legacy = await getPlayerProjectionsForSeason(appSeason(slate));
    for (const [rawPlayerId, row] of Object.entries(legacy.projections)) {
      const playerId = Number(rawPlayerId);
      if (v2PlayerIds.has(playerId) || row.projection === null || !Number.isFinite(Number(row.projection))) continue;
      projections[playerId] = {
        projection: Number(row.projection),
        source: "legacy_nba",
        modelVersion: null,
        confidence: row.confidence ?? null,
        badges: row.badges,
      };
    }
  } catch {
    // V2 rows remain usable if the legacy fallback source is unavailable.
  }

  return { sport: slate.sport, modelVersion: NBA_PROJECTION_V2, projections };
}
