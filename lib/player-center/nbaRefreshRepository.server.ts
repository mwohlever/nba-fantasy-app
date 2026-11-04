import "server-only";
import { supabaseAdmin } from "../supabaseAdmin";
import { SupabaseCenterRepository } from "./repository.server";
import { readNbaRefreshDisk, assertNbaRefreshStorage, type RefreshHealth } from "./nbaRefreshStorage.server";
import { NBA_APPEND_SOURCE_MD5, type NbaRefreshPublication } from "./nbaRefresh";
import { verifyNbaIntegrity, NBA_INTEGRITY_TABLES, NBA_INTEGRITY_ORDER, nbaIntegritySelect } from "./nbaIntegrity";

export async function nbaRefreshCohort() {
  const catalog = await new SupabaseCenterRepository().catalog("nba");
  return catalog.players.filter(player => player.active).sort((a, b) => a.playerId - b.playerId);
}
export async function nbaRefreshHealth(full = false): Promise<RefreshHealth> {
  // Keep the installed SQL guard/fingerprint intact. The expensive correlated full
  // query is replaced by bounded complete reads, not by a partial health result.
  const sql = await supabaseAdmin.rpc("player_center_nba_refresh_health", { full_check: false });
  if (sql.error || !sql.data) throw new Error("Refresh schema/health unavailable; manual installation must be confirmed");
  if (sql.data.schema_ok !== true || sql.data.append_source_hash !== NBA_APPEND_SOURCE_MD5) throw new Error("Refresh schema/fingerprint changed");
  const integrity = full ? await verifyNbaIntegrity({
    async anchor() {
      const [history, current, last] = await Promise.all([
        supabaseAdmin.from(NBA_INTEGRITY_TABLES.history).select("id", { count: "exact", head: true }).abortSignal(AbortSignal.timeout(10000)),
        supabaseAdmin.from(NBA_INTEGRITY_TABLES.current).select("version_id", { count: "exact", head: true }).abortSignal(AbortSignal.timeout(10000)),
        supabaseAdmin.from(NBA_INTEGRITY_TABLES.history).select("id").order("id", { ascending: false }).limit(1).abortSignal(AbortSignal.timeout(10000)),
      ]);
      if (history.error || current.error || last.error || history.count === null || current.count === null) throw new Error("Integrity anchor unavailable");
      return { historyCount: history.count, currentCount: current.count, watermark: last.data?.[0]?.id ?? null };
    },
    async page(table, offset, limit) {
      let query = supabaseAdmin.from(NBA_INTEGRITY_TABLES[table]).select(nbaIntegritySelect(table));
      for (const column of NBA_INTEGRITY_ORDER[table].split(",")) query = query.order(column, { ascending: true });
      const result = await query.range(offset, offset + limit - 1).abortSignal(AbortSignal.timeout(10000));
      if (result.error || !result.data) throw new Error("Integrity page unavailable");
      return result.data as unknown as Record<string, unknown>[];
    },
  }) : {};
  const [finalSql, disk] = await Promise.all([supabaseAdmin.rpc("player_center_nba_refresh_health", { full_check: false }), readNbaRefreshDisk()]);
  if (finalSql.error || finalSql.data?.schema_ok !== true || finalSql.data.append_source_hash !== sql.data.append_source_hash) throw new Error("Integrity schema changed during audit");
  const health = { ...finalSql.data, ...integrity, ...disk, project_ref: new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0] } as RefreshHealth;
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
