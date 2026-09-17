import {
  scoreCachedNbaProjection,
  type NbaProjectionStatCacheRecord,
} from "@/lib/analytics/nba/projectionInfrastructure";
import {
  scoreCachedNflProjection,
  type NflProjectionCacheRecord,
} from "@/lib/analytics/nfl/projectionInfrastructure";

/**
 * A display-only Draft value. V2 rows remain raw and global; this value is
 * scored for one authorized slate at read time and is never cached back.
 */
export function scoreNbaDraftProjection(
  record: Pick<NbaProjectionStatCacheRecord, "projected_stats">,
  rulesSnapshot: Record<string, unknown> | null,
) {
  return scoreCachedNbaProjection(record, rulesSnapshot, rulesSnapshot === null);
}

export function scoreNflDraftProjection(
  record: Pick<NflProjectionCacheRecord, "projected_stats">,
  rulesSnapshot: Record<string, unknown> | null,
) {
  return scoreCachedNflProjection(record, rulesSnapshot);
}
