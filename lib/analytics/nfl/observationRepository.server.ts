import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { nflObservationHashLookupGroups, type NflEligiblePlayer, type NflObservationRecord } from "./observationIngestion";
import type { NflObservationPosition } from "./observationFoundation";
import { type NflObservationVersionRecord, type NflProjectionCacheRecord, validateNflRawProjectionStats } from "./projectionInfrastructure";

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

const HISTORY_PLAYER_BATCH_SIZE = 200;
const CACHE_APPEND_BATCH_SIZE = 100;
type VersionDbRow = Record<string, unknown>;
function asVersionRecord(row: VersionDbRow): NflObservationVersionRecord {
  const number = (key: string) => Number(row[key]), nullable = (key: string) => row[key] === null ? null : number(key), required = (key: string) => String(row[key] ?? "");
  const position = String(row.position);
  if (!(positions.has(position as NflObservationPosition))) throw new Error("Unexpected NFL projection history position");
  return { id: number("id"), provider: "espn", provider_player_id: required("provider_player_id"), provider_event_id: required("provider_event_id"), local_player_id: row.local_player_id === null ? null : number("local_player_id"), position: position as NflObservationPosition,
    season: number("season"), week: number("week"), phase: "regular", game_at: required("game_at"), known_at: required("known_at"), completions: nullable("completions"), passing_attempts: nullable("passing_attempts"), passing_yards: nullable("passing_yards"), passing_touchdowns: nullable("passing_touchdowns"), interceptions: nullable("interceptions"), rushing_attempts: nullable("rushing_attempts"), rushing_yards: nullable("rushing_yards"), rushing_touchdowns: nullable("rushing_touchdowns"), receiving_targets: nullable("receiving_targets"), receptions: nullable("receptions"), receiving_yards: nullable("receiving_yards"), receiving_touchdowns: nullable("receiving_touchdowns"), fumbles_lost: nullable("fumbles_lost") };
}

/** Explicit range paging and 200-ID batches avoid both Supabase's 1,000-row cap and oversized filters. */
export async function loadNflProjectionHistories(input: { playerIds: readonly number[]; targetSeason: number; asOf: string }) {
  const ids = [...new Set(input.playerIds.filter(id => Number.isSafeInteger(id) && id > 0))], output = new Map<number, NflObservationVersionRecord[]>(ids.map(id => [id, []]));
  for (const playerIds of batches(ids, HISTORY_PLAYER_BATCH_SIZE)) {
    const rows: VersionDbRow[] = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const result = await supabaseAdmin.from("nfl_player_game_observation_versions").select("id,provider,provider_player_id,provider_event_id,local_player_id,position,season,week,phase,game_at,known_at,completions,passing_attempts,passing_yards,passing_touchdowns,interceptions,rushing_attempts,rushing_yards,rushing_touchdowns,receiving_targets,receptions,receiving_yards,receiving_touchdowns,fumbles_lost")
        .in("local_player_id", playerIds).in("season", [input.targetSeason - 1, input.targetSeason]).eq("phase", "regular").lt("game_at", input.asOf).lt("known_at", input.asOf)
        .order("game_at", { ascending: true }).order("known_at", { ascending: true }).order("id", { ascending: true }).range(from, from + PAGE_SIZE - 1);
      fail("NFL projection version-history lookup failed", result.error);
      const page = (result.data ?? []) as VersionDbRow[]; rows.push(...page);
      if (page.length < PAGE_SIZE) break;
    }
    for (const raw of rows) {
      const record = asVersionRecord(raw);
      if (record.local_player_id !== null && output.has(record.local_player_id)) output.get(record.local_player_id)!.push(record);
    }
  }
  return output;
}

/** Cache rows append by immutable raw-projection identity; no group/slate scoring is persisted. */
export async function appendNflProjectionStatCache(rows: readonly NflProjectionCacheRecord[]) {
  for (const group of batches(rows, CACHE_APPEND_BATCH_SIZE)) {
    for (const row of group) if (!validateNflRawProjectionStats(row.projected_stats)) throw new Error("Invalid NFL raw projection stats");
    const result = await supabaseAdmin.from("nfl_projection_stat_cache_versions").upsert(group, { onConflict: "provider,provider_player_id,season,model_version,as_of,projection_hash", ignoreDuplicates: true });
    fail("NFL projection cache append failed", result.error);
  }
}

export function nflProjectionGenerationRepository() { return { loadHistories: loadNflProjectionHistories, appendStatCache: appendNflProjectionStatCache }; }

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
