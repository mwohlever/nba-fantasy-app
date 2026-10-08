import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { refreshGolfSlate, type GolfRefreshInput } from "./refreshSlate.server";
import { golfRefreshErrorMessage } from "./backgroundRefreshSafety";
import { golfRefreshDelaySeconds, golfSlateRefreshEligibility, type GolfRefreshCandidate } from "./backgroundRefreshPolicy";

type Claim = { state: "claimed"; token: string; recovered: boolean } | { state: "leased" | "backoff" | "ineligible" };
type GolfOutcome = { state: string; recovered?: boolean; summary?: Record<string, unknown>; error?: string; response?: Response };
const maxProcessed = 2;
const maxSkips = 20;

/** Manual and unattended refreshes share one slate lease; no event-global scoring identity. */
export async function runClaimedGolfSlate(slateId: number, input: GolfRefreshInput = {}, manual = false, now = new Date()): Promise<GolfOutcome> {
  const claim = await supabaseAdmin.rpc("claim_golf_sync", {
    p_slate_id: slateId, p_ignore_retry: manual, p_allow_locked: manual && input.reconcileLockedLifecycle === true,
  });
  if (claim.error || !claim.data) throw new Error("Golf refresh claim failed");
  const lease = claim.data as Claim;
  if (lease.state !== "claimed") return { state: lease.state };
  const began = performance.now();
  async function assertLease() {
    const check = await supabaseAdmin.rpc("golf_sync_lease_owned", { p_slate_id: slateId, p_lease_token: lease.state === "claimed" ? lease.token : "" });
    if (check.error || !check.data) throw new Error("Golf refresh lease lost");
  }
  // Keep completion outside the provider catch: a failed finish must not masquerade as success.
  let response: Response | undefined;
  let summary: Record<string, unknown> = {};
  let error: string | undefined;
  let delaySeconds = 240;
  let waitingForField = false;
  let success = false;
  try {
    response = await refreshGolfSlate(slateId, input, assertLease);
    const result = await response.clone().json();
    waitingForField = response.status === 502 && typeof result.error === "string" && result.error.includes("tournament field is not available yet");
    success = response.ok && result.success === true || waitingForField;
    delaySeconds = golfRefreshDelaySeconds(String(result.tournament?.startDate ?? now.toISOString().slice(0, 10)), now,
      String(result.tournament?.status ?? "scheduled"), waitingForField);
    summary = {
      durationMs: Math.round(performance.now() - began),
      eventId: String(result.tournament?.eventId ?? "").slice(0, 64),
      tournamentStatus: String(result.tournament?.status ?? "unknown").slice(0, 32),
      currentRound: Number(result.tournament?.currentRound ?? 0),
      waitingForField, locked: Boolean(result.slateAutoLocked),
      playerRows: Number(result.eventPlayersUpserted ?? result.eventPlayersUpdated ?? 0),
      teamRows: Number(result.teamResultsUpserted ?? result.teamResultsUpdated ?? 0),
      acceptedRevision: Number(result.acceptedRevision ?? 0), scoringChanged: Boolean(result.scoringChanged),
      playerNotificationsFailed: Number(result.playerFinishedNotifications?.failed ?? 0),
      completionNotificationsFailed: Number(result.slateCompleteNotifications?.failed ?? 0),
    };
    if (!success) error = golfRefreshErrorMessage(result.error ?? `Golf refresh HTTP ${response.status}`);
  } catch (failure) {
    error = golfRefreshErrorMessage(failure);
    summary = { durationMs: Math.round(performance.now() - began) };
  }
  const finish = await supabaseAdmin.rpc("finish_golf_sync", {
    p_slate_id: slateId, p_lease_token: lease.token, p_succeeded: success,
    p_summary: summary, p_error: error ?? null, p_delay_seconds: delaySeconds,
  });
  if (finish.error || !finish.data) throw new Error("Golf lease completion failed");
  return { state: success ? waitingForField ? "waiting_for_field" : "succeeded" : "failed", recovered: lease.recovered, summary,
    ...(error ? { error } : {}), ...(response ? { response } : {}) };
}

