/** Metadata-only seam; callers own authorization and inject their server client. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistryAssignment, RegistryEvent, RegistryEventCourse, RegistryPreparedRevision, RegistryRevisionAsset } from "./model";
import { resolveShotcast3DCapability, type ShotcastCapabilityReader, type ShotcastCapabilityRequest } from "./capability.server";

export function createShotcastRegistryReader(db: SupabaseClient): ShotcastCapabilityReader {
  return {
    async readEvent(eventId) {
      const { data, error } = await db.from("shotcast_events").select("*").eq("pga_event_id", eventId).maybeSingle();
      if (error) throw new Error(`ShotCast registry event read failed: ${error.message}`);
      return data as RegistryEvent | null;
    },
    async readCourses(eventId) {
      const { data, error } = await db.from("shotcast_event_courses").select("*").eq("pga_event_id", eventId);
      if (error) throw new Error(`ShotCast registry course read failed: ${error.message}`);
      return (data ?? []) as RegistryEventCourse[];
    },
    async readAssignments(eventId, playerId, roundNumber) {
      const { data, error } = await db.from("shotcast_player_round_courses").select("*")
        .eq("pga_event_id", eventId).eq("pga_player_id", playerId).eq("round_number", roundNumber);
      if (error) throw new Error(`ShotCast registry assignment read failed: ${error.message}`);
      return (data ?? []) as RegistryAssignment[];
    },
    async readPreparedRevisions(eventId, courseId) {
      const { data, error } = await db.from("shotcast_prepared_revisions").select("*")
        .eq("pga_event_id", eventId).eq("pga_course_id", courseId);
      if (error) throw new Error(`ShotCast registry revision read failed: ${error.message}`);
      return (data ?? []) as RegistryPreparedRevision[];
    },
    async readRevisionAssets(preparationId) {
      const { data, error } = await db.from("shotcast_revision_assets").select("*").eq("preparation_id", preparationId);
      if (error) throw new Error(`ShotCast registry asset read failed: ${error.message}`);
      return (data ?? []) as RegistryRevisionAsset[];
    },
  };
}

/** Narrow server API for later authorized Golf callers; metadata availability only. */
export function createShotcast3DCapabilityResolver(db: SupabaseClient) {
  const registry = createShotcastRegistryReader(db);
  return (request: ShotcastCapabilityRequest) => resolveShotcast3DCapability(registry, request);
}

/** Use only an explicit stored ESPN/PGA link; a missing link stays unresolved. */
export async function findShotcastEventForTournament(db: SupabaseClient, espnEventId: string): Promise<RegistryEvent | null> {
  if (!espnEventId.trim()) return null;
  const { data, error } = await db.from("shotcast_events").select("*").eq("espn_event_id", espnEventId.trim()).maybeSingle();
  if (error) throw new Error(`ShotCast registry tournament link read failed: ${error.message}`);
  return data as RegistryEvent | null;
}
