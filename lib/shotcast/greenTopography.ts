import type { TerrainPrimitive as Primitive } from './productionGeometry';

/** Metres, right-handed engine XY and Z-up. Magnitude is rise/run, not degrees. */
export type GreenSample = {
  elevation: number;
  normalizedElevation: number;
  slopeMagnitude: number;
  downhillX: number;
  downhillY: number;
  primitive: number;
  triangle: number;
};
export const createGreenSample = (): GreenSample => ({ elevation: 0, normalizedElevation: 0, slopeMagnitude: 0, downhillX: 0, downhillY: 0, primitive: -1, triangle: -1 });
type Face = {
  ax: number; ay: number; az: number; bx: number; by: number; cx: number; cy: number;
  denominator: number; gradientX: number; gradientY: number; magnitude: number;
  primitive: number; triangle: number;
};
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Exact triangle-plane field. Spatial buckets accelerate the validated XY barycentric
 * containment / vertical-intersection principle without changing registration code.
 * Authored NORMAL is deliberately not used for physical slope.
 */
export function createGreenTopography(meshes: Primitive[]) {
  const faces: Face[] = [], elevations: number[] = [];
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
  let vertices = 0, skippedTriangles = 0;
  for (let pi = 0; pi < meshes.length; pi++) {
    const { positions: p, indices } = meshes[pi];
    if (p.length % 3 || indices.length % 3) throw new Error('Invalid green triangle buffers');
    const used = new Set<number>();
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
      if ([a, b, c].some(v => v + 2 >= p.length)) throw new Error('Green index outside positions');
      if (![p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]].every(Number.isFinite)) throw new Error('Nonfinite green geometry');
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
      const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
      const nz = ux * vy - uy * vx;
      // Vertical/degenerate faces cannot define a single Z over XY.
      if (Math.abs(nz) < 1e-12) { skippedTriangles++; continue; }
      const gradientX = (uz * vy - uy * vz) / nz;
      const gradientY = (ux * vz - uz * vx) / nz;
      faces.push({ ax: p[a], ay: p[a + 1], az: p[a + 2], bx: p[b], by: p[b + 1], cx: p[c], cy: p[c + 1], denominator: nz, gradientX, gradientY, magnitude: Math.hypot(gradientX, gradientY), primitive: pi, triangle: i / 3 });
      used.add(indices[i]); used.add(indices[i + 1]); used.add(indices[i + 2]);
    }
    vertices += used.size;
    for (const i of used) {
      const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
      bounds.minX = Math.min(bounds.minX, x); bounds.maxX = Math.max(bounds.maxX, x);
      bounds.minY = Math.min(bounds.minY, y); bounds.maxY = Math.max(bounds.maxY, y);
      bounds.minZ = Math.min(bounds.minZ, z); bounds.maxZ = Math.max(bounds.maxZ, z);
      elevations.push(z);
    }
  }
  if (!faces.length) throw new Error('No sampleable detailed green triangles');
  elevations.sort((a, b) => a - b);
  // Robust *relative* display range; true extrema and metre heights remain exposed.
  const quantile = (q: number) => {
    const i = (elevations.length - 1) * q, lo = Math.floor(i);
    return elevations[lo] + (elevations[Math.ceil(i)] - elevations[lo]) * (i - lo);
  };
  let low = quantile(0.02), high = quantile(0.98);
  if (high - low < 1e-9) { low = bounds.minZ; high = bounds.maxZ; }
  const normalizeElevation = (z: number) => high - low < 1e-9 ? 0.5 : clamp((z - low) / (high - low));
  const columns = Math.min(64, Math.max(1, Math.ceil(Math.sqrt(faces.length / 8))));
  const rows = columns;
  const width = bounds.maxX - bounds.minX, height = bounds.maxY - bounds.minY;
  const cellX = (x: number) => Math.max(0, Math.min(columns - 1, Math.floor((x - bounds.minX) / width * columns)));
  const cellY = (y: number) => Math.max(0, Math.min(rows - 1, Math.floor((y - bounds.minY) / height * rows)));
  const buckets: number[][] = Array.from({ length: columns * rows }, () => []);
  faces.forEach((f, i) => {
    for (let y = cellY(Math.min(f.ay, f.by, f.cy)); y <= cellY(Math.max(f.ay, f.by, f.cy)); y++) {
      for (let x = cellX(Math.min(f.ax, f.bx, f.cx)); x <= cellX(Math.max(f.ax, f.bx, f.cx)); x++) buckets[y * columns + x].push(i);
    }
  });
  /** Pass a reusable output to avoid allocations in animation. Null means off mesh;
   * no coarse-terrain fallback, plane approximation, or boundary nudging.
   * Authored order resolves shared edges/overlap exactly as lookupSurface does.
   */
  const sample = (x: number, y: number, out: GreenSample = createGreenSample()): GreenSample | null => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < bounds.minX || x > bounds.maxX || y < bounds.minY || y > bounds.maxY) return null;
    const bucket = buckets[cellY(y) * columns + cellX(x)];
    for (let i = 0; i < bucket.length; i++) {
      const f = faces[bucket[i]];
      const u = ((f.by - f.cy) * (x - f.cx) + (f.cx - f.bx) * (y - f.cy)) / f.denominator;
      const v = ((f.cy - f.ay) * (x - f.cx) + (f.ax - f.cx) * (y - f.cy)) / f.denominator;
      if (Math.min(u, v, 1 - u - v) < -1e-10) continue;
      out.elevation = f.az + f.gradientX * (x - f.ax) + f.gradientY * (y - f.ay);
      out.normalizedElevation = normalizeElevation(out.elevation);
      out.slopeMagnitude = f.magnitude;
      out.downhillX = f.magnitude > 1e-12 ? -f.gradientX / f.magnitude : 0;
      out.downhillY = f.magnitude > 1e-12 ? -f.gradientY / f.magnitude : 0;
      out.primitive = f.primitive; out.triangle = f.triangle;
      return out;
    }
    return null;
  };
  return { bounds, elevationRange: { low, high, lowerQuantile: 0.02, upperQuantile: 0.98 }, vertices, triangles: faces.length, skippedTriangles, normalizeElevation, sample };
}
export type GreenTopography = ReturnType<typeof createGreenTopography>;
