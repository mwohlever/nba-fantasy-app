"use client";

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
};

type CoordinateSet = {
  from: Coordinate;
  to: Coordinate;
};

type MapShot = {
  strokeNumber: number;
  distance: string | null;
  distanceRemaining: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  finalStroke: boolean;
  bottomToTop: CoordinateSet | null;
};

type Props = {
  title: string;
  imageUrl: string;
  shots: MapShot[];
  selectedStrokeNumber: number | null;
  onSelectStroke: (
    strokeNumber: number,
  ) => void;
};

type PlotPoint = {
  x: number;
  y: number;
};

type PlotShot = {
  strokeNumber: number;
  from: PlotPoint;
  to: PlotPoint;
  finalStroke: boolean;
  distance: string | null;
  distanceRemaining: string | null;
  fromLocation: string | null;
  toLocation: string | null;
};

type TransformState = {
  scale: number;
  x: number;
  y: number;
  rotation: number;
};

type PointerPosition = {
  x: number;
  y: number;
};

type GestureSnapshot = {
  distance: number;
  angle: number;
  midpoint: PointerPosition;
  transform: TransformState;
};

type MapCalibration = {
  xScale: number;
  xOffset: number;
  yScale: number;
  yOffset: number;
};

const VIEWBOX_SIZE = 1000;
const MIN_SCALE = 1;
const MAX_SCALE = 5;

/*
 * Rocket Classic · Detroit Golf Club · Hole 8
 *
 * These values map PGA TOUR's normalized TourCast coordinates
 * onto the terrain08 aerial texture. The final-stroke endpoint
 * remains dynamic, so different round-by-round pin locations
 * are plotted automatically.
 */
const HOLE_CALIBRATION: MapCalibration = {
  xScale: 2.488624,
  xOffset: -0.748272,
  yScale: 0.974452,
  yOffset: 0.127478,
};

const DEFAULT_TRANSFORM: TransformState = {
  scale: 1,
  x: 0,
  y: 0,
  rotation: 0,
};

function clamp(
  value: number,
  minimum: number,
  maximum: number,
) {
  return Math.min(
    maximum,
    Math.max(minimum, value),
  );
}

function clampNormalized(
  value: number,
) {
  return clamp(value, 0, 1);
}

function validPoint(
  coordinate: Coordinate | null | undefined,
): coordinate is {
  x: number;
  y: number;
} {
  return (
    coordinate?.x !== null &&
    coordinate?.x !== undefined &&
    coordinate?.y !== null &&
    coordinate?.y !== undefined &&
    Number.isFinite(coordinate.x) &&
    Number.isFinite(coordinate.y)
  );
}

function toPlotPoint(
  coordinate: {
    x: number;
    y: number;
  },
): PlotPoint {
  const calibratedX =
    clampNormalized(
      coordinate.x *
        HOLE_CALIBRATION.xScale +
        HOLE_CALIBRATION.xOffset,
    );

  const calibratedY =
    clampNormalized(
      coordinate.y *
        HOLE_CALIBRATION.yScale +
        HOLE_CALIBRATION.yOffset,
    );

  return {
    x: calibratedX * VIEWBOX_SIZE,
    y: calibratedY * VIEWBOX_SIZE,
  };
}

function curvePath(
  from: PlotPoint,
  to: PlotPoint,
) {
  const midpointX =
    (from.x + to.x) / 2;

  const midpointY =
    (from.y + to.y) / 2;

  const distance = Math.hypot(
    to.x - from.x,
    to.y - from.y,
  );

  const curveAmount =
    Math.min(42, distance * 0.075);

  return [
    `M ${from.x} ${from.y}`,
    `Q ${midpointX + curveAmount} ${midpointY}`,
    `${to.x} ${to.y}`,
  ].join(" ");
}

