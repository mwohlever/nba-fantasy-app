import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { nbaRefreshCohort, nbaRefreshHealth, publishNbaRefresh } from "@/lib/player-center/nbaRefreshRepository.server";
import { professionalSeason } from "@/lib/player-center/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { NbaRefreshPublication } from "@/lib/player-center/nbaRefresh";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Machine-only acquisition/publication. No user-interface refresh or forecast generation. */
export async function POST(request: Request) {
  const expected = process.env.NBA_PROJECTION_INGEST_SECRET?.trim(), authorization = request.headers.get("authorization"), actual = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  if (!expected || !actual || Buffer.byteLength(expected) !== Buffer.byteLength(actual) || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return reply({ error: "Unauthorized" }, 401);
  try {
    if (Number(request.headers.get("content-length") ?? 0) > 3_000_000) return reply({ error: "Payload cap exceeded" }, 413);
    const text = await request.text();
    if (Buffer.byteLength(text) > 3_000_000) return reply({ error: "Payload cap exceeded" }, 413);
    const body = JSON.parse(text) as Record<string, unknown>;
    if (body.action === "health") return reply(await nbaRefreshHealth(body.full === true));
    if (body.action === "cohort") return reply({ players: await nbaRefreshCohort() });
    const season = Number(body.season);
    if (!Number.isInteger(season) || season < 2000 || season > professionalSeason("nba") || typeof body.runId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.runId)) return reply({ error: "Valid season and run UUID required" }, 400);
    if (body.action === "receipts") {
      const result = await supabaseAdmin.from("player_center_nba_refresh_status").select("*").eq("season", season).eq("run_id", body.runId).order("player_id").range(0, 1999);
      if (result.error || result.data?.length === 2000) throw new Error("Refresh receipt lookup failed/capped");
      return reply({ receipts: result.data });
    }
    if (body.action !== "publish" || !Array.isArray(body.publications) || body.publications.length < 1 || body.publications.length > 5 || typeof body.asOf !== "string" || !Number.isFinite(Date.parse(body.asOf)) || Date.parse(body.asOf) > Date.now()) return reply({ error: "Invalid bounded publication" }, 400);
    return reply(await publishNbaRefresh({ runId: body.runId, season, asOf: body.asOf, publications: body.publications as NbaRefreshPublication[] }));
  } catch (error) { return reply({ error: error instanceof Error ? error.message.slice(0, 400) : "Factual refresh failed" }, 503); }
}
