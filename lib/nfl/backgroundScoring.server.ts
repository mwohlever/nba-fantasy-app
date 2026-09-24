import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { NflScoringProvider } from "./scoringProvider";
import { nflSlateEligibility } from "./scoringPolicy";
import { refreshNflSlate, type NflRefreshMetrics } from "./refreshSlate.server";
import type { EspnScoreboardEvent } from "@/lib/providers/nfl";

type Candidate = { id: number; start_date: string; end_date: string };
type Claim = { state: "claimed"; token: string; recovered: boolean } | { state: "leased" | "backoff" | "recent_success" | "ineligible" };
const maxWork = 4;
const maxDetails = 20;
function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : "Unexpected NFL scoring failure";
  return /scoreboard|summary|boxscore|provider/i.test(message) ? "NFL provider unavailable or incomplete" : "NFL scoring operation failed";
}

export async function runClaimedNflSlate(slateId: number, provider: NflScoringProvider, manual = false) {
  const claim = await supabaseAdmin.rpc("claim_nfl_sync", { p_slate_id: slateId, p_ignore_retry: manual });
  if (claim.error) throw new Error("NFL claim failed");
  const lease = claim.data as Claim;
  if (lease.state !== "claimed") return { state: lease.state as string, recovered: false };
  const started = performance.now();
  const scoreboardBefore = provider.scoreboardMs;
  const summaryBefore = provider.summaryMs;
  const fetchedBefore = provider.summariesFetched;
  const metrics: NflRefreshMetrics = { dbReadMs: 0, dbWriteMs: 0, scoringMs: 0, gamesConsidered: 0, relevantGames: 0, liveGames: 0, finalGames: 0 };
  try {
    const response = await refreshNflSlate(slateId, provider, metrics, lease.token);
    const result = await response.clone().json();
    const success = response.ok && result.success === true;
    const summary = {
      durationMs: Math.round(performance.now() - started),
      relevantGames: Number(result.relevantGamesFound ?? 0),
      playerRows: Number(result.playerStatsUpdated ?? 0),
      teamRows: Number(result.teamResultsUpdated ?? 0),
      locked: Boolean(result.slateAutoLocked),
      playerNotifications: result.playerFinishedNotifications ?? metrics.playerNotifications ?? null,
      completionNotifications: result.slateCompleteNotifications ?? metrics.completionNotifications ?? null,
      dbReadMs: Math.round(metrics.dbReadMs), dbWriteMs: Math.round(metrics.dbWriteMs), scoringMs: Math.round(metrics.scoringMs),
      gamesConsidered: metrics.gamesConsidered, liveGames: metrics.liveGames, finalGames: metrics.finalGames,
      scoreboardMs: Math.round(provider.scoreboardMs - scoreboardBefore),
      summaryMs: Math.round(provider.summaryMs - summaryBefore), summariesFetched: provider.summariesFetched - fetchedBefore,
    };
    const finished = await supabaseAdmin.rpc("finish_nfl_sync", {
      p_slate_id: slateId, p_lease_token: lease.token, p_succeeded: success,
      p_summary: success ? summary : {}, p_error: success ? null : "NFL refresh failed",
    });
    if (finished.error || !finished.data) throw new Error("NFL lease completion failed");
    return { state: success ? "succeeded" : "failed", recovered: lease.recovered, summary, response };
  } catch (error) {
    const message = safeError(error);
    const finished = await supabaseAdmin.rpc("finish_nfl_sync", {
      p_slate_id: slateId, p_lease_token: lease.token, p_succeeded: false,
      p_summary: {}, p_error: message,
    });
    if (finished.error || !finished.data) throw new Error("NFL lease completion failed");
    return { state: "failed", recovered: lease.recovered, error: message,
      summary: { durationMs: Math.round(performance.now() - started), scoreboardMs: Math.round(provider.scoreboardMs - scoreboardBefore),
        summaryMs: Math.round(provider.summaryMs - summaryBefore), summariesFetched: provider.summariesFetched - fetchedBefore,
        dbReadMs: Math.round(metrics.dbReadMs), dbWriteMs: Math.round(metrics.dbWriteMs), scoringMs: Math.round(metrics.scoringMs),
        gamesConsidered: metrics.gamesConsidered, relevantGames: metrics.relevantGames, liveGames: metrics.liveGames, finalGames: metrics.finalGames,
        playerNotifications: metrics.playerNotifications ?? null, completionNotifications: metrics.completionNotifications ?? null, locked: metrics.locked ?? false } };
  }
}

async function draftedTeams(slateId: number) {
  const lineups = await supabaseAdmin.from("lineups").select("lineup_players(player_id)").eq("slate_id", slateId);
  if (lineups.error) throw new Error("NFL discovery lineups failed");
  const ids = [...new Set((lineups.data ?? []).flatMap(row => (row.lineup_players ?? []).map(player => Number(player.player_id))))];
  if (!ids.length) return new Set<string>();
  const players = await supabaseAdmin.from("players_nfl").select("team_abbreviation").in("id", ids);
  if (players.error) throw new Error("NFL discovery players failed");
  return new Set((players.data ?? []).map(row => String(row.team_abbreviation ?? "").toUpperCase()).filter(Boolean));
}

