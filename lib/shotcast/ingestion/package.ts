import { decodeGlb, placeShots, type Fixture, type NativePoint, type PgaConfig, type Primitive, type Stroke } from '../fixturePlacement';

export type SourceRef = { identifier: string; localPath: string; sha256: string; sourceUrl?: string; note?: string };
export type AssetRef = SourceRef & { id: string; role: 'terrain' | 'green' | 'image' | 'world-file' | 'mask' | 'course-data' };
export type HoleAssets = { hole: number; terrain: string; green?: string; imagery: string; worldFile: string; mask: string };
export type ShotQuery = { playerId: string; round: number; hole: number };
/** Capture descriptor: all transforms are PGA configuration, never fitted registration. */
export type PackageDescriptor = {
  schemaVersion: 1;
  packageId: string;
  event: { id: string; name: string; course: { name: string; id?: string; identitySource: string }; assetRoot: string };
  engine: { version: '3.3.1'; profile: 'pga-f32-z-up-interior-v1'; source: string };
  configuration: { offset: PgaConfig; selection: 'base' | 'course-override'; source: SourceRef; rawConfig: unknown; courseId?: string };
  assets: AssetRef[];
  courseAssets: { imagery: string; worldFile: string; data: string };
  holes: HoleAssets[];
  shotSource: { format: 'native-shot-details' | 'flattened-collector'; source: SourceRef; identity: { eventId: string; playerId: string; playerName: string; round: number; evidence: string } };
  selection: ShotQuery;
  provenance: { ingestionVersion: '1'; preparedAt: string; notes: string[] };
  validation: { coarse: 'runtime-validated' | 'not-validated'; detailed: 'runtime-validated' | 'offline-only' | 'not-validated'; rotation: 'zero-only' | 'nonzero-pending'; cases: (ShotQuery & { stroke: number; surface: 'terrain' | 'green'; status: 'runtime-validated' | 'offline-only'; reference: string })[]; references: string[] };
};
export type NormalizedShot = { playerId: string; round: number; hole: number; stroke: number; from: NativePoint; to: NativePoint; commentary: string; location: string; ballPath?: Stroke['ballPath']; raw: Record<string, unknown> };
export type NormalizedHole = { playerId: string; round: number; hole: number; par?: number; yardage?: number; pin?: { native: NativePoint; source: 'round-shot-details' }; tee?: { native: NativePoint; source: 'round-shot-details' }; raw: Record<string, unknown> };
/** Native feet inputs and derived field mappings only; renderer outputs are separate. */
export type IngestionPackage = { descriptor: PackageDescriptor; coordinateFrame: 'native-pga-feet'; shots: NormalizedShot[]; holeData: NormalizedHole[]; courseData: Record<string, unknown> };
export type ResolvedHole = { package: IngestionPackage; query: ShotQuery; assets: HoleAssets; fixture: Fixture; terrain: Primitive[]; green: Primitive[]; holeTfw: string; courseTfw: string };

const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected source object');
  return v as Record<string, unknown>;
};
const list = (v: unknown): unknown[] => { if (!Array.isArray(v)) throw new Error('Expected source array'); return v; };
const finite = (v: unknown): number => { if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error('Missing finite numeric value'); return v; };
const integer = (v: unknown): number => { const n = finite(v); if (!Number.isInteger(n) || n < 1) throw new Error('Expected positive integer'); return n; };
const text = (v: unknown): string => { if (typeof v !== 'string' || !v.trim()) throw new Error('Missing string'); return v; };
const point = (v: unknown): NativePoint => { const p = object(v); return { tourcastX: finite(p.tourcastX), tourcastY: finite(p.tourcastY), tourcastZ: finite(p.tourcastZ) }; };
function source(v: unknown) {
  const s = object(v); text(s.identifier); text(s.localPath);
  if (!/^[a-f0-9]{64}$/.test(text(s.sha256))) throw new Error('Missing SHA256');
}

