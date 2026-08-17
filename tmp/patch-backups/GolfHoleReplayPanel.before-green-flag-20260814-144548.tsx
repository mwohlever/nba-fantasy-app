"use client";

import dynamic from "next/dynamic";
const GolfHoleMap2D = dynamic(
  () =>
    import(
      "@/components/lineups/GolfHoleMap2D"
    ),
  {
    ssr: false,
    loading: () => (
      <div className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-8 text-center text-xs font-semibold text-slate-400">
        Loading ShotCast…
      </div>
    ),
  },
);


import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type Coordinate = {
  x: number | null;
  y: number | null;
  tourcastX: number | null;
  tourcastY: number | null;
  tourcastZ: number | null;
};

type CoordinateSet = {
  from: Coordinate;
  to: Coordinate;
};

type ShotRadarData = {
  apexHeight: number | null;
  clubSpeed: number | null;
  ballSpeed: number | null;
  smashFactor: number | null;
  launchSpin: number | null;
  spinAxis: number | null;
  verticalLaunchAngle: number | null;
  horizontalLaunchAngle: number | null;
  actualFlightTime: number | null;
  carry: number | null;
  carrySide: number | null;
};

type BallPathPoint = {
  x: number;
  y: number;
  z: number | null;
  secondsSinceStart: number;
};

type ShotFlightTrajectory = {
  kind: string | null;
  type: string | null;
  xFit: number[];
  yFit: number[];
  zFit: number[];
  timeStart: number;
  timeEnd: number;
};

type BallPath = {
  isLipOut: boolean;
  reconstructionType: string | null;
  totalDistanceInches: number | null;
  path: BallPathPoint[];
};

type ReplayShot = {
  strokeNumber: number;
  playByPlay: string | null;
  distance: string | null;
  distanceRemaining: string | null;
  strokeType: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  fromLocationCode: string | null;
  toLocationCode: string | null;
  finalStroke: boolean;

  videoId: string | null;
  radarData: ShotRadarData | null;
  flightTrajectory: ShotFlightTrajectory | null;
  ballPath: BallPath | null;

  worldFrom?: {
    x: number;
    y: number;
    z?: number | null;
  } | null;

  worldTo?: {
    x: number;
    y: number;
    z?: number | null;
  } | null;

  leftToRight: CoordinateSet | null;
  bottomToTop: CoordinateSet | null;
  greenBottomToTop: CoordinateSet | null;
};

type Replay = {
  tournamentId: string;
  pgaPlayerId: string;
  playerName: string;
  roundNumber: number;
  holeNumber: number;
  par: number | null;
  yardage: number | null;
  holeStatus: string | null;
  holeScore: string | null;

  pinWorld: {
    x: number;
    y: number;
    z?: number | null;
  } | null;

  shotcast: {
    imageUrl: string;
    greenImageUrl: string | null;
    orientation: "bottomToTop";
    source: "pga-tourcast-v3-enhanced";
    verified: true;
  } | null;

  shots: ReplayShot[];
};

type ReconciledHole = {
  hole_number: number;
  strokes: number;
  relative_to_par: number;
  score_display: string;
  holes_completed: number;
  round_score_to_par: number;
  round_strokes: number;
};

type ResponseBody = {
  success?: boolean;
  available?: boolean;
  message?: string;
  replay?: Replay | null;
  reconciledHole?: ReconciledHole | null;
  error?: string;
};

type ShotCastCalibration = {
  xScale: number;
  xOffset: number;
  yScale: number;
  yOffset: number;
  verified?: boolean;
  source?: string;
  affine?: {
    pxX: number;
    rotX: number;
    rotY: number;
    pxY: number;
    coordX: number;
    coordY: number;
    dimX: number;
    dimY: number;
  };
};

type ShotCastManifestHole = {
  holeNumber: number;
  available: boolean;
  par: number | null;
  yards: number | null;
  aboutThisHole: string | null;
  localImageUrl: string | null;
  alignedMapUrl?: string | null;
  localAlignedMapUrl?: string | null;
  calibration?: ShotCastCalibration | null;
  /*
   * PGA courseData.pinsTees, preserved by round.
   */
  pinWorldByRound?: Array<
    {
      x: number;
      y: number;
      z?: number | null;
    } | null
  >;

};

