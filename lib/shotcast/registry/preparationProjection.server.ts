/** Explicit offline/research handoff. Returns metadata rows; never writes or acquires. */
import { declaredCourses, PreparationError, validateEventId, type EventIdentity } from "../preparation/courseIdentity";
import { assignmentFromTeeTimes } from "../preparation/playerRoundCourse.server";
import { validatePreparedCourse, type PreparedCourseManifest } from "../preparation/prepareCourse.server";
import type { Resource } from "../preparation/pgaAcquisition.server";
import type { RegistryAssignment, RegistryEvent, RegistryEventCourse, RegistryPreparedRevision, RegistryRevisionAsset } from "./model";

export function registryRecordsFromTeeTimes(
  event: EventIdentity, teeTimes: Resource, playerId: string, roundNumber: number,
  links: { espnEventId?: string; identityLinkSource?: string; golfPlayerId?: number } = {},
): { event: RegistryEvent; courses: RegistryEventCourse[]; assignment: RegistryAssignment } {
  validateEventId(event.eventId);
  if (!Number.isFinite(Date.parse(teeTimes.evidence.retrievedAt))) throw new PreparationError("invalid_registry_timestamp", "registry");
  if (event.provider !== "pga-tour" || event.season !== Number(event.eventId.slice(1, 5)) ||
    !/^\d+$/.test(playerId) || !Number.isInteger(roundNumber) || roundNumber < 1 || roundNumber > 4 ||
    (links.golfPlayerId !== undefined && (!Number.isSafeInteger(links.golfPlayerId) || links.golfPlayerId <= 0)) ||
    (links.espnEventId !== undefined && (!links.espnEventId.trim() || !links.identityLinkSource?.trim())) ||
    (links.identityLinkSource !== undefined && links.espnEventId === undefined)) throw new PreparationError("invalid_registry_identity", "registry");
  // Reuse the accepted inventory validator, preserving event-scoped aliases.
  declaredCourses(event.courses.map(c => ({ id: c.id, courseName: c.name, hostCourse: c.host, scoringLevel: c.scoringLevel })));
  const assignment: RegistryAssignment = {
    pga_event_id: event.eventId, pga_player_id: playerId, round_number: roundNumber,
    golf_player_id: links.golfPlayerId ?? null, pga_course_id: null, state: "unresolved",
    source: "tee-time-player-round-course", unresolved_reason: null,
    provenance: { inventory: event.inventory, teeTimes: teeTimes.evidence, groups: [] },
    observed_at: teeTimes.evidence.retrievedAt,
  };
  try {
    const resolved = assignmentFromTeeTimes(event, teeTimes, playerId, roundNumber);
    assignment.pga_course_id = resolved.course.id; assignment.state = "authoritative";
    assignment.provenance = resolved.provenance;
  } catch (error) {
    if (!(error instanceof PreparationError)) throw error;
    assignment.unresolved_reason = error.reason;
  }
  return {
    event: { pga_event_id: event.eventId, season: event.season, tournament_name: event.tournamentName,
      espn_event_id: links.espnEventId ?? null, identity_link_source: links.identityLinkSource ?? null,
      schedule_evidence: event.schedule, inventory_evidence: event.inventory },
    courses: event.courses.map(c => ({ pga_event_id: event.eventId, pga_course_id: c.id,
      course_name: c.name, relationship: c.host ? "host" : "alternate", scoring_level: c.scoringLevel })),
    assignment,
  };
}

/** Metadata integrity/registration gates remain owned by accepted preparation code.
 * Validated means the manifest's bounded proof passed; it does not approve delivery.
 * Current selection is deliberately false until an explicit later approval step. */
export function registryRecordsFromPreparedCourse(
  manifest: PreparedCourseManifest, recordedAt: string,
): { revision: RegistryPreparedRevision; assets: RegistryRevisionAsset[]; validation: Pick<RegistryPreparedRevision, "state" | "validation_proof" | "validated_at"> | null } {
  if (!Number.isFinite(Date.parse(recordedAt))) throw new PreparationError("invalid_registry_timestamp", "registry");
  validatePreparedCourse(manifest, !!manifest.registrationProof);
  const proof = manifest.registrationProof;
  return {
    revision: {
      preparation_id: manifest.preparationId, pga_event_id: manifest.identity.eventId, pga_course_id: manifest.identity.courseId,
      preparation_version: manifest.preparationVersion, package_id: manifest.packageId,
      registration_profile: manifest.engine.profile, engine_version: manifest.engine.version,
      engine_sha256: manifest.inputs.engine.sha256, application_sha256: manifest.inputs.application.sha256,
      configuration_sha256: manifest.identity.configurationIdentity, configuration_source_sha256: manifest.configuration.source.sha256,
      asset_root: manifest.identity.assetRoot, prepared_holes: manifest.holes.map(h => h.hole),
      state: "staged", is_current: false, validation_proof: null,
      validated_at: null, state_reason: null, state_changed_at: recordedAt,
    },
    // Persist the staged revision and asset hashes first, then explicitly apply this patch.
    validation: proof ? { state: "validated", validation_proof: proof, validated_at: recordedAt } : null,
    assets: manifest.assets.map(a => ({ preparation_id: manifest.preparationId, asset_id: a.id, role: a.role,
      sha256: a.sha256, source_url: a.sourceUrl! })),
  };
}
