/** Course-only normalization. Acquisition is injected; no storage or renderer ownership. */
import type { PreparedCourseDescriptor } from "../ingestion/prepared";
import type { AssetRef } from "../ingestion/package";
import { decodeTerrainGlb, worldFileUv, type Point3 } from "../productionGeometry";
import { buildHoleWorld, type HoleWorld } from "../holeWorld";
import { parseStaticPlayerHole, type StaticPlayerHole } from "../shotcast3dView";
import { array, courseIdentity, effectiveConfiguration, PreparationError, record, resolvePlayedCourse, selectEventCourse, text, type CourseIdentity, type EventIdentity, type Evidence } from "./courseIdentity";
import { acquireTeeTimes, discoverEvent, json, parseBootstrap, PROFILE, sha256, supportedApplicationProfile, verifyResource, type Acquisition, type DiscoveredEvent, type Resource } from "./pgaAcquisition.server";

export type PreparationCapabilities = { course3d: boolean; detailedGreen: boolean; registrationValidated: boolean; shotCoordinates: boolean; pin: boolean; radarFlight: boolean; simulatedPutt: boolean };
export type RegistrationProof = {
  preparationId: string; hole: number; reference: Evidence; nativeSha256: string;
  worldSha256: string; comparisons: number; maximumResidualMetres: number; toleranceMetres: 1e-8;
};
export type PreparedCourseManifest = PreparedCourseDescriptor & {
  schemaVersion: 2; kind: "pga-course-preparation"; preparationVersion: "1";
  preparationId: string; identity: CourseIdentity; eventIdentity: EventIdentity;
  inputs: Record<string, Evidence>; holeCapabilities: Record<string, PreparationCapabilities>;
  registrationProof: RegistrationProof | null;
};
export type PreparedCandidate = { manifest: PreparedCourseManifest; resources: Record<string, Resource>; discovery: DiscoveredEvent };
export type PreparationResult = { status: "prepared"; candidate: PreparedCandidate } | { status: "unsupported"; reason: string; stage: string; sourceUrl?: string; httpStatus?: number };

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
export const hashValue = (value: unknown): string => sha256(new TextEncoder().encode(canonicalJson(value)));
const packageIdFor = (hash: string): string => `pga-${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
function revision(manifest: Pick<PreparedCourseManifest, "identity" | "configuration" | "assets" | "holes" | "inputs">): string {
  return hashValue({ version: "1", identity: manifest.identity, configuration: manifest.configuration.rawConfig,
    engine: manifest.inputs.engine.sha256, application: manifest.inputs.application.sha256,
    assets: manifest.assets.map(a => ({ id: a.id, role: a.role, sha256: a.sha256 })).sort((a, b) => a.id.localeCompare(b.id)), holes: manifest.holes });
}

function inspectAsset(role: AssetRef["role"], resource: Resource): void {
  const bytes = resource.bytes;
  if (role === "terrain" || role === "green") {
    const primitives = decodeTerrainGlb(bytes.slice().buffer);
    if (primitives.some(p => !p.positions.every(Number.isFinite) || (p.normals && !p.normals.every(Number.isFinite))) || (role === "green" && primitives.some(p => !p.normals))) throw new PreparationError("invalid_mesh", "normalization");
    const doc = record(JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true)))));
    if (doc.extensionsRequired && array(doc.extensionsRequired).length) throw new PreparationError("unsupported_glb_extension", "normalization");
    for (const entry of [...array(doc.buffers), ...(doc.images ? array(doc.images) : [])]) {
      const uri = record(entry).uri;
      if (uri !== undefined && !text(uri).startsWith("data:")) throw new PreparationError("external_glb_dependency", "normalization");
    }
  } else if (role === "world-file") worldFileUv(new TextDecoder().decode(bytes), 0, 0);
  else if (role === "course-data") json(resource);
  else if (role === "image" && (bytes[0] !== 255 || bytes[1] !== 216)) throw new PreparationError("invalid_image", "normalization");
  else if (role === "mask" && ![137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) throw new PreparationError("invalid_mask", "normalization");
}

/** Deterministic content identity excludes retrieval clocks and unrelated schedule changes. */
export function normalizeCourse(event: DiscoveredEvent, courseId: string | undefined, holes: number[], assetResources: Record<string, { role: AssetRef["role"]; resource: Resource }>, teeTimes: Resource): PreparedCandidate {
  const course = selectEventCourse(event.identity, courseId), config = effectiveConfiguration(event.config.offsetConfig, course);
  const identity = courseIdentity(event.identity, course, hashValue(config.rawConfig));
  const resources: Record<string, Resource> = { ...event.resources, "tee-times": teeTimes };
  const assets: AssetRef[] = [];
  for (const [id, { role, resource }] of Object.entries(assetResources).sort(([a], [b]) => a.localeCompare(b))) {
    verifyResource(resource, resource.evidence.sourceUrl);
    if (!resource.evidence.sourceUrl.startsWith(identity.assetRoot)) throw new PreparationError("asset_course_mismatch", "normalization");
    inspectAsset(role, resource); resources[id] = resource;
    assets.push({ id, role, identifier: id, localPath: "", sha256: resource.evidence.sha256, sourceUrl: resource.evidence.sourceUrl });
  }
  const inputs = Object.fromEntries(Object.entries(resources).map(([id, r]) => [id, r.evidence]));
  const holeAssets = holes.map(hole => {
    const prefix = `h${hole}-`;
    return { hole, terrain: `${prefix}terrain`, imagery: `${prefix}image`, worldFile: `${prefix}world`, mask: `${prefix}mask`, ...(assetResources[`${prefix}green`] ? { green: `${prefix}green` } : {}) };
  });
  const manifest: PreparedCourseManifest = {
    schemaVersion: 2, kind: "pga-course-preparation", preparationVersion: "1", preparationId: "", packageId: "",
    identity, eventIdentity: event.identity, event: { id: identity.eventId, name: identity.tournamentName, course: { id: course.id, name: course.name, identitySource: event.identity.inventory.sourceUrl }, assetRoot: identity.assetRoot },
    engine: { version: PROFILE.version, profile: PROFILE.name, source: PROFILE.engineUrl },
    configuration: { ...config, ...(config.selection === "course-override" ? { courseId: course.id } : {}), source: { identifier: "bootstrap", localPath: "", sha256: inputs.bootstrap.sha256, sourceUrl: inputs.bootstrap.sourceUrl } },
    assets, courseAssets: { imagery: "course-image", worldFile: "course-world", data: "course-data" }, holes: holeAssets, inputs,
    holeCapabilities: Object.fromEntries(holes.map(hole => [String(hole), { course3d: false, detailedGreen: !!assetResources[`h${hole}-green`], registrationValidated: false, shotCoordinates: false, pin: false, radarFlight: false, simulatedPutt: false }])),
    registrationProof: null,
  };
  manifest.preparationId = revision(manifest); manifest.packageId = packageIdFor(manifest.preparationId);
  const directory = `tmp/shotcast-ingestion/packages/${manifest.packageId}`;
  manifest.assets.forEach(a => { a.localPath = `${directory}/${a.id}.bin`; });
  manifest.configuration.source.localPath = `${directory}/bootstrap.bin`;
  validatePreparedCourse(manifest, false);
  return { manifest, resources, discovery: event };
}

/** A bounded hole list is explicit: this proof never downloads an entire course library. */
export async function prepareCourseForEvent(request: { eventId: string; courseId?: string; holes: number[] }, acquire?: Acquisition): Promise<PreparationResult> {
  try {
    if (!request.holes.length || request.holes.length > 18 || request.holes.some(h => !Number.isInteger(h) || h < 1 || h > 18) || new Set(request.holes).size !== request.holes.length) throw new PreparationError("invalid_holes", "identity");
    const holes = [...request.holes].sort((a, b) => a - b), event = await discoverEvent(request.eventId, acquire);
    const course = selectEventCourse(event.identity, request.courseId);
    effectiveConfiguration(event.config.offsetConfig, course);
    const root = courseIdentity(event.identity, course, "").assetRoot;
    const definitions: [string, AssetRef["role"], string][] = [
      ["course-image", "image", "terrain/course.jpg"], ["course-world", "world-file", "terrain/course.tfw"], ["course-data", "course-data", "data/courseData.json"],
      ...holes.flatMap(h => {
        const nn = String(h).padStart(2, "0");
        return [[`h${h}-terrain`, "terrain", `terrain/cutGlb/terrain${nn}.glb`], [`h${h}-image`, "image", `terrain/terrain${nn}.jpg`], [`h${h}-world`, "world-file", `terrain/terrain${nn}.tfw`], [`h${h}-mask`, "mask", `terrain/cutouts/${h}.png`], [`h${h}-green`, "green", `terrain/greens/Green${nn}.glb`]] as [string, AssetRef["role"], string][];
      }),
    ];
    const assetResources: Parameters<typeof normalizeCourse>[3] = {};
    const results = await Promise.allSettled(definitions.map(async ([id, role, path]) => {
      try { const resource = await event.acquire(root + path); verifyResource(resource, root + path); assetResources[id] = { role, resource }; }
      catch (e) { if (role === "green" && e instanceof PreparationError && e.status === 404) return; throw e; }
    }));
    const failure = results.find(r => r.status === "rejected"); if (failure?.status === "rejected") throw failure.reason;
    const teeTimes = await acquireTeeTimes(event);
    if (record(record(json(teeTimes).data).teeTimes).id !== event.identity.eventId) throw new PreparationError("assignment_event_mismatch", "assignment");
    return { status: "prepared", candidate: normalizeCourse(event, course.id, holes, assetResources, teeTimes) };
  } catch (e) {
    return e instanceof PreparationError ? { status: "unsupported", reason: e.reason, stage: e.stage, sourceUrl: e.sourceUrl, httpStatus: e.status } : { status: "unsupported", reason: "invalid_or_unavailable_provider_input", stage: "preparation" };
  }
}

/** Strict course-only reader. Legacy accepted descriptors keep their original validator. */
export function validatePreparedCourse(value: unknown, requireValidated = true): asserts value is PreparedCourseManifest {
  const m = value as PreparedCourseManifest;
  if (!m || m.schemaVersion !== 2 || m.kind !== "pga-course-preparation" || m.preparationVersion !== "1") throw new PreparationError("invalid_prepared_schema", "manifest");
  const course = selectEventCourse(m.eventIdentity, m.identity.courseId), config = effectiveConfiguration(m.configuration.rawConfig, course);
  const identity = courseIdentity(m.eventIdentity, course, hashValue(config.rawConfig));
  if (canonicalJson(identity) !== canonicalJson(m.identity) || canonicalJson(config.offset) !== canonicalJson(m.configuration.offset) || config.selection !== m.configuration.selection || (config.selection === "course-override" && m.configuration.courseId !== course.id) || m.event.id !== identity.eventId || m.event.course.id !== course.id || m.event.course.name !== course.name || m.event.assetRoot !== identity.assetRoot) throw new PreparationError("prepared_identity_or_transform_mismatch", "manifest");
  if (m.engine.version !== PROFILE.version || m.engine.profile !== PROFILE.name || m.inputs.engine.sha256 !== PROFILE.engineSha256 || !supportedApplicationProfile(m.inputs.application.sha256) || m.configuration.source.sha256 !== m.inputs.bootstrap.sha256) throw new PreparationError("unsupported_profile", "manifest");
  if (!Array.isArray(m.assets) || !m.assets.length || new Set(m.assets.map(a => a.id)).size !== m.assets.length || !m.holes.length || new Set(m.holes.map(h => h.hole)).size !== m.holes.length) throw new PreparationError("invalid_assets_or_holes", "manifest");
  const directory = `tmp/shotcast-ingestion/packages/${m.packageId}`;
  for (const a of m.assets) {
    if (!/^[a-z0-9-]+$/.test(a.id) || !/^[a-f0-9]{64}$/.test(a.sha256) || a.localPath !== `${directory}/${a.id}.bin` || !a.sourceUrl?.startsWith(identity.assetRoot) || a.sha256 !== m.inputs[a.id]?.sha256 || a.sourceUrl !== m.inputs[a.id]?.sourceUrl) throw new PreparationError("invalid_asset_reference", "manifest");
  }
  if (m.configuration.source.localPath !== `${directory}/bootstrap.bin`) throw new PreparationError("invalid_config_reference", "manifest");
  const requireAsset = (id: string, role: AssetRef["role"]) => { if (!m.assets.some(a => a.id === id && a.role === role)) throw new PreparationError("missing_required_asset", "manifest"); };
  requireAsset(m.courseAssets.imagery, "image"); requireAsset(m.courseAssets.worldFile, "world-file"); requireAsset(m.courseAssets.data, "course-data");
  for (const h of m.holes) {
    if (!Number.isInteger(h.hole) || h.hole < 1 || h.hole > 18) throw new PreparationError("invalid_holes", "manifest");
    requireAsset(h.terrain, "terrain"); requireAsset(h.imagery, "image"); requireAsset(h.worldFile, "world-file"); requireAsset(h.mask, "mask"); if (h.green) requireAsset(h.green, "green");
  }
  if (m.preparationId !== revision(m) || m.packageId !== packageIdFor(m.preparationId)) throw new PreparationError("preparation_integrity_failure", "manifest");
  if (requireValidated) {
    const proof = m.registrationProof;
    if (!proof || proof.preparationId !== m.preparationId || proof.toleranceMetres !== 1e-8 || !Number.isFinite(proof.maximumResidualMetres) || proof.maximumResidualMetres < 0 || proof.maximumResidualMetres > proof.toleranceMetres || proof.comparisons < 3 || !/^[a-f0-9]{64}$/.test(proof.reference.sha256) || !/^[a-f0-9]{64}$/.test(proof.nativeSha256) || !/^[a-f0-9]{64}$/.test(proof.worldSha256) || m.holes.some(h => h.hole !== proof.hole) || m.holes.some(h => !m.holeCapabilities[String(h.hole)]?.registrationValidated)) throw new PreparationError("registration_not_validated", "manifest");
  }
}

export function resolveCandidateWorld(candidate: PreparedCandidate, value: unknown): HoleWorld {
  const replay = parseStaticPlayerHole(value), m = candidate.manifest;
  validatePreparedCourse(m, false);
  const bootstrap = candidate.resources.bootstrap;
  verifyResource(bootstrap, m.inputs.bootstrap.sourceUrl);
  if (bootstrap.evidence.sha256 !== m.configuration.source.sha256 || canonicalJson(parseBootstrap(new TextDecoder().decode(bootstrap.bytes)).offsetConfig) !== canonicalJson(m.configuration.rawConfig)) throw new PreparationError("configuration_source_mismatch", "registration");
  for (const asset of m.assets) {
    const resource = candidate.resources[asset.id];
    if (!resource) throw new PreparationError("missing_required_asset", "registration");
    verifyResource(resource, asset.sourceUrl!);
    if (resource.evidence.sha256 !== asset.sha256) throw new PreparationError("asset_revision_mismatch", "registration");
  }
  if (!replay || replay.tournamentId !== m.identity.eventId) throw new PreparationError("invalid_shot_identity", "registration");
  if (resolvePlayedCourse(m.eventIdentity, json(candidate.resources["tee-times"]), replay.pgaPlayerId, replay.roundNumber).id !== m.identity.courseId) throw new PreparationError("wrong_played_course", "registration");
  const points = [replay.pin, ...replay.shots.flatMap(s => [s.from, s.to])];
  if (points.some(p => [p.tourcastX, p.tourcastY, p.tourcastZ].every(n => n === -1) || [p.tourcastX, p.tourcastY, p.tourcastZ].every(n => n === 0))) throw new PreparationError("placeholder_coordinates", "registration");
  const h = m.holes.find(h => h.hole === replay.holeNumber); if (!h) throw new PreparationError("unprepared_hole", "registration");
  const terrain = decodeTerrainGlb(candidate.resources[h.terrain].bytes.slice().buffer);
  const green = h.green ? decodeTerrainGlb(candidate.resources[h.green].bytes.slice().buffer) : [];
  const world = buildHoleWorld(replay, m.configuration.offset, terrain, green);
  if (!world || (h.green && !world.greenBounds)) throw new PreparationError("unregistered_shots_or_pin", "registration");
  return world;
}

/** Reference expectations must be independently obtained, never fit/tuned here. */
export function validateRegistration(candidate: PreparedCandidate, replay: StaticPlayerHole, expected: { tee: Point3; pin: Point3; shots: { strokeNumber: number; from: Point3; endpoint: Point3 }[] }, reference: Evidence, nativeSha256: string): HoleWorld {
  const world = resolveCandidateWorld(candidate, replay), actual = [world.tee, world.pin, ...world.shots.flatMap(s => [s.from, s.endpoint])];
  const target = [expected.tee, expected.pin, ...expected.shots.flatMap(s => [s.from, s.endpoint])];
  if (world.shots.length !== expected.shots.length || world.shots.some((s, i) => s.strokeNumber !== expected.shots[i].strokeNumber) || actual.length !== target.length || target.some(p => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite))) throw new PreparationError("reference_identity_mismatch", "registration");
  const maximumResidualMetres = Math.max(...actual.map((p, i) => Math.hypot(...p.map((n, axis) => n - target[i][axis]))));
  if (maximumResidualMetres > 1e-8) throw new PreparationError("registration_mismatch", "registration");
  candidate.manifest.registrationProof = { preparationId: candidate.manifest.preparationId, hole: replay.holeNumber, reference, nativeSha256, worldSha256: hashValue(world), comparisons: actual.length, maximumResidualMetres, toleranceMetres: 1e-8 };
  candidate.manifest.holeCapabilities[String(replay.holeNumber)] = { ...candidate.manifest.holeCapabilities[String(replay.holeNumber)], course3d: true, registrationValidated: true, shotCoordinates: true, pin: true };
  validatePreparedCourse(candidate.manifest);
  return world;
}
