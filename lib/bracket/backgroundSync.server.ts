import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { bracketSyncErrorMessage } from "./backgroundSyncSafety";
import { syncBracketCompetitionResults } from "./competitionSync.server";

export type SyncSummary = NonNullable<Awaited<ReturnType<typeof syncBracketCompetitionResults>>>;
type Competition = { id: number; sport_key: string; format_key: string; status: string; starts_at: string | null; ends_at: string | null };
type Game = { status: string; winner_team_id: string | null; scheduled_at: string | null; metadata: Record<string, unknown> | null };
type Contest = { status: string };
const supported = new Set(["college_football:cfp", "mens_college_basketball:ncaa_mens", "womens_college_basketball:ncaa_womens"]);
const day = 86_400_000;
const maxProcessedPerRun = 3;
const maxRecordedSkips = 20;

function compactSummary(result: SyncSummary): SyncSummary {
  return {
    promoted: result.promoted, liveUpdated: result.liveUpdated,
    skipped: result.skipped, conflicts: result.conflicts,
    frozen: result.frozen, unsupported: result.unsupported,
  };
}

/** Pure eligibility rule. Bounds historical polling while allowing recent final scoring retries. */
export function bracketCompetitionNeedsSync(competition: Competition, games: Game[], contests: Contest[], now = new Date()): boolean {
  if (!supported.has(`${competition.sport_key}:${competition.format_key}`) || !games.length || !contests.length) return false;
  if (!new Set(["setup", "open", "in_progress", "final"]).has(competition.status)) return false;
  const activeContest = contests.some((contest) => contest.status !== "final");
  const unresolved = games.some((game) => game.status !== "final" || !game.winner_team_id);
  const scoringPending = games.some((game) => game.status === "final" && game.winner_team_id &&
    game.metadata?.bracket_scoring_synced_winner !== game.winner_team_id);
  if (!unresolved && !scoringPending) return false;
  if (!activeContest && competition.status !== "final" && !scoringPending) return false;
  const gameDates = games.map((game) => game.scheduled_at && Date.parse(game.scheduled_at)).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const start = competition.starts_at ? Date.parse(competition.starts_at) : gameDates.length ? Math.min(...gameDates) : NaN;
  const end = competition.ends_at ? Date.parse(competition.ends_at) : gameDates.length ? Math.max(...gameDates) : Number.isFinite(start) ? start + 60 * day : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const current = now.getTime();
  return start <= current + 14 * day && end >= current - (scoringPending ? 30 : 7) * day;
}

async function discoverBracketCompetitions(now: Date) {
  const response = await supabaseAdmin.from("bracket_competitions")
    .select("id, sport_key, format_key, status, starts_at, ends_at")
    .in("status", ["setup", "open", "in_progress", "final"]).order("season", { ascending: false });
  if (response.error) throw new Error(`Bracket discovery failed: ${response.error.message}`);
  const competitions = (response.data ?? []) as Competition[];
  const eligible: number[] = [];
  for (const competition of competitions) {
    if (!supported.has(`${competition.sport_key}:${competition.format_key}`)) continue;
    // Avoid loading games for clearly historical/far-future competitions.
    const start = competition.starts_at && Date.parse(competition.starts_at);
    const end = competition.ends_at && Date.parse(competition.ends_at);
    if (start && start > now.getTime() + 14 * day) continue;
    if (end && end < now.getTime() - 30 * day) continue;
    const [gamesResult, contestsResult] = await Promise.all([
      supabaseAdmin.from("bracket_games").select("status, winner_team_id, scheduled_at, metadata").eq("competition_id", competition.id),
      supabaseAdmin.from("bracket_contests").select("status").eq("competition_id", competition.id),
    ]);
    if (gamesResult.error || contestsResult.error) throw new Error(`Bracket discovery failed for ${competition.id}: ${gamesResult.error?.message ?? contestsResult.error?.message}`);
    if (bracketCompetitionNeedsSync(competition, (gamesResult.data ?? []) as Game[], (contestsResult.data ?? []) as Contest[], now)) eligible.push(competition.id);
  }
  return { considered: competitions.length, eligible };
}

type Claim = { state: "claimed"; token: string; recovered: boolean } | { state: "leased" | "backoff" };
async function claim(competitionId: number, ignoreRetry = false): Promise<Claim> {
  const response = await supabaseAdmin.rpc("claim_bracket_sync", { p_competition_id: competitionId, p_ignore_retry: ignoreRetry });
  if (response.error) throw new Error(`Bracket claim failed for ${competitionId}: ${response.error.message}`);
  return response.data as Claim;
}
async function finish(competitionId: number, token: string, succeeded: boolean, summary?: SyncSummary, error?: string) {
  const response = await supabaseAdmin.rpc("finish_bracket_sync", {
    p_competition_id: competitionId, p_lease_token: token, p_succeeded: succeeded,
    p_summary: summary ?? {}, p_error: error ?? null,
  });
  if (response.error || !response.data) throw new Error(`Bracket lease completion failed for ${competitionId}: ${response.error?.message ?? "lease ownership lost"}`);
}

