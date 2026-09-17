import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { auditNflObservationSeason, loadActiveNflObservationPlayers, existingNflObservationHashes, insertNflObservationVersions, nflProjectionGenerationRepository } from "@/lib/analytics/nfl/observationRepository.server";
import { persistNflObservationBatch } from "@/lib/analytics/nfl/observationPersistence.server";
import { generateNflProjectionStatCache } from "@/lib/analytics/nfl/projectionGeneration.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request) {
  const expected = process.env.NFL_PROJECTION_INGEST_SECRET?.trim(), received = request.headers.get("authorization");
  if (!expected || !received?.startsWith("Bearer ")) return false;
  const actual = received.slice("Bearer ".length), expectedBytes = Buffer.from(expected), actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}

/** Machine-to-machine factual ingestion and separately invoked raw-stat shadow generation. */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Unauthorized." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await request.json() as Record<string, unknown>;
    if (body.action === "eligible") {
      return NextResponse.json({ players: await loadActiveNflObservationPlayers() }, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "audit") {
      const season = Number(body.season);
      if (!Number.isInteger(season) || season < 2000 || season > 2100) return NextResponse.json({ error: "Valid NFL season required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      return NextResponse.json(await auditNflObservationSeason(season), { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action === "generate") {
      const season = Number(body.season);
      if (!Number.isInteger(season) || season < 2000 || season > 2100) return NextResponse.json({ error: "Valid NFL season required." }, { status: 400, headers: { "Cache-Control": "no-store" } });
      const asOf = typeof body.asOf === "string" && Number.isFinite(Date.parse(body.asOf)) ? new Date(body.asOf).toISOString() : new Date().toISOString();
      const result = await generateNflProjectionStatCache({ repository: nflProjectionGenerationRepository(), players: await loadActiveNflObservationPlayers(), targetSeason: season, asOf, generatedAt: new Date().toISOString() });
      return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
    }
    if (body.action !== "observations" || !Array.isArray(body.observations) || body.observations.length === 0 || body.observations.length > 500) {
      return NextResponse.json({ error: "Use action eligible, audit, generate, or 1–500 normalized factual observations." }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
    const result = await persistNflObservationBatch({ observations: body.observations, repository: {
      loadEligiblePlayers: loadActiveNflObservationPlayers, existingHashes: existingNflObservationHashes, insertVersions: insertNflObservationVersions,
    } });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "NFL factual observation ingestion failed.";
    return NextResponse.json({ error: message.slice(0, 400) }, { status: 400, headers: { "Cache-Control": "no-store" } });
  }
}