export async function runGolfBackgroundRefresh(now = new Date()) {
  const began = performance.now();
  const stopStartingAt = Date.now() + 30_000;
  const created = await supabaseAdmin.from("golf_sync_runs").insert({ started_at: now.toISOString() }).select("id").single();
  if (created.error || !created.data) throw new Error("Golf run history unavailable");
  const runId = created.data.id as string;
  const details: Array<Record<string, unknown>> = [];
  let considered = 0, eligible = 0, processed = 0, succeeded = 0, failed = 0, leaseSkipped = 0, backoffSkipped = 0, recovered = 0, omittedSkips = 0;
  let recordedSkips = 0;
  let budgetStopped = false;
  let discoveryError: string | null = null;
  function record(detail: Record<string, unknown>, work = false) {
    if (work || recordedSkips++ < maxSkips) details.push(detail);
    else omittedSkips++;
  }
  try {
    const query = await supabaseAdmin.from("slates")
      .select("id,sport,start_date,end_date,external_event_id,is_locked,archived_at")
      .eq("sport", "golf").eq("is_locked", false).is("archived_at", null)
      .not("external_event_id", "is", null)
      .lte("start_date", new Date(now.getTime() + 8 * 86_400_000).toISOString().slice(0, 10))
      .gte("end_date", new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10))
      .order("start_date", { ascending: true }).limit(100);
    if (query.error) throw new Error(`Golf slate discovery failed: ${query.error.message}`);
    const candidates = (query.data ?? []) as GolfRefreshCandidate[];
    considered = candidates.length;
    const states = candidates.length ? await supabaseAdmin.from("golf_sync_state").select("slate_id,next_attempt_at,last_attempt_at")
      .in("slate_id", candidates.map(slate => slate.id)) : { data: [], error: null };
    if (states.error) throw new Error(`Golf state discovery failed: ${states.error.message}`);
    const stateById = new Map((states.data ?? []).map(state => [Number(state.slate_id), state]));
    // Oldest/unattempted work first so a busy Group does not starve another Group.
    candidates.sort((a, b) => String(stateById.get(a.id)?.last_attempt_at ?? "").localeCompare(String(stateById.get(b.id)?.last_attempt_at ?? "")) || a.id - b.id);
    for (const slate of candidates) {
      const policy = golfSlateRefreshEligibility(slate, stateById.get(slate.id), now);
      const identity = { slateId: slate.id, eventId: slate.external_event_id?.trim().slice(0, 64), eligible: policy.eligible, reason: policy.reason };
      if (!policy.eligible) {
        if (policy.reason === "not_due") backoffSkipped++;
        record({ ...identity, state: "skipped" });
        continue;
      }
      eligible++;
      if (Date.now() >= stopStartingAt || processed >= maxProcessed) {
        budgetStopped = true;
        record({ ...identity, state: "budget_deferred" });
        continue;
      }
      try {
        const outcome = await runClaimedGolfSlate(slate.id, {}, false, now);
        if (outcome.state === "leased") leaseSkipped++;
        else if (outcome.state === "backoff") backoffSkipped++;
        const work = ["succeeded", "waiting_for_field", "failed"].includes(outcome.state);
        if (work) {
          processed++;
          if (outcome.state === "failed") failed++; else succeeded++;
          if (outcome.recovered) recovered++;
        }
        record({ ...identity, state: outcome.state, refreshed: outcome.state === "succeeded",
          ...(outcome.summary ? { summary: outcome.summary } : {}), ...(outcome.error ? { error: outcome.error } : {}), recovered: Boolean(outcome.recovered) }, work);
      } catch (error) {
        processed++; failed++;
        record({ ...identity, state: "failed", refreshed: false, error: golfRefreshErrorMessage(error) }, true);
      }
    }
  } catch (error) { discoveryError = golfRefreshErrorMessage(error); }
  if (omittedSkips) details.push({ state: "skipped_details_omitted", count: omittedSkips });
  if (discoveryError) details.push({ state: "discovery_failed", error: discoveryError });
  const status = discoveryError ? "failed" : failed ? "partial_failure" : "succeeded";
  const durationMs = Math.round(performance.now() - began);
  const result = { runId, status, considered, eligible, processed, succeeded, failed, leaseSkipped, backoffSkipped, recovered, budgetStopped, durationMs, details };
  const saved = await supabaseAdmin.from("golf_sync_runs").update({ finished_at: new Date().toISOString(), status, considered, eligible, processed, succeeded, failed,
    lease_skipped: leaseSkipped, backoff_skipped: backoffSkipped, recovered, budget_stopped: budgetStopped, duration_ms: durationMs, details }).eq("id", runId).select("id");
  if (saved.error || !saved.data?.length) throw new Error("Golf run history update failed");
  let retentionCleanupFailed = false;
  try {
    const prune = await supabaseAdmin.rpc("prune_golf_sync_runs", {});
    if (prune.error) throw prune.error;
  } catch { retentionCleanupFailed = true; console.warn("golf_run_retention_failed"); }
  console.info("golf_background_refresh", JSON.stringify(result));
  return { ...result, retentionCleanupFailed };
}