/** Shared by the browser's authenticated manual route and the unattended worker. */
export async function syncClaimedBracketCompetition(competitionId: number, ignoreRetry = false) {
  const claimResult = await claim(competitionId, ignoreRetry);
  if (claimResult.state !== "claimed") return { state: claimResult.state };
  const { token, recovered } = claimResult;
  try {
    const result = await syncBracketCompetitionResults(competitionId);
    if (!result || result.unsupported) throw new Error("Competition is missing or unsupported.");
    const summary = compactSummary(result);
    await finish(competitionId, token, true, summary);
    return { state: "succeeded" as const, result: summary, recovered };
  } catch (error) {
    const message = bracketSyncErrorMessage(error);
    await finish(competitionId, token, false, undefined, message);
    return { state: "failed" as const, error: message, recovered };
  }
}

export async function runBracketBackgroundSync(now = new Date()) {
  // Leave half of the 60-second route budget for any competition started last.
  const stopStartingAt = Date.now() + 30_000;
  const startedAt = now.toISOString();
  const created = await supabaseAdmin.from("bracket_sync_runs").insert({ started_at: startedAt }).select("id").single();
  if (created.error || !created.data) throw new Error(`Cannot record Bracket worker run: ${created.error?.message}`);
  const runId = created.data.id as string;
  const details: Array<{ competitionId: number; state: string; recovered?: boolean; summary?: SyncSummary; error?: string; count?: number }> = [];
  let considered = 0;
  let eligible = 0;
  let discoveryError: string | null = null;
  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  let leaseSkipped = 0;
  let backoffSkipped = 0;
  let recovered = 0;
  let recordedSkips = 0;
  let omittedSkips = 0;
  function record(detail: (typeof details)[number]) {
    if (detail.state === "succeeded" || detail.state === "failed") {
      processed++;
      if (detail.state === "succeeded") succeeded++;
      else failed++;
      if (detail.recovered) recovered++;
      details.push(detail);
      return;
    }
    if (detail.state === "leased") leaseSkipped++;
    if (detail.state === "backoff") backoffSkipped++;
    if (recordedSkips++ < maxRecordedSkips) details.push(detail);
    else omittedSkips++;
  }
  try {
    const discovery = await discoverBracketCompetitions(now);
    considered = discovery.considered;
    eligible = discovery.eligible.length;
    // Bound each invocation for a 60-second route; later invocations pick up remaining work.
    for (const competitionId of discovery.eligible) {
      if (Date.now() >= stopStartingAt || processed >= maxProcessedPerRun) break;
      try {
        const outcome = await syncClaimedBracketCompetition(competitionId);
        record({ competitionId, state: outcome.state, ...(outcome.state === "succeeded" ? { summary: outcome.result } : {}),
          ...(outcome.state === "failed" ? { error: outcome.error } : {}),
          ...((outcome.state === "succeeded" || outcome.state === "failed") ? { recovered: outcome.recovered } : {}) });
      } catch (error) {
        record({ competitionId, state: "failed", error: bracketSyncErrorMessage(error) });
      }
    }
  } catch (error) {
    discoveryError = bracketSyncErrorMessage(error);
  }
  if (omittedSkips) details.push({ competitionId: 0, state: "skipped_details_omitted", count: omittedSkips });
  const status = discoveryError ? "failed" : failed ? "partial_failure" : "succeeded";
  const summary = { runId, startedAt, considered, eligible, processed, leaseSkipped, backoffSkipped, recovered, succeeded, failed, details, ...(discoveryError ? { discoveryError } : {}) };
  const updated = await supabaseAdmin.from("bracket_sync_runs").update({
    finished_at: new Date().toISOString(), status, considered, processed,
    lease_skipped: leaseSkipped, backoff_skipped: backoffSkipped, recovered, succeeded, failed,
    details: discoveryError ? [...details, { competitionId: 0, state: "discovery_failed", error: discoveryError }] : details,
  }).eq("id", runId).select("id");
  if (updated.error || !updated.data?.length) throw new Error(`Cannot finish Bracket worker run: ${updated.error?.message ?? "missing run"}`);
  let retentionDeleted = 0;
  let retentionCleanupFailed = false;
  try {
    const cleanup = await supabaseAdmin.rpc("prune_bracket_sync_runs", {});
    if (cleanup.error) throw cleanup.error;
    retentionDeleted = Number(cleanup.data ?? 0);
  } catch (error) {
    retentionCleanupFailed = true;
    console.warn("Bracket run retention cleanup failed", bracketSyncErrorMessage(error));
  }
  const completed = { ...summary, status, retentionDeleted, retentionCleanupFailed };
  console.info("bracket_background_sync", JSON.stringify(completed));
  return completed;
}
