import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResourceAuthorization } from "../security/resourceAuthorization";
import { createShotcastRegistryReader, findShotcastEventForTournament } from "../shotcast/registry/supabaseReader.server";
import { resolveShotcast3DCapability } from "../shotcast/registry/capability.server";
import { PREPARED_ASSET_BUCKET, resolvePreparedShotcastAssets, type PreparedAssetDelivery,
  type PreparedAssetManifestRecord, type PreparedAssetStorage } from "../shotcast/storage/preparedAssets.server";

export type GolfPreparedAssetRequest = { slateId: number; golfPlayerId: number; round: number; hole: number };

/** Dormant server seam. Bind authorizeSlate to the existing
 * authorizeSlateResource(request, slateId) boundary, without allowInternal.
 * No route calls this factory. Never pass authorization or origin from JSON. */
export function createGolfPreparedShotcastAssetDelivery(
  db: SupabaseClient,
  authorizeSlate: (slateId: number) => Promise<ResourceAuthorization>,
  storageOrigin: string,
) {
  const registry = createShotcastRegistryReader(db);
  // Bound metadata reads too; never truncate an oversized asset set into validity.
  registry.readPreparedRevisions = async (eventId, courseId) => {
    const { data, error } = await db.from("shotcast_prepared_revisions").select("*")
      .eq("pga_event_id", eventId).eq("pga_course_id", courseId).eq("is_current", true).limit(2);
    if (error) throw new Error("Prepared revision read failed");
    return data ?? [];
  };
  registry.readRevisionAssets = async preparationId => {
    const { data, error } = await db.from("shotcast_revision_assets").select("*")
      .eq("preparation_id", preparationId).limit(94);
    if (error || (data?.length ?? 0) >= 94) throw new Error("Prepared asset metadata read failed");
    return data ?? [];
  };
  const storage: PreparedAssetStorage = {
    origin: storageOrigin,
    async readManifest(preparationId) {
      const { data, error } = await db.from("shotcast_asset_delivery_manifests")
        .select("preparation_id,manifest_sha256,manifest,state,integrity_verified_at,approved_at")
        .eq("preparation_id", preparationId).maybeSingle();
      if (error) throw new Error("Prepared asset manifest read failed");
      return data as PreparedAssetManifestRecord | null;
    },
    async stat(objectPath) {
      const { data, error } = await db.storage.from(PREPARED_ASSET_BUCKET).info(objectPath);
      if (error || !data) return null;
      return { sizeBytes: data.size!, mediaType: data.contentType! };
    },
    async sign(objectPaths, expiresIn) {
      const { data, error } = await db.storage.from(PREPARED_ASSET_BUCKET).createSignedUrls(objectPaths, expiresIn);
      if (error || !data) throw new Error("Prepared asset signing failed");
      return data;
    },
  };
  return async (input: GolfPreparedAssetRequest): Promise<PreparedAssetDelivery> => {
    const unavailable = (reason: "invalid_scope" | "unauthorized" | "revision_unavailable" | "storage_unavailable"): PreparedAssetDelivery => ({ status: "unavailable", reason });
    if (!Number.isSafeInteger(input.slateId) || input.slateId < 1 || !Number.isSafeInteger(input.golfPlayerId) || input.golfPlayerId < 1 ||
      !Number.isInteger(input.round) || input.round < 1 || input.round > 4 || !Number.isInteger(input.hole) || input.hole < 1 || input.hole > 18 ||
      Object.keys(input).some(k => !["slateId", "golfPlayerId", "round", "hole"].includes(k))) return unavailable("invalid_scope");
    try {
      const authorization = await authorizeSlate(input.slateId);
      if (!authorization.ok || authorization.mode !== "user" || !authorization.user ||
        authorization.target.id !== input.slateId || authorization.target.sportKey !== "golf" ||
        !authorization.target.groupId || !authorization.target.leagueId) return unavailable("unauthorized");
      const { data: slate, error: slateError } = await db.from("slates").select("id,sport,league_id,external_event_id")
        .eq("id", input.slateId).eq("league_id", authorization.target.leagueId).maybeSingle();
      const { data: player, error: playerError } = await db.from("golf_event_players").select("player_id")
        .eq("slate_id", input.slateId).eq("player_id", input.golfPlayerId).maybeSingle();
      if (slateError || playerError) return unavailable("storage_unavailable");
      if (!slate || slate.id !== input.slateId || slate.sport !== "golf" || slate.league_id !== authorization.target.leagueId ||
        !player || player.player_id !== input.golfPlayerId || !slate.external_event_id) return unavailable("unauthorized");
      const event = await findShotcastEventForTournament(db, slate.external_event_id);
      if (!event || event.espn_event_id !== slate.external_event_id || !event.identity_link_source?.trim()) return unavailable("revision_unavailable");
      const { data: links, error } = await db.from("shotcast_player_round_courses")
        .select("pga_event_id,pga_player_id,golf_player_id,round_number")
        .eq("pga_event_id", event.pga_event_id).eq("golf_player_id", input.golfPlayerId).eq("round_number", input.round).limit(2);
      if (error) return unavailable("storage_unavailable");
      if (links?.length !== 1 || links[0].pga_event_id !== event.pga_event_id ||
        links[0].golf_player_id !== input.golfPlayerId || links[0].round_number !== input.round) return unavailable("revision_unavailable");
      const request = { eventId: event.pga_event_id, playerId: links[0].pga_player_id, round: input.round, hole: input.hole };
      const capability = await resolveShotcast3DCapability(registry, request);
      if (capability.status !== "available") return unavailable("revision_unavailable");
      return await resolvePreparedShotcastAssets(registry, storage, {
        request, approvedRevision: capability.revision, eventCourse: capability.eventCourse, hole: input.hole,
      });
    } catch { return unavailable("storage_unavailable"); }
  };
}
