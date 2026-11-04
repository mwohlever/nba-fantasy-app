/* eslint-disable @typescript-eslint/no-require-imports */
require('../../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const { buildNbaRefreshPublication } = require('../../lib/player-center/nbaRefresh.ts');
const acquired = require('../../supabase/manual/player-center/20261023-canary/provider-acquisition.json')[0];
const origin = Date.now() - 600000;
const player = { sport: 'nba', playerId: 6, nativePlayerId: '2544', providerPlayerId: '1966', identity: 'resolved', active: true, name: 'LeBron James', position: 'F/C' };
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function input(n = 1) {
  return { player: structuredClone(player), season: 2027, runId: uuid(n), asOf: new Date(origin + n * 1000).toISOString(),
    attemptedAt: new Date(origin + n * 1000 + 30).toISOString(),
    log: { payload: structuredClone(acquired.log), fetchedAt: new Date(origin + n * 1000 + 10).toISOString() },
    summary: { payload: structuredClone(acquired.stats), fetchedAt: new Date(origin + n * 1000 + 20).toISOString() } };
}
function pointsChange(value, delta = 1) {
  const p = value.log.payload, index = p.names.indexOf('points');
  const type = p.seasonTypes.find(t => /Regular Season/i.test(t.displayName));
  const row = type.categories.flatMap(c => c.events || []).find(r => r.eventId);
  row.stats[index] = String(Number(row.stats[index]) + delta); return value;
}
function gp(value, count) {
  for (const c of value.summary.payload.categories) {
    const index = (c.labels || []).indexOf('GP');
    if (index >= 0) for (const row of c.statistics || []) if (Number(row.season?.year) === value.season) row.stats[index] = String(count);
  }
  return value;
}
module.exports = { player, uuid, input, gp, pointsChange, build: buildNbaRefreshPublication };
