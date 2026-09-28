import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { projectionIsDue, skinsPollDelay } from "./backgroundPolicy";
import { nbaWorkerError } from "./backgroundSafety";
import type { NbaProvider } from "./provider";
import type { NbaConsumerResult, NbaProjections } from "./types";

export async function refreshNbaSkins(seasonId: number, token: string, provider: NbaProvider, previous: Record<string, unknown>, now: Date): Promise<NbaConsumerResult> {
  const found = await supabaseAdmin.from("nba_skins_seasons").select("id,league_id,season,status,participant_count,nba_teams_per_participant").eq("id", seasonId).single();
  if (found.error || !found.data || found.data.status === "final") throw new Error("skins:season_ineligible");
  const season = found.data;
  const standings = await provider.standings(Number(season.season));
  let projections: NbaProjections | null = null;
  let projectionError = typeof previous.projectionError === "string" ? previous.projectionError : null;
  let projectionCheckedAt = previous.projectionCheckedAt ?? null;
  if (projectionIsDue(previous, now)) {
    projectionCheckedAt = now.toISOString();
    try { projections = await provider.projections(Number(season.season)); projectionError = null; }
    catch (error) { projectionError = nbaWorkerError(error); }
  }
  // One transaction derives each current participant's points from current picks, independently of other Groups.
  const saved = await supabaseAdmin.rpc("apply_nba_skins", { p_season_id: seasonId, p_token: token,
    p_season: Number(season.season), p_records: standings.records, p_projections: projections?.projections ?? null });
  if (saved.error || !saved.data) throw new Error("skins:atomic_apply_failed:lease_or_season_changed");
  const complete = standings.records.every(record => record.gamesPlayed === 82);
  return { summary: { success: true, seasonId, skinsSeason: season.season, espnSeason: standings.espnSeason,
    teamsUpdated: standings.records.length, picksUpdated: Number(saved.data.picksUpdated), regularSeasonComplete: complete,
    projectionsUpdated: projections?.projections.length ?? 0, projectionCheckedAt, projectionError,
    projectionSource: projections?.source ?? previous.projectionSource ?? null,
    // Existing cron never changed status/champion; finalization remains an explicit reviewed action.
    seasonAutoFinalized: false,
  }, delaySeconds: skinsPollDelay(Number(season.season), now, complete) };
}
