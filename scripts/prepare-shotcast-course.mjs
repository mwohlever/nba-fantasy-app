/** Explicit LOCAL RESEARCH proof. No deployment, database, donor writes or asset copying. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { importTs } from '../tests/shotcast-ingestion/module-loader.mjs';
import { preservedReplay } from '../tests/shotcast-ingestion/current-provider.mjs';

if (process.env.NODE_ENV === 'production') throw new Error('Research preparation is disabled in production');
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  if (!process.argv[i]?.startsWith('--') || !process.argv[i + 1]) throw new Error('Use --event ID --player ID --round N --hole N --reference DONOR_PACKAGE [--course ID]');
  args.set(process.argv[i].slice(2), process.argv[i + 1]);
}
const eventId = args.get('event'), playerId = args.get('player'), round = Number(args.get('round')), hole = Number(args.get('hole'));
if (!eventId || !playerId || !args.get('reference')) throw new Error('Explicit event, player, round, hole and read-only reference required');
const preparation = await importTs('lib/shotcast/preparation/prepareCourse.server.ts');
const acquisition = await importTs('lib/shotcast/preparation/pgaAcquisition.server.ts');
const identity = await importTs('lib/shotcast/preparation/courseIdentity.ts');
const handoff = await importTs('lib/shotcast/shotcast3dView.ts');
const result = await preparation.prepareCourseForEvent({ eventId, courseId: args.get('course'), holes: [hole] });
if (result.status !== 'prepared') { console.log(JSON.stringify(result)); process.exitCode = 1; }
else {
  const { candidate } = result, manifest = candidate.manifest;
  const shots = await acquisition.acquireNativeShots(candidate.discovery, playerId, round), native = acquisition.json(shots.native);
  const played = identity.resolvePlayedCourse(manifest.eventIdentity, acquisition.json(candidate.resources['tee-times']), playerId, round);
  if (played.id !== manifest.identity.courseId) throw new Error('STOP: selected player-round course differs from preparation');
  const rawHole = identity.array(native.holes).map(identity.record).find(h => h.holeNumber === hole);
  if (!rawHole) throw new Error('STOP: native hole absent');
  const point = v => { const p = identity.record(v); return { tourcastX: p.tourcastX, tourcastY: p.tourcastY, tourcastZ: p.tourcastZ }; };
  const input = handoff.parseStaticPlayerHole({ tournamentId: eventId, pgaPlayerId: playerId, roundNumber: round, holeNumber: hole,
    pin: point(identity.record(rawHole.pinOverview).leftToRightCoords), shots: identity.array(rawHole.strokes).map(identity.record).map(s => {
      const coords = identity.record(identity.record(s.overview).leftToRightCoords);
      return { strokeNumber: s.strokeNumber, from: point(coords.fromCoords), to: point(coords.toCoords) };
    }) });
  if (!input) throw new Error('STOP: native positions are incomplete/ambiguous');

  // The freshly discovered candidate is complete BEFORE this independent reference is read.
  const referenceDirectory = path.resolve(args.get('reference'));
  const descriptorBytes = await fs.readFile(path.join(referenceDirectory, 'descriptor.json'));
  const reference = JSON.parse(descriptorBytes), placementBytes = await fs.readFile(path.join(referenceDirectory, 'placement-check.json'));
  const placement = JSON.parse(placementBytes);
  if (reference.event.id !== eventId || reference.event.course.id !== played.id || reference.selection.playerId !== playerId || reference.selection.round !== round || reference.selection.hole !== hole) throw new Error('STOP: reference identity mismatch');
  if (preparation.canonicalJson(reference.configuration.offset) !== preparation.canonicalJson(manifest.configuration.offset)) throw new Error('STOP: published configuration differs from reference');
  const donor = await importTs(path.resolve(referenceDirectory, '../../../../lib/shotcast/fixturePlacement.ts'));
  const referenceAsset = async id => {
    const a = reference.assets.find(a => a.id === id), bytes = await fs.readFile(path.join(referenceDirectory, path.basename(a.localPath)));
    if (acquisition.sha256(bytes) !== a.sha256) throw new Error(`STOP: changed independent ${id}`);
    return donor.decodeGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  };
  const terrain = await referenceAsset('terrain'), green = await referenceAsset('green');
  const expectedPoint = p => donor.groundPoint(p, terrain, green, true, reference.configuration.offset).surfaceAnchor;
  const expected = { tee: expectedPoint(input.shots.find(s => s.strokeNumber === 1).from), pin: expectedPoint(input.pin),
    shots: input.shots.map(s => ({ strokeNumber: s.strokeNumber, from: expectedPoint(s.from), endpoint: placement.detailed.find(p => p.number === s.strokeNumber)?.surfaceAnchor })) };
  const referenceEvidence = { sourceUrl: path.join(referenceDirectory, 'placement-check.json'), sha256: acquisition.sha256(placementBytes), retrievedAt: new Date().toISOString() };
  const world = preparation.validateRegistration(candidate, input, expected, referenceEvidence, shots.native.evidence.sha256);

  // Local cache is a replaceable adapter. Nothing is written before the numeric gate passes.
  const output = 'tmp/shotcast-phase4b'; await fs.mkdir(output, { recursive: true });
  const player = identity.array(acquisition.json(candidate.resources.leaderboard).players).map(identity.record).find(p => p.id === playerId);
  const playerName = identity.text(identity.record(player.player).displayName);
  const nativePath = `${output}/native.json`;
  await fs.writeFile(nativePath, shots.native.bytes, { mode: 0o600 });
  const transportDescriptor = { event: manifest.event, selection: { playerId, round, hole }, shotSource: { source: { localPath: nativePath }, identity: { playerName } } };
  // Exercise the UNCHANGED application provider against freshly acquired response bytes.
  const { replay } = await preservedReplay(transportDescriptor, hole);
  if (!replay || preparation.canonicalJson(handoff.currentPlayerHole(replay)) !== preparation.canonicalJson(input)) throw new Error('STOP: existing provider normalization changed the authoritative hole');
  const rows = input.shots.flatMap((s, i) => [
    { anchor: `shot-${s.strokeNumber}.from`, rawFeet: Object.values(s.from), worldMetres: world.shots[i].from, referenceMetres: expected.shots[i].from },
    { anchor: `shot-${s.strokeNumber}.to`, rawFeet: Object.values(s.to), worldMetres: world.shots[i].endpoint, referenceMetres: expected.shots[i].endpoint },
  ]);
  rows.push({ anchor: 'pin', rawFeet: Object.values(input.pin), worldMetres: world.pin, referenceMetres: expected.pin });
  const report = { result: 'NUMERIC_PASS', identity: manifest.identity, packageId: manifest.packageId, preparationId: manifest.preparationId,
    sourceInputs: manifest.inputs, shots: { response: shots.response.evidence, native: shots.native.evidence }, offset: manifest.configuration.offset,
    reference: { descriptorSha256: acquisition.sha256(descriptorBytes), ...referenceEvidence }, registration: manifest.registrationProof, rows, world,
    replaySha256: acquisition.sha256(Buffer.from(JSON.stringify(replay, null, 2) + '\n')) };
  await fs.writeFile(`${output}/numeric-proof.json`, JSON.stringify(report, null, 2) + '\n');
  await fs.writeFile(`${output}/replay.json`, JSON.stringify(replay, null, 2) + '\n');
  await fs.writeFile(`${output}/shot-response.json`, shots.response.bytes, { mode: 0o600 });
  const directory = path.join('tmp/shotcast-ingestion/packages', manifest.packageId);
  try { await fs.mkdir(directory); }
  catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const existing = JSON.parse(await fs.readFile(path.join(directory, 'descriptor.json')));
    if (existing.preparationId !== manifest.preparationId) throw new Error('STOP: existing preparation identity collision');
    // Do not overwrite prior preparation or user evidence on repeat runs.
    console.log(JSON.stringify({ result: 'NUMERIC_PASS', packageId: manifest.packageId, reusedLocalPackage: true, maximumResidualMetres: manifest.registrationProof.maximumResidualMetres }));
    process.exit(0);
  }
  for (const [id, r] of Object.entries(candidate.resources)) await fs.writeFile(path.join(directory, `${id}.bin`), r.bytes, { mode: 0o600 });
  await fs.writeFile(path.join(directory, 'provenance.json'), JSON.stringify({ inputs: manifest.inputs }, null, 2) + '\n');
  // Descriptor last: partially written packages are never eligible.
  await fs.writeFile(path.join(directory, 'descriptor.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ result: 'NUMERIC_PASS', packageId: manifest.packageId, course: manifest.identity.courseName, offset: manifest.configuration.offset, maximumResidualMetres: manifest.registrationProof.maximumResidualMetres, output }));
}
