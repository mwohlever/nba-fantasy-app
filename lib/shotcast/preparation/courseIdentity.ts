/** Provider identities are event-scoped aliases, never permanent physical-course IDs. */
import type { CourseOffset } from "../productionGeometry";

export type Evidence = { sourceUrl: string; sha256: string; retrievedAt: string; operation?: string; variables?: Record<string, unknown> };
export type DeclaredCourse = { id: string; name: string; host: boolean; scoringLevel: string };
export type EventIdentity = { provider: "pga-tour"; eventId: string; season: number; tournamentName: string; courses: DeclaredCourse[]; schedule: Evidence; inventory: Evidence };
export type CourseIdentity = {
  provider: "pga-tour";
  eventId: string;
  season: number;
  tournamentName: string;
  courseId: string;
  courseName: string;
  eventCourseKey: string;
  relationship: "host" | "alternate";
  // No physical-course/version alias is inferred from a name or provider number.
  physicalCourseId: null;
  assetRoot: string;
  configurationIdentity: string;
  registrationProfile: "pga-f32-z-up-interior-v1";
  nativeUnit: "feet";
  worldUnit: "metres";
  feetToMetres: 0.3048;
  rotationUnit: "degrees";
  worldAxes: "xy-horizontal-z-up";
};
export type EffectiveConfiguration = { offset: CourseOffset; selection: "base" | "course-override"; rawConfig: Record<string, unknown> };

export class PreparationError extends Error {
  constructor(public reason: string, public stage: string, public sourceUrl?: string, public status?: number) { super(`${stage}: ${reason}`); }
}
export const record = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new PreparationError("invalid_schema", "schema");
  return v as Record<string, unknown>;
};
export const array = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new PreparationError("invalid_schema", "schema"); return v; };
export const text = (v: unknown): string => { if (typeof v !== "string" || !v.trim()) throw new PreparationError("invalid_schema", "schema"); return v; };
export function validateEventId(eventId: string): void {
  if (!/^R\d{7}$/.test(eventId)) throw new PreparationError("unsupported_event_id", "identity");
}
export function declaredCourses(value: unknown): DeclaredCourse[] {
  const courses = array(value).map(v => {
    const c = record(v), id = text(c.id);
    if (!/^\d{1,8}$/.test(id) || typeof c.hostCourse !== "boolean") throw new PreparationError("invalid_course_identity", "identity");
    return { id, name: text(c.courseName), host: c.hostCourse, scoringLevel: text(c.scoringLevel) };
  });
  if (!courses.length || new Set(courses.map(c => c.id)).size !== courses.length || courses.filter(c => c.host).length !== 1) throw new PreparationError("ambiguous_course_inventory", "identity");
  return courses;
}

/** A host is not an implicit choice for a multi-course preparation request. */
export function selectEventCourse(event: EventIdentity, courseId?: string): DeclaredCourse {
  validateEventId(event.eventId);
  if (!courseId && event.courses.length !== 1) throw new PreparationError("course_selection_required", "identity");
  const matches = event.courses.filter(c => courseId ? c.id === courseId : true);
  if (matches.length !== 1) throw new PreparationError("unknown_or_ambiguous_course", "identity");
  if (matches[0].scoringLevel !== "TOURCAST") throw new PreparationError("course_without_tourcast", "identity");
  return matches[0];
}

/** Always require the actual player-round assignment, even for a single-course event. */
export function resolvePlayedCourse(event: EventIdentity, teeTimesResponse: unknown, playerId: string, round: number): DeclaredCourse {
  if (!/^\d+$/.test(playerId) || !Number.isInteger(round) || round < 1 || round > 4) throw new PreparationError("invalid_player_round", "assignment");
  const times = record(record(record(teeTimesResponse).data).teeTimes);
  if (times.id !== event.eventId) throw new PreparationError("assignment_event_mismatch", "assignment");
  const matches = new Set<string>();
  for (const v of array(times.rounds)) {
    const r = record(v); if (r.roundInt !== round) continue;
    for (const g of array(r.groups)) {
      const group = record(g);
      if (array(group.players).some(p => record(p).id === playerId)) matches.add(text(group.courseId));
    }
  }
  if (matches.size !== 1) throw new PreparationError("missing_or_ambiguous_assignment", "assignment");
  return selectEventCourse(event, [...matches][0]);
}

export function effectiveConfiguration(raw: unknown, course: DeclaredCourse): EffectiveConfiguration {
  const rawConfig = record(raw);
  const overrides = rawConfig.courseOffset === undefined ? [] : array(rawConfig.courseOffset).map(record);
  const matches = overrides.filter(c => c.courseId === course.id);
  if (matches.length > 1 || (!course.host && matches.length !== 1)) throw new PreparationError("missing_or_ambiguous_override", "registration");
  const selected = matches[0] ?? rawConfig;
  const keys = ["x", "y", "z", "rotate"] as const;
  if (keys.some(k => typeof selected[k] !== "number" || !Number.isFinite(selected[k])) || (selected.x === -1 && selected.y === -1)) throw new PreparationError("invalid_or_placeholder_transform", "registration");
  const offset = Object.fromEntries(keys.map(k => [k, selected[k]])) as CourseOffset;
  return { offset, selection: matches.length ? "course-override" : "base", rawConfig };
}

export function courseIdentity(event: EventIdentity, course: DeclaredCourse, configHash: string): CourseIdentity {
  if (!event.courses.some(c => c.id === course.id)) throw new PreparationError("course_event_mismatch", "identity");
  return {
    provider: "pga-tour", eventId: event.eventId, season: event.season, tournamentName: event.tournamentName,
    courseId: course.id, courseName: course.name, eventCourseKey: `pga-tour:${event.eventId}:${course.id}`,
    relationship: course.host ? "host" : "alternate", physicalCourseId: null,
    assetRoot: `https://tourcast.pgatour.com/models/${event.eventId}/${course.host ? "" : `${course.id}/`}3D_Assets/`,
    configurationIdentity: configHash, registrationProfile: "pga-f32-z-up-interior-v1", nativeUnit: "feet", worldUnit: "metres",
    feetToMetres: 0.3048, rotationUnit: "degrees", worldAxes: "xy-horizontal-z-up",
  };
}
