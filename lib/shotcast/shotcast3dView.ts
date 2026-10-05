import type { NativePoint, Point3 } from "./productionGeometry";
import type { HoleWorld } from "./holeWorld";
import type { PuttPath } from "./puttReplay";
import type { FlightPath } from "./flightReplay";
import type { GolfHoleReplay, GolfShotFlightTrajectory } from "../providers/pgaTourShots";
import type { PreparedShotcastHole, ExistingShotcastHole } from "./visualizationCapabilities";

/** Selected player's current provider data; no course assets or research strokes. */
export type StaticPlayerHole = Pick<ExistingShotcastHole, "tournamentId" | "pgaPlayerId" | "roundNumber" | "holeNumber"> & {
  pin: NativePoint;
  shots: { strokeNumber: number; from: NativePoint; to: NativePoint }[];
};

export function parseStaticPlayerHole(value: unknown): StaticPlayerHole | null {
  if (!value || typeof value !== "object") return null;
  const input = value as StaticPlayerHole;
  const point = (p: NativePoint | undefined) => p && [p.tourcastX, p.tourcastY, p.tourcastZ].every(n => typeof n === "number" && Number.isFinite(n));
  if (typeof input.tournamentId !== "string" || !/^R\d{7}$/.test(input.tournamentId) ||
    typeof input.pgaPlayerId !== "string" || !/^\d+$/.test(input.pgaPlayerId) ||
    !Number.isInteger(input.roundNumber) || input.roundNumber < 1 || input.roundNumber > 4 ||
    !Number.isInteger(input.holeNumber) || input.holeNumber < 1 || input.holeNumber > 18 ||
    !point(input.pin) || !Array.isArray(input.shots) || !input.shots.length ||
    input.shots.some(s => !s || !Number.isInteger(s.strokeNumber) || s.strokeNumber < 1 || !point(s.from) || !point(s.to)) ||
    !input.shots.some(s => s.strokeNumber === 1) || new Set(input.shots.map(s => s.strokeNumber)).size !== input.shots.length) return null;
  return input;
}

/** Only the current hole response supplies tee/start, pin and shot coordinates. */
export function currentPlayerHole(replay: ExistingShotcastHole & { pinWorld: { x: number; y: number; z?: number | null } | null }): StaticPlayerHole | null {
  const native = (p: { tourcastX: number | null; tourcastY: number | null; tourcastZ: number | null } | null | undefined) => p ? { tourcastX: p.tourcastX, tourcastY: p.tourcastY, tourcastZ: p.tourcastZ } : null;
  return parseStaticPlayerHole({
    tournamentId: replay.tournamentId, pgaPlayerId: replay.pgaPlayerId,
    roundNumber: replay.roundNumber, holeNumber: replay.holeNumber,
    pin: replay.pinWorld ? { tourcastX: replay.pinWorld.x, tourcastY: replay.pinWorld.y, tourcastZ: replay.pinWorld.z } : null,
    shots: replay.shots.map(s => ({ strokeNumber: s.strokeNumber, from: native(s.leftToRight?.from), to: native(s.leftToRight?.to) })),
  });
}

/** Render-ready handoff; asset URLs are supplied by a replaceable resolver. */
export type Shotcast3DView = HoleWorld & {
  packageId: string;
  prepared: PreparedShotcastHole;
  courseName: string;
  assets: {
    terrain: string;
    green?: string;
    courseImage: string;
    holeImage: string;
    mask: string;
  };
  worldFiles: { course: string; hole: string };
  flightPaths?: readonly FlightPath[];
  puttPaths?: readonly PuttPath[];
};

/** Separate replay metadata; never replace static coordinates or load saved players. */
export type PlayerFlightInput = { fairway: NativePoint; shots: { strokeNumber: number; trajectory: GolfShotFlightTrajectory }[] };
export type PlayerPuttInput = { strokeNumber: number; ballPath: NonNullable<GolfHoleReplay["shots"][number]["ballPath"]>; made: boolean }[];
export function currentPreparationInput(replay: ExistingShotcastHole & { pinWorld: { x: number; y: number; z?: number | null } | null } & Partial<Pick<GolfHoleReplay, "fairwayWorld">>): (StaticPlayerHole & { flightData?: PlayerFlightInput; puttData?: PlayerPuttInput }) | null {
  const hole = currentPlayerHole(replay);
  if (!hole) return null;
  const puttData: PlayerPuttInput = replay.shots.flatMap(shot => {
    const richer = shot as GolfHoleReplay["shots"][number];
    return richer.ballPath?.reconstructionType?.toLowerCase() === "simulation" && richer.ballPath.path.length >= 2 &&
      richer.fromLocation?.toLowerCase().includes("green")
      ? [{ strokeNumber: shot.strokeNumber, ballPath: richer.ballPath, made: richer.finalStroke && !richer.ballPath.isLipOut }] : [];
  });
  const withPutts = { ...hole, ...(puttData.length ? { puttData } : {}) };
  const fairway = replay.fairwayWorld;
  if (!fairway || ![fairway.x, fairway.y, fairway.z].every(value => typeof value === "number" && Number.isFinite(value))) return withPutts;
  const shots = replay.shots.flatMap(shot => {
    const richer = shot as typeof shot & { flightTrajectory?: GolfShotFlightTrajectory | null; ballPath?: { path: unknown[] } | null };
    // Supplied sample paths take precedence over inferred flight geometry.
    return richer.flightTrajectory?.representation === "single-flight-no-impact-v1" && !richer.ballPath?.path.length
      ? [{ strokeNumber: shot.strokeNumber, trajectory: richer.flightTrajectory }] : [];
  });
  return { ...withPutts, flightData: { fairway: { tourcastX: fairway.x, tourcastY: fairway.y, tourcastZ: fairway.z! }, shots } };
}

