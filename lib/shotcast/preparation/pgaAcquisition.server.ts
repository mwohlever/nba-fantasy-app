/** Bounded research acquisition; normalization and delivery do not depend on this transport. */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { array, declaredCourses, PreparationError, record, text, validateEventId, type EventIdentity, type Evidence } from "./courseIdentity";

export type Resource = { bytes: Uint8Array; evidence: Evidence };
export type Acquisition = (url: string, request?: { operation: string; variables: Record<string, unknown>; body: string; headers: Record<string, string> }) => Promise<Resource>;
export const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");
export const json = (r: Resource): Record<string, unknown> => record(JSON.parse(new TextDecoder().decode(r.bytes)));
export const PROFILE = {
  version: "3.3.1" as const, name: "pga-f32-z-up-interior-v1" as const,
  engineUrl: "https://static-assets.pgatour.com/golf-engine/3.3.1/golfEngine.min.js",
  engineSha256: "2a64bbe1e11db7343aab33ca91a357e87139ef0becbbc869d89c73c4a99f3018",
  applicationSha256: "b4e64727f646e6baa8d68f6c3cae308c25eb86c039d9869b6bf998ca12a225cd",
};

/** Exact reviewed bundles only. 2026-10-07 was checked with the original PGA
 * webpack converter and unchanged 3.3.1 grounding engine; see Phase 4C evidence.
 * An unknown rebundle still fails closed. Keep the Phase 4B fingerprint valid. */
export const REVIEWED_APPLICATION_HASHES: readonly string[] = [
  PROFILE.applicationSha256,
  "09870190bcc511bcd988a7bee22edd9758a0640fa52019bb2e0d00f388232811",
];
export const supportedApplicationProfile = (hash: string): boolean => REVIEWED_APPLICATION_HASHES.includes(hash);

/** No credentials are logged or persisted in request evidence; no redirects/access bypass. */
export const publicPgaAcquisition: Acquisition = async (url, request) => {
  if (process.env.NODE_ENV === "production") throw new PreparationError("research_acquisition_disabled", "acquisition");
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.port || parsed.username || parsed.password || !["tourcast.pgatour.com", "static-assets.pgatour.com", "data-api.pgatour.com", "orchestrator.pgatour.com"].includes(parsed.hostname)) throw new PreparationError("unsupported_source", "acquisition");
  const response = await fetch(url, { method: request ? "POST" : "GET", headers: request?.headers, body: request?.body, redirect: "error", signal: AbortSignal.timeout(30000), cache: "no-store" });
  if (!response.ok) { await response.body?.cancel(); throw new PreparationError("provider_http_failure", "acquisition", url, response.status); }
  const maximum = 24 * 1024 * 1024;
  if (!response.body || Number(response.headers.get("content-length")) > maximum) { await response.body?.cancel(); throw new PreparationError("asset_size_limit", "acquisition", url); }
  const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > maximum) { await reader.cancel(); throw new PreparationError("asset_size_limit", "acquisition", url); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let cursor = 0;
  for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
  return { bytes, evidence: { sourceUrl: url, sha256: sha256(bytes), retrievedAt: new Date().toISOString(), ...(request ? { operation: request.operation, variables: request.variables } : {}) } };
};

export function verifyResource(resource: Resource, url: string): void {
  if (resource.evidence.sourceUrl !== url || resource.evidence.sha256 !== sha256(resource.bytes) || !Number.isFinite(Date.parse(resource.evidence.retrievedAt))) throw new PreparationError("source_integrity_failure", "integrity", url);
}

