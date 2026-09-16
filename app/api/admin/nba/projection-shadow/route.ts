import { NextRequest, NextResponse } from 'next/server';
import { requireAdminApi } from '@/lib/requireAdminApi';
import { authorizeSlateResource } from '@/lib/security/resourceAuthorization';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { scoreCachedNbaProjection } from '@/lib/analytics/nba/projectionInfrastructure';
import { getPlayerProjectionsForSeason } from '@/lib/playerProjections';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin-only read surface. It never changes production projections or cache state. */
export async function GET(request: NextRequest) {
  const denied = await requireAdminApi();
  if (denied) return denied;
  const slateId = Number(request.nextUrl.searchParams.get('slateId'));
  if (Number.isSafeInteger(slateId) && slateId > 0) {
    const authorization = await authorizeSlateResource(request, slateId, { requireCommissioner: true });
    if (!authorization.ok) return authorization.response;
  }
  const season = request.nextUrl.searchParams.get('season') ?? String(new Date().getUTCFullYear());
  const [cache, production, slate] = await Promise.all([
    supabaseAdmin.from('nba_projection_stat_cache').select('player_id,model_version,as_of,generated_at,projected_stats,projected_participation,confidence,sample,components,fallback_reason,source_latest_game_at,source_latest_updated_at'),
    getPlayerProjectionsForSeason(season),
    Number.isSafeInteger(slateId) && slateId > 0 ? supabaseAdmin.from('slates').select('id,rules_snapshot,start_date').eq('id', slateId).maybeSingle() : Promise.resolve({ data: null, error: null }),
  ]);
  if (cache.error) return NextResponse.json({ error: cache.error.message }, { status: 500 });
  if (slate.error) return NextResponse.json({ error: slate.error.message }, { status: 500 });
  const snapshot = slate.data?.rules_snapshot as Record<string, unknown> | null ?? { sport: 'nba' };
  const now = Date.now();
  const rows = (cache.data ?? []).map(row => {
    const generatedAt = String(row.generated_at);
    const ageHours = (now - Date.parse(generatedAt)) / 3_600_000;
    let v2ProjectedFantasyPoints: number | null = null;
    try { v2ProjectedFantasyPoints = scoreCachedNbaProjection({ projected_stats: row.projected_stats as never }, snapshot, snapshot === null); } catch { /* invalid cache row stays inspectable */ }
    const current = production.projections[Number(row.player_id)];
    return { playerId: row.player_id, playerName: current?.playerName ?? null, productionProjection: current?.projection ?? null,
      v2ProjectedFantasyPoints, expectedMinutes: (row.projected_participation as { expectedMinutes?: number })?.expectedMinutes ?? null,
      confidence: row.confidence, modelVersion: row.model_version, asOf: row.as_of, generatedAt, stale: !Number.isFinite(ageHours) || ageHours > 36,
      sample: row.sample, components: row.components, fallbackReason: row.fallback_reason, sourceLatestGameAt: row.source_latest_game_at };
  });
  return NextResponse.json({ slateId: slate.data?.id ?? null, slateRulesSnapshot: slate.data?.rules_snapshot ?? null, rows }, { headers: { 'Cache-Control': 'no-store' } });
}
