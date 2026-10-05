/** Isolated PGA ingestion prototypes. Sources: tmp/placement-validation/LIVE-PARITY-RESULT.md.
 * Float32 operations mirror PGA modules 54318/19811; GLB vertices stay right-handed Z-up.
 */
export type XYZ = [number, number, number];
export type PgaConfig = { x: number; y: number; z: number; rotate: number };
/** Legacy diagnostic default only. Ingestion always supplies its explicit PGA offset. */
export const PGA_CONFIG = { x: 3200.056917, y: 3099.998293, z: 0, rotate: 0 };
export const MARKER_LIFT = 0.017068; // Observed PGA 3.3.1: ball diameter .04267 * .4.
export type NativePoint = { tourcastX: number; tourcastY: number; tourcastZ: number };
export type Stroke = { strokeNumber: number; playByPlay: string; toLocation: string; overview: { leftToRightCoords: { fromCoords: NativePoint; toCoords: NativePoint } }; ballPath?: { reconstructionType: string; path: { x: number; y: number; z: number; secondsSinceStart: number }[] }; radarData?: unknown };
export type Fixture = { id: string; playerId: string; round: number; holes: { holeNumber: number; strokes: Stroke[] }[] };
export type Primitive = { positions: Float32Array; indices: Uint32Array; normals?: Float32Array };
export type Hit = { surface: 'terrain' | 'green'; z: number; triangle: number; primitive: number; indices: number[] };
export type PlacedShot = { number: number; native: XYZ; engineInput: XYZ; surfaceAnchor: XYZ; markerOrigin: XYZ; hit: Hit; commentary: string; location: string };

export function convertNative(p: NativePoint, config: PgaConfig = PGA_CONFIG): XYZ {
  if (![p.tourcastX, p.tourcastY, p.tourcastZ, config.x, config.y, config.z, config.rotate].every(Number.isFinite)) throw new Error('Nonfinite PGA transform input');
  const raw = new Float32Array([p.tourcastX, p.tourcastY, p.tourcastZ]);
  const offset = new Float32Array([config.x, config.y, config.z]);
  for (let i = 0; i < 3; i++) raw[i] = raw[i] * 0.3048;
  // PGA A6(vt(), 0, 0, rotate): degrees, quaternion rounded to float32.
  // PGA gL: cache input components, double intermediates, float32 output writes.
  // Rotate about native origin before offset subtraction; preserve operation order.
  const halfAngle = config.rotate * (Math.PI / 360);
  const quaternion = new Float32Array([0, 0, Math.sin(halfAngle), Math.cos(halfAngle)]);
  const [qx, qy, qz, qw] = quaternion;
  const [x, y, z] = raw;
  let tx = qy * z - qz * y, ty = qz * x - qx * z, tz = qx * y - qy * x;
  tx += tx; ty += ty; tz += tz;
  raw[0] = x + qw * tx + qy * tz - qz * ty;
  raw[1] = y + qw * ty + qz * tx - qx * tz;
  raw[2] = z + qw * tz + qx * ty - qy * tx;
  for (let i = 0; i < 3; i++) raw[i] = raw[i] - offset[i];
  return [raw[0], raw[1], raw[2]];
}

