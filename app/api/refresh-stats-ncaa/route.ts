import { authorizeNcaaWeekResource } from "@/lib/security/resourceAuthorization";
import { ncaaWorkerError } from "@/lib/ncaaPickEm/backgroundSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  let body;
  try { body = await request.json(); } catch { body = {}; }
  const weekId = Number(body?.weekId);
  if (!Number.isInteger(weekId) || weekId <= 0)
    return Response.json({ error: "weekId is required." }, { status: 400 });
  const authorization = await authorizeNcaaWeekResource(request, weekId, { allowInternal: true });
  if (!authorization.ok) return authorization.response;
  try {
    const { runNcaaWorker } = await import("@/lib/ncaaPickEm/backgroundWorker.server");
    const result = await runNcaaWorker("results", { weekId });
    const outcome = result.details.find(detail => detail.weekId === weekId);
    if (!result.success) return Response.json({ error: "Unable to refresh NCAA Pick 'Em.", runId: result.runId }, { status: 500 });
    if (outcome?.state === "succeeded") return Response.json({ ...outcome.summary as Record<string, unknown>, runId: result.runId });
    return Response.json({ success: true, skipped: true, weekId, reason: outcome?.state ?? "ineligible", runId: result.runId });
  } catch (error) {
    console.error("ncaa_pickem_manual_refresh_failed", ncaaWorkerError(error));
    return Response.json({ error: "Unable to refresh NCAA Pick 'Em." }, { status: 500 });
  }
}
