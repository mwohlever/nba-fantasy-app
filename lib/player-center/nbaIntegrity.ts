import { createHash } from "node:crypto";

type Row = Record<string, unknown>;
export type NbaIntegrityAnchor = { historyCount: number; currentCount: number; watermark: number | null };
export type NbaIntegrityReader = {
  anchor(): Promise<NbaIntegrityAnchor>;
  page(table: "history" | "current", offset: number, limit: number): Promise<Row[]>;
};

const common = "provider,provider_player_id,provider_event_id,local_player_id,season,phase,game_at,completed_at,team_provider_id,team_abbreviation,opponent_provider_id,opponent_abbreviation,home_away,minutes,points,rebounds,assists,steals,blocks,turnovers,source_url,provider_fetched_at,provider_known_at,normalization_version,observation_hash,created_at".split(",");
const numeric = ["local_player_id", "season", "minutes", "points", "rebounds", "assists", "steals", "blocks", "turnovers"];
export const NBA_INTEGRITY_TABLES = { history: "nba_player_game_observation_versions", current: "nba_player_game_current_observations" } as const;
export const NBA_INTEGRITY_ORDER = { history: "id", current: "provider,provider_player_id,provider_event_id" } as const;
/** Text casts preserve arbitrary PostgreSQL NUMERIC precision during exact comparisons. */
export function nbaIntegritySelect(table: "history" | "current") {
  return ["*", ...[table === "history" ? "id" : "version_id", ...numeric].map(key => `audit_${key}:${key}::text`)].join(",");
}
const stable = (row: Row) => JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])));
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
function decimal(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || !/^-?\d+(?:\.\d+)?$/.test(value)) throw Error("Missing lossless numeric audit field");
  const normalized = value.replace(/^(\-?)0+(?=\d)/, "$1").replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  return /^-?0$/.test(normalized) ? "0" : normalized;
}
function canonical(raw: Row, table: "history" | "current") {
  const id = table === "history" ? "id" : "version_id", expected = [...common, id];
  const aliases = [id, ...numeric].map(key => `audit_${key}`);
  if (Object.keys(raw).sort().join() !== [...expected, ...aliases].sort().join()) throw Error("Observation audit schema changed");
  const row: Row = Object.fromEntries(expected.map(key => [key, raw[key]]));
  for (const key of [id, ...numeric]) row[key] = decimal(raw[`audit_${key}`]);
  if (typeof row[id] !== "string" || !/^[1-9]\d*$/.test(row[id] as string)) throw Error("Invalid observation version ID");
  if (![row.provider, row.provider_player_id, row.provider_event_id].every(value => typeof value === "string" && value.length)) throw Error("Invalid observation audit key");
  return row;
}
const keyOf = (row: Row) => JSON.stringify([row.provider, row.provider_player_id, row.provider_event_id]);

/**
 * Same whole-history/current guarantees as full SQL health, without its per-current-row
 * correlated latest-version query. No sampling. Immutable history must have an unchanged
 * count/watermark, and two full current scans must agree. Any race/cap/deadline aborts.
 */
export async function verifyNbaIntegrity(reader: NbaIntegrityReader, options: { now?: () => number; timeoutMs?: number; pageSize?: number } = {}) {
  const now = options.now ?? Date.now, deadline = now() + (options.timeoutMs ?? 75_000), pageSize = options.pageSize ?? 1000;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw Error("Invalid audit page size");
  let bytes = 0, pages = 0;
  const budget = () => { if (now() >= deadline || pages > 500 || bytes > 256 * 1048576) throw Error("Integrity audit budget exhausted; no partial certification"); };
  const before = await reader.anchor(); budget();
  if (!Number.isSafeInteger(before.historyCount) || before.historyCount < 0 || before.historyCount > 250000 ||
      !Number.isSafeInteger(before.currentCount) || before.currentCount < 0 || before.currentCount > 100000 ||
      before.historyCount === 0 && before.watermark !== null || before.historyCount > 0 && (!Number.isSafeInteger(before.watermark) || before.watermark! < 1)) throw Error("Integrity anchor/cap invalid");
  const latest = new Map<string, { id: string; at: number; value: string }>();
  let previousId = BigInt(0);
  async function scan(table: "history" | "current", count: number, visit: (row: Row) => void) {
    // Counts are checked independently; a short page is never mistaken for exhaustion.
    for (let offset = 0; offset < count;) {
      budget(); pages++;
      const raw = await reader.page(table, offset, Math.min(pageSize, count - offset)); budget();
      if (!raw.length || raw.length > Math.min(pageSize, count - offset)) throw Error("Truncated/oversized integrity page");
      bytes += Buffer.byteLength(JSON.stringify(raw)); budget();
      for (const item of raw) visit(canonical(item, table));
      offset += raw.length;
    }
  }
  await scan("history", before.historyCount, row => {
    const id = row.id as string, at = Date.parse(String(row.provider_fetched_at));
    if (BigInt(id) <= previousId || !Number.isFinite(at)) throw Error("Invalid/repeated history order or timestamp");
    previousId = BigInt(id);
    const key = keyOf(row), old = latest.get(key); delete row.id;
    if (!old || at > old.at || at === old.at && BigInt(id) > BigInt(old.id)) latest.set(key, { id, at, value: stable(row) });
  });
  if (previousId !== BigInt(before.watermark ?? 0)) throw Error("History watermark changed during audit");
  async function currentScan() {
    const seen = new Set<string>(), hash = createHash("sha256");
    await scan("current", before.currentCount, row => {
      const key = keyOf(row), expected = latest.get(key), version = row.version_id; delete row.version_id;
      if (seen.has(key) || !expected || expected.id !== version || expected.value !== stable(row)) throw Error("Current/latest reference or payload mismatch");
      seen.add(key); hash.update(key + "\n" + String(version) + "\n" + stable(row) + "\n");
    });
    if (seen.size !== latest.size) throw Error("Orphan history key missing from current table");
    return hash.digest("hex");
  }
  const first = await currentScan(), second = await currentScan(), after = await reader.anchor(); budget();
  if (stable(before) !== stable(after) || first !== second) throw Error("Concurrent observation change; restart the complete audit");
  return { history_count: before.historyCount, current_count: before.currentCount, watermark: before.watermark,
    current_checksum: `paged-v1:sha256:${first}`, reference_errors: 0, integrity_protocol: "paged-v1" as const,
    integrity_receipt: digest(stable({ before, first, pages, bytes })), integrity_pages: pages };
}
