/** Bounded LOCAL proof, using an independent PGA-function oracle. No donor input. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { importTs } from '../tests/shotcast-ingestion/module-loader.mjs';
import { preservedReplay } from '../tests/shotcast-ingestion/current-provider.mjs';

if (process.env.NODE_ENV === 'production') throw Error('Research preparation disabled in production');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1]) throw Error('Explicit --event --player --round --hole --proof --oracle arguments required');
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const eventId = args.get('event'), playerId = args.get('player'), roundNumber = Number(args.get('round')), holeNumber = Number(args.get('hole')), proofId = args.get('proof');
if (!eventId || !playerId || !/^[a-z0-9-]+$/.test(proofId ?? '') || !args.get('oracle')) throw Error('Missing or invalid proof identity');
const playerRound = await importTs('lib/shotcast/preparation/playerRoundCourse.server.ts');
const preparation = await importTs('lib/shotcast/preparation/prepareCourse.server.ts');
const acquisition = await importTs('lib/shotcast/preparation/pgaAcquisition.server.ts');
const handoff = await importTs('lib/shotcast/shotcast3dView.ts');
const identity = await importTs('lib/shotcast/preparation/courseIdentity.ts');

const result = await playerRound.prepareCourseForPlayerRound({ eventId, playerId, roundNumber, holes: [holeNumber] });
if (result.status !== 'prepared') { console.log(JSON.stringify(result)); process.exit(1); }
const { candidate, assignment } = result, manifest = candidate.manifest;
const shots = await acquisition.acquireNativeShots(candidate.discovery, playerId, roundNumber), native = acquisition.json(shots.native);
const rawHole = identity.array(native.holes).map(identity.record).find(h => h.holeNumber === holeNumber);
const point = value => { const p = identity.record(value); return { tourcastX: p.tourcastX, tourcastY: p.tourcastY, tourcastZ: p.tourcastZ }; };
const input = handoff.parseStaticPlayerHole({ tournamentId: eventId, pgaPlayerId: playerId, roundNumber, holeNumber,
  pin: point(identity.record(rawHole.pinOverview).leftToRightCoords),
  shots: identity.array(rawHole.strokes).map(identity.record).map(s => { const c = identity.record(identity.record(s.overview).leftToRightCoords); return { strokeNumber: s.strokeNumber, from: point(c.fromCoords), to: point(c.toCoords) }; }) });
if (!input) throw Error('STOP: unsupported native positions');

// The candidate is freshly acquired before the oracle is read. No oracle input
// supplies a transform, mesh or native coordinate to the preparation pipeline.
const oraclePath = path.resolve(args.get('oracle')), oracleBytes = await fs.readFile(oraclePath);
const matches = JSON.parse(oracleBytes).filter(r => r.event === eventId && r.player === playerId && r.round === roundNumber && r.hole === holeNumber && r.course === assignment.course.id);
if (matches.length !== 1) throw Error('STOP: oracle identity absent/ambiguous');
const oracle = matches[0];
if (oracle.engineSha256 !== manifest.inputs.engine.sha256 || oracle.appSha256 !== manifest.inputs.application.sha256 || preparation.canonicalJson(oracle.rawOffsetConfig) !== preparation.canonicalJson(manifest.configuration.rawConfig)) throw Error('STOP: oracle configuration/profile version mismatch');
for (const a of manifest.assets.filter(a => ['terrain', 'green'].includes(a.role))) {
  const inputs = Object.values(oracle.inputs).filter(r => r.sourceUrl === a.sourceUrl);
  if (!inputs.length || inputs.some(r => r.sha256 !== a.sha256)) throw Error('STOP: oracle geometry version mismatch');
}
const referencePoint = (label, raw) => {
  const registered = oracle.registered.find(p => p.label === label), grounded = oracle.detailed.find(p => p.label === label);
  const nativePoint = registered ? { tourcastX: registered.raw.tourcastX, tourcastY: registered.raw.tourcastY, tourcastZ: registered.raw.tourcastZ } : null;
  if (!registered || !grounded || grounded.xyWasNudged || preparation.canonicalJson(raw) !== preparation.canonicalJson(nativePoint)) throw Error('STOP: oracle native identity or XY mismatch');
  return grounded.world;
};
const expected = { tee: referencePoint('tee-from', input.shots.find(s => s.strokeNumber === 1).from), pin: referencePoint('pin', input.pin), shots: input.shots.map(s => ({ strokeNumber: s.strokeNumber, from: referencePoint(`from-${s.strokeNumber}`, s.from), endpoint: referencePoint(`to-${s.strokeNumber}`, s.to) })) };
const reference = { sourceUrl: oraclePath, sha256: acquisition.sha256(oracleBytes), retrievedAt: new Date().toISOString() };
const world = preparation.validateRegistration(candidate, input, expected, reference, shots.native.evidence.sha256);
const directory = `tmp/shotcast-phase4c/proofs/${proofId}`;
await fs.mkdir(path.dirname(directory), { recursive: true });
await fs.mkdir(directory); // Exclusive directory: preserve previous proof runs/evidence.
const nativePath = `${directory}/native.json`; await fs.writeFile(nativePath, shots.native.bytes, { mode: 0o600 });
const player = identity.array(acquisition.json(candidate.resources.leaderboard).players).map(identity.record).find(p => p.id === playerId);
const playerName = identity.text(identity.record(player.player).displayName);
const { replay } = await preservedReplay({ event: manifest.event, selection: { playerId, round: roundNumber, hole: holeNumber }, shotSource: { source: { localPath: nativePath }, identity: { playerName } } }, holeNumber);
if (preparation.canonicalJson(handoff.currentPlayerHole(replay)) !== preparation.canonicalJson(input)) throw Error('STOP: existing provider changed native anchors');
const replayBytes = Buffer.from(JSON.stringify(replay, null, 2) + '\n');
const rows = input.shots.flatMap((s, i) => [{ anchor: `from-${s.strokeNumber}`, raw: s.from, ours: world.shots[i].from, provider: expected.shots[i].from }, { anchor: `to-${s.strokeNumber}`, raw: s.to, ours: world.shots[i].endpoint, provider: expected.shots[i].endpoint }]);
rows.unshift({ anchor: 'tee-from', raw: input.shots[0].from, ours: world.tee, provider: expected.tee }, { anchor: 'pin', raw: input.pin, ours: world.pin, provider: expected.pin });
rows.forEach(r => { r.residual = r.ours.map((p, axis) => p - r.provider[axis]); r.error = Math.hypot(...r.residual); });
const proof = { result: 'NUMERIC_PASS', oracleMethod: oracle.method, assignment, identity: manifest.identity, packageId: manifest.packageId, preparationId: manifest.preparationId, registration: manifest.registrationProof,
  offset: manifest.configuration.offset, sourceInputs: manifest.inputs, nativeEvidence: shots.native.evidence, responseEvidence: shots.response.evidence, replaySha256: acquisition.sha256(replayBytes), world, rows };
await fs.writeFile(`${directory}/replay.json`, replayBytes); await fs.writeFile(`${directory}/numeric-proof.json`, JSON.stringify(proof, null, 2) + '\n');
await fs.writeFile(`${directory}/candidate.json`, JSON.stringify(manifest, null, 2) + '\n');
// --validate-only is useful for a newly observed source revision of an already
// prepared course. It avoids publishing an ambiguous duplicate of Phase 4B.
if (args.get('validate-only') !== '1') {
  const packageDirectory = `tmp/shotcast-ingestion/packages/${manifest.packageId}`;
  await fs.mkdir(packageDirectory);
  for (const [id, r] of Object.entries(candidate.resources)) await fs.writeFile(`${packageDirectory}/${id}.bin`, r.bytes, { mode: 0o600 });
  await fs.writeFile(`${packageDirectory}/provenance.json`, JSON.stringify({ inputs: manifest.inputs }, null, 2) + '\n');
  await fs.writeFile(`${packageDirectory}/descriptor.json`, JSON.stringify(manifest, null, 2) + '\n');
  const indexPath = 'tmp/shotcast-phase4c/proofs/index.json'; let index = [];
  try { index = JSON.parse(await fs.readFile(indexPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (index.some(p => p.id === proofId)) throw Error('STOP: duplicate proof selector');
  index.push({ id: proofId, label: `${assignment.course.name} · R${roundNumber} H${holeNumber}`, packageId: manifest.packageId });
  await fs.writeFile(indexPath, JSON.stringify(index, null, 2) + '\n');
}
console.log(JSON.stringify({ result: 'PASS', proofId, course: assignment.course, roundNumber, packageId: manifest.packageId, maximumResidualMetres: manifest.registrationProof.maximumResidualMetres, published: args.get('validate-only') !== '1' }));
