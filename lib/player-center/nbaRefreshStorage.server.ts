import "server-only";
import { NBA_REFRESH_LIMITS } from "./nbaRefresh";

export { NBA_REFRESH_LIMITS };
export type RefreshHealth = { project_ref?: string; append_source_hash?: string; database_bytes: number; cache_bytes: number; history_bytes: number; wal_bytes: number;
  schema_ok: boolean; available_bytes: number; metrics_at: string; history_count?: number; current_count?: number;
  watermark?: number; current_checksum?: string; reference_errors?: number };

/** Aggregate-only metrics. Service credentials never leave the server or enter a report. */
export async function readNbaRefreshDisk(now = Date.now(), request: typeof fetch = fetch) {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(origin) || !key) throw new Error("Storage metrics configuration unavailable");
  const response = await request(`${origin}/customer/v1/privileged/metrics`, { headers: {
    Authorization: `Basic ${Buffer.from(`service_role:${key}`).toString("base64")}`, "Cache-Control": "no-cache, max-age=0", Pragma: "no-cache" },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error("Storage metrics unavailable");
  const served = Date.parse(response.headers.get("date") ?? ""), age = Number(response.headers.get("age") ?? 0);
  if (!Number.isFinite(served) || Math.abs(now - served) > 30000 || !Number.isFinite(age) || age > 90) throw new Error("Storage metrics stale");
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 5_000_000) throw new Error("Metrics response cap exceeded");
  let available: number | undefined, readOnly: number | undefined, wal: number | undefined, database: number | undefined;
  for (const line of raw.split("\n")) {
    const value = Number(line.trim().split(/\s+/).at(-1));
    if (line.startsWith("node_filesystem_avail_bytes{") && line.includes('mountpoint="/data"')) available = value;
    if (line.startsWith("node_filesystem_readonly{") && line.includes('mountpoint="/data"')) readOnly = value;
    if (line.startsWith("pg_wal_size_mb{")) wal = value * 1048576;
    if (line.startsWith("pg_database_size_bytes{") && line.includes('datname="postgres"')) database = value;
  }
  if (![available, wal, database].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0) || readOnly !== 0) throw new Error("Required writable-disk metrics missing");
  return { available_bytes: available!, metrics_at: new Date(served).toISOString(), metrics_wal_bytes: wal!, metrics_database_bytes: database! };
}

export function assertNbaRefreshStorage(health: RefreshHealth, payloadBytes = 0, now = Date.now()) {
  const heapBudget = payloadBytes * 6 + 4 * 1048576;
  const diskBudget = payloadBytes * 6 + NBA_REFRESH_LIMITS.walAllowanceBytes; // Includes concurrency/WAL allowance; not a hard PostgreSQL peak guarantee.
  if (![health.database_bytes, health.cache_bytes, health.wal_bytes, health.available_bytes].every(n => Number.isFinite(n) && n >= 0) ||
    !Number.isFinite(Date.parse(health.metrics_at)) || Math.abs(now - Date.parse(health.metrics_at)) > 90_000 || health.schema_ok !== true ||
    health.reference_errors != null && health.reference_errors !== 0) throw new Error("Refresh health/integrity gate failed");
  if (health.available_bytes - diskBudget < NBA_REFRESH_LIMITS.reserveBytes || health.database_bytes + heapBudget > NBA_REFRESH_LIMITS.stopDatabaseBytes ||
    health.cache_bytes + payloadBytes * 6 + 1048576 > NBA_REFRESH_LIMITS.cacheBytes) throw new Error("Refresh storage reserve/budget gate failed");
}
