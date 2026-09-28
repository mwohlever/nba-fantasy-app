import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refreshNcaaWeek } from "./refreshWeek.server";
import { remindNcaaWeek } from "./reminders.server";
import { ncaaWeekEligibility, ncaaRefreshDelaySeconds, type NcaaWeek, type NcaaTask, type NcaaGame } from "./backgroundPolicy";
import { ncaaWorkerError } from "./backgroundSafety";

type Claim = { state: "claimed"; token: string; recovered: boolean } | { state: "leased" | "backoff" | "ineligible" };
type Outcome = { state: string; recovered?: boolean; summary?: Record<string, unknown>; error?: string };

export async function runClaimedNcaaWeek(weekId: number, task: NcaaTask, manual = false, now = new Date(), preflightError?: string): Promise<Outcome> {
  const claimed = await supabaseAdmin.rpc("claim_ncaa_pickem_sync", { p_week_id: weekId, p_task: task, p_ignore_retry: manual });
  if (claimed.error || !claimed.data) throw new Error("NCAA worker claim failed.");
  const lease = claimed.data as Claim;
  if (lease.state !== "claimed") return { state: lease.state };
  const token = lease.token;
  async function assertLease() {
    const owned = await supabaseAdmin.rpc("ncaa_pickem_sync_lease_owned", { p_week_id: weekId, p_task: task, p_lease_token: token });
    if (owned.error || !owned.data) throw new Error("NCAA worker lease lost.");
  }
  let summary: Record<string, unknown> = {}, error: string | undefined, succeeded = false, delay = 240;
  try {
    await assertLease();
    if (preflightError) throw new Error(preflightError);
    if (task === "results") {
      summary = await refreshNcaaWeek(weekId, token);
      const [week, games] = await Promise.all([
        supabaseAdmin.from("ncaa_pickem_weeks").select("id,league_id,season,week_number,status,lock_at").eq("id", weekId).single(),
        supabaseAdmin.from("ncaa_pickem_games").select("kickoff_at,status,included").eq("week_id", weekId),
      ]);
      if (week.error || games.error || !week.data) throw new Error("NCAA cadence state unavailable.");
      delay = ncaaRefreshDelaySeconds(week.data as NcaaWeek, (games.data ?? []) as NcaaGame[], now);
    } else {
      summary = await remindNcaaWeek(weekId, token, assertLease, now);
      if (Number(summary.notificationsFailed) > 0) throw new Error("NCAA reminder push delivery failed; event keys retained.");
    }
    succeeded = true;
  } catch (failure) { error = ncaaWorkerError(failure); }
  const finished = await supabaseAdmin.rpc("finish_ncaa_pickem_sync", {
    p_week_id: weekId, p_task: task, p_lease_token: token, p_succeeded: succeeded,
    p_summary: summary, p_error: error ?? null, p_delay_seconds: delay,
  });
  if (finished.error || !finished.data) throw new Error("NCAA lease completion failed.");
  return { state: succeeded ? "succeeded" : "failed", recovered: lease.recovered, summary, ...(error ? { error } : {}) };
}

/** Manual calls and each background invocation get durable history, even when idle or discovery fails. */
export async function runNcaaWorker(task: NcaaTask, options: { weekId?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const manual = options.weekId !== undefined;
  const began = performance.now(), stopStartingAt = Date.now() + 30_000;
  const created = await supabaseAdmin.from("ncaa_pickem_sync_runs")
    .insert({ task, source: manual ? "manual" : "background", started_at: now.toISOString() }).select("id").single();
  if (created.error || !created.data) throw new Error("NCAA worker run history unavailable.");
  const runId = String(created.data.id), details: Array<Record<string, unknown>> = [];
  let considered = 0, eligible = 0, processed = 0, succeeded = 0, failed = 0, leaseSkipped = 0, backoffSkipped = 0, recovered = 0, omitted = 0;
  let budgetStopped = false, discoveryError: string | undefined;
  function record(detail: Record<string, unknown>, work = false) {
    if (work || details.length < 20) details.push(detail); else omitted++;
  }
  try {
    // SQL does bounded discovery and oldest-attempt ordering, avoiding starvation beyond the first 100 weeks.
    const found = manual
      ? await supabaseAdmin.from("ncaa_pickem_weeks").select("id,league_id,season,week_number,status,lock_at").eq("id", options.weekId!)
      : await supabaseAdmin.rpc("discover_ncaa_pickem_work", { p_task: task });
    if (found.error) throw new Error("NCAA worker discovery failed.");
    const candidates = (found.data ?? []) as NcaaWeek[];
    considered = candidates.length;
    for (const week of candidates) {
      if (processed >= 2 || Date.now() >= stopStartingAt) {
        budgetStopped = true;
        record({ weekId: week.id, leagueId: week.league_id, state: "budget_deferred" });
        continue;
      }
      const games = task === "results" && !manual
        ? await supabaseAdmin.from("ncaa_pickem_games").select("kickoff_at,status,included").eq("week_id", week.id)
        : { data: [], error: null };
      const policy = games.error ? { eligible: true, reason: "eligibility_read_failed" }
        : manual ? { eligible: true, reason: "manual" } : ncaaWeekEligibility(week, (games.data ?? []) as NcaaGame[], task, now);
      const identity = { weekId: week.id, leagueId: week.league_id, reason: policy.reason };
      if (!policy.eligible) { record({ ...identity, state: "ineligible" }); continue; }
      eligible++;
      try {
        const outcome = await runClaimedNcaaWeek(week.id, task, manual, now, games.error ? "NCAA eligibility games unavailable." : undefined);
        if (outcome.state === "leased") leaseSkipped++;
        else if (outcome.state === "backoff") backoffSkipped++;
        const work = outcome.state === "succeeded" || outcome.state === "failed";
        if (work) { processed++; if (outcome.state === "succeeded") succeeded++; else failed++; if (outcome.recovered) recovered++; }
        record({ ...identity, ...outcome }, work);
      } catch (error) {
        processed++; failed++; record({ ...identity, state: "failed", error: ncaaWorkerError(error) }, true);
      }
    }
  } catch (error) { discoveryError = ncaaWorkerError(error); }
  if (omitted) details.push({ state: "details_omitted", count: omitted });
  if (discoveryError) details.push({ state: "discovery_failed", error: discoveryError });
  const status = discoveryError ? "failed" : failed ? "partial_failure" : "succeeded";
  const durationMs = Math.round(performance.now() - began);
  const result = { runId, task, source: manual ? "manual" : "background", success: status === "succeeded", status,
    considered, eligible, processed, succeeded, failed, leaseSkipped, backoffSkipped, recovered, budgetStopped, durationMs, details };
  const saved = await supabaseAdmin.from("ncaa_pickem_sync_runs").update({ finished_at: new Date().toISOString(), status,
    considered, eligible, processed, succeeded, failed, lease_skipped: leaseSkipped, backoff_skipped: backoffSkipped,
    recovered, budget_stopped: budgetStopped, duration_ms: durationMs, details }).eq("id", runId).select("id");
  if (saved.error || !saved.data?.length) throw new Error("NCAA worker history update failed.");
  let retentionCleanupFailed = false;
  try {
    const pruned = await supabaseAdmin.rpc("prune_ncaa_pickem_sync_runs", {});
    if (pruned.error) throw pruned.error;
  } catch { retentionCleanupFailed = true; }
  console.info("ncaa_pickem_worker", JSON.stringify(result));
  return { ...result, retentionCleanupFailed };
}
