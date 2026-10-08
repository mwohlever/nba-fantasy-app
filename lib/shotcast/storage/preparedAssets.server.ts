import "server-only";
import { createHash } from "node:crypto";
import { hashValue } from "../preparation/prepareCourse.server";
import { resolveShotcast3DCapability, type ShotcastCapabilityReader, type ShotcastCapabilityRequest } from "../registry/capability.server";
import type { RegistryEventCourse, RegistryPreparedRevision, RegistryRevisionAsset } from "../registry/model";

export const PREPARED_ASSET_BUCKET = "shotcast-prepared-private";
export const ASSET_URL_TTL_SECONDS = 60;
export const MAX_ASSET_BYTES = 50 * 1024 * 1024;
export type PreparedStoredAsset = {
  assetId: string; kind: RegistryRevisionAsset["role"]; objectPath: string;
  sha256: string; sizeBytes: number; mediaType: string;
};
/** A delivery index of accepted package assets, not a replacement preparation format. */
export type PreparedAssetManifest = {
  schemaVersion: 1; packageSchemaVersion: 2; preparationId: string;
  preparationVersion: string; hole: number; assets: PreparedStoredAsset[];
};
export type PreparedAssetManifestRecord = {
  preparation_id: string; manifest_sha256: string; manifest: PreparedAssetManifest;
  state: "pending" | "approved" | "rejected" | "stale";
  integrity_verified_at: string | null; approved_at: string | null;
};
export type PreparedAssetStorage = {
  readManifest(preparationId: string): Promise<PreparedAssetManifestRecord | null>;
  stat(objectPath: string): Promise<{ sizeBytes: number; mediaType: string } | null>;
  sign(objectPaths: string[], expiresIn: number): Promise<{ path: string | null; signedUrl: string | null; error: string | null }[]>;
  // Trusted server configuration, never supplied by a client.
  origin: string;
};
export type PreparedAssetRequest = {
  request: ShotcastCapabilityRequest; approvedRevision: Pick<RegistryPreparedRevision, "preparation_id">;
  eventCourse: Pick<RegistryEventCourse, "pga_event_id" | "pga_course_id">; hole: number;
};
export type PreparedAssetDelivery =
  | { status: "unavailable"; reason: "invalid_scope" | "revision_unavailable" | "manifest_unavailable" | "manifest_invalid" | "storage_unavailable" | "unauthorized" }
  | { status: "available"; scope: { eventId: string; courseId: string; playerId: string; round: number; hole: number };
      preparationId: string; preparationVersion: string; manifestId: string;
      expiresAt: string; assets: (PreparedStoredAsset & { signedUrl: string })[] };

const hash = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const exactKeys = (value: object, keys: string[]) => Object.keys(value).sort().join() === [...keys].sort().join();
const mediaTypes: Record<PreparedStoredAsset["kind"], string> = {
  terrain: "model/gltf-binary", green: "model/gltf-binary", image: "image/jpeg",
  "world-file": "text/plain", mask: "image/png", "course-data": "application/json",
};
export function preparedAssetObjectPath(preparationId: string, assetId: string): string {
  if (!hash(preparationId) || !/^[a-z0-9-]{1,64}$/.test(assetId)) throw new Error("Invalid prepared asset identity");
  return `revisions/${preparationId}/${assetId}.bin`;
}

/** Future explicit upload/approval code must verify EVERY object before approving
 * the immutable manifest. Upload with upsert:false; never replace approved bytes.
 * No upload, provider acquisition, or registry mutation happens in this function. */
export function verifyPreparedShotcastAssetBytes(asset: PreparedStoredAsset, bytes: Uint8Array): boolean {
  return hash(asset.sha256) && Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 &&
    asset.sizeBytes <= MAX_ASSET_BYTES && bytes.byteLength === asset.sizeBytes &&
    createHash("sha256").update(bytes).digest("hex") === asset.sha256;
}

function validSignedUrl(value: string, origin: string, path: string, issuedAt: number, now: number): number | null {
  try {
    const url = new URL(value), trusted = new URL(origin);
    if (trusted.protocol !== "https:" || trusted.pathname !== "/" || trusted.search || trusted.hash || trusted.username || trusted.password ||
      url.origin !== trusted.origin || url.username || url.password || url.hash ||
      url.pathname !== `/storage/v1/object/sign/${PREPARED_ASSET_BUCKET}/${path}` ||
      [...url.searchParams.keys()].join() !== "token") return null;
    const token = url.searchParams.get("token")!;
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return null;
    // Storage verifies the signature on download. Here enforce returned token
    // scope/expiry and reject accidental service-role or upload tokens.
    const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    if (claims.url !== `${PREPARED_ASSET_BUCKET}/${path}` || claims.role || claims.upsert !== undefined || claims.owner !== undefined ||
      (claims.scope !== undefined && claims.scope !== "download") || !Number.isInteger(claims.iat) || !Number.isInteger(claims.exp) ||
      claims.exp - claims.iat !== ASSET_URL_TTL_SECONDS || claims.iat < issuedAt - 1 || claims.iat > now + 1 ||
      claims.exp <= now || claims.exp > now + ASSET_URL_TTL_SECONDS + 1) return null;
    return claims.exp;
  } catch { return null; }
}