/** Validate transport JSON before it enters either storage or rendering. */
export function validateDescriptor(value: unknown): asserts value is PackageDescriptor {
  const d = object(value);
  if (d.schemaVersion !== 1) throw new Error('Unsupported ingestion schema');
  text(d.packageId);
  const event = object(d.event); if (!/^R\d{7}$/.test(text(event.id))) throw new Error('Invalid PGA event ID');
  text(event.name); const course = object(event.course); text(course.name); text(course.identitySource);
  if (!text(event.assetRoot).startsWith('https://tourcast.pgatour.com/models/')) throw new Error('Missing PGA asset root');
  const engine = object(d.engine);
  if (engine.version !== '3.3.1' || engine.profile !== 'pga-f32-z-up-interior-v1') throw new Error('Unsupported engine profile');
  text(engine.source);
  const cfg = object(d.configuration), offset = object(cfg.offset);
  for (const k of ['x', 'y', 'z', 'rotate']) finite(offset[k]);
  if (!['base', 'course-override'].includes(text(cfg.selection))) throw new Error('Unknown config selection');
  if (cfg.selection === 'course-override') text(cfg.courseId);
  source(cfg.source);
  const rawConfig = object(cfg.rawConfig);
  if (cfg.selection === 'base' && ['x', 'y', 'z', 'rotate'].some(k => rawConfig[k] !== offset[k])) throw new Error('Effective offset differs from PGA base config');
  if (cfg.selection === 'course-override') {
    const matches = list(rawConfig.courseOffset).map(object).filter(c => c.courseId === cfg.courseId);
    if (matches.length !== 1 || ['x', 'y', 'z', 'rotate'].some(k => matches[0][k] !== offset[k])) throw new Error('Effective offset differs from PGA course override');
  }
  const ids = new Map<string, string>();
  for (const value of list(d.assets)) {
    source(value); const a = object(value), id = text(a.id), role = text(a.role);
    if (ids.has(id)) throw new Error('Duplicate asset ID');
    if (!['terrain', 'green', 'image', 'world-file', 'mask', 'course-data'].includes(role)) throw new Error('Unsupported asset role');
    if (!text(a.sourceUrl).startsWith(text(event.assetRoot))) throw new Error('Asset outside selected PGA root');
    ids.set(id, role);
  }
  const ref = (v: unknown, role: string) => { if (ids.get(text(v)) !== role) throw new Error(`Unresolved ${role} asset`); };
  const ca = object(d.courseAssets); ref(ca.imagery, 'image'); ref(ca.worldFile, 'world-file'); ref(ca.data, 'course-data');
  const holes = new Set<number>();
  for (const value of list(d.holes)) {
    const h = object(value), n = integer(h.hole);
    if (n > 18 || holes.has(n)) throw new Error('Invalid/duplicate hole'); holes.add(n);
    ref(h.terrain, 'terrain'); if (h.green !== undefined) ref(h.green, 'green'); ref(h.imagery, 'image'); ref(h.worldFile, 'world-file'); ref(h.mask, 'mask');
  }
  const ss = object(d.shotSource); source(ss.source);
  if (!['native-shot-details', 'flattened-collector'].includes(text(ss.format))) throw new Error('Unsupported shot source');
  const identity = object(ss.identity); if (identity.eventId !== event.id) throw new Error('Shot/event identity mismatch');
  text(identity.playerId); text(identity.playerName); text(identity.evidence); integer(identity.round);
  const q = object(d.selection); if (q.playerId !== identity.playerId || q.round !== identity.round || !holes.has(integer(q.hole))) throw new Error('Unavailable selection');
  const p = object(d.provenance); if (p.ingestionVersion !== '1' || !Number.isFinite(Date.parse(text(p.preparedAt)))) throw new Error('Missing ingestion provenance'); list(p.notes).forEach(text);
  const v = object(d.validation);
  if (!['runtime-validated', 'not-validated'].includes(text(v.coarse)) || !['runtime-validated', 'offline-only', 'not-validated'].includes(text(v.detailed)) || !['zero-only', 'nonzero-pending'].includes(text(v.rotation))) throw new Error('Unsupported validation status');
  list(v.references).forEach(text);
  for (const value of list(v.cases)) {
    const c = object(value); text(c.playerId); integer(c.round); integer(c.hole); integer(c.stroke); text(c.reference);
    if (!['terrain', 'green'].includes(text(c.surface)) || !['runtime-validated', 'offline-only'].includes(text(c.status))) throw new Error('Invalid validation case');
  }
}

function normalizeBallPath(value: unknown): Stroke['ballPath'] {
  if (value === undefined || value === null) return undefined;
  const raw = object(value);
  return { reconstructionType: text(raw.reconstructionType), path: list(raw.path).map(v => {
    const p = object(v); return { x: finite(p.x), y: finite(p.y), z: finite(p.z), secondsSinceStart: finite(p.secondsSinceStart) };
  }) };
}

