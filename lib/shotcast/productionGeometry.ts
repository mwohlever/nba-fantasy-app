/** Geometry operations shared by the read-only ShotCast view and its preparation. */
export type Point3 = readonly [number, number, number];
export type TerrainPrimitive = {
  positions: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
};
export type CourseOffset = { x: number; y: number; z: number; rotate: number };
export type NativePoint = { tourcastX: number; tourcastY: number; tourcastZ: number };

/** PGA 3.3.1 float32 native-feet registration; no event-specific offset. */
export function convertNativePoint(point: NativePoint, offset: CourseOffset): Point3 {
  if (![point.tourcastX, point.tourcastY, point.tourcastZ, offset.x, offset.y, offset.z, offset.rotate].every(Number.isFinite)) {
    throw new Error("Invalid ShotCast coordinate or offset");
  }
  const raw = new Float32Array([point.tourcastX, point.tourcastY, point.tourcastZ]);
  const course = new Float32Array([offset.x, offset.y, offset.z]);
  for (let i = 0; i < 3; i++) raw[i] = raw[i] * 0.3048;
  const half = offset.rotate * Math.PI / 360;
  const quaternion = new Float32Array([0, 0, Math.sin(half), Math.cos(half)]);
  const [qx, qy, qz, qw] = quaternion;
  const [x, y, z] = raw;
  let tx = qy * z - qz * y, ty = qz * x - qx * z, tz = qx * y - qy * x;
  tx += tx; ty += ty; tz += tz;
  raw[0] = x + qw * tx + qy * tz - qz * ty;
  raw[1] = y + qw * ty + qz * tx - qx * tz;
  raw[2] = z + qw * tz + qx * ty - qy * tx;
  for (let i = 0; i < 3; i++) raw[i] = raw[i] - course[i];
  return [raw[0], raw[1], raw[2]];
}

export function surfaceHeight(meshes: TerrainPrimitive[], x: number, y: number): number | null {
  for (const { positions: p, indices: ids } of meshes) {
    for (let i = 0; i < ids.length; i += 3) {
      const a = ids[i] * 3, b = ids[i + 1] * 3, c = ids[i + 2] * 3;
      const den = (p[b + 1] - p[c + 1]) * (p[a] - p[c]) + (p[c] - p[b]) * (p[a + 1] - p[c + 1]);
      if (Math.abs(den) < 1e-15) continue;
      const u = ((p[b + 1] - p[c + 1]) * (x - p[c]) + (p[c] - p[b]) * (y - p[c + 1])) / den;
      const v = ((p[c + 1] - p[a + 1]) * (x - p[c]) + (p[a] - p[c]) * (y - p[c + 1])) / den;
      if (Math.min(u, v, 1 - u - v) >= -1e-10) {
        return u * p[a + 2] + v * p[b + 2] + (1 - u - v) * p[c + 2];
      }
    }
  }
  return null;
}

export function groundNativePoint(point: NativePoint, offset: CourseOffset, terrain: TerrainPrimitive[], green: TerrainPrimitive[] = []): Point3 | null {
  const [x, y] = convertNativePoint(point, offset);
  const z = surfaceHeight(green, x, y) ?? surfaceHeight(terrain, x, y);
  return z === null ? null : [x, y, z];
}

/** Only the untransformed, indexed GLB profile used by the validated terrain. */
export function decodeTerrainGlb(buffer: ArrayBuffer): TerrainPrimitive[] {
  const view = new DataView(buffer);
  if (buffer.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== buffer.byteLength) throw new Error("Invalid terrain GLB");
  let document: Record<string, unknown> | null = null;
  let binary = 0;
  for (let at = 12; at < buffer.byteLength;) {
    if (at + 8 > buffer.byteLength) throw new Error("Invalid GLB chunk");
    const size = view.getUint32(at, true), type = view.getUint32(at + 4, true);
    if (at + 8 + size > buffer.byteLength) throw new Error("Invalid GLB chunk length");
    if (type === 0x4e4f534a) document = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, at + 8, size)));
    if (type === 0x004e4942) binary = at + 8;
    at += 8 + size;
  }
  if (!document || !binary) throw new Error("Missing GLB chunks");
  const doc = document as { nodes?: Record<string, unknown>[]; meshes?: { primitives: { mode?: number; extensions?: unknown; attributes: { POSITION: number; NORMAL?: number }; indices?: number }[] }[]; accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; sparse?: unknown }[]; bufferViews: { buffer?: number; byteOffset?: number; byteStride?: number }[] };
  for (const node of doc.nodes ?? []) if (["translation", "rotation", "scale", "matrix"].some(key => key in node)) throw new Error("Unexpected terrain node transform");
  const read = (id: number): number[] => {
    const accessor = doc.accessors[id], block = doc.bufferViews[accessor.bufferView];
    if (!accessor || !block || accessor.sparse || (block.buffer ?? 0) !== 0) throw new Error("Unsupported terrain accessor");
    const width = accessor.type === "VEC3" ? 3 : accessor.type === "SCALAR" ? 1 : 0;
    const bytes = accessor.componentType === 5126 || accessor.componentType === 5125 ? 4 : accessor.componentType === 5123 ? 2 : accessor.componentType === 5121 ? 1 : 0;
    if (!width || !bytes || !Number.isInteger(accessor.count) || accessor.count < 1) throw new Error("Unsupported terrain accessor type");
    const start = binary + (block.byteOffset ?? 0) + (accessor.byteOffset ?? 0), stride = block.byteStride ?? width * bytes;
    return Array.from({ length: accessor.count * width }, (_, i) => {
      const at = start + Math.floor(i / width) * stride + i % width * bytes;
      if (at + bytes > buffer.byteLength) throw new Error("Terrain accessor outside GLB");
      return accessor.componentType === 5126 ? view.getFloat32(at, true) : bytes === 4 ? view.getUint32(at, true) : bytes === 2 ? view.getUint16(at, true) : view.getUint8(at);
    });
  };
  const primitives = (doc.meshes ?? []).flatMap(mesh => mesh.primitives.map(primitive => {
    if ((primitive.mode ?? 4) !== 4 || primitive.extensions) throw new Error("Unsupported terrain primitive");
    const positions = new Float32Array(read(primitive.attributes.POSITION));
    const indices = new Uint32Array(primitive.indices === undefined ? Array.from({ length: positions.length / 3 }, (_, i) => i) : read(primitive.indices));
    const normals = primitive.attributes.NORMAL === undefined ? undefined : new Float32Array(read(primitive.attributes.NORMAL));
    if (!positions.length || indices.length % 3 || indices.some(id => id >= positions.length / 3)) throw new Error("Invalid terrain triangles");
    return { positions, indices, normals };
  }));
  if (!primitives.length) throw new Error("Empty terrain GLB");
  return primitives;
}

export function worldFileUv(text: string, x: number, y: number): [number, number] {
  const values = text.trim().split(/\s+/).map(Number);
  if (values.length !== 8 || !values.every(Number.isFinite)) throw new Error("Invalid terrain world file");
  const [a, d, b, e, c, f, width, height] = values;
  const determinant = a * e - b * d;
  if (!determinant || width <= 0 || height <= 0) throw new Error("Invalid terrain registration");
  return [((x - c) * e - b * (y - f)) / determinant / width, (a * (y - f) - d * (x - c)) / determinant / height];
}