export function decodeGlb(buffer: ArrayBuffer): Primitive[] {
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error('Invalid GLB');
  let doc, binary = 0;
  for (let at = 12; at < buffer.byteLength;) {
    const size = view.getUint32(at, true), type = view.getUint32(at + 4, true);
    if (type === 0x4e4f534a) doc = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, at + 8, size)));
    if (type === 0x004e4942) binary = at + 8;
    at += 8 + size;
  }
  if (!doc || !binary) throw new Error('Missing GLB chunks');
  for (const n of doc.nodes ?? []) if (['translation', 'rotation', 'scale', 'matrix'].some(k => k in n)) throw new Error('Unexpected node registration transform');
  const read = (id: number): number[] => {
    const a = doc.accessors[id], v = doc.bufferViews[a.bufferView];
    if (a.sparse || (v.buffer ?? 0) !== 0) throw new Error('Unsupported accessor');
    const width = a.type === 'VEC3' ? 3 : a.type === 'SCALAR' ? 1 : 0;
    const bytes = a.componentType === 5126 || a.componentType === 5125 ? 4 : a.componentType === 5123 ? 2 : a.componentType === 5121 ? 1 : 0;
    if (!width || !bytes) throw new Error('Unsupported accessor type');
    const start = binary + (v.byteOffset ?? 0) + (a.byteOffset ?? 0), stride = v.byteStride ?? width * bytes;
    return Array.from({ length: a.count * width }, (_, i) => {
      const pos = start + Math.floor(i / width) * stride + (i % width) * bytes;
      return a.componentType === 5126 ? view.getFloat32(pos, true) : bytes === 4 ? view.getUint32(pos, true) : bytes === 2 ? view.getUint16(pos, true) : view.getUint8(pos);
    });
  };
  return doc.meshes.flatMap((m: { primitives: { mode?: number; extensions?: unknown; attributes: { POSITION: number; NORMAL?: number }; indices?: number }[] }) => m.primitives.map(p => {
    if ((p.mode ?? 4) !== 4 || p.extensions) throw new Error('Unsupported primitive');
    const positions = new Float32Array(read(p.attributes.POSITION));
    const indices = new Uint32Array(p.indices === undefined ? Array.from({ length: positions.length / 3 }, (_, i) => i) : read(p.indices));
    const normals = p.attributes.NORMAL === undefined ? undefined : new Float32Array(read(p.attributes.NORMAL));
    return { positions, indices, normals };
  }));
}

export function lookupSurface(meshes: Primitive[], x: number, y: number, surface: Hit['surface']): Hit | null {
  // et/Ra/tl principle: first containing authored triangle, vertical plane intersection.
  // Interior points only; deliberately no undocumented fallback or edge nudging.
  for (let pi = 0; pi < meshes.length; pi++) {
    const { positions: p, indices: ids } = meshes[pi];
    for (let i = 0; i < ids.length; i += 3) {
      const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
      const den = (p[b + 1] - p[c + 1]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 1] - p[c + 1]);
      if (Math.abs(den) < 1e-15) continue;
      const u = ((p[b + 1] - p[c + 1]) * (x - p[c]) + (p[c] - p[b]) * (y - p[c + 1])) / den;
      const v = ((p[c + 1] - p[a + 1]) * (x - p[c]) + (p[a] - p[c]) * (y - p[c + 1])) / den;
      if (Math.min(u, v, 1 - u - v) >= -1e-10) return { surface, z: u * p[a + 2] + v * p[b + 2] + (1 - u - v) * p[c + 2], triangle: i / 3, primitive: pi, indices: Array.from(ids.slice(i, i + 3)) };
    }
  }
  return null;
}

export function groundPoint(p: NativePoint, terrain: Primitive[], green: Primitive[], detailed: boolean, config: PgaConfig = PGA_CONFIG) {
  const converted = convertNative(p, config);
  const hit = (detailed ? lookupSurface(green, converted[0], converted[1], 'green') : null) ?? lookupSurface(terrain, converted[0], converted[1], 'terrain');
  if (!hit) throw new Error('Endpoint outside preserved surfaces; no fitted fallback');
  const surfaceAnchor: XYZ = [converted[0], converted[1], hit.z];
  const markerOrigin: XYZ = [converted[0], converted[1], hit.z + MARKER_LIFT];
  return { engineInput: [converted[0], converted[1], 0] as XYZ, surfaceAnchor, markerOrigin, hit };
}
export function placeShots(fixture: Fixture, terrain: Primitive[], green: Primitive[], detailed: boolean, config: PgaConfig = PGA_CONFIG): PlacedShot[] {
  if (fixture.holes.length !== 1 || !fixture.holes[0].strokes.length) throw new Error('Expected one nonempty fixture hole');
  return fixture.holes[0].strokes.map(s => {
    const p = s.overview.leftToRightCoords.toCoords;
    return { number: s.strokeNumber, native: [p.tourcastX, p.tourcastY, p.tourcastZ], ...groundPoint(p, terrain, green, detailed, config), commentary: s.playByPlay, location: s.toLocation };
  });
}
export function worldFileUv(text: string, x: number, y: number): [number, number] {
  const [a, d, b, e, c, f, width, height] = text.trim().split(/\s+/).map(Number);
  const det = a * e - b * d;
  if (!det || !width || !height) throw new Error('Invalid PGA world file');
  // PGA RC directly inverts the affine world file, with no pixel-center adjustment.
  return [((x - c) * e - b * (y - f)) / det / width, (a * (y - f) - d * (x - c)) / det / height];
}
