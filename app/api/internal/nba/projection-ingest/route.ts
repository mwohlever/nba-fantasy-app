import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Retired machine writer. All factual publication now uses player-center-refresh atomically. */
export async function POST(request: Request) {
  const expected = process.env.NBA_PROJECTION_INGEST_SECRET?.trim(), authorization = request.headers.get('authorization');
  const actual = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  if (!expected || !actual || Buffer.byteLength(expected) !== Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return NextResponse.json({ error: 'NBA shadow ingestion is retired. Use Player Center factual refresh.', retired: true },
    { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
