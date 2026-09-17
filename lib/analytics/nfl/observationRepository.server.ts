import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { nflObservationHashLookupGroups, type NflEligiblePlayer, type NflObservationRecord } from "./observationIngestion";
import type { NflObservationPosition } from "./observationFoundation";

const PAGE_SIZE = 1000;
const INSERT_BATCH_SIZE = 500;
const positions = new Set<NflObservationPosition>(["QB", "RB", "WR", "TE"]);
const batches = <T,>(items: readonly T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_value, index) => items.slice(index * size, (index + 1) * size));
function fail(label: string, error: { message: string; code?: string; details?: string; hint?: string } | null) {
  if (!error) return;
  const details = [error.code, error.details, error.hint].filter(Boolean).join("; ");
  throw new Error(`${label}: ${error.message}${details ? ` (${details})` : ""}`);
}

/** Explicit pagination prevents the Supabase 1,000-row cap from hiding eligible athletes. */
export async function loadActiveNflObservationPlayers(): Promise<NflEligiblePlayer[]> {
  const rows: Array<{ id: number; nfl_player_id: number | null; position: string; is_active: boolean }> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await supabaseAdmin.from("players_nfl").select("id,nfl_player_id,position,is_active")
      .eq("is_active", true).order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    fail("NFL eligible-player lookup failed", result.error);
    const page = (result.data ?? []) as typeof rows;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  const eligible: NflEligiblePlayer[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!positions.has(row.position as NflObservationPosition)) continue;
    const providerPlayerId = String(row.nfl_player_id ?? "");
    if (!/^\d+$/.test(providerPlayerId) || Number(providerPlayerId) >= 100_000_000) throw new Error(`Invalid active NFL ESPN identity: ${row.id}`);
    // A single ESPN athlete must not resolve to two local active rows, even if
    // an upstream position label happens to differ. There is no fuzzy fallback.
    const key = providerPlayerId;
    if (seen.has(key)) throw new Error(`Duplicate active NFL ESPN identity: ${key}`);
    seen.add(key); eligible.push({ localPlayerId: Number(row.id), providerPlayerId, position: row.position as NflObservationPosition });
  }
  return eligible.sort((left, right) => Number(left.providerPlayerId) - Number(right.providerPlayerId));
}

export async function existingNflObservationHashes(hashes: readonly string[]) {
  const found = new Set<string>();
  for (const group of nflObservationHashLookupGroups(hashes)) {
    if (!group.length) continue;
    const result = await supabaseAdmin.from("nfl_player_game_observation_versions").select("observation_hash").in("observation_hash", group);
    fail("NFL observation dedupe lookup failed", result.error);
    for (const row of result.data ?? []) found.add(String(row.observation_hash));
  }
  return found;
}

export async function insertNflObservationVersions(rows: readonly NflObservationRecord[]) {
  for (const group of batches(rows, INSERT_BATCH_SIZE)) {
    const result = await supabaseAdmin.from("nfl_player_game_observation_versions").upsert(group,
      { onConflict: "provider,provider_player_id,provider_event_id,observation_hash", ignoreDuplicates: true });
    fail("NFL observation append failed", result.error);
  }
}

type AuditRow = { provider_player_id: string; provider_event_id: string; local_player_id: number | null; position: string; phase: string; game_at: string; fumbles_lost: number | null; fumble_summary_source_url: string | null };
async function pagedAuditRows(source: "nfl_player_game_observations" | "nfl_player_game_observation_versions", season: number) {
  const rows: AuditRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const result = await supabaseAdmin.from(source).select("provider_player_id,provider_event_id,local_player_id,position,phase,game_at,fumbles_lost,fumble_summary_source_url")
      .eq("season", season).order("game_at", { ascending: true }).order("provider_player_id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
    fail(`NFL ${source} audit failed`, result.error);
    const page = (result.data ?? []) as AuditRow[]; rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
  }
}

/** Read-only, explicitly paginated factual audit for the first real 2026 run. */
export async function auditNflObservationSeason(season: number) {
  const [current, versions, eligible] = await Promise.all([pagedAuditRows("nfl_player_game_observations", season), pagedAuditRows("nfl_player_game_observation_versions", season), loadActiveNflObservationPlayers()]);
  const positions = ["QB", "RB", "WR", "TE"] as const;
  const byPosition = Object.fromEntries(positions.map(position => [position, current.filter(row => row.position === position).length]));
  const qb = current.filter(row => row.position === "QB");
  const duplicateCurrentKeys = current.length - new Set(current.map(row => `espn:${row.provider_player_id}:${row.provider_event_id}`)).size;
  const appearedPlayerIds = new Set(current.map(row => row.provider_player_id));
  return {
    season, currentObservations: current.length, observationVersions: versions.length, byPosition,
    uniquePlayers: appearedPlayerIds.size, uniqueEvents: new Set(current.map(row => row.provider_event_id)).size,
    unresolvedLocalPlayerIds: current.filter(row => row.local_player_id === null).length, duplicateCurrentKeys,
    qbFumbleSummaryProvenance: qb.filter(row => row.fumble_summary_source_url !== null).length,
    qbFumblesLost: { zero: qb.filter(row => row.fumbles_lost === 0).length, positive: qb.filter(row => (row.fumbles_lost ?? 0) > 0).length },
    unsupportedPositions: current.filter(row => !positions.includes(row.position as typeof positions[number])).length,
    nonRegularPhase: current.filter(row => row.phase !== "regular").length,
    futureGameAt: current.filter(row => Date.parse(row.game_at) > Date.now()).length,
    eligiblePlayersWithoutObservation: eligible.filter(player => !appearedPlayerIds.has(player.providerPlayerId)).map(player => ({ providerPlayerId: player.providerPlayerId, position: player.position })).slice(0, 100),
  };
}