type ShotCastManifest = {
  tournament: {
    id: string;
    name: string | null;
  };
  course: {
    id: string;
    name: string | null;
  };
  holes: ShotCastManifestHole[];
};

type ActiveShotCastConfig = {
  title: string;
  imageUrl: string;
  imageFit: "fill" | "contain";
  calibration: ShotCastCalibration;
  calibrationVerified: boolean;
  aboutThisHole: string | null;
};

type Props = {
  slateId: number;
  playerId: number;
  roundNumber: number;
  holeNumber: number;
  fallbackPar: number | null;
  fallbackYardage: number | null;
  fallbackResult: string;
  onClose: () => void;
  onReconciled?: (
    hole: ReconciledHole,
  ) => void;
};

const IDENTITY_CALIBRATION: ShotCastCalibration = {
  xScale: 1,
  xOffset: 0,
  yScale: 1,
  yOffset: 0,
  verified: false,
};

const DETROIT_HOLE_8_CALIBRATION: ShotCastCalibration = {
  xScale: 2.488624,
  xOffset: -0.748272,
  yScale: 0.974452,
  yOffset: 0.127478,
  verified: true,
};

function titleCase(
  value: string | null | undefined,
) {
  if (!value) return "";

  return value
    .toLowerCase()
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
}

function locationLabel(
  value: string | null | undefined,
) {
  return value?.trim() || "Unknown lie";
}

function resultToneClass(
  result: string | null | undefined,
) {
  const normalized =
    result?.trim().toLowerCase() ?? "";

  if (
    normalized.includes("albatross") ||
    normalized.includes("eagle") ||
    normalized.includes("birdie")
  ) {
    return "text-emerald-300";
  }

  if (
    normalized.includes("double") ||
    normalized.includes("triple") ||
    normalized.includes("quad") ||
    /^\+\d+/.test(normalized)
  ) {
    return "text-red-400";
  }

  if (normalized.includes("bogey")) {
    return "text-red-300";
  }

  if (
    normalized === "par" ||
    normalized.includes("even")
  ) {
    return "text-slate-200";
  }

  return "text-slate-300";
}

function resultBadgeClass(
  result: string | null | undefined,
) {
  const normalized =
    result?.trim().toLowerCase() ?? "";

  if (
    normalized.includes("albatross") ||
    normalized.includes("eagle")
  ) {
    return "border-emerald-500 bg-emerald-700 text-white";
  }

  if (normalized.includes("birdie")) {
    return "border-emerald-400 bg-emerald-600 text-white";
  }

  if (
    normalized.includes("double") ||
    normalized.includes("triple") ||
    normalized.includes("quad") ||
    /^\+\d+/.test(normalized)
  ) {
    return "border-red-500 bg-red-700 text-white";
  }

  if (normalized.includes("bogey")) {
    return "border-red-400 bg-red-600 text-white";
  }

  return "border-slate-500 bg-slate-700 text-white";
}

function shotSummary(
  shot: ReplayShot,
  holeResult: string,
) {
  const pieces: string[] = [];

  if (shot.distance) {
    pieces.push(shot.distance);
  }

  if (shot.finalStroke) {
    pieces.push("In the hole");

    if (holeResult) {
      pieces.push(holeResult);
    }
  } else if (shot.distanceRemaining) {
    pieces.push(
      `${shot.distanceRemaining} remaining`,
    );
  }

  return pieces.join(" · ");
}

