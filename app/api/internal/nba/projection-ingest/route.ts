import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { loadActiveResolvedNbaProviderPlayerIds } from '@/lib/analytics/nba/projectionRepository.server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Preserve the read-only catalog contract; legacy writes cannot bypass atomic factual publication. */
export async function POST(request: Request) {
  const expected = process.env.NBA_PROJECTION_INGEST_SECRET?.trim(), authorization = request.headers.get('authorization');
  const actual = authorization?.startsWith('Bearer ') ? authorization.slice(7) : undefined;
  if (!expected || !actual || Buffer.byteLength(expected) !== Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  try {
    const body: unknown = await request.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'JSON object required.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    if ('action' in body && body.action === 'eligible') {
      return NextResponse.json({ providerPlayerIds: await loadActiveResolvedNbaProviderPlayerIds() }, { headers: { 'Cache-Control': 'no-store' } });
    }
    return NextResponse.json({ error: 'NBA legacy forecast/writer actions are retired. Use the separately approved atomic Player Center factual publication path.', retired: true }, { status: 410, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyntaxError ? 'Invalid JSON.' : 'NBA eligibility lookup failed.' }, { status: error instanceof SyntaxError ? 400 : 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
