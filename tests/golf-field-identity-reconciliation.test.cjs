/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const resolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, main, options) {
  return resolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, main, options);
};
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { reconcileGolfFieldIdentities, normalizeGolfIdentityName } = require('../lib/golf/fieldIdentityReconciliation.ts');

function database(players) {
  return { from() { return {
    select() { return Promise.resolve({ data: players, error: null }); },
    update(values) { return { eq(_key, id) { const row = players.find(player => player.id === id); Object.assign(row, values); return Promise.resolve({ error: null }); } }; },
    upsert(rows) { return { select() { for (const row of rows) { let saved = players.find(player => player.espn_player_id === row.espn_player_id); if (!saved) { saved = { id: Math.max(0, ...players.map(player => player.id)) + 1 }; players.push(saved); } Object.assign(saved, row); } return Promise.resolve({ data: players.filter(player => rows.some(row => row.espn_player_id === player.espn_player_id)), error: null }); } }; },
  }; } };
}
const competitor = (id, name) => ({ espnPlayerId: id, displayName: name, shortName: name, country: null, countryFlagUrl: null, playerUrl: null });

test('field identity reconciliation preserves canonical IDs, accents, exact IDs, ambiguity, and empty feeds', async () => {
  const players = [{ id: 7, display_name: 'Fabián Gómez', espn_player_id: 'pga:77' }, { id: 8, display_name: 'Exact Player', espn_player_id: '88' },
    { id: 9, display_name: 'Duplicate Name', espn_player_id: 'pga:9' }, { id: 10, display_name: 'Duplicate Name', espn_player_id: 'pga:10' }];
  const db = database(players);
  const none = await reconcileGolfFieldIdentities({ db, competitors: [], refreshedAt: '2026-09-13T00:00:00Z' });
  assert.deepEqual(none.counts, { retained: 0, resolved: 0, created: 0, ambiguous: 0, unresolved: 0 });
  const result = await reconcileGolfFieldIdentities({ db, competitors: [competitor('101', 'Fabian Gomez'), competitor('88', 'Exact Player'), competitor('102', 'Duplicate Name'), competitor('103', 'New Player')], refreshedAt: '2026-09-13T00:00:00Z' });
  assert.equal(players.find(player => player.id === 7).espn_player_id, '101');
  assert.equal(result.playerIdByEspnId.get('101'), 7);
  assert.equal(result.playerIdByEspnId.get('88'), 8);
  assert.equal(result.diagnostics.find(row => row.espnPlayerId === '102').status, 'ambiguous');
  assert.equal(result.diagnostics.find(row => row.espnPlayerId === '103').status, 'created');
  assert.equal(normalizeGolfIdentityName('Fabián Gómez'), 'fabian gomez');
});

test('PGA field workflow defers empty ESPN feeds and uses the identity-only route', () => {
  const admin = fs.readFileSync(path.join(root, 'app/admin/slates/page.tsx'), 'utf8');
  const route = fs.readFileSync(path.join(root, 'app/api/admin/golf/field-identities/route.ts'), 'utf8');
  assert.match(admin, /reconcileGolfFieldIdentitiesFromBrowser/);
  assert.match(route, /parseGolfTournamentByEventIdFromPayload/);
  assert.match(route, /reconcileGolfFieldIdentities/);
  assert.doesNotMatch(route, /reconcileGolf\(|initialize_golf_lifecycle|golf_rounds/);
});
