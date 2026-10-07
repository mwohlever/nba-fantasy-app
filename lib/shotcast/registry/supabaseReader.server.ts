/** Metadata-only seam; callers own authorization and inject their server client. */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RegistryAssignment, RegistryEvent, RegistryEventCourse } from "./model";
import type { RegistryReader } from "./resolution";

export function createShotcastRegistryReader(db: SupabaseClient): RegistryReader {
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
  };
}

/** Use only an explicit stored ESPN/PGA link; a missing link stays unresolved. */
export async function findShotcastEventForTournament(db: SupabaseClient, espnEventId: string): Promise<RegistryEvent | null> {
  if (!espnEventId.trim()) return null;
  const { data, error } = await db.from("shotcast_events").select("*").eq("espn_event_id", espnEventId.trim()).maybeSingle();
  if (error) throw new Error(`ShotCast registry tournament link read failed: ${error.message}`);
  return data as RegistryEvent | null;
}
