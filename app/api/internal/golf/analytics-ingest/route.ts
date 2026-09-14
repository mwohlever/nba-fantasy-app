import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { beginGolfAnalyticsIngestion, finalizeGolfAnalyticsIngestion, ingestGolfAnalyticsEvent } from '@/lib/golf/valueAnalytics.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MAX_REQUEST_BYTES = 2_000_000;

function authorized(request: Request) {
  const expected = process.env.GOLF_ANALYTICS_INGEST_SECRET?.trim();
  const received = request.headers.get('authorization');
  if (!expected || !received?.startsWith('Bearer ')) return false;
  const actual = received.slice('Bearer '.length);
  const expectedBytes = Buffer.from(expected), actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

async function requestJson(request: Request): Promise<unknown> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) throw new Error('Golf analytics request is too large');
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new Error('Golf analytics request is too large');
  try { return JSON.parse(body); } catch { throw new Error('Golf analytics request must be valid JSON'); }
}

/** Machine-to-machine ingestion only. The GitHub worker never receives Supabase credentials. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  try {
    const body = await requestJson(request) as Record<string, unknown>;
    if (body.action === 'begin') {
      const result = await beginGolfAnalyticsIngestion(body.plan as never);
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'event') {
      const result = await ingestGolfAnalyticsEvent({ refreshId: Number(body.refreshId), eventId: String(body.eventId ?? ''),
        expectedNormalizedHash: String(body.expectedNormalizedHash ?? ''), rawEvent: body.rawEvent });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (body.action === 'finalize') {
      const result = await finalizeGolfAnalyticsIngestion({ refreshId: Number(body.refreshId), eventManifest: body.eventManifest as never });
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: 'Unknown Golf analytics ingestion action.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Golf analytics ingestion failed.';
    const status = /invalid|must be|too large|manifest|mapping changed|absent/.test(message) ? 400 : 500;
    return NextResponse.json({ error: message.slice(0, 400) }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
