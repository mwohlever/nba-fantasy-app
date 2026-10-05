/**
 * DEVELOPMENT / EXPERIMENTAL local ShotCast asset adapter.
 * Reads existing hash-checked research packages; never fetches PGA upstream,
 * writes files, or exposes this path from a production build. Replace this
 * adapter with an approved asset resolver before deploying 3D distribution.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { PREPARED_DIRECTORY, readPreparedCourseDescriptor, type PreparedCourseDescriptor } from "./ingestion/prepared";
import { readPreserved } from "./ingestion/local";
import { convertNativePoint, decodeTerrainGlb, surfaceHeight, worldFileUv } from "./productionGeometry";
import { buildFlightPath, type FlightPath } from "./flightReplay";
import { buildPuttPath, type PuttPath } from "./puttReplay";
import { createGreenTopography } from "./greenTopography";
import { buildHoleWorld } from "./holeWorld";
import { parseStaticPlayerHole, type Shotcast3DView } from "./shotcast3dView";

export type ShotcastSelection = { tournamentId: string; pgaPlayerId: string; roundNumber: number; holeNumber: number };

const packageIdPattern = /^pga-[a-f0-9-]{36}$/;
const source = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid preserved source");
  return value as Record<string, unknown>;
};

export function isVerifiedPlayedCourse(teeTimes: unknown, playerId: string, round: number, courseId: string): boolean {
  const root = source(teeTimes);
  const rounds = source(source(root.data).teeTimes).rounds;
  if (!Array.isArray(rounds)) return false;
  const matches = new Set<string>();
  for (const candidate of rounds) {
    const item = source(candidate);
    if (item.roundInt !== round || !Array.isArray(item.groups)) continue;
    for (const groupValue of item.groups) {
      const group = source(groupValue);
      if (!Array.isArray(group.players)) continue;
      if (group.players.some(player => source(player).id === playerId)) {
        if (typeof group.courseId !== "string" || !group.courseId.trim()) return false;
        matches.add(group.courseId);
      }
    }
  }
  return matches.size === 1 && matches.has(courseId);
}

export function matchingPreparedDescriptor(descriptors: PreparedCourseDescriptor[], selection: ShotcastSelection, verifiedCourseId: string): PreparedCourseDescriptor | null {
  const matches = descriptors.filter(descriptor =>
    descriptor.event.id === selection.tournamentId &&
    Number.isInteger(selection.roundNumber) && selection.roundNumber >= 1 && selection.roundNumber <= 4 &&
    descriptor.engine.version === "3.3.1" &&
    descriptor.engine.profile === "pga-f32-z-up-interior-v1" &&
    descriptor.event.course.id === verifiedCourseId &&
    (!descriptor.configuration.courseId || descriptor.configuration.courseId === verifiedCourseId) &&
    descriptor.holes.some(hole => hole.hole === selection.holeNumber),
  );
  // Two prepared revisions for the same context are ambiguous until explicitly selected.
  return matches.length === 1 ? matches[0] : null;
}

async function descriptors(): Promise<PreparedCourseDescriptor[]> {
  let ids: string[];
  try { ids = await readdir(/*turbopackIgnore: true*/ path.join(process.cwd(), PREPARED_DIRECTORY)); }
  catch { return []; }
  const results = await Promise.allSettled(ids.filter(id => packageIdPattern.test(id)).map(readPreparedCourseDescriptor));
  return results.flatMap(result => result.status === "fulfilled" ? [result.value] : []);
}

