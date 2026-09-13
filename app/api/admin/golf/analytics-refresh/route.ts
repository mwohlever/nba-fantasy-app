import { NextResponse } from 'next/server';
import { refreshGolfAnalyticsSeason } from '@/lib/golf/valueAnalytics.server';
import { fetchGolfSeasonScoreboardPayload } from '@/lib/providers/golf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.GOLF_CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

/** Read-only deployed-egress probe, safe to invoke before the cache migration. */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const season = Number(new URL(request.url).searchParams.get('season'));
  if (!Number.isInteger(season) || season < 2000 || season > 2100)
    return NextResponse.json({ error: 'Valid Golf season required.' }, { status: 400 });
  const startedAt = Date.now();
  try {
    const payload = await fetchGolfSeasonScoreboardPayload(season) as { season?: { year?: number }; events?: unknown[] };
    if (payload?.season?.year !== season || !Array.isArray(payload.events)) throw new Error('ESPN Golf season payload mismatch');
    return NextResponse.json({ provider: 'espn_pga', season, status: 'reachable',
      sourceBytes: Buffer.byteLength(JSON.stringify(payload)), eventCount: payload.events.length,
      durationMs: Date.now() - startedAt }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Golf analytics provider probe failed.';
    return NextResponse.json({ provider: 'espn_pga', season, status: 'failed', error: message.slice(0, 400) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
}

/** Explicit operator invocation only; no schedule and no fantasy-slate dependency. */
export async function POST(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  let requestedSeason: number | null = null;
  try {
    const body = await request.json() as { season?: unknown };
    const season = Number(body.season);
    if (!Number.isInteger(season) || season < 2000 || season > 2100)
      return NextResponse.json({ error: 'Valid Golf season required.' }, { status: 400 });
    requestedSeason = season;
    const result = await refreshGolfAnalyticsSeason(season);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Golf analytics refresh failed.';
    return NextResponse.json({ provider: 'espn_pga', season: requestedSeason, status: 'failed', error: message.slice(0, 400) },
      { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
