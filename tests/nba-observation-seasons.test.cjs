/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { resolveNbaObservationSeason } = require('../scripts/lib/nbaObservationSeason.cjs');

test('NBA end-year selection stays stable through January, playoffs, and the offseason', () => {
  for (const date of [
    '2026-01-01T00:00:00Z', '2026-06-30T23:59:59Z',
    '2026-07-01T00:00:00Z', '2026-08-15T12:00:00Z',
    '2026-09-30T23:59:59.999Z',
  ]) assert.equal(resolveNbaObservationSeason({ now: new Date(date) }), 2026, date);
});

test('October rollover selects 2027 for 2026–27 and continues into future seasons', () => {
  for (const [date, season] of [
    ['2026-10-01T00:00:00Z', 2027], ['2026-10-28T12:00:00Z', 2027],
    ['2026-12-31T23:59:59.999Z', 2027], ['2027-01-01T00:00:00Z', 2027],
    ['2027-09-30T23:59:59.999Z', 2027], ['2027-10-01T00:00:00Z', 2028],
    ['2034-10-01T00:00:00Z', 2035],
  ]) assert.equal(resolveNbaObservationSeason({ now: new Date(date) }), season, date);
});

test('rollover follows UTC rather than the timestamp or host local timezone', () => {
  assert.equal(resolveNbaObservationSeason({ now: new Date('2026-09-30T20:00:00-04:00') }), 2027);
  assert.equal(resolveNbaObservationSeason({ now: new Date('2026-10-01T01:00:00+02:00') }), 2026);
});

test('explicit historical seasons remain supported and blank overrides use the default', () => {
  const now = new Date('2026-10-28T12:00:00Z');
  for (const override of [undefined, '', '   ']) {
    assert.equal(resolveNbaObservationSeason({ now, override }), 2027);
  }
  assert.equal(resolveNbaObservationSeason({ now, override: ' 2025 ' }), 2025);
  assert.equal(resolveNbaObservationSeason({ now, override: '2000' }), 2000);
  assert.equal(resolveNbaObservationSeason({ now, override: '2100' }), 2100);
});

test('invalid dates or season overrides fail before acquisition', () => {
  assert.throws(() => resolveNbaObservationSeason({ now: new Date('invalid') }), /Valid acquisition date/);
  for (const override of ['invalid', '2026.5', '1999', '2101', 'Infinity']) {
    assert.throws(() => resolveNbaObservationSeason({ override }), /NBA_PROJECTION_SEASON/);
  }
});

async function exerciseWorker({ now, override, source } = {}) {
  const acquisitions = [], posts = [], errors = [];
  const requireStub = name => {
    if (name === 'fs') return fs;
    if (name === 'path') return path;
    if (name === 'typescript') return {};
    if (name === './lib/nbaObservationSeason.cjs') return { resolveNbaObservationSeason };
    if (name.endsWith('/lib/analytics/providers/espnNbaGameLog.ts')) {
      return { fetchEspnNbaGameLog: async request => {
        acquisitions.push(request);
        return { observations: [{ providerPlayerId: request.espnPlayerId, season: request.season }] };
      } };
    }
    throw new Error(`Unexpected worker dependency: ${name}`);
  };
  requireStub.extensions = {};
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
  }
  const processStub = { env: {
    NBA_PROJECTION_INGEST_BASE_URL: 'https://isolated.invalid',
    NBA_PROJECTION_INGEST_SECRET: 'fixture-only',
    ...(override === undefined ? {} : { NBA_PROJECTION_SEASON: override }),
  } };
  const completion = vm.runInNewContext(source ?? fs.readFileSync('scripts/run-nba-projection-shadow-refresh.cjs', 'utf8'), {
    require: requireStub, __dirname: path.resolve('scripts'), process: processStub,
    Date: FixedDate, URL, AbortSignal,
    console: { log() {}, error(message) { errors.push(message); } },
    fetch: async (url, options) => {
      assert.equal(new URL(url).origin, 'https://isolated.invalid');
      assert.equal(options.method, 'POST');
      const body = JSON.parse(options.body); posts.push(body);
      return { ok: true, json: async () => body.action === 'eligible'
        ? { providerPlayerIds: ['1966'] } : { accepted: body.observations?.length ?? 0 } };
    },
  });
  await completion;
  assert.deepEqual(errors, []);
  assert.equal(processStub.exitCode, undefined);
  return { acquisitions, posts };
}

test('worker preserves its current/prior acquisition window and deferred-generation payload', async () => {
  for (const [now, override, expected] of [
    ['2026-09-30T23:59:59.999Z', undefined, 2026],
    ['2026-10-01T00:00:00Z', undefined, 2027],
    ['2026-10-28T12:00:00Z', undefined, 2027],
    ['2027-01-01T00:00:00Z', undefined, 2027],
    ['2027-08-01T00:00:00Z', undefined, 2027],
    ['2027-10-01T00:00:00Z', undefined, 2028],
    ['2034-10-01T00:00:00Z', undefined, 2035],
    ['2026-10-28T12:00:00Z', '2025', 2025],
  ]) {
    const { acquisitions, posts } = await exerciseWorker({ now, override });
    assert.deepEqual(acquisitions.map(r => [r.espnPlayerId, r.season]), [['1966', expected - 1], ['1966', expected]]);
    const writes = posts.filter(body => body.action === 'observations');
    assert.equal(writes.length, 1);
    assert.equal(writes[0].season, expected);
    assert.equal(writes[0].generate, false);
    assert.deepEqual(writes[0].observations.map(row => row.season), [expected - 1, expected]);
  }
});

test('worker rejects an invalid override before making any provider or application request', async () => {
  // A synchronous season error must occur before the worker starts its async acquisition.
  await assert.rejects(exerciseWorker({ now: '2026-10-28T12:00:00Z', override: '2026.5' }), /NBA_PROJECTION_SEASON/);
});