async function verifiedTeeTimes(descriptor: PreparedCourseDescriptor, selection: ShotcastSelection): Promise<boolean> {
  const filename = path.join(process.cwd(), PREPARED_DIRECTORY, descriptor.packageId, "provenance.json");
  const provenance = source(JSON.parse(await readFile(/*turbopackIgnore: true*/ filename, "utf8")));
  const inputs = source(provenance.inputs), teeRef = source(inputs["tee-times"]);
  if (typeof teeRef.sha256 !== "string" || typeof teeRef.sourceUrl !== "string") return false;
  const relative = `${PREPARED_DIRECTORY}/${descriptor.packageId}/tee-times.bin`;
  const bytes = await readPreserved({ localPath: relative, sha256: teeRef.sha256, identifier: "tee-times" });
  const teeTimes = JSON.parse(new TextDecoder().decode(bytes));
  if (source(source(source(teeTimes).data).teeTimes).id !== selection.tournamentId) return false;
  return isVerifiedPlayedCourse(teeTimes, selection.pgaPlayerId, selection.roundNumber, descriptor.event.course.id ?? "");
}

function assetUrl(packageId: string, assetId: string): string {
  return `/api/golf/shotcast-3d-dev?package=${encodeURIComponent(packageId)}&asset=${encodeURIComponent(assetId)}`;
}

