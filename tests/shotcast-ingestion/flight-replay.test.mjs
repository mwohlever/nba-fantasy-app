import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importTs } from './module-loader.mjs';
import { preservedReplay } from './current-provider.mjs';

const g = await importTs('lib/shotcast/productionGeometry.ts');
const { buildHoleWorld } = await importTs('lib/shotcast/holeWorld.ts');
const { reconstructGenericPgaFlight } = await importTs('lib/shotcast/pgaFlight.ts');
const { buildFlightPath, constrainFlightOrigin, createFlightReveal, createFlightPlayback, FLIGHT_ANCHOR_TOLERANCE } = await importTs('lib/shotcast/flightReplay.ts');
const { currentPlayerHole, currentPreparationInput, isShotcast3DView } = await importTs('lib/shotcast/shotcast3dView.ts');
const { resolveDevelopmentShotcast } = await importTs('lib/shotcast/developmentAssetResolver.server.ts');
const donor = process.env.SHOTCAST_DONOR_ROOT ?? '../nba-fantasy-app-3d';
const near = (a, b, tolerance = FLIGHT_ANCHOR_TOLERANCE) => assert.ok(Math.abs(a - b) <= tolerance, `${a} != ${b}`);
const fixtures = [];
for (const [name, id, rawPath, player, number] of [
  ['Scheffler Shot 1', 'pga-71908773-fb52-47d0-bb1e-f44f50b34965', 'tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json', '46046', 1],
  ['Scheffler Shot 2', 'pga-71908773-fb52-47d0-bb1e-f44f50b34965', 'tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json', '46046', 2],
  ['Sedgefield Brennan Shot 1', 'pga-6dd7c507-1e90-4bbc-a90e-8cbff49b24b3', 'tmp/placement-validation/nonzero-rotation/shot-details.json', '61522', 1],
]) {
  const descriptor = JSON.parse(fs.readFileSync(`tmp/shotcast-ingestion/packages/${id}/descriptor.json`));
  descriptor.selection.playerId = player; descriptor.shotSource.source.localPath = rawPath;
  descriptor.shotSource.identity.playerName = player === '46046' ? 'Scottie Scheffler' : 'Michael Brennan';
  const raw = JSON.parse(fs.readFileSync(rawPath)), hole = raw.holes.find(h => h.holeNumber === 1);
  const mesh = id => { const bytes = fs.readFileSync(descriptor.assets.find(a => a.id === id).localPath); return g.decodeTerrainGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); };
  const terrain = mesh('terrain'), green = mesh('green'), offset = descriptor.configuration.offset;
  const { replay } = await preservedReplay(descriptor);
  const world = buildHoleWorld(currentPlayerHole(replay), offset, terrain, green);
  const shot = world.shots.find(s => s.strokeNumber === number), rawShot = hole.strokes.find(s => s.strokeNumber === number);
  const fit = rawShot.radarData.ballTrajectory[0], fairway = g.convertNativePoint(hole.fairwayCenter, offset);
  const surface = (x, y) => g.surfaceHeight(terrain, x, y);
  const source = reconstructGenericPgaFlight(fit, world.tee, shot.from, shot.endpoint, fairway, surface);
  const flight = buildFlightPath(number, fit, world.tee, shot.from, shot.endpoint, fairway, surface);
  fixtures.push({ name, descriptor, replay, world, terrain, green, shot, fit, fairway, source, flight, surface });
}

test('fresh supplied PGA payload distinguishes radar models from timed putt samples', () => {
  const replay = fixtures[0].replay;
  assert.deepEqual(replay.shots.map(s => s.ballPath?.path.length ?? 0), [0, 0, 46, 14]);
  assert.deepEqual(replay.shots.map(s => s.flightTrajectory?.type ?? null), ['Broadcast', 'Incoming', null, null]);
  assert.deepEqual(replay.fairwayWorld, { x:9543.47, y:10760.57, z:348.42 });
  const raw = JSON.parse(fs.readFileSync('tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json'));
  assert.equal(raw.holes[0].strokes[0].radarData.normalizedTrajectory.length, 1);
  assert.equal(raw.holes[0].strokes[1].radarData.normalizedTrajectory.length, 0);
  assert.ok(replay.shots.slice(0,2).every(s => s.flightTrajectory.representation === 'single-flight-no-impact-v1'));
});

