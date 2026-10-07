/** Event inventory does not identify the course played by a particular golfer. */
import { array, PreparationError, record, resolvePlayedCourse, type DeclaredCourse, type EventIdentity, type Evidence } from "./courseIdentity";
import { acquireTeeTimes, discoverEvent, json, verifyResource, type Acquisition, type DiscoveredEvent, type Resource } from "./pgaAcquisition.server";
import { prepareCourseForEvent, type PreparationResult } from "./prepareCourse.server";

export type PlayerRoundCourseAssignment = {
  eventId: string; season: number; playerId: string; roundNumber: number;
  course: DeclaredCourse; eventCourseKey: string; physicalCourseId: null;
  method: "tee-time-player-round-course";
  provenance: { inventory: Evidence; teeTimes: Evidence; groups: { roundNumber: number; groupIndex: number; courseId: string }[] };
};

/** Tee-time membership is authoritative here; inventory validates its course alias.
 * No host, current leaderboard course, or name fallback replaces a missing join. */
export function assignmentFromTeeTimes(event: EventIdentity, teeTimes: Resource, playerId: string, roundNumber: number): PlayerRoundCourseAssignment {
  verifyResource(teeTimes, "https://orchestrator.pgatour.com/graphql");
  if (teeTimes.evidence.operation !== "GetTeeTimes" || teeTimes.evidence.variables?.id !== event.eventId) throw new PreparationError("assignment_query_mismatch", "assignment");
  const body = json(teeTimes), course = resolvePlayedCourse(event, body, playerId, roundNumber);
  const groups: PlayerRoundCourseAssignment["provenance"]["groups"] = [];
  for (const v of array(record(record(body.data).teeTimes).rounds)) {
    const round = record(v); if (round.roundInt !== roundNumber) continue;
    array(round.groups).forEach((g, groupIndex) => {
      const group = record(g);
      if (array(group.players).some(p => record(p).id === playerId)) groups.push({ roundNumber, groupIndex, courseId: course.id });
    });
  }
  return { eventId: event.eventId, season: event.season, playerId, roundNumber, course,
    eventCourseKey: `pga-tour:${event.eventId}:${course.id}`, physicalCourseId: null,
    method: "tee-time-player-round-course", provenance: { inventory: event.inventory, teeTimes: teeTimes.evidence, groups } };
}

export async function resolveCourseForPlayerRound(eventId: string, playerId: string, roundNumber: number, acquire?: Acquisition): Promise<{ assignment: PlayerRoundCourseAssignment; discovery: DiscoveredEvent; teeTimes: Resource }> {
  const discovery = await discoverEvent(eventId, acquire), teeTimes = await acquireTeeTimes(discovery);
  return { assignment: assignmentFromTeeTimes(discovery.identity, teeTimes, playerId, roundNumber), discovery, teeTimes };
}

export type PlayerRoundPreparationResult = PreparationResult & { assignment?: PlayerRoundCourseAssignment };
export async function prepareCourseForPlayerRound(request: { eventId: string; playerId: string; roundNumber: number; holes: number[] }, acquire?: Acquisition): Promise<PlayerRoundPreparationResult> {
  try {
    const resolved = await resolveCourseForPlayerRound(request.eventId, request.playerId, request.roundNumber, acquire);
    const result = await prepareCourseForEvent({ eventId: request.eventId, courseId: resolved.assignment.course.id, holes: request.holes }, acquire);
    if (result.status === "unsupported") return result;
    // Acquisition can span updates. Re-check the join against the candidate's
    // preserved tee-time body instead of assuming the preliminary join still holds.
    const assignment = assignmentFromTeeTimes(result.candidate.manifest.eventIdentity, result.candidate.resources["tee-times"], request.playerId, request.roundNumber);
    if (assignment.course.id !== resolved.assignment.course.id || assignment.course.id !== result.candidate.manifest.identity.courseId) throw new PreparationError("course_assignment_changed", "assignment");
    return { ...result, assignment };
  } catch (e) {
    return e instanceof PreparationError ? { status: "unsupported", reason: e.reason, stage: e.stage, sourceUrl: e.sourceUrl, httpStatus: e.status } : { status: "unsupported", reason: "invalid_or_unavailable_course_assignment", stage: "assignment" };
  }
}
