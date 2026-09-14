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
const { reconcileGolfFieldIdentities, reconcileGolfPgaPlaceholderIdentities, normalizeGolfIdentityName } = require('../lib/golf/fieldIdentityReconciliation.ts');

function database(players) {
  return { from() { return {
    select() { return Promise.resolve({ data: players, error: null }); },
    update(values) { return { eq(_key, id) { const row = players.find(player => player.id === id); Object.assign(row, values); return Promise.resolve({ error: null }); } }; },
    upsert(rows) { return { select() { for (const row of rows) { let saved = players.find(player => player.espn_player_id === row.espn_player_id); if (!saved) { saved = { id: Math.max(0, ...players.map(player => player.id)) + 1 }; players.push(saved); } Object.assign(saved, row); } return Promise.resolve({ data: players.filter(player => rows.some(row => row.espn_player_id === player.espn_player_id)), error: null }); } }; },
  }; } };
}
const competitor = (id, name) => ({ espnPlayerId: id, displayName: name, shortName: name, country: null, countryFlagUrl: null, playerUrl: null });

function broaderDatabase(players, observations) {
  return { from(table) {
    if (table === 'golf_analytics_observations') return {
      select() { return { in(_column, names) { return Promise.resolve({ data: observations.filter(row => names.includes(row.provider_name)), error: null }); } }; },
    };
    return {
      select() { return Promise.resolve({ data: players, error: null }); },
      update(values) { return { eq(_key, id) { const row = players.find(player => player.id === id); Object.assign(row, values); return Promise.resolve({ error: null }); } }; },
    };
  } };
}

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

test('broader identity evidence resolves exact unique placeholders without tournament competitors', async () => {
  const players = [
    { id: 1, display_name: 'Directory Player', espn_player_id: 'pga:1' },
    { id: 2, display_name: 'History Player', espn_player_id: 'pga:2' },
    { id: 3, display_name: 'Ambiguous Player', espn_player_id: 'pga:3' },
    { id: 4, display_name: 'Existing Numeric', espn_player_id: '444' },
  ];
  const db = broaderDatabase(players, [{ provider_name: 'History Player', provider_player_id: '222' }]);
  const result = await reconcileGolfPgaPlaceholderIdentities({
    db, playerIds: [1, 2, 3, 4], refreshedAt: '2026-09-14T00:00:00Z',
    athleteSearch: async () => new Map([
      ['Directory Player', [{ espnPlayerId: '111', displayName: 'Directory Player' }]],
      ['History Player', [{ espnPlayerId: '222', displayName: 'History Player' }]],
      ['Ambiguous Player', [
        { espnPlayerId: '333', displayName: 'Ambiguous Player' },
        { espnPlayerId: '334', displayName: 'Ambiguous Player' },
      ]],
    ]),
  });
  assert.equal(players.find(player => player.id === 1).espn_player_id, '111');
  assert.equal(players.find(player => player.id === 2).espn_player_id, '222');
  assert.equal(players.find(player => player.id === 3).espn_player_id, 'pga:3');
  assert.equal(players.find(player => player.id === 4).espn_player_id, '444');
  assert.equal(result.counts.resolved, 2);
  assert.equal(result.counts.ambiguous, 1);
  assert.equal(result.diagnostics.find(row => row.playerId === 1).source, 'athlete_search');
  assert.equal(result.diagnostics.find(row => row.playerId === 2).source, 'analytics_history');
});

test('Salary Setup partitions only nonnumeric identities after broader reconciliation', () => {
  const route = fs.readFileSync(path.join(root, 'app/api/admin/golf/salary-cap/route.ts'), 'utf8');
  const importer = fs.readFileSync(path.join(root, 'app/api/admin/golf/import-field/route.ts'), 'utf8');
  assert.match(importer, /reconcileGolfPgaPlaceholderIdentities/);
  assert.match(route, /^\s*identityStatus: \/\^\\d\+\$\//m);
});

test('an unavailable broader directory leaves an empty competitor feed safely unresolved', async () => {
  const players = [{ id: 1, display_name: 'Unlisted Player', espn_player_id: 'pga:1' }];
  const result = await reconcileGolfPgaPlaceholderIdentities({
    db: broaderDatabase(players, []), playerIds: [1], refreshedAt: '2026-09-14T00:00:00Z',
    athleteSearch: async () => { throw new Error('directory unavailable'); },
  });
  assert.equal(players[0].espn_player_id, 'pga:1');
  assert.equal(result.counts.unresolved, 1);
});