export function shotcastContextKey(replay: Pick<ExistingShotcastHole, "tournamentId" | "pgaPlayerId" | "roundNumber" | "holeNumber">): string {
  return [replay.tournamentId, replay.pgaPlayerId, replay.roundNumber, replay.holeNumber].join("/");
}

export function matchesReplayEndpoints(view: Shotcast3DView, replay: ExistingShotcastHole & { pinWorld?: { x: number; y: number; z?: number | null } | null }): boolean {
  // A refreshed replay can have additional strokes beyond a frozen package.
  // Keep that complete current replay in 2D rather than omit newer endpoints.
  if (view.shots.length === 0 || view.shots.length !== replay.shots.length) return false;
  for (const placed of view.shots) {
    const shot = replay.shots.find(candidate => candidate.strokeNumber === placed.strokeNumber);
    if (!shot) return false;
    for (const [native, expected] of [[shot.leftToRight?.from, placed.nativeFrom], [shot.leftToRight?.to, placed.nativeEndpoint]] as const) {
      if (!native) return false;
      const actual = [native.tourcastX, native.tourcastY, native.tourcastZ];
      if (actual.some((value, i) => typeof value !== "number" || !Number.isFinite(value) || value !== expected[i])) return false;
    }
  }
  const current = replay.pinWorld;
  // The request body binds pin/tee as well as endpoints to this preparation.
  // pinWorld is required in the normal panel seam; older capability callers
  // without a pin still validate all native shot starts and ends here.
  if (current !== undefined && (!current || [current.x, current.y, current.z].some((value, i) => value !== view.nativePin[i]))) return false;
  return true;
}

export function isShotcast3DView(value: unknown): value is Shotcast3DView {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Shotcast3DView>;
  const point = (input: unknown): input is Point3 => Array.isArray(input) && input.length === 3 && input.every(item => typeof item === "number" && Number.isFinite(item));
  const prepared = candidate.prepared;
  return typeof candidate.packageId === "string" &&
    typeof candidate.courseName === "string" &&
    !!candidate.assets && [candidate.assets.terrain, candidate.assets.courseImage, candidate.assets.holeImage, candidate.assets.mask].every(item => typeof item === "string" && item.startsWith("/api/golf/shotcast-3d-dev?")) &&
    (candidate.assets.green === undefined || (typeof candidate.assets.green === "string" && candidate.assets.green.startsWith("/api/golf/shotcast-3d-dev?"))) &&
    !!candidate.worldFiles && typeof candidate.worldFiles.course === "string" && typeof candidate.worldFiles.hole === "string" &&
    !!prepared && typeof prepared.tournamentId === "string" && typeof prepared.pgaPlayerId === "string" && Number.isInteger(prepared.roundNumber) && Number.isInteger(prepared.holeNumber) &&
    typeof prepared.engineVersion === "string" && typeof prepared.transformProfile === "string" &&
    !!prepared.course && typeof prepared.course.pgaCourseId === "string" && Array.isArray(prepared.shots) &&
    point(candidate.tee) && point(candidate.pin) && point(candidate.nativePin) &&
    (candidate.greenBounds === null || (!!candidate.assets.green && !!candidate.greenBounds && point(candidate.greenBounds.min) && point(candidate.greenBounds.max))) &&
    Array.isArray(candidate.shots) && candidate.shots.length > 0 && candidate.shots.every(shot => Number.isInteger(shot.strokeNumber) && point(shot.from) && point(shot.endpoint) && point(shot.nativeFrom) && point(shot.nativeEndpoint)) &&
    (candidate.puttPaths === undefined || (Array.isArray(candidate.puttPaths) && candidate.puttPaths.length <= candidate.shots.length &&
      new Set(candidate.puttPaths.map(path => path.strokeNumber)).size === candidate.puttPaths.length && candidate.puttPaths.every((path: PuttPath) => {
        const shot = candidate.shots!.find(shot => shot.strokeNumber === path.strokeNumber);
        return shot && path.source === "pga-supplied-putt-simulation" && point(path.from) && point(path.endpoint) &&
          path.from.every((v: number, i: number) => v === shot.from[i]) && path.endpoint.every((v: number, i: number) => v === shot.endpoint[i]) &&
          Number.isFinite(path.sourceDuration) && path.sourceDuration > 0 && [0, 0.24].includes(path.connectorSeconds) &&
          Array.isArray(path.samples) && path.samples.length >= 2 && path.samples.length <= 4096 &&
          path.samples.every((p: PuttPath["samples"][number], i: number) => point(p.position) && point(p.native) && Number.isFinite(p.secondsSinceStart) &&
            (i === 0 ? p.secondsSinceStart === 0 : p.secondsSinceStart > path.samples[i - 1].secondsSinceStart)) &&
          path.sourceDuration === path.samples.at(-1)!.secondsSinceStart;
      }))) &&
    (candidate.flightPaths === undefined || (Array.isArray(candidate.flightPaths) && new Set(candidate.flightPaths.map(path => path.strokeNumber)).size === candidate.flightPaths.length && candidate.flightPaths.every(path => {
      const shot = candidate.shots!.find(shot => shot.strokeNumber === path.strokeNumber);
      return shot && path.source === "pga-radar-endpoint-constrained" && point(path.originCorrection) &&
        Number.isFinite(path.coefficientContactTime) && path.coefficientContactTime > 0 &&
        Number.isInteger(path.flightCount) && path.flightCount >= 2 && Array.isArray(path.points) &&
        path.points.length >= path.flightCount && path.points.length <= 4096 && path.points.every(point) &&
        path.points[0].every((v: number, i: number) => v === shot.from[i]) && path.points.at(-1)!.every((v: number, i: number) => v === shot.endpoint[i]);
    })));
}
