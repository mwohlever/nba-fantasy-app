import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Retired. Disable all old scheduler jobs; use /api/cron/refresh-nba with CRON_SECRET. */
export async function GET(request: Request) {
  const secret = process.env.GOLF_CRON_SECRET?.trim();
  const actual = Buffer.from(request.headers.get("authorization") ?? ""), expected = Buffer.from(secret ? `Bearer ${secret}` : "");
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return NextResponse.json({ error: "NBA Skins cron retired. Use /api/cron/refresh-nba." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