export function normalizePackage(descriptor: PackageDescriptor, rawShots: unknown, rawCourseData: unknown): IngestionPackage {
  validateDescriptor(descriptor);
  const identity = descriptor.shotSource.identity;
  const shots: NormalizedShot[] = [], holeData: NormalizedHole[] = [];
  const available = new Set(descriptor.holes.map(h => h.hole));
  const add = (h: Record<string, unknown>, strokes: Record<string, unknown>[]) => {
    const hole = integer(h.holeNumber); if (!available.has(hole)) return;
    const metadata: NormalizedHole = { playerId: identity.playerId, round: identity.round, hole, raw: h };
    if (h.par !== undefined) metadata.par = integer(h.par);
    if (h.yardage !== undefined) metadata.yardage = finite(h.yardage);
    for (const key of ['pin', 'tee'] as const) {
      const overview = h[`${key}Overview`];
      if (overview) metadata[key] = { native: point(object(overview).leftToRightCoords), source: 'round-shot-details' };
    }
    holeData.push(metadata);
    for (const s of strokes) {
      const coords = object(object(s.overview).leftToRightCoords);
      shots.push({ playerId: identity.playerId, round: identity.round, hole, stroke: integer(s.strokeNumber), from: point(coords.fromCoords), to: point(coords.toCoords), commentary: typeof s.playByPlay === 'string' ? s.playByPlay : '', location: typeof s.toLocation === 'string' ? s.toLocation : '', ballPath: normalizeBallPath(s.ballPath), raw: s.sourceRecord ? object(s.sourceRecord) : s });
    }
  };
  if (descriptor.shotSource.format === 'native-shot-details') {
    const raw = object(rawShots);
    if (raw.tournamentId !== identity.eventId || raw.playerId !== identity.playerId || raw.round !== identity.round) throw new Error('Native response identity mismatch');
    for (const v of list(raw.holes)) { const h = object(v); add(h, list(h.strokes).map(object)); }
  } else {
    // Adapter is source-format-specific, never event-specific. Retain collector rows verbatim.
    const groups = new Map<number, Record<string, unknown>[]>();
    for (const v of list(rawShots)) { const row = object(v), n = integer(row.hole_number); groups.set(n, [...(groups.get(n) ?? []), row]); }
    for (const [hole, rows] of groups) {
      const strokes = rows.map(row => {
        const coords = (side: string) => Object.fromEntries(['tourcastX', 'tourcastY', 'tourcastZ'].map(k => [k, row[`leftToRightCoords.${side}.${k}`]]));
        return { ...row, sourceRecord: row, strokeNumber: row.stroke_number, playByPlay: row.play_by_play, toLocation: row.to_location, overview: { leftToRightCoords: { fromCoords: coords('fromCoords'), toCoords: coords('toCoords') } } };
      });
      add({ holeNumber: hole, par: rows[0].par, yardage: rows[0].yardage, collectorRows: rows }, strokes);
    }
  }
  shots.sort((a, b) => a.hole - b.hole || a.stroke - b.stroke);
  const keys = shots.map(s => `${s.hole}/${s.stroke}`);
  if (new Set(keys).size !== keys.length || new Set(holeData.map(h => h.hole)).size !== holeData.length) throw new Error('Duplicate source shots/holes');
  const pkg: IngestionPackage = { descriptor, coordinateFrame: 'native-pga-feet', shots, holeData, courseData: object(rawCourseData) };
  retrieveShots(pkg, descriptor.selection);
  return pkg;
}
export function retrieveShots(pkg: IngestionPackage, query: ShotQuery): NormalizedShot[] {
  const result = pkg.shots.filter(s => s.playerId === query.playerId && s.round === query.round && s.hole === query.hole);
  if (!result.length) throw new Error('No shots for requested player/round/hole');
  return result;
}
export function resolveAsset(pkg: IngestionPackage, id: string): AssetRef {
  const asset = pkg.descriptor.assets.find(a => a.id === id); if (!asset) throw new Error(`Unknown package asset ${id}`); return asset;
}
export async function resolveHole(pkg: IngestionPackage, query: ShotQuery, read: (asset: AssetRef) => Promise<ArrayBuffer>): Promise<ResolvedHole> {
  validateDescriptor(pkg.descriptor);
  const assets = pkg.descriptor.holes.find(h => h.hole === query.hole); if (!assets) throw new Error('Unprepared hole');
  const shots = retrieveShots(pkg, query);
  const fixture: Fixture = { id: pkg.descriptor.shotSource.source.identifier, playerId: query.playerId, round: query.round, holes: [{ holeNumber: query.hole, strokes: shots.map(s => ({ strokeNumber: s.stroke, playByPlay: s.commentary, toLocation: s.location, overview: { leftToRightCoords: { fromCoords: s.from, toCoords: s.to } }, ballPath: s.ballPath })) }] };
  const binary = (id: string) => read(resolveAsset(pkg, id));
  const [terrain, green, holeTfw, courseTfw] = await Promise.all([binary(assets.terrain).then(decodeGlb), assets.green ? binary(assets.green).then(decodeGlb) : Promise.resolve([]), binary(assets.worldFile).then(b => new TextDecoder().decode(b)), binary(pkg.descriptor.courseAssets.worldFile).then(b => new TextDecoder().decode(b))]);
  return { package: pkg, query, assets, fixture, terrain, green, holeTfw, courseTfw };
}
export function placePackageShots(hole: ResolvedHole, detailed: boolean) {
  return placeShots(hole.fixture, hole.terrain, hole.green, detailed, hole.package.descriptor.configuration.offset);
}
