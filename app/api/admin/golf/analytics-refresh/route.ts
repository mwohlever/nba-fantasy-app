import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.GOLF_CRON_SECRET?.trim();
  return Boolean(secret) && request.headers.get('authorization') === `Bearer ${secret}`;
}

/** Retired: GitHub Actions owns ESPN acquisition because Vercel egress is blocked by ESPN. */
export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ error: 'Retired: Golf analytics ESPN ingestion runs from GitHub Actions.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } });
}

/** Retired: this route must never make the large direct ESPN request from Vercel. */
export async function POST(request: Request) {
  if (!authorized(request))
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  return NextResponse.json({ error: 'Retired: Golf analytics ingestion runs from GitHub Actions.' },
    { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
