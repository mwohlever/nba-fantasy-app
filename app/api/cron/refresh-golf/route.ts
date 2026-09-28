import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { golfRefreshErrorMessage } from "@/lib/golf/backgroundRefreshSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Replaces the EasyCron-era handler at the same URL. Only CRON_SECRET is accepted. */
export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization");
  const actual = Buffer.from(header?.startsWith("Bearer ") ? header.slice(7) : "");
  const secret = Buffer.from(expected ?? "");
  const headers = { "Cache-Control": "no-store" };
  if (!expected || actual.length !== secret.length || !timingSafeEqual(actual, secret))
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers });
  try {
    const { runGolfBackgroundRefresh } = await import("@/lib/golf/backgroundRefresh.server");
    const result = await runGolfBackgroundRefresh();
    return NextResponse.json(result, { status: result.status === "succeeded" ? 200 : 500, headers });
  } catch (error) {
    console.error("golf_background_refresh_unhandled", golfRefreshErrorMessage(error));
    return NextResponse.json({ error: "Golf background refresh failed." }, { status: 500, headers });
  }
}
