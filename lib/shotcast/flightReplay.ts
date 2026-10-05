import type { Point3 } from "./productionGeometry";
import { reconstructGenericPgaFlight, type RadarFit } from "./pgaFlight";

export const FLIGHT_ANCHOR_TOLERANCE = 1e-8; // CPU geometry; stored endpoints are exact copies.
export const FLIGHT_REVEAL_SECONDS = 3; // Presentation choice, not physical/PGA timing parity.
export type FlightPath = {
  strokeNumber: number;
  points: readonly Point3[];
  flightCount: number;
  originCorrection: Point3;
  coefficientContactTime: number;
  source: "pga-radar-endpoint-constrained";
};

/** Preserve the airborne residual about its linear coefficient-time chord.
 * Q(t)=P(t)+(A-P(0))*(1-t/T). No height change; landing and connector unchanged.
 * Only small horizontal origin disagreements are eligible. Inputs are untouched. */
export function constrainFlightOrigin(
  points: readonly Point3[], times: readonly number[], flightCount: number,
  from: Point3, endpoint: Point3, surface: (x: number, y: number) => number | null,
): readonly Point3[] {
  if (!Number.isInteger(flightCount) || flightCount < 2 || flightCount > points.length || times.length !== flightCount ||
    [from, endpoint].some(p => p.length !== 3 || !p.every(Number.isFinite)) ||
    times[0] !== 0 || !points.every(p => p.length === 3 && p.every(Number.isFinite)) ||
    times.some((t, i) => !Number.isFinite(t) || (i > 0 && t <= times[i - 1]))) throw new Error("Invalid flight shape");
  const first = points[0], landing = points[flightCount - 1], last = points.at(-1)!;
  const correction = from.map((v, i) => v - first[i]) as [number, number, number];
  if (Math.abs(correction[2]) > FLIGHT_ANCHOR_TOLERANCE ||
    Math.hypot(...last.map((v, i) => v - endpoint[i])) > FLIGHT_ANCHOR_TOLERANCE ||
    Math.hypot(correction[0], correction[1]) > 0.01 * Math.hypot(landing[0] - first[0], landing[1] - first[1])) {
    throw new Error("Flight discrepancy exceeds supported horizontal origin constraint");
  }
  const duration = times.at(-1)!;
  const result = points.map((p, i): Point3 => {
    if (i === 0) return Object.freeze([...from] as [number, number, number]);
    if (i === points.length - 1) return Object.freeze([...endpoint] as [number, number, number]);
    const weight = i < flightCount - 1 ? 1 - times[i] / duration : 0;
    // Vertical donor geometry is preserved, including terrain connector heights.
    const point: Point3 = Object.freeze([p[0] + correction[0] * weight, p[1] + correction[1] * weight, p[2]]);
    const height = surface(point[0], point[1]);
    if (height === null || !Number.isFinite(height) || (i < flightCount - 1 && point[2] < height - FLIGHT_ANCHOR_TOLERANCE)) throw new Error("Constrained flight leaves supported terrain");
    return point;
  });
  return Object.freeze(result);
}

export function buildFlightPath(strokeNumber: number, fit: RadarFit, tee: Point3, from: Point3, endpoint: Point3, fairway: Point3, surface: (x: number, y: number) => number | null): FlightPath {
  const source = reconstructGenericPgaFlight(fit, tee, from, endpoint, fairway, surface);
  const points = constrainFlightOrigin(source.points, source.coefficientTimes, source.flightCount, from, endpoint, surface);
  return freezeFlightPath({ strokeNumber, points, flightCount: source.flightCount,
    originCorrection: from.map((v, i) => v - source.points[0][i]) as [number, number, number],
    coefficientContactTime: source.coefficientImpactTime, source: "pga-radar-endpoint-constrained" });
}

export function freezeFlightPath(path: FlightPath): FlightPath {
  path.points.forEach(Object.freeze);
  Object.freeze(path.points); Object.freeze(path.originCorrection);
  return Object.freeze(path);
}

/** Arc-length reveal over a fixed presentation duration; exact CPU boundaries. */
export function createFlightReveal(points: readonly Point3[]) {
  const distances = [0];
  for (let i = 1; i < points.length; i++) distances.push(distances[i - 1] + Math.hypot(...points[i].map((v, a) => v - points[i - 1][a])));
  const length = distances.at(-1)!;
  if (points.length < 2 || !(length > 0) || !Number.isFinite(length)) throw new Error("Invalid flight reveal");
  const sample = (seconds: number) => {
    if (!Number.isFinite(seconds)) throw new Error("Invalid reveal time");
    const fraction = Math.max(0, Math.min(1, seconds / FLIGHT_REVEAL_SECONDS));
    if (fraction === 0) return { position: points[0], segment: 0, fraction };
    if (fraction === 1) return { position: points.at(-1)!, segment: points.length - 2, fraction };
    const distance = length * fraction;
    let segment = 0;
    while (segment < points.length - 2 && distance > distances[segment + 1]) segment++;
    const span = distances[segment + 1] - distances[segment];
    const t = span > 0 ? (distance - distances[segment]) / span : 0;
    const a = points[segment], b = points[segment + 1];
    const position: Point3 = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])];
    return { position, segment, fraction };
  };
  return { sample };
}

/** Selection, playback and camera are independent. No reference to world objects. */
export function createFlightPlayback(paths: readonly FlightPath[]) {
  const reveals = new Map(paths.map(path => [path.strokeNumber, createFlightReveal(path.points)]));
  let selected: number | null = null, phase: "idle" | "playing" | "finished" = "idle";
  let elapsed = 0, previous: number | null = null;
  const reset = () => { phase = "idle"; elapsed = 0; previous = null; };
  return {
    select(stroke: number | null) { selected = stroke; reset(); },
    play() { reset(); if (selected === null || !reveals.has(selected)) return false; phase = "playing"; return true; },
    reset,
    tick(timestamp: number, active: boolean) {
      if (!active || phase !== "playing" || !Number.isFinite(timestamp)) { previous = null; return; }
      if (previous !== null) elapsed = Math.min(FLIGHT_REVEAL_SECONDS, elapsed + Math.max(0, (timestamp - previous) / 1000));
      previous = timestamp;
      if (elapsed === FLIGHT_REVEAL_SECONDS) { phase = "finished"; previous = null; }
    },
    snapshot() { return { selected, phase, elapsed, sample: phase === "idle" || selected === null ? null : reveals.get(selected)!.sample(elapsed) }; },
  };
}
