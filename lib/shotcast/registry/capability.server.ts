/** Server metadata read seam. Callers retain Group/slate authorization.
 * No asset loading, preparation, approval, writes or provider requests occur here. */
import { PROFILE, supportedApplicationProfile } from "../preparation/pgaAcquisition.server";
import { parsePreparedRevisionState, selectCurrentPreparedRevision } from "./model";
import type { RegistryEvent, RegistryEventCourse, RegistryPreparedRevision, RegistryRevisionAsset } from "./model";
import { resolveCourseForPlayerRound, type CourseResolution, type RegistryReader } from "./resolution";

export type ShotcastCapabilityRequest = { eventId: string; playerId: string; round: number; hole: number };
export type ShotcastCapabilityReader = RegistryReader & {
  readPreparedRevisions(eventId: string, courseId: string): Promise<RegistryPreparedRevision[]>;
  readRevisionAssets(preparationId: string): Promise<RegistryRevisionAsset[]>;
};
export type ShotcastFallbackReason =
  | "invalid_request" | "event_not_registered"
  | "course_assignment_missing" | "course_assignment_ambiguous" | "course_assignment_unresolved"
  | "course_not_registered" | "no_prepared_revision" | "revision_not_approved"
  | "revision_ambiguous" | "revision_pending" | "revision_staged" | "revision_rejected"
  | "revision_stale" | "revision_not_validated" | "required_assets_missing"
  | "hole_not_prepared" | "validation_failed";
type OptionalGeometryCapability =
  | { status: "available"; asset: RegistryRevisionAsset }
  | { status: "unavailable"; reason: "asset_not_recorded" };
// 4D.1 records course assets, not shot-specific replay material. Unknown never means available.
type ReplayCapability = { status: "unknown"; reason: "replay_evidence_not_recorded" };
export type Shotcast3DCapability = { request: ShotcastCapabilityRequest } & (
  { status: "unavailable"; reason: ShotcastFallbackReason; detail: string } |
  {
    status: "available"; event: RegistryEvent; player: CourseResolution["player"];
    round: number; hole: number; eventCourse: RegistryEventCourse;
    assignment: Pick<CourseResolution, "source" | "provenance">;
    revision: RegistryPreparedRevision; preparationId: string; preparationVersion: string;
    capabilities: {
      staticCourse: { status: "available"; assets: RegistryRevisionAsset[] };
      detailedGreen: OptionalGeometryCapability;
      flightReplay: ReplayCapability; suppliedPuttReplay: ReplayCapability;
    };
  }
);

const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const timestamp = (value: unknown): boolean => typeof value === "string" && Number.isFinite(Date.parse(value));
const nonempty = (value: unknown): boolean => typeof value === "string" && !!value.trim();
const stateReasons = {
  pending: "revision_pending", staged: "revision_staged", rejected: "revision_rejected", stale: "revision_stale",
} as const;
const assignmentReasons: Record<string, ShotcastFallbackReason> = {
  event_not_registered: "event_not_registered", missing_assignment: "course_assignment_missing",
  ambiguous_assignment: "course_assignment_ambiguous", unresolved_assignment: "course_assignment_unresolved",
  missing_or_ambiguous_assignment: "course_assignment_unresolved", unknown_course: "course_not_registered",
};

// IDs and paths are the accepted normalizeCourse projection convention, not host fallback.
function staticAssetDefinitions(hole: number): [string, RegistryRevisionAsset["role"], string][] {
  const nn = String(hole).padStart(2, "0");
  return [
    ["course-data", "course-data", "data/courseData.json"],
    ["course-image", "image", "terrain/course.jpg"],
    ["course-world", "world-file", "terrain/course.tfw"],
    [`h${hole}-terrain`, "terrain", `terrain/cutGlb/terrain${nn}.glb`],
    [`h${hole}-image`, "image", `terrain/terrain${nn}.jpg`],
    [`h${hole}-world`, "world-file", `terrain/terrain${nn}.tfw`],
    [`h${hole}-mask`, "mask", `terrain/cutouts/${hole}.png`],
  ];
}

