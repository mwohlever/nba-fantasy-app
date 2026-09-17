import { NextRequest, NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/requireAdminApi";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NFL_PROJECTION_V2, scoreCachedNflProjection, validateNflRawProjectionStats } from "@/lib/analytics/nfl/projectionInfrastructure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin-only raw-stat shadow audit. It never writes or supplies production NFL projections. */
export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const slateId = Number(request.nextUrl.searchParams.get("slateId")), season = Number(request.nextUrl.searchParams.get("season") ?? new Date().getUTCFullYear());
  if (!Number.isInteger(season) || season < 2000 || season > 2100) return NextResponse.json({ error: "Valid NFL season required." }, { status: 400 });
  if (Number.isSafeInteger(slateId) && slateId > 0) {
    const authorization = await authorizeSlateResource(request, slateId, { requireCommissioner: true });
    if (!authorization.ok) return authorization.response;
  }
  const [cache, players, slate] = await Promise.all([
    supabaseAdmin.from("nfl_projection_stat_cache").select("provider_player_id,local_player_id,position,season,model_version,as_of,generated_at,projected_stats,confidence,sample,components,source_latest_game_at,source_latest_known_at").eq("season", season).eq("model_version", NFL_PROJECTION_V2),
    supabaseAdmin.from("players_nfl").select("id,name,nfl_player_id,position,is_active").eq("is_active", true),
    Number.isSafeInteger(slateId) && slateId > 0 ? supabaseAdmin.from("slates").select("id,sport,rules_snapshot").eq("id", slateId).eq("sport", "nfl").maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (cache.error || players.error || slate.error) return NextResponse.json({ error: cache.error?.message ?? players.error?.message ?? slate.error?.message }, { status: 500 });
  const supportedPositions = ["QB", "RB", "WR", "TE"], activePlayers = players.data ?? [];
  const invalidIdentityCount = activePlayers.filter(player => supportedPositions.includes(String(player.position)) && !/^\d+$/.test(String(player.nfl_player_id ?? ""))).length;
  const eligible = activePlayers.filter(player => supportedPositions.includes(String(player.position)) && /^\d+$/.test(String(player.nfl_player_id ?? "")));
  const cachedByLocalId = new Map((cache.data ?? []).map(row => [Number(row.local_player_id), row]));
  const rows = eligible.map(player => {
    const row = cachedByLocalId.get(Number(player.id));
    if (!row) return { playerId: player.id, playerName: player.name, position: player.position, availability: "unavailable", reason: "zero_current_season_history" };
    const stats = row.projected_stats as never, valid = validateNflRawProjectionStats(stats);
    let fantasyPoints: number | null = null;
    try { if (slate.data?.rules_snapshot && valid) fantasyPoints = scoreCachedNflProjection({ projected_stats: stats }, slate.data.rules_snapshot as Record<string, unknown>); } catch { /* cache remains inspectable */ }
    return { playerId: player.id, playerName: player.name, position: player.position, availability: "available", modelVersion: row.model_version, asOf: row.as_of, generatedAt: row.generated_at, confidence: row.confidence, sample: row.sample, components: row.components, projectedStats: stats, projectedFantasyPoints: fantasyPoints, sourceLatestGameAt: row.source_latest_game_at, sourceLatestKnownAt: row.source_latest_known_at, rawStatValid: valid };
  });
  const available = rows.filter(row => row.availability === "available"), byPosition = Object.fromEntries(["QB", "RB", "WR", "TE"].map(position => [position, rows.filter(row => row.position === position).length]));
  return NextResponse.json({ season, slateId: slate.data?.id ?? null, slateRulesSnapshot: slate.data?.rules_snapshot ?? null, modelVersion: NFL_PROJECTION_V2,
    audit: { eligiblePlayers: eligible.length, projectedPlayers: available.length, unavailablePlayers: rows.length - available.length, zeroHistoryCount: rows.length - available.length, invalidIdentityCount, byPosition, confidence: { low: available.filter(row => row.confidence === "low").length, normal: available.filter(row => row.confidence === "normal").length }, modelVersions: Object.fromEntries([...new Set(available.map(row => row.modelVersion))].map(version => [version, available.filter(row => row.modelVersion === version).length])), duplicateCurrentProjectionIdentities: available.length - new Set(available.map(row => `${row.playerId}:${row.modelVersion}`)).size, missingLocalIds: available.filter(row => !Number.isSafeInteger(Number(row.playerId))).length, unexpectedPositions: rows.filter(row => !supportedPositions.includes(String(row.position))).length, rawStatValidationAnomalies: available.filter(row => !row.rawStatValid).length, futureHistoryLeakageAnomalies: available.filter(row => Date.parse(String(row.sourceLatestGameAt)) >= Date.parse(String(row.asOf)) || Date.parse(String(row.sourceLatestKnownAt)) >= Date.parse(String(row.asOf))).length, persistedFantasyPointsOrScopeFields: 0 }, rows }, { headers: { "Cache-Control": "no-store" } });
}
