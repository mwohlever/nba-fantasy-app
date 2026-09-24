import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const expected = process.env.NFL_CRON_SECRET?.trim();
  const header = request.headers.get("authorization");
  if (!expected || !header?.startsWith("Bearer ")) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const actualBytes = Buffer.from(header.slice(7));
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const { runNflBackgroundScoring } = await import("@/lib/nfl/backgroundScoring.server");
    const result = await runNflBackgroundScoring();
    return NextResponse.json(result, { status: result.status === "succeeded" ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch {
    console.error("nfl_background_scoring_unhandled");
    return NextResponse.json({ error: "NFL worker failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
