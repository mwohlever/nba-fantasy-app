/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const test = require('node:test');
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

test('factual worker defaults to one current season and preserves explicit prior/historical modes',()=>{
  const {selectRefreshSeason}=require('../scripts/run-nba-player-center-refresh.cjs');
  for(const [date,current] of [['2026-09-30T23:59:59Z',2026],['2026-10-01T00:00:00Z',2027],['2027-01-01T00:00:00Z',2027],['2027-10-01T00:00:00Z',2028]]) {
    const now=new Date(date);assert.equal(selectRefreshSeason({now}),current);assert.equal(selectRefreshSeason({now,mode:'prior'}),current-1);
    assert.equal(selectRefreshSeason({now,override:'2025'}),2025);
  }
});
test('factual worker rejects invalid/future seasons before acquisition',()=>{
  const {selectRefreshSeason}=require('../scripts/run-nba-player-center-refresh.cjs');
  const now=new Date('2026-10-29T00:00:00Z');
  assert.throws(()=>selectRefreshSeason({now,override:'2026.5'}),/NBA_PROJECTION_SEASON/);
  assert.throws(()=>selectRefreshSeason({now,override:'2028'}),/future/);
  assert.throws(()=>selectRefreshSeason({now,mode:'arbitrary'}),/Mode/);
});
