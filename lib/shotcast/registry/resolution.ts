/** Read-only application contract. No provider transport, preparation or asset loading. */
import type { RegistryAssignment, RegistryEvent, RegistryEventCourse } from "./model";

export type RegistryReader = {
  readEvent(eventId: string): Promise<RegistryEvent | null>;
  readCourses(eventId: string): Promise<RegistryEventCourse[]>;
  readAssignments(eventId: string, playerId: string, roundNumber: number): Promise<RegistryAssignment[]>;
};
export type CourseResolution = {
  event: RegistryEvent | null; player: { pgaPlayerId: string; golfPlayerId: number | null };
  roundNumber: number; source: RegistryAssignment["source"] | null;
  provenance: RegistryAssignment["provenance"] | null;
} & (
  { state: "authoritative"; eventCourse: RegistryEventCourse; reason: null } |
  { state: "unresolved"; eventCourse: null; reason: string }
);

export async function resolveCourseForPlayerRound(
  registry: RegistryReader, eventId: string, playerId: string, roundNumber: number,
): Promise<CourseResolution> {
  const base = { event: null as RegistryEvent | null, player: { pgaPlayerId: playerId, golfPlayerId: null as number | null },
    roundNumber, source: null as RegistryAssignment["source"] | null, provenance: null as RegistryAssignment["provenance"] | null };
  const unresolved = (reason: string): CourseResolution => ({ ...base, state: "unresolved", eventCourse: null, reason });
  if (!/^R\d{7}$/.test(eventId) || !/^\d+$/.test(playerId) || !Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 4) return unresolved("invalid_player_round_identity");
  base.event = await registry.readEvent(eventId);
  if (!base.event) return unresolved("event_not_registered");
  if (base.event.pga_event_id !== eventId) return unresolved("event_identity_mismatch");
  const [courses, assignments] = await Promise.all([
    registry.readCourses(eventId), registry.readAssignments(eventId, playerId, roundNumber),
  ]);
  if (!assignments.length) return unresolved("missing_assignment");
  if (assignments.length !== 1) return unresolved("ambiguous_assignment");
  const assignment = assignments[0];
  if (assignment.pga_event_id !== eventId || assignment.pga_player_id !== playerId || assignment.round_number !== roundNumber) return unresolved("assignment_identity_mismatch");
  base.source = assignment.source; base.provenance = assignment.provenance;
  base.player.golfPlayerId = assignment.golf_player_id;
  if (assignment.state !== "authoritative") return unresolved(assignment.unresolved_reason ?? "unresolved_assignment");
  if (assignment.source !== "tee-time-player-round-course" || assignment.unresolved_reason !== null ||
    assignment.provenance?.teeTimes?.operation !== "GetTeeTimes" || assignment.provenance?.teeTimes?.variables?.id !== eventId ||
    !Array.isArray(assignment.provenance?.groups) || !assignment.provenance.groups.length || assignment.provenance.groups.some(g => g.roundNumber !== roundNumber || g.courseId !== assignment.pga_course_id)) return unresolved("invalid_assignment_provenance");
  const matches = courses.filter(c => c.pga_event_id === eventId && c.pga_course_id === assignment.pga_course_id);
  if (!matches.length) return unresolved("unknown_course");
  if (matches.length !== 1) return unresolved("ambiguous_course");
  return { ...base, state: "authoritative", eventCourse: matches[0], reason: null };
}