export async function runNflBackgroundScoring(now = new Date()) {
  const began = performance.now();
  const stopStartingAt = Date.now() + 30_000;
  const created = await supabaseAdmin.from("nfl_sync_runs").insert({ started_at: now.toISOString() }).select("id").single();
  if (created.error || !created.data) throw new Error("NFL run history unavailable");
  const runId = created.data.id as string;
  const provider = new NflScoringProvider();
  const details: Array<Record<string, unknown>> = [];
  let considered = 0, eligible = 0, claimed = 0, processed = 0, leaseSkipped = 0, backoffSkipped = 0, recovered = 0, succeeded = 0, failed = 0;
  let budgetStopped = false;
  let runError: string | null = null;
  try {
    const future = new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
    const past = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const oldWindow = new Date(now.getTime() - 2 * 86_400_000).toISOString().slice(0, 10);
    const query = await supabaseAdmin.from("slates").select("id,start_date,end_date")
      .eq("sport", "nfl").eq("is_locked", false).is("archived_at", null)
      .lte("start_date", future).gte("end_date", past).order("start_date", { ascending: false }).limit(100);
    if (query.error) throw new Error("NFL slate discovery failed");
    const candidates = (query.data ?? []) as Candidate[];
    considered = candidates.length;
    const states = candidates.length ? await supabaseAdmin.from("nfl_sync_state").select("slate_id,last_success_at,next_attempt_at").in("slate_id", candidates.map(s => s.id)) : { data: [], error: null };
    if (states.error) throw new Error("NFL state discovery failed");
    const successById = new Map((states.data ?? []).map(row => [Number(row.slate_id), row.last_success_at as string | null]));
    const nextAttemptById = new Map((states.data ?? []).map(row => [Number(row.slate_id), row.next_attempt_at as string | null]));
    for (const slate of candidates) {
      if (Date.now() >= stopStartingAt || processed >= maxWork) { budgetStopped = true; break; }
      try {
        const nextAttempt = nextAttemptById.get(slate.id);
        if (nextAttempt && Date.parse(nextAttempt) > now.getTime()) { backoffSkipped++; continue; }
        const lastSuccess = successById.get(slate.id);
        if (slate.end_date < oldWindow && lastSuccess && now.getTime() - Date.parse(lastSuccess) < 6 * 3_600_000) continue;
        const teams = await draftedTeams(slate.id);
        if (!teams.size) continue;
        let schedule: EspnScoreboardEvent[];
        let acquisitionFailed = false;
        try { schedule = await provider.schedule(slate.start_date, slate.end_date); }
        catch { acquisitionFailed = true; schedule = []; }
        const policy = nflSlateEligibility(schedule, teams, successById.get(slate.id) ?? null, now.getTime());
        if (!policy.eligible && !acquisitionFailed) continue;
        eligible++;
        const outcome = await runClaimedNflSlate(slate.id, provider);
        if (outcome.state === "leased") leaseSkipped++;
        else if (outcome.state === "backoff" || outcome.state === "recent_success") backoffSkipped++;
        else if (outcome.state === "succeeded" || outcome.state === "failed") {
          claimed++;
          processed++;
          if (outcome.recovered) recovered++;
          if (outcome.state === "succeeded") succeeded++; else failed++;
        }
        if (details.length < maxDetails) details.push({ slateId: slate.id, state: outcome.state,
          ...(outcome.summary ? { summary: outcome.summary } : {}), ...(outcome.error ? { error: outcome.error } : {}) });
      } catch (error) {
        failed++;
        if (details.length < maxDetails) details.push({ slateId: slate.id, state: "failed", error: safeError(error) });
      }
    }
  } catch (error) { runError = safeError(error); }
  const durationMs = Math.round(performance.now() - began);
  const status = runError ? "failed" : failed ? "partial_failure" : "succeeded";
  if (runError) details.push({ state: "discovery_failed", error: runError });
  const result = { runId, status, considered, eligible, claimed, processed, leaseSkipped, backoffSkipped, recovered, succeeded, failed,
    budgetStopped, durationMs, scoreboardMs: Math.round(provider.scoreboardMs), summaryMs: Math.round(provider.summaryMs), summariesFetched: provider.summariesFetched, details };
  const saved = await supabaseAdmin.from("nfl_sync_runs").update({ finished_at: new Date().toISOString(), status, considered, eligible, claimed, processed,
    lease_skipped: leaseSkipped, backoff_skipped: backoffSkipped, recovered, succeeded, failed, budget_stopped: budgetStopped, duration_ms: durationMs,
    details: [...details, { provider: { scoreboardMs: result.scoreboardMs, summaryMs: result.summaryMs, summariesFetched: result.summariesFetched } }],
  }).eq("id", runId);
  if (saved.error) throw new Error("NFL run history update failed");
  const prune = await supabaseAdmin.rpc("prune_nfl_sync_runs", {});
  if (prune.error) console.warn("nfl_run_retention_failed");
  console.info("nfl_background_scoring", JSON.stringify(result));
  return result;
}