export async function resolveDevelopmentShotcast(value: unknown): Promise<Shotcast3DView | null> {
  if (process.env.NODE_ENV !== "development") return null;
  const replay = parseStaticPlayerHole(value);
  if (!replay) return null;
  const selection = replay;
  // Each candidate must independently verify the CURRENT player's course assignment.
  const candidates = (await descriptors()).filter(d => d.event.id === selection.tournamentId && d.holes.some(h => h.hole === selection.holeNumber));
  const verified = await Promise.allSettled(candidates.map(async d => await verifiedTeeTimes(d, selection) ? d : null));
  const eligible = verified.flatMap(result => result.status === "fulfilled" && result.value ? [result.value] : []);
  if (eligible.length !== 1) return null;
  const descriptor = matchingPreparedDescriptor(eligible, selection, eligible[0].event.course.id ?? "");
  if (!descriptor) return null;
  // Validate original configuration/course metadata hashes, but never load player research.
  const courseData = descriptor.assets.find(asset => asset.id === descriptor.courseAssets.data);
  if (!courseData) return null;
  await Promise.all([readPreserved(descriptor.configuration.source), readPreserved(courseData)]);
  const hole = descriptor.holes.find(item => item.hole === selection.holeNumber);
  if (!hole) return null;
  const byId = (id: string) => {
    const asset = descriptor.assets.find(item => item.id === id);
    if (!asset) throw new Error("Prepared asset absent");
    return asset;
  };
  const required = [hole.terrain, hole.imagery, hole.mask, hole.worldFile, descriptor.courseAssets.imagery, descriptor.courseAssets.worldFile];
  const bytes = await Promise.all(required.map(id => readPreserved(byId(id))));
  const terrain = decodeTerrainGlb(bytes[0].slice().buffer);
  const green = hole.green ? decodeTerrainGlb((await readPreserved(byId(hole.green))).slice().buffer) : [];
  if (bytes[1][0] !== 255 || bytes[1][1] !== 216 || bytes[4][0] !== 255 || bytes[4][1] !== 216 || bytes[2][0] !== 137 || bytes[2][1] !== 80) throw new Error("Invalid prepared imagery");
  const holeWorld = new TextDecoder().decode(bytes[3]), courseWorld = new TextDecoder().decode(bytes[5]);
  worldFileUv(holeWorld, terrain[0].positions[0], terrain[0].positions[1]);
  worldFileUv(courseWorld, terrain[0].positions[0], terrain[0].positions[1]);
  const world = buildHoleWorld(replay, descriptor.configuration.offset, terrain, green);
  if (!world) return null;
  const flightPaths: FlightPath[] = [];
  // Optional current-player flight inputs. Any unsupported flight stays static;
  // the verified frozen hole and existing 2D playback remain available.
  const flightData = source(value).flightData;
  if (flightData && typeof flightData === "object") {
    const input = flightData as import("./shotcast3dView").PlayerFlightInput;
    try {
      const fairway = convertNativePoint(input.fairway, descriptor.configuration.offset);
      if (Array.isArray(input.shots)) for (const shot of world.shots) {
        const matches = input.shots.filter(candidate => candidate.strokeNumber === shot.strokeNumber);
        if (matches.length !== 1) continue;
        const fit = matches[0].trajectory;
        if (fit?.representation !== "single-flight-no-impact-v1" || fit.kind?.toLowerCase() !== "flight") continue;
        try {
          flightPaths.push(buildFlightPath(shot.strokeNumber, { xFit: fit.xFit, yFit: fit.yFit, zFit: fit.zFit, type: fit.type ?? "", timeInterval: [fit.timeStart, fit.timeEnd] },
            world.tee, shot.from, shot.endpoint, fairway, (x, y) => surfaceHeight(terrain, x, y)));
        } catch { /* Unsupported source branch/constraint: retain static endpoints. */ }
      }
    } catch { /* Missing/invalid current orientation never changes registration. */ }
  }
  const puttPaths: PuttPath[] = [];
  const puttData = source(value).puttData as import("./shotcast3dView").PlayerPuttInput | undefined;
  if (green.length && Array.isArray(puttData)) {
    const topo = createGreenTopography(green);
    for (const shot of world.shots) {
      const matches = puttData.filter(p => p.strokeNumber === shot.strokeNumber);
      if (matches.length !== 1) continue;
      try { puttPaths.push(buildPuttPath(shot.strokeNumber, matches[0].ballPath, descriptor.configuration.offset,
        shot.from, shot.endpoint, world.pin, matches[0].made === true, topo)); }
      catch { /* Unreconciled samples retain existing 2D playback; never change anchors. */ }
    }
  }
  return {
    packageId: descriptor.packageId,
    prepared: {
      tournamentId: selection.tournamentId,
      pgaPlayerId: selection.pgaPlayerId,
      roundNumber: selection.roundNumber,
      holeNumber: selection.holeNumber,
      engineVersion: descriptor.engine.version,
      transformProfile: descriptor.engine.profile,
      course: { pgaCourseId: descriptor.event.course.id!, playerRoundAssignment: "verified", terrain: "ready", imagery: "ready", green: hole.green ? "ready" : "unavailable" },
      shots: world.shots.map(shot => ({ strokeNumber: shot.strokeNumber, kind: flightPaths.some(path => path.strokeNumber === shot.strokeNumber) ? "non_putt" as const : puttPaths.some(path => path.strokeNumber === shot.strokeNumber) ? "putt" as const : "unknown" as const, endpointSource: "verified" as const,
        timedPuttSource: puttPaths.some(path => path.strokeNumber === shot.strokeNumber) ? "verified" as const : "unavailable" as const,
        puttSurface: puttPaths.some(path => path.strokeNumber === shot.strokeNumber) ? "ready" as const : "unavailable" as const,
        flightPath: flightPaths.some(path => path.strokeNumber === shot.strokeNumber) ? "ready" as const : "unavailable" as const })),
    },
    courseName: descriptor.event.course.name,
    assets: { terrain: assetUrl(descriptor.packageId, hole.terrain), ...(hole.green ? { green: assetUrl(descriptor.packageId, hole.green) } : {}), courseImage: assetUrl(descriptor.packageId, descriptor.courseAssets.imagery), holeImage: assetUrl(descriptor.packageId, hole.imagery), mask: assetUrl(descriptor.packageId, hole.mask) },
    worldFiles: { course: courseWorld, hole: holeWorld },
    flightPaths: Object.freeze(flightPaths),
    puttPaths: Object.freeze(puttPaths),
    ...world,
  };
}

export async function readDevelopmentAsset(packageId: string, assetId: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (process.env.NODE_ENV !== "development" || !packageIdPattern.test(packageId)) return null;
  const descriptor = await readPreparedCourseDescriptor(packageId);
  const asset = descriptor.assets.find(item => item.id === assetId);
  if (!asset || !["terrain", "green", "image", "mask"].includes(asset.role)) return null;
  const bytes = await readPreserved(asset);
  const contentType = asset.role === "image" ? "image/jpeg" : asset.role === "mask" ? "image/png" : "model/gltf-binary";
  return { bytes, contentType };
}