/** Server-only, after Golf authorization. Re-read current approval; never trust
 * a cached capability, substitute revisions, enumerate storage, or acquire data. */
export async function resolvePreparedShotcastAssets(
  registry: ShotcastCapabilityReader, storage: PreparedAssetStorage, input: PreparedAssetRequest,
): Promise<PreparedAssetDelivery> {
  const unavailable = (reason: Extract<PreparedAssetDelivery, { status: "unavailable" }>["reason"]): PreparedAssetDelivery => ({ status: "unavailable", reason });
  try {
    if (!hash(input.approvedRevision.preparation_id) || input.request.hole !== input.hole ||
      input.eventCourse.pga_event_id !== input.request.eventId) return unavailable("invalid_scope");
    const capability = await resolveShotcast3DCapability(registry, input.request);
    if (capability.status !== "available" || capability.preparationId !== input.approvedRevision.preparation_id ||
      capability.eventCourse.pga_course_id !== input.eventCourse.pga_course_id) return unavailable("revision_unavailable");
    const record = await storage.readManifest(capability.preparationId);
    if (!record || record.state !== "approved" || !record.integrity_verified_at || !record.approved_at) return unavailable("manifest_unavailable");
    const m = record.manifest, required = [...capability.capabilities.staticCourse.assets];
    if (capability.capabilities.detailedGreen.status === "available") required.push(capability.capabilities.detailedGreen.asset);
    if (!m || !exactKeys(m, ["schemaVersion", "packageSchemaVersion", "preparationId", "preparationVersion", "hole", "assets"]) ||
      record.preparation_id !== capability.preparationId || m.preparationId !== capability.preparationId ||
      m.schemaVersion !== 1 || m.packageSchemaVersion !== 2 || m.preparationVersion !== capability.preparationVersion || m.hole !== input.hole ||
      !Number.isFinite(Date.parse(record.integrity_verified_at)) || !Number.isFinite(Date.parse(record.approved_at)) ||
      Date.parse(record.integrity_verified_at) > Date.parse(record.approved_at) ||
      !Array.isArray(m.assets) || m.assets.length !== required.length || m.assets.length > 8 ||
      new Set(m.assets.map(a => a.assetId)).size !== m.assets.length ||
      Buffer.byteLength(JSON.stringify(m)) > 16384 || !hash(record.manifest_sha256) || hashValue(m) !== record.manifest_sha256) return unavailable("manifest_invalid");
    for (const asset of m.assets) {
      const registered = required.find(a => a.asset_id === asset.assetId);
      if (!registered || !exactKeys(asset, ["assetId", "kind", "objectPath", "sha256", "sizeBytes", "mediaType"]) ||
        asset.kind !== registered.role || asset.sha256 !== registered.sha256 || !hash(asset.sha256) ||
        asset.objectPath !== preparedAssetObjectPath(capability.preparationId, registered.asset_id) ||
        !Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes < 1 || asset.sizeBytes > MAX_ASSET_BYTES ||
        asset.mediaType !== mediaTypes[asset.kind]) return unavailable("manifest_invalid");
    }
    // Cheap object metadata checks, bounded to seven/eight exact keys. SHA256 was
    // verified separately at upload time; never download/re-hash binaries here.
    const stats = await Promise.all(m.assets.map(a => storage.stat(a.objectPath)));
    if (stats.some((s, i) => !s || s.sizeBytes !== m.assets[i].sizeBytes || s.mediaType !== m.assets[i].mediaType)) return unavailable("storage_unavailable");
    const issuedAt = Math.floor(Date.now() / 1000);
    const signed = await storage.sign(m.assets.map(a => a.objectPath), ASSET_URL_TTL_SECONDS);
    if (signed.length !== m.assets.length || new Set(signed.map(s => s.path)).size !== signed.length) return unavailable("storage_unavailable");
    const assets: (PreparedStoredAsset & { signedUrl: string })[] = [];
    const expiries: number[] = [];
    for (const asset of m.assets) {
      const entry = signed.find(s => s.path === asset.objectPath);
      const expiry = entry?.signedUrl && !entry.error ? validSignedUrl(entry.signedUrl, storage.origin, asset.objectPath, issuedAt, Math.floor(Date.now() / 1000)) : null;
      if (!expiry || !entry?.signedUrl) return unavailable("storage_unavailable");
      // Project explicitly: never echo arbitrary manifest fields or credentials.
      assets.push({ assetId: asset.assetId, kind: asset.kind, objectPath: asset.objectPath, sha256: asset.sha256,
        sizeBytes: asset.sizeBytes, mediaType: asset.mediaType, signedUrl: entry.signedUrl });
      expiries.push(expiry);
    }
    return { status: "available", scope: { eventId: input.request.eventId, courseId: input.eventCourse.pga_course_id,
      playerId: input.request.playerId, round: input.request.round, hole: input.hole },
      preparationId: capability.preparationId, preparationVersion: capability.preparationVersion,
      manifestId: record.manifest_sha256, expiresAt: new Date(Math.min(...expiries) * 1000).toISOString(), assets };
  } catch { return unavailable("storage_unavailable"); }
}