function shotDescription(
  shot: PlotShot,
) {
  return [
    shot.distance,
    shot.finalStroke
      ? "In the hole"
      : shot.distanceRemaining
        ? `${shot.distanceRemaining} remaining`
        : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function pointerDistance(
  first: PointerPosition,
  second: PointerPosition,
) {
  return Math.hypot(
    second.x - first.x,
    second.y - first.y,
  );
}

function pointerAngle(
  first: PointerPosition,
  second: PointerPosition,
) {
  return (
    Math.atan2(
      second.y - first.y,
      second.x - first.x,
    ) *
    (180 / Math.PI)
  );
}

function pointerMidpoint(
  first: PointerPosition,
  second: PointerPosition,
): PointerPosition {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
  };
}

export default function GolfHoleMap2D({
  title,
  imageUrl,
  shots,
  selectedStrokeNumber,
  onSelectStroke,
}: Props) {
  const viewportRef =
    useRef<HTMLDivElement | null>(
      null,
    );

  const pointersRef =
    useRef(
      new Map<number, PointerPosition>(),
    );

  const dragStartRef =
    useRef<{
      pointer: PointerPosition;
      transform: TransformState;
    } | null>(null);

  const gestureStartRef =
    useRef<GestureSnapshot | null>(
      null,
    );

  const [transform, setTransform] =
    useState<TransformState>(
      DEFAULT_TRANSFORM,
    );

  const [isInteracting, setIsInteracting] =
    useState(false);

  const [isPlaying, setIsPlaying] =
    useState(false);

  const plottedShots = useMemo(
    () =>
      shots
        .map((shot): PlotShot | null => {
          if (
            !shot.bottomToTop ||
            !validPoint(
              shot.bottomToTop.from,
            ) ||
            !validPoint(
              shot.bottomToTop.to,
            )
          ) {
            return null;
          }

          return {
            strokeNumber:
              shot.strokeNumber,
            from: toPlotPoint(
              shot.bottomToTop.from,
            ),
            to: toPlotPoint(
              shot.bottomToTop.to,
            ),
            finalStroke:
              shot.finalStroke,
            distance: shot.distance,
            distanceRemaining:
              shot.distanceRemaining,
            fromLocation:
              shot.fromLocation,
            toLocation:
              shot.toLocation,
          };
        })
        .filter(
          (
            shot,
          ): shot is PlotShot =>
            shot !== null,
        ),
    [shots],
  );

  const selectedShot =
    plottedShots.find(
      (shot) =>
        shot.strokeNumber ===
        selectedStrokeNumber,
    ) ??
    plottedShots[0] ??
    null;

  const constrainTransform =
    useCallback(
      (
        next: TransformState,
      ): TransformState => {
        const viewport =
          viewportRef.current;

        const width =
          viewport?.clientWidth ?? 400;

        const height =
          viewport?.clientHeight ?? 400;

        const scale =
          clamp(
            next.scale,
            MIN_SCALE,
            MAX_SCALE,
          );

        const maxX =
          Math.max(
            width * 0.85,
            ((scale - 1) * width) / 2 +
              width * 0.35,
          );

        const maxY =
          Math.max(
            height * 0.85,
            ((scale - 1) * height) / 2 +
              height * 0.35,
          );

        return {
          scale,
          x: clamp(
            next.x,
            -maxX,
            maxX,
          ),
          y: clamp(
            next.y,
            -maxY,
            maxY,
          ),
          rotation:
            ((next.rotation + 180) %
              360) -
            180,
        };
      },
      [],
    );

  const updateTransform =
    useCallback(
      (
        updater:
          | TransformState
          | ((
              current: TransformState,
            ) => TransformState),
      ) => {
        setTransform((current) => {
          const next =
            typeof updater ===
            "function"
              ? updater(current)
              : updater;

          return constrainTransform(
            next,
          );
        });
      },
      [constrainTransform],
    );

  const resetView =
    useCallback(() => {
      setIsPlaying(false);
      setTransform(
        DEFAULT_TRANSFORM,
      );
    }, []);

  const focusShot =
    useCallback(
      (
        shot: PlotShot | null,
      ) => {
        if (!shot) {
          resetView();
          return;
        }

        const viewport =
          viewportRef.current;

        if (!viewport) {
          return;
        }

        const width =
          viewport.clientWidth;

        const height =
          viewport.clientHeight;

        const targetScale =
          shot.strokeNumber === 1
            ? 1.55
            : shot.finalStroke
              ? 3.75
              : 3;

        const targetX =
          (shot.to.x /
            VIEWBOX_SIZE) *
          width;

        const targetY =
          (shot.to.y /
            VIEWBOX_SIZE) *
          height;

        const centerX = width / 2;
        const centerY = height / 2;

        updateTransform({
          scale: targetScale,
          x:
            (centerX - targetX) *
            targetScale,
          y:
            (centerY - targetY) *
            targetScale,
          rotation: 0,
        });
      },
      [
        resetView,
        updateTransform,
      ],
    );

  function zoomAroundPoint(
    clientX: number,
    clientY: number,
    scaleMultiplier: number,
  ) {
    const viewport =
      viewportRef.current;

    if (!viewport) {
      return;
    }

    const rect =
      viewport.getBoundingClientRect();

    const localX =
      clientX - rect.left;

    const localY =
      clientY - rect.top;

    updateTransform(
      (current) => {
        const nextScale =
          clamp(
            current.scale *
              scaleMultiplier,
            MIN_SCALE,
            MAX_SCALE,
          );

        const ratio =
          nextScale /
          current.scale;

        const centerX =
          rect.width / 2;

        const centerY =
          rect.height / 2;

        return {
          ...current,
          scale: nextScale,
          x:
            localX -
            centerX -
            (localX -
              centerX -
              current.x) *
              ratio,
          y:
            localY -
            centerY -
            (localY -
              centerY -
              current.y) *
              ratio,
        };
      },
    );
  }

  function handleWheel(
    event: React.WheelEvent<HTMLDivElement>,
  ) {
    event.preventDefault();

    zoomAroundPoint(
      event.clientX,
      event.clientY,
      event.deltaY < 0
        ? 1.12
        : 0.89,
    );
  }

  function handleDoubleClick(
    event: React.MouseEvent<HTMLDivElement>,
  ) {
    zoomAroundPoint(
      event.clientX,
      event.clientY,
      transform.scale >= 2.5
        ? 0.5
        : 1.75,
    );
  }

  function handlePointerDown(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    const target =
      event.target as Element | null;

    /*
     * Shot markers control replay selection. Do not let the
     * pan/zoom layer capture those presses as drag gestures.
     */
    if (
      target?.closest(
        '[data-shotcast-marker="true"]',
      )
    ) {
      return;
    }

    const viewport =
      viewportRef.current;

    if (!viewport) {
      return;
    }

    viewport.setPointerCapture(
      event.pointerId,
    );

    pointersRef.current.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY,
      },
    );

    setIsInteracting(true);
    setIsPlaying(false);

    const pointers = [
      ...pointersRef.current.values(),
    ];

    if (pointers.length === 1) {
      dragStartRef.current = {
        pointer: pointers[0],
        transform: {
          ...transform,
        },
      };

      gestureStartRef.current =
        null;
    } else if (
      pointers.length >= 2
    ) {
      const first = pointers[0];
      const second = pointers[1];

      gestureStartRef.current = {
        distance:
          pointerDistance(
            first,
            second,
          ),
        angle:
          pointerAngle(
            first,
            second,
          ),
        midpoint:
          pointerMidpoint(
            first,
            second,
          ),
        transform: {
          ...transform,
        },
      };

      dragStartRef.current =
        null;
    }
  }

  function handlePointerMove(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    if (
      !pointersRef.current.has(
        event.pointerId,
      )
    ) {
      return;
    }

    pointersRef.current.set(
      event.pointerId,
      {
        x: event.clientX,
        y: event.clientY,
      },
    );

    const pointers = [
      ...pointersRef.current.values(),
    ];

    if (
      pointers.length === 1 &&
      dragStartRef.current
    ) {
      const pointer =
        pointers[0];

      const start =
        dragStartRef.current;

      updateTransform({
        ...start.transform,
        x:
          start.transform.x +
          pointer.x -
          start.pointer.x,
        y:
          start.transform.y +
          pointer.y -
          start.pointer.y,
      });

      return;
    }

    if (
      pointers.length >= 2 &&
      gestureStartRef.current
    ) {
      const first = pointers[0];
      const second = pointers[1];

      const distance =
        pointerDistance(
          first,
          second,
        );

      const angle =
        pointerAngle(
          first,
          second,
        );

      const midpoint =
        pointerMidpoint(
          first,
          second,
        );

      const start =
        gestureStartRef.current;

      const distanceRatio =
        start.distance > 0
          ? distance /
            start.distance
          : 1;

      updateTransform({
        scale:
          start.transform.scale *
          distanceRatio,
        rotation:
          start.transform.rotation +
          angle -
          start.angle,
        x:
          start.transform.x +
          midpoint.x -
          start.midpoint.x,
        y:
          start.transform.y +
          midpoint.y -
          start.midpoint.y,
      });
    }
  }

  function releasePointer(
    event: React.PointerEvent<HTMLDivElement>,
  ) {
    pointersRef.current.delete(
      event.pointerId,
    );

    if (
      event.currentTarget.hasPointerCapture(
        event.pointerId,
      )
    ) {
      event.currentTarget.releasePointerCapture(
        event.pointerId,
      );
    }

    const pointers = [
      ...pointersRef.current.values(),
    ];

    if (pointers.length === 0) {
      dragStartRef.current =
        null;

      gestureStartRef.current =
        null;

      setIsInteracting(false);
    } else if (
      pointers.length === 1
    ) {
      dragStartRef.current = {
        pointer: pointers[0],
        transform: {
          ...transform,
        },
      };

      gestureStartRef.current =
        null;
    }
  }

  useEffect(() => {
    if (!isPlaying) {
      return;
    }

    if (
      plottedShots.length === 0
    ) {
      setIsPlaying(false);
      return;
    }

    const currentIndex =
      plottedShots.findIndex(
        (shot) =>
          shot.strokeNumber ===
          selectedStrokeNumber,
      );

    const activeIndex =
      currentIndex < 0
        ? 0
        : currentIndex;

    const currentShot =
      plottedShots[activeIndex];

    focusShot(currentShot);

    if (
      activeIndex >=
      plottedShots.length - 1
    ) {
      const timeout =
        window.setTimeout(() => {
          setIsPlaying(false);
        }, 1700);

      return () =>
        window.clearTimeout(
          timeout,
        );
    }

    const timeout =
      window.setTimeout(() => {
        onSelectStroke(
          plottedShots[
            activeIndex + 1
          ].strokeNumber,
        );
      }, 1900);

    return () =>
      window.clearTimeout(timeout);
  }, [
    focusShot,
    isPlaying,
    onSelectStroke,
    plottedShots,
    selectedStrokeNumber,
  ]);

  function startPlayback() {
    if (!plottedShots[0]) {
      return;
    }

    onSelectStroke(
      plottedShots[0].strokeNumber,
    );

    focusShot(
      plottedShots[0],
    );

    setIsPlaying(true);
  }

  function selectShot(
    strokeNumber: number,
  ) {
    setIsPlaying(false);

    onSelectStroke(
      strokeNumber,
    );

    focusShot(
      plottedShots.find(
        (shot) =>
          shot.strokeNumber ===
          strokeNumber,
      ) ?? null,
    );
  }

  if (plottedShots.length === 0) {
    return null;
  }

  const inverseScale =
    1 / transform.scale;

  const markerRadius =
    25 * inverseScale;

  const markerStroke =
    Math.max(
      3,
      7 * inverseScale,
    );

  const markerFontSize =
    Math.max(
      12,
      29 * inverseScale,
    );

  return (
    <section className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-3 py-2.5">
        <div>
          <div className="text-[9px] font-black uppercase tracking-[0.16em] text-emerald-400">
            ShotCast replay
          </div>

          <div className="mt-0.5 text-xs font-bold text-slate-200">
            {title}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() =>
              focusShot(
                selectedShot,
              )
            }
            className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-[10px] font-bold text-slate-300"
          >
            Focus shot
          </button>

          <button
            type="button"
            onClick={startPlayback}
            disabled={isPlaying}
            className="rounded-lg border border-emerald-600 bg-emerald-950 px-3 py-1.5 text-[10px] font-bold text-emerald-200 disabled:opacity-50"
          >
            {isPlaying
              ? "Playing…"
              : "▶ Play"}
          </button>

          <button
            type="button"
            onClick={resetView}
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-[10px] font-bold text-slate-400"
          >
            Reset
          </button>
        </div>
      </header>

      <div className="grid gap-3 p-3 sm:grid-cols-[minmax(260px,430px)_1fr]">
        <div className="mx-auto w-full max-w-[430px]">
          <div
            ref={viewportRef}
            className={`relative aspect-square overflow-hidden rounded-xl border border-slate-700 bg-slate-950 select-none ${
              isInteracting
                ? "cursor-grabbing"
                : "cursor-grab"
            }`}
            style={{
              touchAction: "none",
            }}
            onWheel={handleWheel}
            onDoubleClick={
              handleDoubleClick
            }
            onPointerDown={
              handlePointerDown
            }
            onPointerMove={
              handlePointerMove
            }
            onPointerUp={
              releasePointer
            }
            onPointerCancel={
              releasePointer
            }
          >
            <div
              className="absolute inset-0 will-change-transform"
              style={{
                transform: [
                  `translate3d(${transform.x}px, ${transform.y}px, 0)`,
                  `scale(${transform.scale})`,
                  `rotate(${transform.rotation}deg)`,
                ].join(" "),
                transformOrigin:
                  "50% 50%",
                transition:
                  isInteracting
                    ? "none"
                    : "transform 650ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <img
                src={imageUrl}
                alt={`${title} aerial hole layout`}
                draggable={false}
                className="absolute inset-0 h-full w-full object-fill"
              />

              <svg
                viewBox={`0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}`}
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full"
                role="img"
                aria-label={`${title} shot paths`}
              >
                <defs>
                  <filter
                    id="shot-path-shadow"
                    x="-40%"
                    y="-40%"
                    width="180%"
                    height="180%"
                  >
                    <feDropShadow
                      dx="0"
                      dy="2"
                      stdDeviation={
                        3 *
                        inverseScale
                      }
                      floodColor="#020617"
                      floodOpacity="0.95"
                    />
                  </filter>
                </defs>

                {plottedShots.map(
                  (shot) => {
                    const isSelected =
                      shot.strokeNumber ===
                      selectedShot
                        ?.strokeNumber;

                    return (
                      <g
                        key={`path-${shot.strokeNumber}`}
                        data-shotcast-marker="true"
                        className="cursor-pointer"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();

                          selectShot(
                            shot.strokeNumber,
                          );
                        }}
                      >
                        <circle
                          cx={shot.to.x}
                          cy={shot.to.y}
                          r={
                            markerRadius *
                            1.85
                          }
                          fill="transparent"
                          stroke="transparent"
                          pointerEvents="all"
                        />

                        <path
                          d={curvePath(
                            shot.from,
                            shot.to,
                          )}
                          fill="none"
                          stroke={
                            isSelected
                              ? "#facc15"
                              : "#f8fafc"
                          }
                          strokeWidth={
                            (isSelected
                              ? 11
                              : 7) *
                            inverseScale
                          }
                          strokeLinecap="round"
                          strokeDasharray={
                            isSelected
                              ? "0"
                              : `${18 * inverseScale} ${13 * inverseScale}`
                          }
                          opacity={
                            isSelected
                              ? 1
                              : 0.75
                          }
                          filter="url(#shot-path-shadow)"
                        />

                        <circle
                          cx={shot.to.x}
                          cy={shot.to.y}
                          r={
                            isSelected
                              ? markerRadius *
                                1.2
                              : markerRadius
                          }
                          fill={
                            shot.finalStroke
                              ? "#10b981"
                              : isSelected
                                ? "#facc15"
                                : "#0f172a"
                          }
                          stroke="#ffffff"
                          strokeWidth={
                            markerStroke
                          }
                          filter="url(#shot-path-shadow)"
                        />

                        <text
                          x={shot.to.x}
                          y={
                            shot.to.y +
                            markerFontSize *
                              0.34
                          }
                          textAnchor="middle"
                          fontSize={
                            markerFontSize
                          }
                          fontWeight="900"
                          fill={
                            isSelected &&
                            !shot.finalStroke
                              ? "#111827"
                              : "#ffffff"
                          }
                          className="pointer-events-none select-none"
                        >
                          {
                            shot.strokeNumber
                          }
                        </text>
                      </g>
                    );
                  },
                )}

                {plottedShots[0] ? (
                  <g>
                    <circle
                      cx={
                        plottedShots[0]
                          .from.x
                      }
                      cy={
                        plottedShots[0]
                          .from.y
                      }
                      r={
                        21 *
                        inverseScale
                      }
                      fill="#0f172a"
                      stroke="#ffffff"
                      strokeWidth={
                        markerStroke
                      }
                      filter="url(#shot-path-shadow)"
                    />

                    <text
                      x={
                        plottedShots[0]
                          .from.x
                      }
                      y={
                        plottedShots[0]
                          .from.y +
                        markerFontSize *
                          0.3
                      }
                      textAnchor="middle"
                      fontSize={
                        markerFontSize *
                        0.86
                      }
                      fontWeight="900"
                      fill="#ffffff"
                      className="pointer-events-none select-none"
                    >
                      T
                    </text>
                  </g>
                ) : null}
              </svg>
            </div>

            <div className="pointer-events-none absolute bottom-2 left-2 rounded-lg border border-white/10 bg-slate-950/85 px-2 py-1 text-[9px] text-slate-300 backdrop-blur">
              Drag · Pinch · Twist · Scroll
            </div>

            <div className="pointer-events-none absolute right-2 top-2 rounded-lg border border-white/10 bg-slate-950/80 px-2 py-1 text-[9px] text-slate-300 backdrop-blur">
              {transform.scale.toFixed(
                1,
              )}
              × ·{" "}
              {Math.round(
                transform.rotation,
              )}
              °
            </div>
          </div>
        </div>

        <div className="min-w-0">
          {selectedShot ? (
            <div className="rounded-xl border border-slate-700 bg-slate-950 p-3">
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-black ${
                    selectedShot.finalStroke
                      ? "border-emerald-400 bg-emerald-700 text-white"
                      : "border-yellow-400 bg-yellow-300 text-slate-950"
                  }`}
                >
                  {
                    selectedShot.strokeNumber
                  }
                </span>

                <div className="min-w-0">
                  <div className="text-sm font-black text-white">
                    Shot{" "}
                    {
                      selectedShot.strokeNumber
                    }
                  </div>

                  <div className="mt-0.5 text-xs font-bold text-slate-300">
                    {shotDescription(
                      selectedShot,
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-3 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-400">
                {selectedShot.fromLocation ||
                  "Unknown lie"}

                <span className="mx-2 text-slate-600">
                  →
                </span>

                {selectedShot.finalStroke
                  ? "Hole"
                  : selectedShot.toLocation ||
                    "Unknown lie"}
              </div>
            </div>
          ) : null}

          <div className="mt-3 text-[10px] leading-4 text-slate-500">
            Drag or pinch for a closer view. Twist with two fingers to rotate the course.
          </div>
        </div>
      </div>
    </section>
  );
}
