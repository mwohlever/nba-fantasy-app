/** Provider-wide metadata. PGA course IDs retain leading zeroes and are event-scoped. */
import type { Evidence } from "../preparation/courseIdentity";
import type { RegistrationProof } from "../preparation/prepareCourse.server";
import type { AssetRef } from "../ingestion/package";

export type RegistryEvent = {
  pga_event_id: string; season: number; tournament_name: string;
  // Explicitly reviewed link to slates.external_event_id (ESPN), shared across Groups.
  espn_event_id: string | null; identity_link_source: string | null;
  schedule_evidence: Evidence; inventory_evidence: Evidence;
};
export type RegistryEventCourse = {
  pga_event_id: string; pga_course_id: string; course_name: string;
  relationship: "host" | "alternate"; scoring_level: string;
};
export type AssignmentProvenance = {
  inventory: Evidence; teeTimes: Evidence;
  groups: { roundNumber: number; groupIndex: number; courseId: string }[];
};
export type RegistryAssignment = {
  pga_event_id: string; pga_player_id: string; round_number: number;
  // Optional explicit bridge, never inferred from a name, ESPN ID or OWGR field.
  golf_player_id: number | null;
  pga_course_id: string | null; state: "authoritative" | "unresolved";
  source: "tee-time-player-round-course"; unresolved_reason: string | null;
  provenance: AssignmentProvenance; observed_at: string;
};
export const PREPARED_REVISION_STATES = ["pending", "staged", "validated", "rejected", "stale"] as const;
export type PreparedRevisionState = typeof PREPARED_REVISION_STATES[number];
export function parsePreparedRevisionState(value: unknown): PreparedRevisionState | null {
  return PREPARED_REVISION_STATES.find(state => state === value) ?? null;
}
export type RegistryPreparedRevision = {
  preparation_id: string; pga_event_id: string; pga_course_id: string;
  preparation_version: string; package_id: string; registration_profile: string;
  engine_version: string; engine_sha256: string; application_sha256: string;
  configuration_sha256: string; configuration_source_sha256: string; asset_root: string;
  prepared_holes: number[];
  state: PreparedRevisionState; is_current: boolean;
  // This is a bounded numeric proof, not a claim of all-hole/round readiness.
  validation_proof: RegistrationProof | null; validated_at: string | null;
  state_reason: string | null; state_changed_at: string;
};
export type RegistryRevisionAsset = {
  preparation_id: string; asset_id: string; role: AssetRef["role"];
  sha256: string; source_url: string;
};

/** Explicit selection only. Never infer currentness from creation time or a host. */
export function selectCurrentPreparedRevision(
  revisions: RegistryPreparedRevision[], eventId: string, courseId: string,
): RegistryPreparedRevision | null {
  const matches = revisions.filter(r => r.pga_event_id === eventId && r.pga_course_id === courseId && r.is_current);
  if (matches.length !== 1) return null;
  const revision = matches[0];
  return parsePreparedRevisionState(revision.state) === "validated" && revision.validation_proof &&
    revision.validation_proof.preparationId === revision.preparation_id &&
    revision.prepared_holes.includes(revision.validation_proof.hole) &&
    revision.validation_proof.toleranceMetres === 1e-8 &&
    Number.isFinite(revision.validation_proof.maximumResidualMetres) &&
    revision.validation_proof.maximumResidualMetres >= 0 && revision.validation_proof.maximumResidualMetres <= 1e-8 &&
    revision.validation_proof.comparisons >= 3 && revision.validated_at && Number.isFinite(Date.parse(revision.validated_at))
    ? revision : null;
}