/** Parse JSON Flight records. Never execute/evaluate JavaScript from the provider. */
export function parseBootstrap(html: string): Record<string, unknown> {
  let flight = "";
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) {
    const script = match[1].trim(), prefix = "self.__next_f.push(";
    if (!script.startsWith(prefix)) continue;
    const row = array(JSON.parse(script.slice(prefix.length).replace(/\);?$/, "")));
    if (row[0] === 1 && typeof row[1] === "string") flight += row[1];
  }
  const configs = new Map<string, Record<string, unknown>>();
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) { v.forEach(visit); return; }
    if (!v || typeof v !== "object") return;
    const obj = record(v);
    if (obj.configData) { const c = record(obj.configData); configs.set(JSON.stringify(c), c); }
    Object.values(obj).forEach(visit);
  };
  for (const line of flight.split("\n")) {
    const m = /^[a-f0-9]+:(.*)$/.exec(line);
    if (m && /^[\[{]/.test(m[1])) visit(JSON.parse(m[1]));
  }
  if (configs.size !== 1) throw new PreparationError("missing_or_ambiguous_config", "discovery");
  return [...configs.values()][0];
}

export type DiscoveredEvent = { identity: EventIdentity; config: Record<string, unknown>; resources: Record<string, Resource>; acquire: Acquisition };
export async function discoverEvent(eventId: string, acquire: Acquisition = publicPgaAcquisition): Promise<DiscoveredEvent> {
  validateEventId(eventId);
  const definitions = {
    bootstrap: `https://tourcast.pgatour.com/tourcast.html?id=${eventId}`,
    leaderboard: `https://data-api.pgatour.com/leaderboard/${eventId}`,
    schedule: `https://data-api.pgatour.com/schedule/R/${eventId.slice(1, 5)}`,
  };
  const resources: Record<string, Resource> = {};
  const results = await Promise.allSettled(Object.entries(definitions).map(async ([key, url]) => {
    const r = await acquire(url); verifyResource(r, url); resources[key] = r;
  }));
  const failure = results.find(r => r.status === "rejected"); if (failure?.status === "rejected") throw failure.reason;
  const html = new TextDecoder().decode(resources.bootstrap.bytes), config = parseBootstrap(html);
  const leaderboard = json(resources.leaderboard), schedule = json(resources.schedule);
  if (config.enabled !== true || leaderboard.tournamentId !== eventId || leaderboard.subEvent === true || leaderboard.formatType !== "STROKE_PLAY") throw new PreparationError("unsupported_event", "discovery");
  const tournaments = array(schedule.tournaments).map(record).filter(t => t.tournamentId === eventId);
  if (tournaments.length !== 1) throw new PreparationError("missing_or_ambiguous_tournament", "identity");
  const engines = new Set([...html.matchAll(/https:\/\/static-assets\.pgatour\.com\/golf-engine\/[^"\s<>\\]+/g)].map(m => m[0]).filter(u => u.endsWith("golfEngine.min.js")));
  const apps = [...html.matchAll(/src="([^"]+)"/g)].map(m => m[1]).filter(u => /\/app\/(?:%5B|\[)product(?:%5D|\])\/page-.*\.js/.test(u));
  if (engines.size !== 1 || !engines.has(PROFILE.engineUrl) || apps.length !== 1) throw new PreparationError("unsupported_profile", "profile");
  for (const [key, url] of [["engine", PROFILE.engineUrl], ["application", new URL(apps[0], definitions.bootstrap).href]]) {
    resources[key] = await acquire(url); verifyResource(resources[key], url);
  }
  if (resources.engine.evidence.sha256 !== PROFILE.engineSha256 || !supportedApplicationProfile(resources.application.evidence.sha256)) throw new PreparationError("unsupported_profile", "profile");
  return { identity: { provider: "pga-tour", eventId, season: Number(eventId.slice(1, 5)), tournamentName: text(tournaments[0].name), courses: declaredCourses(leaderboard.courses), schedule: resources.schedule.evidence, inventory: resources.leaderboard.evidence }, config, resources, acquire };
}

export async function graphql(event: DiscoveredEvent, operation: string, query: string, variables: Record<string, unknown>): Promise<Resource> {
  const endpoint = record(event.config.endpoints), url = text(endpoint.graphqlHostname);
  if (url !== "https://orchestrator.pgatour.com/graphql") throw new PreparationError("unsupported_graphql_endpoint", "discovery");
  const resource = await event.acquire(url, { operation, variables, body: JSON.stringify({ operationName: operation, query, variables }), headers: { "Content-Type": "application/json", "x-api-key": text(endpoint.graphqlKey), "x-pgat-platform": "web", Origin: "https://www.pgatour.com", Referer: "https://www.pgatour.com/" } });
  verifyResource(resource, url);
  if (json(resource).errors) throw new PreparationError("provider_graphql_failure", "acquisition", url);
  return resource;
}

export function acquireTeeTimes(event: DiscoveredEvent): Promise<Resource> {
  return graphql(event, "GetTeeTimes", "query GetTeeTimes($id: ID!) { teeTimes(id: $id) { id rounds { roundInt groups { courseId players { id } } } } }", { id: event.identity.eventId });
}

export async function acquireNativeShots(event: DiscoveredEvent, playerId: string, round: number): Promise<{ response: Resource; native: Resource }> {
  if (!/^\d+$/.test(playerId) || !Number.isInteger(round) || round < 1 || round > 4) throw new PreparationError("invalid_player_round", "shots");
  const response = await graphql(event, "ShotDetailsCompressedV3", "query ShotDetailsCompressedV3($tournamentId: ID!, $playerId: ID!, $round: Int!, $includeRadar: Boolean) { shotDetailsCompressedV3(tournamentId: $tournamentId, playerId: $playerId, round: $round, includeRadar: $includeRadar) { id payload } }", { tournamentId: event.identity.eventId, playerId, round, includeRadar: true });
  const envelope = record(record(json(response).data).shotDetailsCompressedV3);
  const bytes = new Uint8Array(gunzipSync(Buffer.from(text(envelope.payload), "base64"), { maxOutputLength: 24 * 1024 * 1024 }));
  const native = { bytes, evidence: { ...response.evidence, sha256: sha256(bytes) } };
  const body = json(native);
  if (body.id !== envelope.id || body.tournamentId !== event.identity.eventId || body.playerId !== playerId || body.round !== round) throw new PreparationError("shot_identity_mismatch", "shots");
  return { response, native };
}
