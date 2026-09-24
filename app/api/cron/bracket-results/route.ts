import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { bracketSyncErrorMessage } from "@/lib/bracket/backgroundSyncSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(request: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization");
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const actual = Buffer.from(header.slice("Bearer ".length));
  const secret = Buffer.from(expected);
  return actual.length === secret.length && timingSafeEqual(actual, secret);
}

/** Supabase pg_net will invoke this GET route with a Vault-backed bearer secret. */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    // Keep provider and Supabase modules out of the unauthenticated cold path.
    const { runBracketBackgroundSync } = await import("@/lib/bracket/backgroundSync.server");
    const result = await runBracketBackgroundSync();
    return NextResponse.json(result, { status: result.status === "succeeded" ? 200 : 500, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Bracket background sync failed before completion", bracketSyncErrorMessage(error));
    return NextResponse.json({ error: "Bracket background sync failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
