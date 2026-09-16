import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { refreshNbaProjectionBatch } from '@/lib/analytics/nba/projectionRefresh.server';
import { loadActiveResolvedNbaProviderPlayerIds, loadActiveResolvedNbaPlayerIds, loadNbaProviderIdentities, nbaProjectionGenerationRepository, upsertNbaProjectionObservations } from '@/lib/analytics/nba/projectionRepository.server';
import { persistNbaProjectionObservations } from '@/lib/analytics/nba/projectionIngestion.server';
import { generateNbaProjectionStatCache } from '@/lib/analytics/nba/projectionGeneration.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.NBA_PROJECTION_INGEST_SECRET?.trim();
  const received = request.headers.get('authorization');
  if (!expected || !received?.startsWith('Bearer ')) return false;
  const actual = received.slice('Bearer '.length), expectedBytes = Buffer.from(expected), actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

/** Machine-to-machine only; future scheduler calls this in provider-athlete batches of 50 or fewer. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === 'eligible') {
      return NextResponse.json({ providerPlayerIds: await loadActiveResolvedNbaProviderPlayerIds() }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'observations') {
      const season = Number(body.season), observations = body.observations;
      if (!Number.isInteger(season) || !Array.isArray(observations) || observations.length > 5_000) {
        return NextResponse.json({ error: 'Valid season and bounded normalized observations are required.' }, { status: 400 });
      }
      const identities = await loadNbaProviderIdentities();
      const persisted = await persistNbaProjectionObservations({ observations: observations as never,
        repository: { loadProviderIdentities: async () => identities, upsertObservations: upsertNbaProjectionObservations } });
      if (body.generate === false) {
        return NextResponse.json({ ...persisted, generated: 0, unavailable: [], deferredGeneration: true }, { headers: { 'Cache-Control': 'no-store' } });
      }
      const now = new Date().toISOString(), playerIds = await loadActiveResolvedNbaPlayerIds();
      const projections = await generateNbaProjectionStatCache({ repository: nbaProjectionGenerationRepository(), playerIds, targetSeason: season, asOf: now, generatedAt: now });
      return NextResponse.json({ ...persisted, generated: projections.generated.length, unavailable: projections.unavailable, modelVersion: projections.modelVersion }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'generate') {
      const season = Number(body.season);
      if (!Number.isInteger(season) || season < 2000 || season > 2100) {
        return NextResponse.json({ error: 'Valid NBA season required.' }, { status: 400 });
      }
      const now = new Date().toISOString(), playerIds = await loadActiveResolvedNbaPlayerIds();
      const projections = await generateNbaProjectionStatCache({ repository: nbaProjectionGenerationRepository(), playerIds, targetSeason: season, asOf: now, generatedAt: now });
      return NextResponse.json({ generated: projections.generated.length, unavailable: projections.unavailable, modelVersion: projections.modelVersion }, { headers: { 'Cache-Control': 'no-store' } });
    }
    const season = Number(body.season), providerPlayerIds = body.providerPlayerIds;
    if (!Number.isInteger(season) || season < 2000 || season > 2100 || !Array.isArray(providerPlayerIds) || providerPlayerIds.length === 0 || providerPlayerIds.length > 50 || providerPlayerIds.some(value => !/^\d+$/.test(String(value)))) {
      return NextResponse.json({ error: 'Valid season and 1–50 ESPN athlete IDs are required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }
    const now = new Date().toISOString();
    const result = await refreshNbaProjectionBatch({ season, providerPlayerIds: providerPlayerIds?.map(String), asOf: now, generatedAt: now });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'NBA projection ingestion failed.';
    return NextResponse.json({ error: message.slice(0, 400) }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