export default function GolfHoleReplayPanel({
  slateId,
  playerId,
  roundNumber,
  holeNumber,
  fallbackPar,
  fallbackYardage,
  fallbackResult,
  onClose,
  onReconciled,
}: Props) {
  const [replay, setReplay] =
    useState<Replay | null>(null);

  const [message, setMessage] =
    useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  const [isRefreshing, setIsRefreshing] =
    useState(false);

  const [lastUpdatedAt, setLastUpdatedAt] =
    useState<Date | null>(null);

  const [
    selectedStrokeNumber,
    setSelectedStrokeNumber,
  ] = useState<number | null>(null);

  const [
    isShotCastOpen,
    setIsShotCastOpen,
  ] = useState(true);

  const [
    isAllShotsOpen,
    setIsAllShotsOpen,
  ] = useState(false);

  /*
   * Keep the latest reconciliation callback without making the replay
   * fetch depend on the callback's identity.
   *
   * GolfPlayerModal passes onReconciled inline, so its function identity
   * changes whenever the scorecard rerenders. If loadReplay depends on it,
   * the loading effect restarts and creates a request loop.
   */
  const onReconciledRef =
    useRef(onReconciled);

  useEffect(() => {
    onReconciledRef.current =
      onReconciled;
  }, [onReconciled]);

  const [
    shotCastManifest,
    setShotCastManifest,
  ] = useState<ShotCastManifest | null>(
    null,
  );

  const [
    isManifestLoading,
    setIsManifestLoading,
  ] = useState(false);

  const loadReplay = useCallback(
    async ({
      forceRefresh = false,
      signal,
    }: {
      forceRefresh?: boolean;
      signal?: AbortSignal;
    } = {}) => {
      try {
        if (forceRefresh) {
          setIsRefreshing(true);
        } else {
          setIsLoading(true);
          setReplay(null);
        }

        setMessage("");

        const query =
          new URLSearchParams({
            slateId: String(slateId),
            playerId: String(playerId),
            round: String(roundNumber),
            hole: String(holeNumber),
          });

        if (forceRefresh) {
          query.set(
            "refresh",
            String(Date.now()),
          );
        }

        const response = await fetch(
          `/api/golf/hole-replay?${query}`,
          {
            cache: "no-store",
            signal,
          },
        );

        const result =
          (await response.json()) as ResponseBody;

        if (!response.ok) {
          setMessage(
            result.error ||
              "Unable to load shot tracking.",
          );
          return;
        }

        if (!result.replay) {
          setMessage(
            result.message ||
              "Shot tracking is not available for this hole yet.",
          );
          return;
        }

        setReplay(result.replay);

        /*
         * Temporary PGA pin-coordinate audit.
         *
         * Compare the authoritative hole pin with the latest
         * live shot in every coordinate frame we currently have.
         */
        {
          const latestShot =
            result.replay.shots.length > 0
              ? result.replay.shots[
                  result.replay.shots.length - 1
                ]
              : null;

          console.log(
            "[PGA LIVE PIN AUDIT]",
            {
              tournamentId:
                result.replay.tournamentId,
              hole:
                result.replay.holeNumber,

              pinWorld:
                result.replay.pinWorld,

              shotCount:
                result.replay.shots.length,

              latestStroke:
                latestShot?.strokeNumber ??
                null,

              latestWorldTo:
                latestShot?.worldTo ??
                null,

              latestBottomToTop:
                latestShot?.bottomToTop ??
                null,

              latestGreenBottomToTop:
                latestShot?.greenBottomToTop ??
                null,
            },
          );
        }

        if (
          result.reconciledHole &&
          onReconciledRef.current
        ) {
          onReconciledRef.current(
            result.reconciledHole,
          );
        }

        if (!result.available) {
          setMessage(
            result.message ||
              "This hole has not started yet.",
          );
        }

        setSelectedStrokeNumber(
          (current) => {
            const shots =
              result.replay?.shots ?? [];

            if (forceRefresh) {
              return (
                shots.at(-1)
                  ?.strokeNumber ??
                null
              );
            }

            if (
              current !== null &&
              shots.some(
                (shot) =>
                  shot.strokeNumber ===
                  current,
              )
            ) {
              return current;
            }

            return (
              shots[0]
                ?.strokeNumber ??
              null
            );
          },
        );

        setLastUpdatedAt(new Date());
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        console.error(
          "Unable to load Golf hole replay",
          error,
        );

        setMessage(
          "Unable to load shot tracking.",
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [
      slateId,
      playerId,
      roundNumber,
      holeNumber,
    ],
  );

  useEffect(() => {
    const controller =
      new AbortController();

    void loadReplay({
      forceRefresh: true,
      signal: controller.signal,
    });

    return () => controller.abort();
  }, [loadReplay]);

  useEffect(() => {
    const tournamentId =
      replay?.tournamentId?.trim() ?? "";

    if (!tournamentId) {
      setShotCastManifest(null);
      return;
    }

    const controller =
      new AbortController();

    async function loadManifest() {
      try {
        setIsManifestLoading(true);

        const databaseResponse =
          await fetch(
            `/api/golf/shotcast-manifest?tournamentId=${encodeURIComponent(
              tournamentId,
            )}`,
            {
              cache: "no-store",
              signal:
                controller.signal,
            },
          );

        if (databaseResponse.ok) {
          const manifest =
            (await databaseResponse.json()) as ShotCastManifest;

          setShotCastManifest(
            manifest,
          );

          return;
        }

        /*
         * Preserve previously committed static manifests,
         * including the current Wyndham checkpoint.
         */
        const staticResponse =
          await fetch(
            `/shotcast/${encodeURIComponent(
              tournamentId,
            )}/manifest.json`,
            {
              cache: "no-store",
              signal:
                controller.signal,
            },
          );

        if (!staticResponse.ok) {
          setShotCastManifest(null);
          return;
        }

        const manifest =
          (await staticResponse.json()) as ShotCastManifest;

        setShotCastManifest(manifest);
      } catch (error) {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        console.warn(
          "Unable to load ShotCast manifest",
          error,
        );

        setShotCastManifest(null);
      } finally {
        setIsManifestLoading(false);
      }
    }

    void loadManifest();

    return () => controller.abort();
  }, [replay?.tournamentId]);

  /*
   * Hole-level PGA metadata is independent of the golfer's
   * ShotDetails payload.
   */
  const manifestHole =
    useMemo(
      () =>
        shotCastManifest
          ?.holes.find(
            (hole) =>
              Number(
                hole.holeNumber,
              ) ===
              holeNumber,
          ) ??
        null,
      [
        holeNumber,
        shotCastManifest,
      ],
    );

  /*
   * PGA getTeeAndPinFromEventData() selects pinsTees by round.
   * Match that behavior rather than hardcoding Round 1.
   */
  /*
   * TOURCAST courseData may publish either:
   *
   * - multiple pin/tee sets, or
   * - one authoritative set at pinsTees[0].
   *
   * St. Jude publishes one set. Prefer a round-specific
   * value when PGA actually provides one, otherwise use
   * PGA's sole authoritative set rather than returning null.
   */
  const authoritativePinWorld =
    manifestHole
      ?.pinWorldByRound?.[
        Math.max(
          0,
          roundNumber - 1,
        )
      ] ??
    manifestHole
      ?.pinWorldByRound?.[0] ??
    null;

  const activeShotCastConfig =
    useMemo<ActiveShotCastConfig | null>(
      () => {
        /*
         * AUTHORITATIVE COURSE VIEW
         * -------------------------
         *
         * PGA pinsTees and terrainNN.tfw share the same raw
         * TOURCAST coordinate system.
         *
         * Never project pinsTees onto the V3 enhanced pickle:
         * that image uses a different normalized frame.
         */
        if (
          authoritativePinWorld &&
          manifestHole
            ?.localAlignedMapUrl &&
          manifestHole
            ?.calibration
            ?.affine
        ) {
          return {
            title:
              `ShotCast · Hole ${holeNumber}`,
            imageUrl:
              manifestHole
                .localAlignedMapUrl,
            imageFit: "fill",
            calibration:
              manifestHole.calibration,
            calibrationVerified:
              true,
            aboutThisHole:
              manifestHole
                .aboutThisHole ??
              null,
          };
        }

        /*
         * PRIMARY PATH:
         *
         * PGA TOURCAST V3 already supplies the exact
         * bottom-to-top image and normalized coordinates.
         *
         * No terrain image, TFW, manual calibration, or
         * admin import is required.
         */
        if (
          replay?.shotcast?.verified ===
            true &&
          replay.shotcast.imageUrl
        ) {
          return {
            title: `ShotCast · Hole ${holeNumber}`,
            imageUrl:
              replay.shotcast.imageUrl,
            imageFit: "fill",
            calibration: {
              ...IDENTITY_CALIBRATION,
              verified: true,
              source:
                replay.shotcast.source,
            },
            calibrationVerified: true,
            aboutThisHole:
              null,
          };
        }

        /*
         * FALLBACK:
         *
         * Preserve the verified Rocket Classic proof of
         * concept until all historical events use V3.
         */
        if (
          slateId === 161 &&
          holeNumber === 8
        ) {
          return {
            title:
              "Detroit Golf Club · Hole 8",
            imageUrl:
              "/tourcast/rocket-classic/hole-8/terrain08-web.jpg",
            imageFit: "fill",
            calibration:
              DETROIT_HOLE_8_CALIBRATION,
            calibrationVerified: true,
            aboutThisHole: null,
          };
        }

        const imageUrl =
          manifestHole
            ?.localAlignedMapUrl ||
          manifestHole
            ?.localImageUrl ||
          null;

        if (!imageUrl) {
          return null;
        }

        const calibration =
          manifestHole?.calibration &&
          Number.isFinite(
            manifestHole
              .calibration.xScale,
          ) &&
          Number.isFinite(
            manifestHole
              .calibration.xOffset,
          ) &&
          Number.isFinite(
            manifestHole
              .calibration.yScale,
          ) &&
          Number.isFinite(
            manifestHole
              .calibration.yOffset,
          )
            ? manifestHole.calibration
            : IDENTITY_CALIBRATION;

        return {
          title: `${
            shotCastManifest?.course
              .name ||
            "Golf course"
          } · Hole ${holeNumber}`,

          imageUrl,

          imageFit:
            manifestHole
              ?.localAlignedMapUrl
              ? "fill"
              : "contain",

          calibration,

          calibrationVerified:
            calibration.verified ===
            true,

          aboutThisHole:
            manifestHole
              ?.aboutThisHole ??
            null,
        };
      },
      [
        holeNumber,
        replay,
        shotCastManifest,
        slateId,
      ],
    );

  const isHoleComplete = useMemo(
    () =>
      Boolean(
        replay?.shots.some(
          (shot) => shot.finalStroke,
        ),
      ),
    [replay],
  );

  /*
   * While a live ShotCast is actually open, refresh PGA
   * shot data every 30 seconds.
   *
   * Stop polling when:
   * - ShotCast closes
   * - the hole is complete
   * - this component unmounts
   *
   * Also skip requests while the browser tab is hidden.
   */
  useEffect(() => {
    if (
      !isShotCastOpen ||
      isHoleComplete
    ) {
      return;
    }

    const refreshLiveShotCast = () => {
      if (
        document.visibilityState !==
        "visible"
      ) {
        return;
      }

      void loadReplay({
        forceRefresh: true,
      });
    };

    const intervalId =
      window.setInterval(
        refreshLiveShotCast,
        30_000,
      );

    return () => {
      window.clearInterval(
        intervalId,
      );
    };
  }, [
    isHoleComplete,
    isShotCastOpen,
    loadReplay,
  ]);

  /*
   * PGA's holeStatus can occasionally collapse exceptional
   * scores into a broader label (for example, reporting a
   * 2 on a par 5 as "Eagle").
   *
   * Once the hole is complete we have enough authoritative
   * information to derive the result ourselves from strokes
   * and par. Prefer that calculation over the provider label.
   */
  const completedResult = useMemo(() => {
    if (!isHoleComplete) {
      return "";
    }

    const completedStrokes =
      replay?.shots.length
        ? Math.max(
            ...replay.shots.map(
              (shot) =>
                Number(
                  shot.strokeNumber ?? 0,
                ),
            ),
          )
        : null;

    const holePar =
      replay?.par ?? fallbackPar;

    if (
      completedStrokes !== null &&
      Number.isFinite(completedStrokes) &&
      completedStrokes > 0 &&
      holePar !== null &&
      holePar !== undefined &&
      Number.isFinite(Number(holePar))
    ) {
      const relative =
        completedStrokes -
        Number(holePar);

      if (relative <= -4) {
        return "Condor";
      }

      if (relative === -3) {
        return "Albatross";
      }

      if (relative === -2) {
        return "Eagle";
      }

      if (relative === -1) {
        return "Birdie";
      }

      if (relative === 0) {
        return "Par";
      }

      if (relative === 1) {
        return "Bogey";
      }

      if (relative === 2) {
        return "Double Bogey";
      }

      if (relative === 3) {
        return "Triple Bogey";
      }

      return `+${relative}`;
    }

    return (
      fallbackResult ||
      titleCase(replay?.holeStatus) ||
      "Complete"
    );
  }, [
    fallbackPar,
    fallbackResult,
    isHoleComplete,
    replay,
  ]);

  const displayStatus =
    isHoleComplete
      ? completedResult || "Complete"
      : replay?.shots.length
        ? "In progress"
        : replay
          ? "Not started"
          : "";

  const par =
    replay?.par ?? fallbackPar;

  const yardage =
    replay?.yardage ??
    fallbackYardage;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-white shadow-xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">
              Hole replay
            </div>

            {!isHoleComplete &&
            replay?.shots.length ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[9px] font-black uppercase text-red-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
                Live
              </span>
            ) : null}
          </div>

          <h4 className="mt-1 text-lg font-black">
            Hole {holeNumber}
          </h4>

          <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs text-slate-400">
            <span>
              {par === null
                ? "Par —"
                : `Par ${par}`}
            </span>

            {yardage !== null ? (
              <>
                <span aria-hidden="true">·</span>
                <span>{yardage} yards</span>
              </>
            ) : null}

            {displayStatus ? (
              <>
                <span aria-hidden="true">·</span>

                <strong
                  className={
                    isHoleComplete
                      ? resultToneClass(
                          completedResult,
                        )
                      : "text-amber-300"
                  }
                >
                  {displayStatus}
                </strong>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() =>
              void loadReplay({
                forceRefresh: true,
              })
            }
            disabled={isRefreshing}
            className="inline-flex h-9 items-center justify-center rounded-xl border border-emerald-700 bg-emerald-950 px-3 text-[11px] font-bold text-emerald-200 transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Refresh this hole's shot tracking"
          >
            {isRefreshing
              ? "Refreshing…"
              : "↻ Refresh hole"}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xl text-slate-300 transition hover:bg-slate-800"
            aria-label="Close hole replay"
          >
            ×
          </button>
        </div>
      </header>

      {isLoading ? (
        <div className="px-4 py-7 text-center">
          <div className="text-sm font-bold text-emerald-300">
            Loading shot tracking…
          </div>

          <div className="mt-1 text-xs text-slate-500">
            Loaded only when you open a hole.
          </div>
        </div>
      ) : message && !replay ? (
        <div className="px-4 py-6 text-center">
          <div className="text-sm font-bold text-slate-200">
            Shot tracking unavailable
          </div>

          <div className="mt-1 text-xs leading-5 text-slate-500">
            {message}
          </div>

          <button
            type="button"
            onClick={() =>
              void loadReplay({
                forceRefresh: true,
              })
            }
            disabled={isRefreshing}
            className="mt-4 rounded-xl border border-emerald-700 bg-emerald-950 px-4 py-2 text-xs font-bold text-emerald-200 disabled:opacity-60"
          >
            Try again
          </button>
        </div>
      ) : replay ? (
        <div className="p-3 sm:p-4">
          {message ? (
            <div className="mb-3 rounded-xl border border-amber-700/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
              {message}
            </div>
          ) : null}

          {activeShotCastConfig ? (
            <div className="mb-3">
              {isShotCastOpen ? (
                <>
                  <GolfHoleMap2D
                    title={
                      activeShotCastConfig
                        .title
                    }
                    imageUrl={
                      activeShotCastConfig
                        .imageUrl
                    }
                    greenImageUrl={
                      replay.shotcast
                        ?.greenImageUrl ??
                      null
                    }
                    pinWorld={
                      authoritativePinWorld
                    }
                    imageFit={
                      activeShotCastConfig
                        .imageFit
                    }
                    calibration={
                      activeShotCastConfig
                        .calibration
                    }
                    showShotOverlay={
                      activeShotCastConfig
                        .calibrationVerified
                    }
                    emptyStateLabel={
                      replay.shots.length === 0
                        ? "This hole has not started. The course layout is available now, and shot paths will appear once play begins and alignment is verified."
                        : activeShotCastConfig
                              .calibrationVerified
                          ? "No plottable shot coordinates were returned."
                          : "Shot data is available, but its placement is hidden until this hole’s map alignment is verified."
                    }
                    shots={replay.shots}
                    selectedStrokeNumber={
                      selectedStrokeNumber
                    }
                    onSelectStroke={
                      setSelectedStrokeNumber
                    }
                  />

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {!activeShotCastConfig
                        .calibrationVerified ? (
                        <span className="rounded-full border border-amber-700/60 bg-amber-950/50 px-2 py-1 text-[8px] font-black uppercase tracking-wide text-amber-300">
                          Layout preview
                        </span>
                      ) : null}

                      {!isHoleComplete &&
                      replay.shots.length > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-slate-500">
                          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                          Auto-refreshing every 30 sec
                        </span>
                      ) : null}
                    </div>

                    {replay.shots.length > 0 ? (
                      <button
                        type="button"
                        onClick={() =>
                          setIsAllShotsOpen(
                            (current) =>
                              !current,
                          )
                        }
                        aria-expanded={
                          isAllShotsOpen
                        }
                        className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-[10px] font-bold text-slate-300 transition hover:border-slate-600 hover:bg-slate-800"
                      >
                        {isAllShotsOpen
                          ? "Hide all shots"
                          : `All shots (${replay.shots.length})`}
                      </button>
                    ) : null}
                  </div>

                  {activeShotCastConfig
                    .aboutThisHole ? (
                    <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5">
                      <div className="text-[9px] font-black uppercase tracking-[0.14em] text-slate-500">
                        About this hole
                      </div>

                      <div className="mt-1 text-xs leading-5 text-slate-400">
                        {
                          activeShotCastConfig
                            .aboutThisHole
                        }
                      </div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : isManifestLoading ? (
            <div className="mb-3 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3 text-xs text-slate-500">
              Checking for ShotCast course assets…
            </div>
          ) : null}

          {replay.shots.length > 0 &&
          (!activeShotCastConfig ||
            isAllShotsOpen) ? (
            <div className="overflow-hidden rounded-xl border border-slate-800">
              {replay.shots.map(
                (shot, index) => {
                  const summary =
                    shotSummary(
                      shot,
                      completedResult,
                    );

                  const isCurrentBall =
                    !isHoleComplete &&
                    index ===
                      replay.shots.length - 1;

                  const isSelectedShot =
                    shot.strokeNumber ===
                    selectedStrokeNumber;

                  return (
                    <button
                      type="button"
                      key={shot.strokeNumber}
                      onClick={() => {
                        setSelectedStrokeNumber(
                          shot.strokeNumber,
                        );

                        if (
                          activeShotCastConfig
                        ) {
                          setIsAllShotsOpen(
                            false,
                          );
                        }
                      }}
                      className={`block w-full px-3 py-3 text-left transition sm:px-4 ${
                        index > 0
                          ? "border-t border-slate-800"
                          : ""
                      } ${
                        isSelectedShot
                          ? "bg-emerald-500/10"
                          : isCurrentBall
                            ? "bg-amber-500/5"
                            : "hover:bg-slate-900/70"
                      }`}
                    >
                      <div className="flex gap-3">
                        <span
                          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${
                            shot.finalStroke
                              ? resultBadgeClass(
                                  completedResult,
                                )
                              : isCurrentBall
                                ? "border-amber-500 bg-amber-950 text-amber-200"
                                : "border-slate-600 bg-slate-800 text-slate-200"
                          }`}
                        >
                          {shot.strokeNumber}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                            <strong className="text-sm text-white">
                              Shot {shot.strokeNumber}
                            </strong>

                            {summary ? (
                              <>
                                <span
                                  aria-hidden="true"
                                  className="text-slate-600"
                                >
                                  ·
                                </span>

                                <span
                                  className={`text-sm font-bold ${
                                    shot.finalStroke
                                      ? resultToneClass(
                                          completedResult,
                                        )
                                      : "text-slate-200"
                                  }`}
                                >
                                  {summary}
                                </span>
                              </>
                            ) : null}

                            {isCurrentBall ? (
                              <span className="rounded-full border border-amber-700/60 bg-amber-950 px-2 py-0.5 text-[9px] font-black uppercase text-amber-300">
                                Current ball
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-1 text-xs text-slate-400">
                            {locationLabel(
                              shot.fromLocation,
                            )}

                            <span
                              aria-hidden="true"
                              className="mx-2 text-slate-600"
                            >
                              →
                            </span>

                            {shot.finalStroke
                              ? "Hole"
                              : locationLabel(
                                  shot.toLocation,
                                )}
                          </div>

                          {shot.playByPlay ? (
                            <div className="mt-1.5 text-[11px] leading-4 text-slate-600">
                              {shot.playByPlay}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  );
                },
              )}
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-600">
            <span>
              Shot data provided on demand from PGA TOUR tracking.
            </span>

            {lastUpdatedAt ? (
              <span>
                Updated{" "}
                {lastUpdatedAt.toLocaleTimeString(
                  [],
                  {
                    hour: "numeric",
                    minute: "2-digit",
                    second: "2-digit",
                  },
                )}
              </span>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
