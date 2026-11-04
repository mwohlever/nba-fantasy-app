import "server-only";
import type { DraftProjection } from "./draftProjectionTypes";
/** Retired compatibility symbol. No cache lookup, prediction or fallback is performed. */
export async function getDraftProjectionsForSlate(_slate: { sport: "nba" | "nfl"; date: string | null; start_date: string | null; display_name: string | null; rules_snapshot: Record<string, unknown> | null }): Promise<{ sport: "nba" | "nfl"; modelVersion: string; projections: Record<number, DraftProjection> }> {
  void _slate;
  throw new Error("NBA/NFL player projections have been retired.");
}