export async function resolveShotcast3DCapability(
  registry: ShotcastCapabilityReader, request: ShotcastCapabilityRequest,
): Promise<Shotcast3DCapability> {
  const unavailable = (reason: ShotcastFallbackReason, detail: string = reason): Shotcast3DCapability =>
    ({ request, status: "unavailable", reason, detail });
  if (!/^R\d{7}$/.test(request.eventId) || !/^\d+$/.test(request.playerId) ||
    !Number.isInteger(request.round) || request.round < 1 || request.round > 4 ||
    !Number.isInteger(request.hole) || request.hole < 1 || request.hole > 18) return unavailable("invalid_request");
  const course = await resolveCourseForPlayerRound(registry, request.eventId, request.playerId, request.round);
  if (course.state !== "authoritative") {
    return unavailable(assignmentReasons[course.reason] ?? "validation_failed", course.reason);
  }
  const { eventCourse, event } = course;
  if (!event || event.season !== Number(request.eventId.slice(1, 5)) ||
    !/^\d{1,8}$/.test(eventCourse.pga_course_id) || !["host", "alternate"].includes(eventCourse.relationship) ||
    eventCourse.scoring_level !== "TOURCAST") return unavailable("validation_failed", "invalid_event_course_metadata");
  const revisions = await registry.readPreparedRevisions(request.eventId, eventCourse.pga_course_id);
  if (!revisions.length) return unavailable("no_prepared_revision");
  if (revisions.some(r => r.pga_event_id !== request.eventId || r.pga_course_id !== eventCourse.pga_course_id ||
    typeof r.is_current !== "boolean" || !parsePreparedRevisionState(r.state))) {
    return unavailable("validation_failed", "invalid_revision_identity_or_state");
  }
  const current = revisions.filter(r => r.is_current === true);
  if (current.length > 1) return unavailable("revision_ambiguous");
  if (!current.length) {
    // A uniform ineligible state gives a useful diagnostic without choosing a revision.
    const states = new Set(revisions.map(r => r.state));
    const state = revisions[0].state;
    return unavailable(states.size === 1 && state !== "validated" ? stateReasons[state] : "revision_not_approved");
  }
  const revision = current[0];
  if (revision.state !== "validated") return unavailable(stateReasons[revision.state]);
  if (!Array.isArray(revision.prepared_holes) || !revision.prepared_holes.length ||
    new Set(revision.prepared_holes).size !== revision.prepared_holes.length ||
    revision.prepared_holes.some(h => !Number.isInteger(h) || h < 1 || h > 18)) {
    return unavailable("validation_failed", "invalid_prepared_holes");
  }
  if (!revision.prepared_holes.includes(request.hole)) return unavailable("hole_not_prepared");
  const proof = revision.validation_proof;
  if (!proof || !timestamp(revision.validated_at)) return unavailable("revision_not_validated");
  if (!selectCurrentPreparedRevision(current, request.eventId, eventCourse.pga_course_id) ||
    !Number.isInteger(proof.comparisons) || !hash(proof.nativeSha256) || !hash(proof.worldSha256) ||
    !hash(proof.reference?.sha256) || !nonempty(proof.reference?.sourceUrl) || !timestamp(proof.reference?.retrievedAt)) {
    return unavailable("validation_failed", "invalid_registration_proof");
  }
  // Presence in prepared_holes alone cannot extend a bounded proof to another hole.
  if (proof.hole !== request.hole) return unavailable("revision_not_validated", "requested_hole_not_validated");
  const expectedRoot = `https://tourcast.pgatour.com/models/${request.eventId}/${eventCourse.relationship === "host" ? "" : `${eventCourse.pga_course_id}/`}3D_Assets/`;
  const id = revision.preparation_id;
  if (!hash(id)) return unavailable("validation_failed", "invalid_preparation_id");
  const expectedPackage = `pga-${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20, 32)}`;
  if (revision.package_id !== expectedPackage || revision.preparation_version !== "1" ||
    revision.registration_profile !== PROFILE.name || revision.engine_version !== PROFILE.version ||
    revision.engine_sha256 !== PROFILE.engineSha256 || !supportedApplicationProfile(revision.application_sha256) ||
    !hash(revision.configuration_sha256) || !hash(revision.configuration_source_sha256) || revision.asset_root !== expectedRoot) {
    return unavailable("validation_failed", "invalid_revision_metadata");
  }
  const assets = await registry.readRevisionAssets(id);
  if (new Set(assets.map(a => a.asset_id)).size !== assets.length || assets.some(a =>
    a.preparation_id !== id || !/^[a-z0-9-]+$/.test(a.asset_id) || !hash(a.sha256) ||
    !["terrain", "green", "image", "world-file", "mask", "course-data"].includes(a.role) ||
    typeof a.source_url !== "string" || !a.source_url.startsWith(expectedRoot))) {
    return unavailable("validation_failed", "invalid_revision_assets");
  }
  const find = ([assetId, role, path]: [string, RegistryRevisionAsset["role"], string]) =>
    assets.find(a => a.asset_id === assetId && a.role === role && a.source_url === expectedRoot + path);
  // Check required metadata for the entire approved revision, then return this hole's assets.
  for (const hole of revision.prepared_holes) {
    if (staticAssetDefinitions(hole).some(definition => !find(definition))) return unavailable("required_assets_missing");
  }
  const greenId = `h${request.hole}-green`;
  const green = find([greenId, "green", `terrain/greens/Green${String(request.hole).padStart(2, "0")}.glb`]);
  if (!green && assets.some(a => a.asset_id === greenId)) return unavailable("validation_failed", "invalid_green_asset_reference");
  return {
    request, status: "available", event, player: course.player, round: request.round, hole: request.hole,
    eventCourse, assignment: { source: course.source, provenance: course.provenance },
    revision, preparationId: id, preparationVersion: revision.preparation_version,
    capabilities: {
      staticCourse: { status: "available", assets: staticAssetDefinitions(request.hole).map(d => find(d)!) },
      detailedGreen: green ? { status: "available", asset: green } : { status: "unavailable", reason: "asset_not_recorded" },
      flightReplay: { status: "unknown", reason: "replay_evidence_not_recorded" },
      suppliedPuttReplay: { status: "unknown", reason: "replay_evidence_not_recorded" },
    },
  };
}
