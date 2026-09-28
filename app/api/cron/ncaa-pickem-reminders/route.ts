import { authorizeNcaaCron, ncaaWorkerError } from "@/lib/ncaaPickEm/backgroundSafety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Existing URL and heartbeat authorization retained; new Vault jobs use CRON_SECRET. */
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!authorizeNcaaCron(request)) return Response.json({ error: "Unauthorized." }, { status: 401, headers });
  try {
    const { runNcaaWorker } = await import("@/lib/ncaaPickEm/backgroundWorker.server");
    const result = await runNcaaWorker("reminders");
    return Response.json(result, { status: result.success ? 200 : 500, headers });
  } catch (error) {
    console.error("ncaa_pickem_reminders_unhandled", ncaaWorkerError(error));
    return Response.json({ error: "NCAA worker failed." }, { status: 500, headers });
  }
}
