import type { Point3 } from "./productionGeometry";
export type RadarFit = { xFit: readonly number[]; yFit: readonly number[]; zFit: readonly number[]; timeInterval: readonly number[]; type: string; impactTime?: number };
type XYZ = [number, number, number];

/** PGA 3.3.1 Xs ascending-power evaluation; coefficients are already engine units. */
export function evaluateRadarFit(fit: RadarFit, seconds: number): XYZ {
  if (!Number.isFinite(seconds)) throw new Error("Nonfinite coefficient time");
  const arrays = [fit.xFit, fit.yFit, fit.zFit];
  if (arrays.some(a => !a.length || a.length > 12 || a.some(v => !Number.isFinite(v)))) throw new Error("Invalid PGA coefficients");
  const powers = [1];
  for (let i = 1; i < Math.max(...arrays.map(a => a.length)); i++) powers[i] = seconds * powers[i - 1];
  return arrays.map(a => a.reduce((sum, c, i) => sum + powers[i] * c, 0)) as XYZ;
}

/** Source-derived PGA 3.3.1 jm/HP/Wu/$m geometry, selectively migrated from the
 * donor generalFlightResearch.ts. This remains the unconstrained source model.
 * Only interior-surface, zero-origin, no-impactTime Broadcast/Incoming branches.
 * Does not assert physical time, bounce or sampled ball motion. */
export function reconstructGenericPgaFlight(fit: RadarFit, tee: Point3, start: Point3, end: Point3, fairway: Point3, surface: (x: number, y: number) => number | null) {
  const [p, g] = fit.timeInterval, step = 0.05;
  if (p !== 0 || !(g > p) || !Number.isFinite(g) || g > 20 || fit.timeInterval.length !== 2 || fit.impactTime !== undefined || !['broadcast', 'incoming'].includes(fit.type.toLowerCase())) throw new Error('Unsupported radar representation');
  evaluateRadarFit(fit, 0);
  if ([tee, start, end, fairway].some(p => p.length !== 3 || !p.every(Number.isFinite))) throw new Error('Invalid flight anchor');
  const angle = Math.atan2(tee[0] - fairway[0], fairway[1] - tee[1]);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const mapped = (seconds: number): XYZ => {
    const [x, y, z] = evaluateRadarFit(fit, seconds);
    return [z * cos - x * sin + tee[0], z * sin + x * cos + tee[1], y + start[2] - fit.yFit[0]];
  };
  const ground = (v: XYZ) => {
    const z = surface(v[0], v[1]);
    if (z === null || !Number.isFinite(z)) throw new Error('Unsupported PGA surface fallback/edge retry');
    return z;
  };
  const points: XYZ[] = [], times: number[] = [];
  let seconds = p, limit = g + step, extensions = 0, completedBatch = true;
  while (seconds < g + 3 + step) {
    completedBatch = true;
    while (seconds < limit) { points.push(mapped(seconds)); times.push(seconds); seconds += step; }
    if (points[points.length - 1][2] <= ground(points[points.length - 1])) break;
    limit += 0.5; extensions++; completedBatch = false;
  }
  // PGA's exhausted/snap branch is a different capability; keep unsupported.
  if (!completedBatch || !points.length || points[points.length - 1][2] > ground(points[points.length - 1])) throw new Error('Unsupported PGA exhausted-flight snap branch');
  let lo = Math.max(points.length - (1 / step | 0) - 1, 0), hi = points.length - 1;
  while (lo > 0) {
    if (points[lo][2] < ground(points[lo])) { hi = lo; lo = Math.max(lo - (0.5 / step | 0), 0); } else break;
  }
  let left = lo, right = hi;
  while (left < right) {
    const mid = (right + left) / 2 | 0;
    if (points[mid][2] > ground(points[mid])) left = mid + 1; else right = mid;
  }
  const index = left === 0 ? left : left - 1;
  let lower = p + step * index, upper = lower + step, landing = points[index];
  while (upper - lower > 0.001) {
    const t = (lower + upper) / 2, candidate = mapped(t), height = ground(candidate), delta = candidate[2] - height;
    if (delta < 0) upper = t;
    else { lower = t; candidate[2] = height; landing = candidate; if (delta < 0.01) break; }
  }
  points.length = index + 2; times.length = index + 2;
  points[index + 1] = landing; times[index + 1] = lower;
  const correction = start.map((v, i) => v - points[0][i]) as XYZ;
  const distance = (a: Point3, b: Point3) => Math.hypot(...a.map((v, i) => v - b[i]));
  const startCorrectionApplied = distance(tee, start) > 20 || fit.type.toLowerCase() === 'incoming';
  if (startCorrectionApplied) for (let i = 0; i < points.length; i++) {
    const weight = 1 - Math.min(i * step / (lower - p), 1);
    points[i] = points[i].map((v, axis) => v + correction[axis] * weight) as XYZ;
  }
  const flightCount = points.length;
  if (distance(landing, end) > 1000) throw new Error('Unsupported endpoint connector length');
  const requestedSegments = distance(landing, end) * 2 | 0, segments = requestedSegments > 2 ? requestedSegments : 3;
  const midpoint = landing.map((v, i) => v + (end[i] - v) * 0.5) as XYZ;
  for (let i = 1; i <= segments; i++) {
    const f = i / segments;
    const point = landing.map((v, axis) => (1 - f) * (1 - f) * v + 2 * f * (1 - f) * midpoint[axis] + f * f * end[axis]) as XYZ;
    if (i < segments) point[2] = ground(point);
    points.push(point);
  }
  return { points, coefficientTimes: times, flightCount, coefficientImpactTime: lower, landing, correction, startCorrectionApplied, extensions, angle, step, mapped };
}
