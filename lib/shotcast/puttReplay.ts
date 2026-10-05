import { convertNativePoint, type CourseOffset, type Point3 } from "./productionGeometry";
import type { GreenTopography } from "./greenTopography";
import type { GolfBallPath } from "../providers/pgaTourShots";

// Adapted donor supplied-time / exact triangle surface replay. These are
// presentation connector limits, not physics, glyph lift or coordinate offsets.
export const PUTT_ANCHOR_TOLERANCE = 1e-8;
export const PUTT_MAX_CUP_GAP = 0.02;
export const PUTT_CUP_SECONDS = 0.24;
export type PuttPath = {
  strokeNumber: number;
  source: "pga-supplied-putt-simulation";
  samples: readonly { position: Point3; native: Point3; secondsSinceStart: number }[];
  from: Point3;
  endpoint: Point3;
  sourceDuration: number;
  connectorSeconds: number;
};
const gap = (a: Point3, b: Point3) => Math.hypot(...a.map((v, i) => v - b[i]));

export function freezePuttPath(path: PuttPath): PuttPath {
  for (const p of path.samples) { Object.freeze(p.position); Object.freeze(p.native); Object.freeze(p); }
  Object.freeze(path.samples); Object.freeze(path.from); Object.freeze(path.endpoint);
  return Object.freeze(path);
}

/** No fitted curve: every supplied native sample/time survives the handoff.
 * Only a made-cup millimetre residual may have an explicitly separate connector. */
export function buildPuttPath(strokeNumber: number, source: GolfBallPath, offset: CourseOffset,
  from: Point3, endpoint: Point3, pin: Point3, made: boolean, topo: GreenTopography): PuttPath {
  if (source.reconstructionType?.toLowerCase() !== "simulation" || source.path.length < 2 || source.path.length > 4096) throw new Error("Unsupported supplied putt path");
  const samples = source.path.map((p, i) => {
    if (![p.x, p.y, p.z, p.secondsSinceStart].every(v => typeof v === "number" && Number.isFinite(v)) ||
      (i === 0 ? p.secondsSinceStart !== 0 : p.secondsSinceStart <= source.path[i - 1].secondsSinceStart)) throw new Error("Invalid putt sample ordering");
    const native: Point3 = [p.x, p.y, p.z!];
    const [x, y] = convertNativePoint({ tourcastX: p.x, tourcastY: p.y, tourcastZ: p.z! }, offset);
    const hit = topo.sample(x, y);
    if (!hit) throw new Error("Putt sample outside authored green");
    return { position: [x, y, hit.elevation] as Point3, native, secondsSinceStart: p.secondsSinceStart };
  });
  if (gap(samples[0].position, from) > PUTT_ANCHOR_TOLERANCE) throw new Error("Putt start differs from authoritative anchor");
  const endGap = gap(samples.at(-1)!.position, endpoint);
  const connectorSeconds = endGap > PUTT_ANCHOR_TOLERANCE ? PUTT_CUP_SECONDS : 0;
  if (connectorSeconds && (!made || source.isLipOut || gap(endpoint, pin) > PUTT_ANCHOR_TOLERANCE || endGap > PUTT_MAX_CUP_GAP)) throw new Error("Putt endpoint cannot reconcile with authoritative cup");
  for (const p of [from, endpoint]) {
    const hit = topo.sample(p[0], p[1]);
    if (!hit || Math.abs(hit.elevation - p[2]) > PUTT_ANCHOR_TOLERANCE) throw new Error("Putt anchor is outside authored green");
  }
  const path = freezePuttPath({ strokeNumber, source: "pga-supplied-putt-simulation", samples,
    from: [...from] as Point3, endpoint: [...endpoint] as Point3,
    sourceDuration: samples.at(-1)!.secondsSinceStart, connectorSeconds });
  // Validate the displayed interpolation too, not just its source samples.
  // 2cm subdivisions bound work; runtime still fails closed on any off-mesh hit.
  const reveal = createPuttReplay(path, topo);
  reveal.displayPoints();
  return path;
}

export function createPuttReplay(path: PuttPath, topo: GreenTopography) {
  const { samples, sourceDuration, connectorSeconds } = path;
  const duration = sourceDuration + connectorSeconds;
  const sample = (seconds: number) => {
    if (!Number.isFinite(seconds)) throw new Error("Invalid putt time");
    if (seconds <= 0) return { position: path.from, segment: 0, fraction: 0 };
    if (seconds >= duration) return { position: path.endpoint, segment: samples.length - 2 + (connectorSeconds ? 1 : 0), fraction: 1 };
    let segment = 0;
    while (segment < samples.length - 2 && seconds > samples[segment + 1].secondsSinceStart) segment++;
    const connector = connectorSeconds > 0 && seconds > sourceDuration;
    const a = connector ? samples.at(-1)!.position : samples[segment].position;
    const b = connector ? path.endpoint : samples[segment + 1].position;
    const t = connector ? (seconds - sourceDuration) / connectorSeconds :
      (seconds - samples[segment].secondsSinceStart) / (samples[segment + 1].secondsSinceStart - samples[segment].secondsSinceStart);
    const x = a[0] + t * (b[0] - a[0]), y = a[1] + t * (b[1] - a[1]);
    const hit = topo.sample(x, y);
    if (!hit) throw new Error("Putt interpolation leaves authored green");
    return { position: [x, y, hit.elevation] as Point3, segment: connector ? samples.length - 1 : segment, fraction: seconds / duration };
  };
  const displayPoints = () => {
    const times: number[] = [0];
    const nodes = [...samples, ...(connectorSeconds ? [{ position: path.endpoint, secondsSinceStart: duration }] : [])];
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i], steps = Math.max(1, Math.ceil(gap(a.position, b.position) / 0.02));
      for (let j = 1; j <= steps; j++) times.push(a.secondsSinceStart + (b.secondsSinceStart - a.secondsSinceStart) * j / steps);
    }
    return { points: times.map(t => sample(t).position), times };
  };
  return { duration, sample, displayPoints };
}
