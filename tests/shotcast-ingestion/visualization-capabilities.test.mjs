import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { importTs } from './module-loader.mjs';

const { planShotcastVisualization } = await importTs(
  'lib/shotcast/visualizationCapabilities.ts',
);

function sourceHole(filename) {
  const raw = JSON.parse(readFileSync(filename, 'utf8'));
  const hole = raw.holes.find((candidate) => candidate.holeNumber === 1);
  assert.ok(hole);
  return {
    tournamentId: raw.tournamentId,
    pgaPlayerId: raw.playerId,
    roundNumber: raw.round,
    holeNumber: hole.holeNumber,
    shots: hole.strokes.map((stroke) => ({
      strokeNumber: stroke.strokeNumber,
      leftToRight: stroke.overview?.leftToRightCoords
        ? {
            from: stroke.overview.leftToRightCoords.fromCoords,
            to: stroke.overview.leftToRightCoords.toCoords,
          }
        : null,
      bottomToTop: stroke.overview?.bottomToTopCoords
        ? {
            from: stroke.overview.bottomToTopCoords.fromCoords,
            to: stroke.overview.bottomToTopCoords.toCoords,
          }
        : null,
      ballPath: stroke.ballPath ?? null,
    })),
  };
}

const southwind = sourceHole('tmp/placement-validation/henley-r1-hole1.json');
const sedgefield = sourceHole(
  'tmp/placement-validation/nonzero-rotation/shot-details.json',
);

function preparedFor(replay, courseId, shots) {
  return {
    tournamentId: replay.tournamentId,
    pgaPlayerId: replay.pgaPlayerId,
    roundNumber: replay.roundNumber,
    holeNumber: replay.holeNumber,
    engineVersion: '3.3.1',
    transformProfile: 'pga-f32-z-up-interior-v1',
    course: {
      pgaCourseId: courseId,
      playerRoundAssignment: 'verified',
      terrain: 'ready',
      imagery: 'ready',
      green: 'ready',
    },
    shots: shots.map((shot) => ({
      endpointSource: 'verified',
      timedPuttSource: shot.kind === 'putt' ? 'verified' : 'unavailable',
      ...shot,
    })),
  };
}

test('the existing PGA hole context selects Southwind non-putt and putt capabilities independently', () => {
  const prepared = preparedFor(southwind, '513', [
    { strokeNumber: 2, kind: 'non_putt' },
    { strokeNumber: 3, kind: 'non_putt', flightPath: 'ready' },
    { strokeNumber: 4, kind: 'putt', puttSurface: 'ready' },
  ]);

  const shot3 = planShotcastVisualization(southwind, prepared, 3);
  assert.equal(shot3.mode, 'non_putt_replay');
  assert.equal(shot3.shots.find((shot) => shot.strokeNumber === 3).recordedEndpoint, true);
  assert.equal(shot3.shots.find((shot) => shot.strokeNumber === 3).replayablePutt, false);

  const shot4 = planShotcastVisualization(southwind, prepared, 4);
  assert.equal(shot4.mode, 'putt_replay');
  assert.equal(shot4.shots.find((shot) => shot.strokeNumber === 4).puttPath, true);
  assert.equal(shot4.shots.find((shot) => shot.strokeNumber === 4).replayableNonPutt, false);

  assert.equal(planShotcastVisualization(southwind, prepared, 2).mode, 'endpoint');
});

test('Sedgefield radar by itself never promises a flight replay', () => {
  const prepared = preparedFor(sedgefield, '752', [
    { strokeNumber: 1, kind: 'non_putt' },
  ]);
  const endpoint = planShotcastVisualization(sedgefield, prepared, 1);
  assert.equal(endpoint.mode, 'endpoint');
  assert.equal(endpoint.shots[0].reconstructedFlightPath, false);

  prepared.shots[0].flightPath = 'ready';
  assert.equal(
    planShotcastVisualization(sedgefield, prepared, 1).mode,
    'non_putt_replay',
  );
});

test('mapped 2D coordinates alone do not grant a 3D endpoint or replay', () => {
  const prepared = preparedFor(sedgefield, '752', [
    {
      strokeNumber: 1,
      kind: 'non_putt',
      endpointSource: 'unavailable',
      flightPath: 'ready',
    },
  ]);
  const plan = planShotcastVisualization(sedgefield, prepared, 1);
  assert.equal(plan.mode, 'course_only');
  assert.equal(plan.shots[0].recordedEndpoint, false);
  assert.equal(plan.shots[0].replayableNonPutt, false);
});

