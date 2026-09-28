import { NextResponse } from "next/server";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { nbaWorkerError } from "@/lib/nba/backgroundSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const slateId = Number(body.slateId);
    if (!Number.isSafeInteger(slateId) || slateId <= 0) return NextResponse.json({ error: "slateId is required." }, { status: 400 });
    const authorization = await authorizeSlateResource(request, slateId, { allowInternal: true });
    if (!authorization.ok) return authorization.response;
    if (authorization.target.sportKey !== "nba") return NextResponse.json({ error: "Resource not found." }, { status: 404 });
    const { runNbaWorker } = await import("@/lib/nba/backgroundWorker.server");
    const result = await runNbaWorker({ manualWork: { task: "fantasy", target_id: slateId,
      league_id: authorization.target.leagueId, group_id: authorization.target.groupId } });
    const outcome = result.details.find(item => item.target_id === slateId);
    if (!outcome || outcome.state === "budget_deferred") return NextResponse.json({ error: "NBA refresh is busy. Try again shortly.", runId: result.runId }, { status: 503 });
    if (outcome?.state === "ineligible") return NextResponse.json({ error: "This slate is locked or unavailable. Historical stats cannot be refreshed." }, { status: 400 });
    if (!result.success) return NextResponse.json({ error: "Unable to refresh NBA stats.", runId: result.runId }, { status: 500 });
    // Existing clients reload saved stats after a 200. An overlapping request safely reloads the current accepted state.
    return NextResponse.json({ success: true, slateId, ...(outcome?.summary as Record<string, unknown> ?? {}),
      skipped: outcome?.state === "leased", reason: outcome?.state === "leased" ? "Refresh already running." : undefined,
      runId: result.runId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("NBA manual refresh failed", nbaWorkerError(error));
    return NextResponse.json({ error: "Unexpected server error while refreshing stats." }, { status: 500 });
  }
}