for (const f of fixtures) {
  test(`${f.name}: nonzero t=0 fit constants explain the complete XY origin residual`, () => {
    const expected = [f.fit.zFit[0] * Math.cos(f.source.angle) - f.fit.xFit[0] * Math.sin(f.source.angle), f.fit.zFit[0] * Math.sin(f.source.angle) + f.fit.xFit[0] * Math.cos(f.source.angle)];
    assert.equal(f.source.coefficientTimes[0], 0);
    if (f.fit.type === 'Broadcast') {
      near(f.source.points[0][0] - f.shot.from[0], expected[0], 1e-12);
      near(f.source.points[0][1] - f.shot.from[1], expected[1], 1e-12);
      assert.equal(f.source.points[0][2], f.shot.from[2]);
    } else assert.deepEqual(f.source.points[0], f.shot.from);
  });
  test(`${f.name}: exact start/end, immutable world, registration and deterministic reveal`, () => {
    const worldBefore = JSON.stringify(f.world), buffersBefore = f.terrain.map(m => [...m.positions]);
    const offsetBefore = JSON.stringify(f.descriptor.configuration.offset);
    assert.deepEqual(f.flight.points[0], f.shot.from); assert.deepEqual(f.flight.points.at(-1), f.shot.endpoint);
    const reveal = createFlightReveal(f.flight.points);
    assert.deepEqual(reveal.sample(0).position, f.shot.from); assert.deepEqual(reveal.sample(3).position, f.shot.endpoint);
    const run = () => Array.from({length:181}, (_,i) => reveal.sample(i/60));
    assert.deepEqual(run(), run());
    for (const p of f.flight.points) assert.ok(Object.isFrozen(p));
    assert.throws(() => { f.flight.points[0][0] += 1; }, TypeError);
    assert.equal(JSON.stringify(f.world), worldBefore);
    assert.deepEqual(f.terrain.map(m => [...m.positions]), buffersBefore);
    assert.equal(JSON.stringify(f.descriptor.configuration.offset), offsetBefore);
    // GPU line attributes use Float32. Their tolerance is 5e-5m, distinct from
    // the exact binary64 logical anchor/glyph position contract above.
    for (const p of [f.flight.points[0], f.flight.points.at(-1)]) for (const value of p) near(Math.fround(value),value,5e-5);
  });
  test(`${f.name}: coefficient-time chord residual, Z, landing and connector preserved`, () => {
    const T = f.source.coefficientTimes.at(-1), first = f.source.points[0], landing = f.source.points[f.source.flightCount-1];
    for (let i=0; i<f.source.flightCount; i++) {
      const u = f.source.coefficientTimes[i]/T, before=f.source.points[i], after=f.flight.points[i];
      assert.equal(after[2],before[2]);
      for (let a=0; a<3; a++) {
        const oldChord=first[a]+u*(landing[a]-first[a]), newChord=f.shot.from[a]+u*(landing[a]-f.shot.from[a]);
        near(after[a]-newChord,before[a]-oldChord,1e-12);
      }
      if (i>0&&i<f.source.flightCount-1) assert.ok(after[2]>=f.surface(after[0],after[1])-1e-8);
    }
    assert.deepEqual(f.flight.points.slice(f.source.flightCount-1), f.source.points.slice(f.source.flightCount-1));
    // Constant correction slope: no extra curvature/acceleration in time.
    const correctionVelocity = f.flight.originCorrection.map(v => -v/T);
    for(let i=1;i<f.source.flightCount;i++) for(let a=0;a<3;a++) {
      const d0=f.flight.points[i-1][a]-f.source.points[i-1][a],d1=f.flight.points[i][a]-f.source.points[i][a];
      near((d1-d0)/(f.source.coefficientTimes[i]-f.source.coefficientTimes[i-1]),correctionVelocity[a],1e-10);
    }
  });
}

test('independently captured Sedgefield and Southwind paths still match the unconstrained evaluator', () => {
  for (const [file, f] of [['tmp/sedgefield-generalization/runtime-capture1.json',fixtures[2]],['tmp/non-putt-flight/southwind-shot3-hole-runtime.json',null]]) {
    const capture=JSON.parse(fs.readFileSync(path.join(donor,file)));
    const source = f ? f.source : reconstructGenericPgaFlight(capture.radar.ballTrajectory[0],capture.tee,capture.start,capture.end,capture.fairwayCenterARL,fixtures[0].surface);
    assert.equal(source.points.length,capture.points.length);
    source.points.forEach((p,i)=>p.forEach((v,a)=>near(v,capture.points[i].xyz[a],1e-5)));
  }
});

