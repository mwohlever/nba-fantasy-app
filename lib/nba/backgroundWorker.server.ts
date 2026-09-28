import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NbaProvider } from "./provider";
import { nbaWorkerError } from "./backgroundSafety";
import { deliverNbaNotifications, refreshNbaFantasy } from "./refreshFantasy.server";
import { refreshNbaSkins } from "./refreshSkins.server";
import type { NbaWork, NbaTask, FantasyNotifications, NbaConsumerResult } from "./types";

type Claim = { state: "claimed"; token: string; recovered: boolean; summary: Record<string, unknown>; pending: FantasyNotifications | null }
  | { state: "leased" | "backoff" | "ineligible" };

export async function runClaimedNbaWork(work: NbaWork, provider: NbaProvider, manual: boolean, now: Date) {
  const claimed = await supabaseAdmin.rpc("claim_nba_sync", { p_task: work.task, p_target_id: work.target_id, p_manual: manual });
  if (claimed.error || !claimed.data) throw new Error("nba:claim_failed");
  const lease = claimed.data as Claim;
  if (lease.state !== "claimed") return { state: lease.state };
  let result: NbaConsumerResult = { summary: {}, delaySeconds: 240 }, error: string | undefined;
  try {
    if (lease.pending) {
      // Drain a committed batch before fetching another; immutable pending input preserves pre-write status transitions.
      const notifications = await deliverNbaNotifications(work.target_id, lease.token, lease.pending);
      result = { summary: { ...lease.summary, ...notifications, notificationRecovery: true }, delaySeconds: 30 };
    } else if (work.task === "fantasy") {
      result = await refreshNbaFantasy(work.target_id, lease.token, provider, manual, now);
      if (manual && result.delaySeconds <= 240) result.delaySeconds = 30;
    } else result = await refreshNbaSkins(work.target_id, lease.token, provider, lease.summary, now);
  } catch (failure) { error = nbaWorkerError(failure); }
  const finished = await supabaseAdmin.rpc("finish_nba_sync", { p_task: work.task, p_target_id: work.target_id, p_token: lease.token,
    p_success: !error, p_summary: result.summary, p_error: error ?? null, p_delay: result.delaySeconds });
  if (finished.error || !finished.data) throw new Error("nba:lease_completion_failed");
  return { state: error ? "failed" : "succeeded", recovered: lease.recovered, summary: result.summary, ...(error ? { error } : {}) };
}

/** One external job; two concurrent, bounded lanes with independent discovery, leases, retries and outcomes. */
export async function runNbaWorker(options: {
  manualWork?: NbaWork; only?: NbaTask; source?: "background" | "manual" | "heartbeat"; now?: Date;
} = {}) {
  const now = options.now ?? new Date(), began = performance.now(), startDeadline = Date.now() + 20_000;
  const source = options.manualWork ? "manual" : options.source ?? "background";
  const created = await supabaseAdmin.from("nba_sync_runs").insert({ source, started_at: now.toISOString() }).select("id").single();
  if (created.error || !created.data) throw new Error("nba:run_history_unavailable");
  const runId = String(created.data.id), provider = new NbaProvider();
  const details: Array<Record<string, unknown>> = [];
  let processed = 0, succeeded = 0, failed = 0, budgetStopped = false;
  const tasks: NbaTask[] = options.manualWork ? [options.manualWork.task] : options.only ? [options.only] : ["fantasy", "skins"];
  async function lane(task: NbaTask) {
    // A slow or failed consumer cannot consume the other game's work allocation.
    const stopStartingAt = startDeadline;
    let attempted = 0;
    try {
      const discovery = options.manualWork ? { data: [options.manualWork], error: null }
        : await supabaseAdmin.rpc("discover_nba_work", { p_task: task });
      if (discovery.error) throw new Error(`nba:${task}:discovery_failed`);
      const work = (discovery.data ?? []) as NbaWork[];
      for (const item of work.slice(0, 30)) {
        if (attempted >= 3 || Date.now() >= stopStartingAt) {
          budgetStopped = true;
          if (details.length < 24) details.push({ ...item, state: "budget_deferred" });
          continue;
        }
        attempted++;
        try {
          const outcome = await runClaimedNbaWork(item, provider, Boolean(options.manualWork), now);
          if (outcome.state === "succeeded" || outcome.state === "failed") {
            processed++; if (outcome.state === "succeeded") succeeded++; else failed++;
          }
          if (details.length < 24 || outcome.state === "succeeded" || outcome.state === "failed") details.push({ ...item, ...outcome });
        } catch (error) {
          processed++; failed++; details.push({ ...item, state: "failed", error: nbaWorkerError(error) });
        }
      }
    } catch (error) { failed++; details.push({ task, state: "discovery_failed", error: nbaWorkerError(error) }); }
  }
  await Promise.all(tasks.map(lane));
  const status = failed ? succeeded ? "partial_failure" : "failed" : "succeeded";
  const durationMs = Math.round(performance.now() - began);
  const saved = await supabaseAdmin.from("nba_sync_runs").update({ finished_at: new Date().toISOString(), status,
    processed, succeeded, failed, budget_stopped: budgetStopped, duration_ms: durationMs, details,
    provider_counts: provider.counts, provider_failures: provider.failures }).eq("id", runId).select("id");
  if (saved.error || !saved.data?.length) throw new Error("nba:run_history_finish_failed");
  let retentionCleanupFailed = false;
  try { const cleanup = await supabaseAdmin.rpc("prune_nba_sync_runs", {}); if (cleanup.error) throw cleanup.error; }
  catch { retentionCleanupFailed = true; }
  const result = { success: !failed, runId, source, status, processed, succeeded, failed, budgetStopped, durationMs,
    providerCounts: provider.counts, providerFailures: provider.failures, details, retentionCleanupFailed };
  console.info("nba_background_worker", JSON.stringify(result));
  return result;
}
