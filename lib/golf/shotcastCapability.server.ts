import type { SupabaseClient } from "@supabase/supabase-js";
import type { GolfHoleReplay } from "../providers/pgaTourShots";
import type { Shotcast3DCapability, ShotcastFallbackReason } from "../shotcast/registry/capability.server";
import { createShotcast3DCapabilityResolver, findShotcastEventForTournament } from "../shotcast/registry/supabaseReader.server";

type GolfShotcastContext = {
  espnEventId: string | null;
  golfPlayerId: number;
  round: number;
  hole: number;
  replay: Pick<GolfHoleReplay, "tournamentId" | "pgaPlayerId" | "roundNumber" | "holeNumber"> | null;
};
type ApplicationFallbackReason = "missing_pga_event_identity" | "missing_pga_player_identity"
  | "ambiguous_pga_identity" | "capability_read_failed";
export type GolfShotcastCapability = {
  renderer: "2d";
  activation: "disabled";
  capability: Shotcast3DCapability | {
    status: "unavailable";
    reason: ApplicationFallbackReason | ShotcastFallbackReason;
  };
};

/** Call only after slate/Group authorization. Read metadata, never prepare or deliver assets.
 * Replay IDs originate in name matching; explicit stored links must corroborate them.
 * Activation remains disabled unconditionally: registry population cannot enable rendering.
 */
export async function resolveGolfShotcastCapability(
  db: SupabaseClient, context: GolfShotcastContext,
): Promise<GolfShotcastCapability> {
  const fallback = (reason: ApplicationFallbackReason | ShotcastFallbackReason): GolfShotcastCapability =>
    ({ renderer: "2d", activation: "disabled", capability: { status: "unavailable", reason } });
  const { replay, round, hole, golfPlayerId } = context;
  if (!Number.isInteger(round) || round < 1 || round > 4 ||
    !Number.isInteger(hole) || hole < 1 || hole > 18 ||
    !Number.isSafeInteger(golfPlayerId) || golfPlayerId < 1) return fallback("invalid_request");
  // Missing provider context or application link keys incur no registry reads.
  const espnEventId = context.espnEventId?.trim();
  if (!espnEventId || !replay?.tournamentId) return fallback("missing_pga_event_identity");
  if (!replay.pgaPlayerId) return fallback("missing_pga_player_identity");
  if (!/^R\d{7}$/.test(replay.tournamentId) || !/^\d+$/.test(replay.pgaPlayerId)) return fallback("invalid_request");
  if (replay.roundNumber !== round || replay.holeNumber !== hole) return fallback("ambiguous_pga_identity");

  try {
    // This link is unique in the existing registry schema; no schedule/name inference.
    const event = await findShotcastEventForTournament(db, espnEventId);
    if (!event || !event.identity_link_source?.trim()) return fallback("missing_pga_event_identity");
    if (event.espn_event_id !== espnEventId || event.pga_event_id !== replay.tournamentId) {
      return fallback("ambiguous_pga_identity");
    }
    const { data, error } = await db.from("shotcast_player_round_courses")
      .select("pga_event_id, pga_player_id, golf_player_id, round_number")
      .eq("pga_event_id", event.pga_event_id).eq("golf_player_id", golfPlayerId)
      .eq("round_number", round).limit(2);
    if (error) return fallback("capability_read_failed");
    if (!data?.length) return fallback("missing_pga_player_identity");
    if (data.length !== 1 || data[0].pga_event_id !== event.pga_event_id ||
      data[0].golf_player_id !== golfPlayerId || data[0].round_number !== round ||
      data[0].pga_player_id !== replay.pgaPlayerId) return fallback("ambiguous_pga_identity");

    const capability = await createShotcast3DCapabilityResolver(db)({
      eventId: event.pga_event_id, playerId: data[0].pga_player_id, round, hole,
    });
    return { renderer: "2d", activation: "disabled", capability };
  } catch {
    // Registry outages cannot break the existing replay; no per-request logging.
    return fallback("capability_read_failed");
  }
}

/** Public diagnostics omit registry proofs, asset URLs, hashes and provider detail. */
export function golfShotcastCapabilitySummary(result: GolfShotcastCapability) {
  return {
    renderer: result.renderer,
    activation: result.activation,
    capability: result.capability.status === "available"
      ? { status: "available" as const }
      : { status: "unavailable" as const, reason: result.capability.reason },
  };
}
