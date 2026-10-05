import type {
  GolfHoleReplay,
  GolfHoleReplayShot,
  GolfShotCoordinateSet,
} from "@/lib/providers/pgaTourShots";

/** The existing hole panel already owns event/player, round/hole and shot selection. */
export type ExistingShotcastHole = Pick<
  GolfHoleReplay,
  "tournamentId" | "pgaPlayerId" | "roundNumber" | "holeNumber"
> & {
  shots: Array<
    Pick<
      GolfHoleReplayShot,
      "strokeNumber" | "leftToRight" | "bottomToTop" | "ballPath"
    >
  >;
};

/** Supplied later by a verified 3D preparation step, never inferred from 2D imagery. */
export type PreparedShotcastHole = {
  tournamentId: string;
  pgaPlayerId: string;
  roundNumber: number;
  holeNumber: number;
  engineVersion: string;
  transformProfile: string;
  course: {
    pgaCourseId: string;
    playerRoundAssignment: "verified" | "unresolved";
    terrain: "ready" | "unavailable";
    imagery: "ready" | "unavailable";
    green: "ready" | "unavailable";
  };
  shots: Array<{
    strokeNumber: number;
    kind: "non_putt" | "putt" | "unknown";
    /** Native PGA endpoint validated and placeable on this prepared course. */
    endpointSource?: "verified" | "unavailable";
    timedPuttSource?: "verified" | "unavailable";
    /** Ready only after a supported path has actually been reconstructed. */
    flightPath?: "ready" | "unavailable";
    /** Ready only after samples have been grounded on the detailed green. */
    puttSurface?: "ready" | "unavailable";
  }>;
};

export type ShotcastViewMode =
  | "2d_fallback"
  | "course_only"
  | "endpoint"
  | "non_putt_replay"
  | "putt_replay";

export type ShotcastViewPlan = {
  mode: ShotcastViewMode;
  reason?:
    | "missing_replay"
    | "missing_preparation"
    | "identity_mismatch"
    | "unsupported_profile"
    | "course_unresolved"
    | "terrain_unavailable"
    | "ambiguous_shots";
  course: {
    geometry: boolean;
    imagery: boolean;
    green: boolean;
  };
  selectedStrokeNumber: number | null;
  shots: Array<{
    strokeNumber: number;
    recordedEndpoint: boolean;
    reconstructedFlightPath: boolean;
    replayableNonPutt: boolean;
    puttPath: boolean;
    replayablePutt: boolean;
  }>;
};

function pointHasNative3d(
  point: GolfShotCoordinateSet["to"] | null | undefined,
): boolean {
  return Boolean(
    point &&
      [point.tourcastX, point.tourcastY, point.tourcastZ].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ),
  );
}

function hasRecordedEndpoint(
  shot: ExistingShotcastHole["shots"][number],
): boolean {
  return (
    pointHasNative3d(shot.bottomToTop?.to) ||
    pointHasNative3d(shot.leftToRight?.to)
  );
}

function hasTimedPuttPath(
  shot: ExistingShotcastHole["shots"][number],
): boolean {
  const points = shot.ballPath?.path;
  if (!points || points.length < 2 || !shot.ballPath?.reconstructionType) {
    return false;
  }

  return points.every(
    (point, index) =>
      [point.x, point.y, point.z, point.secondsSinceStart].every(
        (value) => typeof value === "number" && Number.isFinite(value),
      ) &&
      (index === 0 ||
        point.secondsSinceStart > points[index - 1].secondsSinceStart),
  );
}

function fallback(
  reason: NonNullable<ShotcastViewPlan["reason"]>,
  selectedStrokeNumber: number | null,
): ShotcastViewPlan {
  return {
    mode: "2d_fallback",
    reason,
    course: { geometry: false, imagery: false, green: false },
    selectedStrokeNumber,
    shots: [],
  };
}

/**
 * Read-only decision for the current ShotCast slot. No fetch, DB lookup,
 * score mutation, path reconstruction, or assumption that radar implies replay.
 */
export function planShotcastVisualization(
  replay: ExistingShotcastHole | null,
  prepared: PreparedShotcastHole | null,
  selectedStrokeNumber: number | null,
): ShotcastViewPlan {
  if (!replay) return fallback("missing_replay", selectedStrokeNumber);
  if (!prepared) return fallback("missing_preparation", selectedStrokeNumber);

  if (
    !/^R\d{7}$/.test(replay.tournamentId) ||
    !/^\d+$/.test(replay.pgaPlayerId) ||
    prepared.tournamentId !== replay.tournamentId ||
    prepared.pgaPlayerId !== replay.pgaPlayerId ||
    prepared.roundNumber !== replay.roundNumber ||
    prepared.holeNumber !== replay.holeNumber
  ) {
    return fallback("identity_mismatch", selectedStrokeNumber);
  }

  if (
    prepared.engineVersion !== "3.3.1" ||
    prepared.transformProfile !== "pga-f32-z-up-interior-v1"
  ) {
    return fallback("unsupported_profile", selectedStrokeNumber);
  }

  if (
    !prepared.course.pgaCourseId.trim() ||
    prepared.course.playerRoundAssignment !== "verified"
  ) {
    return fallback("course_unresolved", selectedStrokeNumber);
  }

  if (prepared.course.terrain !== "ready") {
    return fallback("terrain_unavailable", selectedStrokeNumber);
  }

  const replayStrokes = replay.shots.map((shot) => shot.strokeNumber);
  const preparedStrokes = prepared.shots.map((shot) => shot.strokeNumber);
  if (
    replayStrokes.some((stroke) => !Number.isInteger(stroke) || stroke < 1) ||
    preparedStrokes.some((stroke) => !Number.isInteger(stroke) || stroke < 1) ||
    new Set(replayStrokes).size !== replayStrokes.length ||
    new Set(preparedStrokes).size !== preparedStrokes.length
  ) {
    return fallback("ambiguous_shots", selectedStrokeNumber);
  }

  const preparedByStroke = new Map(
    prepared.shots.map((shot) => [shot.strokeNumber, shot]),
  );
  const green = prepared.course.green === "ready";
  const shots = replay.shots.map((shot) => {
    const match = preparedByStroke.get(shot.strokeNumber);
    const recordedEndpoint =
      match?.endpointSource === "verified" && hasRecordedEndpoint(shot);
    const reconstructedFlightPath =
      match?.kind === "non_putt" &&
      match.flightPath === "ready" &&
      recordedEndpoint;
    const puttPath =
      match?.kind === "putt" &&
      match.timedPuttSource === "verified" &&
      hasTimedPuttPath(shot);

    return {
      strokeNumber: shot.strokeNumber,
      recordedEndpoint,
      reconstructedFlightPath,
      replayableNonPutt: reconstructedFlightPath,
      puttPath,
      replayablePutt:
        puttPath && green && match?.puttSurface === "ready",
    };
  });

  const selected = shots.find(
    (shot) => shot.strokeNumber === selectedStrokeNumber,
  );
  const mode: ShotcastViewMode = selected?.replayableNonPutt
    ? "non_putt_replay"
    : selected?.replayablePutt
      ? "putt_replay"
      : selected?.recordedEndpoint
        ? "endpoint"
        : "course_only";

  return {
    mode,
    course: {
      geometry: true,
      imagery: prepared.course.imagery === "ready",
      green,
    },
    selectedStrokeNumber,
    shots,
  };
}