test('an unresolved course or mismatched PGA identity keeps the current 2D fallback', () => {
  const prepared = preparedFor(sedgefield, '752', []);
  prepared.course.playerRoundAssignment = 'unresolved';
  assert.deepEqual(
    planShotcastVisualization(sedgefield, prepared, 1).mode,
    '2d_fallback',
  );

  prepared.course.playerRoundAssignment = 'verified';
  assert.equal(
    planShotcastVisualization(sedgefield, null, 1).reason,
    'missing_preparation',
  );
  for (const changed of [
    { pgaPlayerId: '34098' },
    { tournamentId: 'R2026027' },
    { roundNumber: 2 },
    { holeNumber: 2 },
  ]) {
    assert.equal(
      planShotcastVisualization(sedgefield, { ...prepared, ...changed }, 1).reason,
      'identity_mismatch',
    );
  }
});

test('a different engine or transform profile cannot inherit the validated 3D path', () => {
  const prepared = preparedFor(sedgefield, '752', [
    { strokeNumber: 1, kind: 'non_putt', flightPath: 'ready' },
  ]);
  prepared.engineVersion = '3.4.0';
  assert.equal(
    planShotcastVisualization(sedgefield, prepared, 1).reason,
    'unsupported_profile',
  );
});

test('missing imagery or green preserves only the supported 3D subset', () => {
  const prepared = preparedFor(southwind, '513', [
    { strokeNumber: 4, kind: 'putt', puttSurface: 'ready' },
  ]);
  prepared.course.imagery = 'unavailable';
  prepared.course.green = 'unavailable';
  const plan = planShotcastVisualization(southwind, prepared, 4);
  assert.equal(plan.mode, 'endpoint');
  assert.deepEqual(plan.course, {
    geometry: true,
    imagery: false,
    green: false,
  });
  assert.equal(plan.shots.find((shot) => shot.strokeNumber === 4).puttPath, true);
  assert.equal(plan.shots.find((shot) => shot.strokeNumber === 4).replayablePutt, false);

  prepared.course.terrain = 'unavailable';
  assert.equal(planShotcastVisualization(southwind, prepared, 4).mode, '2d_fallback');
});

test('invalid putt timestamps and missing native 3D endpoint do not create a replay', () => {
  const replay = structuredClone(southwind);
  const putt = replay.shots.find((shot) => shot.strokeNumber === 4);
  putt.ballPath.path[1].secondsSinceStart = putt.ballPath.path[0].secondsSinceStart;
  putt.bottomToTop.to.tourcastZ = null;
  putt.leftToRight.to.tourcastZ = null;
  const prepared = preparedFor(replay, '513', [
    { strokeNumber: 4, kind: 'putt', puttSurface: 'ready' },
  ]);
  const plan = planShotcastVisualization(replay, prepared, 4);
  assert.equal(plan.mode, 'course_only');
  assert.equal(plan.shots.find((shot) => shot.strokeNumber === 4).recordedEndpoint, false);
  assert.equal(plan.shots.find((shot) => shot.strokeNumber === 4).puttPath, false);
});

test('mapped timed putt samples require their own native-source validation', () => {
  const prepared = preparedFor(southwind, '513', [
    {
      strokeNumber: 4,
      kind: 'putt',
      timedPuttSource: 'unavailable',
      puttSurface: 'ready',
    },
  ]);
  const plan = planShotcastVisualization(southwind, prepared, 4);
  assert.equal(plan.mode, 'endpoint');
  assert.equal(plan.shots.find((shot) => shot.strokeNumber === 4).puttPath, false);
});

test('duplicate stroke identities fail closed instead of selecting an arbitrary path', () => {
  const prepared = preparedFor(southwind, '513', [
    { strokeNumber: 3, kind: 'non_putt', flightPath: 'ready' },
    { strokeNumber: 3, kind: 'non_putt', flightPath: 'ready' },
  ]);
  const plan = planShotcastVisualization(southwind, prepared, 3);
  assert.equal(plan.mode, '2d_fallback');
  assert.equal(plan.reason, 'ambiguous_shots');
});
