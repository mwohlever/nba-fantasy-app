import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { nbaWorkerError } from "@/lib/nba/backgroundSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.NBA_CRON_SECRET?.trim(), header = request.headers.get("authorization");
  const actual = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : ""), expected = Buffer.from(secret ?? "");
  if (!secret || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const { runNbaWorker } = await import("@/lib/nba/backgroundWorker.server");
    const result = await runNbaWorker();
    return NextResponse.json(result, { status: result.success ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("NBA background refresh failed", nbaWorkerError(error));
    return NextResponse.json({ error: "NBA background refresh failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
