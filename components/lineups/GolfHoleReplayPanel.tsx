"use client";

import {
  useEffect,
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
  leftToRight: CoordinateSet | null;
  bottomToTop: CoordinateSet | null;
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
  shots: ReplayShot[];
};

type ResponseBody = {
  success?: boolean;
  available?: boolean;
  message?: string;
  replay?: Replay | null;
  error?: string;
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

  if (
    normalized === "par" ||
    normalized.includes("even")
  ) {
    return "border-slate-500 bg-slate-700 text-white";
  }

  return "border-slate-600 bg-slate-800 text-slate-100";
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
}: Props) {
  const [replay, setReplay] =
    useState<Replay | null>(null);

  const [message, setMessage] =
    useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  useEffect(() => {
    const controller =
      new AbortController();

    async function loadReplay() {
      try {
        setIsLoading(true);
        setMessage("");
        setReplay(null);

        const query =
          new URLSearchParams({
            slateId: String(slateId),
            playerId: String(playerId),
            round: String(roundNumber),
            hole: String(holeNumber),
          });

        const response = await fetch(
          `/api/golf/hole-replay?${query}`,
          {
            cache: "no-store",
            signal: controller.signal,
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

        if (
          !result.available ||
          !result.replay
        ) {
          setMessage(
            result.message ||
              "Shot tracking is not available for this hole yet.",
          );
          return;
        }

        setReplay(result.replay);
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
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadReplay();

    return () => controller.abort();
  }, [
    slateId,
    playerId,
    roundNumber,
    holeNumber,
  ]);

  const par =
    replay?.par ?? fallbackPar;

  const yardage =
    replay?.yardage ??
    fallbackYardage;

  const result =
    titleCase(replay?.holeStatus) ||
    fallbackResult;

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-slate-700 bg-slate-950 text-white shadow-xl">
      <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-4 py-3">
        <div>
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-400">
            Hole replay
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

            {result ? (
              <>
                <span aria-hidden="true">·</span>
                <strong
                  className={resultToneClass(
                    result,
                  )}
                >
                  {result}
                </strong>
              </>
            ) : null}
          </div>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xl text-slate-300 transition hover:bg-slate-800"
          aria-label="Close hole replay"
        >
          ×
        </button>
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
      ) : message ? (
        <div className="px-4 py-6 text-center">
          <div className="text-sm font-bold text-slate-200">
            Shot tracking unavailable
          </div>

          <div className="mt-1 text-xs leading-5 text-slate-500">
            {message}
          </div>
        </div>
      ) : replay ? (
        <div className="p-3 sm:p-4">
          <div className="overflow-hidden rounded-xl border border-slate-800">
            {replay.shots.map(
              (shot, index) => {
                const summary =
                  shotSummary(
                    shot,
                    result,
                  );

                return (
                  <article
                    key={shot.strokeNumber}
                    className={`px-3 py-3 sm:px-4 ${
                      index > 0
                        ? "border-t border-slate-800"
                        : ""
                    }`}
                  >
                    <div className="flex gap-3">
                      <span
                        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-black ${
                          shot.finalStroke
                            ? resultBadgeClass(result)
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
                                        result,
                                      )
                                    : "text-slate-200"
                                }`}
                              >
                                {summary}
                              </span>
                            </>
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
                  </article>
                );
              },
            )}
          </div>

          <div className="mt-3 text-center text-[10px] text-slate-600">
            Shot data provided on demand from PGA TOUR tracking.
          </div>
        </div>
      ) : null}
    </section>
  );
}
