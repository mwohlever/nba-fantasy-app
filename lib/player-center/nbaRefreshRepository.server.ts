import "server-only";
import { supabaseAdmin } from "../supabaseAdmin";
import { SupabaseCenterRepository } from "./repository.server";
import { readNbaRefreshDisk, assertNbaRefreshStorage, type RefreshHealth } from "./nbaRefreshStorage.server";
import { NBA_APPEND_SOURCE_MD5, type NbaRefreshPublication } from "./nbaRefresh";

export async function nbaRefreshCohort() {
  const catalog = await new SupabaseCenterRepository().catalog("nba");
  return catalog.players.filter(player => player.active).sort((a, b) => a.playerId - b.playerId);
}
export async function nbaRefreshHealth(full = false): Promise<RefreshHealth> {
  const [sql, disk] = await Promise.all([supabaseAdmin.rpc("player_center_nba_refresh_health", { full_check: full }), readNbaRefreshDisk()]);
  if (sql.error || !sql.data) throw new Error("Refresh schema/health unavailable; manual installation must be confirmed");
  const health = { ...sql.data, ...disk, project_ref: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0] } as RefreshHealth;
  if (Math.abs(health.database_bytes - disk.metrics_database_bytes) > 16 * 1048576 || Math.abs(health.wal_bytes - disk.metrics_wal_bytes) > 32 * 1048576) throw new Error("Storage exporter disagrees with live SQL");
  if (health.append_source_hash !== NBA_APPEND_SOURCE_MD5) throw new Error("Reviewed observation append RPC changed");
  assertNbaRefreshStorage(health);
  return health;
}
export async function publishNbaRefresh(input: { runId: string; season: number; asOf: string; publications: NbaRefreshPublication[] }) {
  const health = await nbaRefreshHealth();
  assertNbaRefreshStorage(health, Buffer.byteLength(JSON.stringify(input.publications)));
  const result = await supabaseAdmin.rpc("publish_player_center_nba_refresh", {
    run_id: input.runId, season: input.season, as_of: input.asOf, publications: input.publications });
  if (result.error || !result.data) throw new Error(`NBA factual publication failed: ${result.error?.message ?? "missing receipt"}`);
  return result.data;
}