test('selection, reset/replay, mid-flight switch and hidden-tab resume are deterministic', () => {
  const paths=fixtures.slice(0,2).map(f=>f.flight), playback=createFlightPlayback(paths), before=JSON.stringify(fixtures[0].world);
  const cycle=()=>{playback.select(1);assert.equal(playback.snapshot().sample,null);assert.ok(playback.play());const out=[playback.snapshot()];
    for(let frame=0;frame<=180;frame++){playback.tick(frame*1000/60,true);out.push(playback.snapshot());} return out;};
  const first=cycle();playback.reset();assert.equal(playback.snapshot().sample,null);assert.deepEqual(cycle(),first);
  assert.equal(playback.snapshot().phase,'finished');assert.deepEqual(playback.snapshot().sample.position,paths[0].points.at(-1));
  playback.play();playback.tick(0,true);playback.tick(1000,true);const halfway=playback.snapshot();
  playback.tick(1500,false);playback.tick(10000,true);assert.deepEqual(playback.snapshot(),halfway);
  playback.select(2);assert.equal(playback.snapshot().phase,'idle');assert.equal(playback.snapshot().sample,null);
  playback.play();assert.deepEqual(playback.snapshot().sample.position,paths[1].points[0]);
  playback.select(3);assert.equal(playback.play(),false);assert.equal(playback.snapshot().sample,null);
  assert.equal(JSON.stringify(fixtures[0].world),before);
});

test('unsupported representations, large/vertical discrepancies and changed endpoints are rejected', () => {
  const f=fixtures[0];
  const constrain=(points=f.source.points,from=f.shot.from,end=f.shot.endpoint)=>constrainFlightOrigin(points,f.source.coefficientTimes,f.source.flightCount,from,end,f.surface);
  assert.throws(()=>constrain(undefined,[f.shot.from[0],f.shot.from[1],f.shot.from[2]+.01]),/discrepancy/);
  assert.throws(()=>constrain(undefined,[f.shot.from[0]+20,f.shot.from[1],f.shot.from[2]]),/discrepancy/);
  assert.throws(()=>constrain(undefined,undefined,[f.shot.endpoint[0]+1,...f.shot.endpoint.slice(1)]),/discrepancy/);
  for(const fit of [{...f.fit,impactTime:7},{...f.fit,timeInterval:[1,8]},{...f.fit,type:'unknown'},{...f.fit,xFit:[NaN]}])
    assert.throws(()=>buildFlightPath(1,fit,f.world.tee,f.shot.from,f.shot.endpoint,f.fairway,f.surface));
});

test('verified current response handoff prepares only non-putts; source failures retain static world; production stays closed', async () => {
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='development';
  try {
    for(const f of [fixtures[0],fixtures[2]]) {
      const input=currentPreparationInput(f.replay),view=await resolveDevelopmentShotcast(input);
      assert.ok(isShotcast3DView(view));assert.ok(view.flightPaths.some(p=>p.strokeNumber===1));
      for(const key of ['tee','pin','shots','greenBounds'])assert.deepEqual(view[key],f.world[key]);
      const bad=structuredClone(input);bad.flightData.fairway.tourcastX=NaN;
      const staticView=await resolveDevelopmentShotcast(bad);assert.deepEqual(staticView.flightPaths,[]);assert.deepEqual(staticView.shots,view.shots);
      const broken=structuredClone(view);broken.flightPaths[0].points[0][0]+=.01;assert.equal(isShotcast3DView(broken),false);
    }
    const input=currentPreparationInput(fixtures[0].replay),view=await resolveDevelopmentShotcast(input);
    assert.deepEqual(view.flightPaths.map(p=>p.strokeNumber),[1,2]);
    const withSamples=structuredClone(fixtures[0].replay);withSamples.shots[0].ballPath={path:[{x:1}]};
    assert.ok(!currentPreparationInput(withSamples).flightData.shots.some(s=>s.strokeNumber===1));
    process.env.NODE_ENV='production';assert.equal(await resolveDevelopmentShotcast(input),null);
  } finally { if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous; }
});
