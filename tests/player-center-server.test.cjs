/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..'), originalLoad = Module._load, originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...args) { return originalResolve.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args); };
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED='true';
const state = { user: null, active: null, authorization: null, tables: {}, queries: [], calls: [] };
function query(table) {
  const filters = [], orders = [];
  const q = {
    select() { return q; },
    eq(key, value) { filters.push(row => row[key] === value); return q; },
    lte(key, value) { filters.push(row => Date.parse(row[key]) <= Date.parse(value)); return q; },
    order(key) { orders.push(key); return q; },
    range(first, last) { state.queries.push({ table, first, last }); return Promise.resolve(state.failPage?.(table,first)?{data:null,error:{message:'isolated cache outage'}}:{ data: rows().slice(first, last + 1), error: null }); },
    maybeSingle() { state.queries.push({ table }); return Promise.resolve({ data: rows()[0] ?? null, error: null }); },
    insert() { throw Error('PRODUCTION WRITE ATTEMPT'); }, update() { throw Error('PRODUCTION WRITE ATTEMPT'); },
    upsert() { throw Error('PRODUCTION WRITE ATTEMPT'); }, delete() { throw Error('PRODUCTION WRITE ATTEMPT'); },
  };
  function rows() { return [...(state.tables[table] ?? [])].filter(row => filters.every(f => f(row))).sort((a, b) => {
    for (const key of orders) { const result = typeof a[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key])); if (result) return result; } return 0;
  }); }
  return q;
}
const db = { from: query, rpc() { throw Error('RPC FORBIDDEN'); } };
const stubService = class {
  async profile(input) { state.calls.push(input); return { scoring: input.scoring }; }
  async comparisons(input) { state.calls.push(input); return { scoring: input.scoring, providerRequests: 0 }; }
};
Module._load = function(request, parent, ...args) {
  if (request === 'server-only') return {};
  if (parent?.filename.includes('/lib/player-center/')) {
    if (request === '../supabaseAdmin') return { supabaseAdmin: db };
    if (request === '../auth') return { getCurrentUser: async () => state.user };
    if (request === '../groups/context') return { getActiveLeagueForSport: async () => state.active };
    if (request === '../security/resourceAuthorization') return { authorizeSlateResource: async () => state.authorization };
    if (request === './service' && parent.filename.endsWith('/http.server.ts')) return { PlayerCenterService: stubService };
  }
  return originalLoad.call(this, request, parent, ...args);
};
const { SupabaseCenterRepository } = require('../lib/player-center/repository.server.ts');
const { playerCenterGet } = require('../lib/player-center/http.server.ts');
const now = Date.parse('2026-10-23T17:00:00Z');
function reset() { state.user = { id: 'user' }; state.active = { context: { group: { id: 'group-a' } }, league: { id: 'league-a', settings: { scoring: { points: 10 } } } };
  state.authorization = { ok: true, target: { groupId: 'group-a', leagueId: 'league-a' } }; state.tables = {}; state.queries = []; state.calls = []; state.failPage=null; }
const request = query => new Request(`http://localhost/api/player-center?${query}`);

test('catalog paging retains all 1,031 NFL identities and detects provider ID collisions', async () => {
  reset(); state.tables.players_nfl = Array.from({ length: 1031 }, (_, i) => ({ id: i + 1, name: `Player ${i}`, nfl_player_id: 1000 + i, position: 'WR', is_active: true }));
  const repository = new SupabaseCenterRepository(db, () => now), catalog = await repository.catalog('nfl');
  assert.equal(catalog.players.length, 1031); assert.equal(state.queries.filter(q => q.table === 'players_nfl').length, 2);
  state.tables.players_nfl[1].nfl_player_id = state.tables.players_nfl[0].nfl_player_id;
  const collided = await repository.catalog('nfl');
  assert.equal(collided.players[0].identity, 'conflict'); assert.equal(collided.players[0].providerPlayerId, null);
});
test('stored reads join exact local AND provider identity and do not mix seasons or fill missing fields', async () => {
  reset(); state.tables.players_nfl = [{ id: 1, name: 'QB', nfl_player_id: 42, position: 'QB', is_active: true }];
  const base = { provider: 'espn', provider_player_id: '42', provider_event_id: '100', local_player_id: 1, season: 2026, phase: 'regular', game_at: '2026-10-20T20:00:00Z', game_log_fetched_at: '2026-10-23T16:00:00Z', passing_yards: -1 };
  state.tables.nfl_player_game_observations = [base, { ...base, provider_player_id: '999', provider_event_id: '101' }, { ...base, season: 2025, provider_event_id: '102' }];
  state.tables.player_nfl_season_stats = [{ season: 2026, nfl_player_id: 42, games_played: 1 }];
  const repo = new SupabaseCenterRepository(db, () => now), catalog = await repo.catalog('nfl');
  const histories = await repo.histories('nfl', 2026, catalog, new Date(now).toISOString());
  assert.equal(histories[0].games.length, 1); assert.equal(histories[0].games[0].stats.passing_yards, -1);
  assert.equal(histories[0].games[0].stats.receptions, null); assert.equal(histories[0].coverage.expectedGames, 1);
  assert.equal(histories[0].coverage.freshness, 'fresh');
  state.tables.nfl_player_game_observations.push({ ...base });
  const ambiguous=await repo.histories('nfl',2026,catalog,new Date(now).toISOString());assert.equal(ambiguous[0].games.length,0);assert.equal(ambiguous[0].coverage.freshness,'unavailable');
});
test('NBA resolves only reviewed explicit IDs; local review candidates are not runtime identities', async () => {
  reset(); state.tables.players = [{ id: 1, name: 'Same Name', nba_player_id: 100, is_active: true, position_group: 'G' }, { id: 2, name: 'Unmapped', nba_player_id: 101, is_active: true, position_group: 'G' }];
  state.tables.nba_player_provider_identities = [{ provider: 'espn', provider_player_id: '9', player_id: 1, resolution_status: 'resolved', resolution_method: 'reviewed_provider_evidence', evidence: 'Reviewed native ID + team', is_locked: true }];
  const catalog = await new SupabaseCenterRepository(db, () => now).catalog('nba');
  assert.equal(catalog.players[0].providerPlayerId, '9'); assert.equal(catalog.players[1].identity, 'unresolved');
});
test('unauthenticated/disabled-Group API requests stop before all data/provider reads', async () => {
  reset(); state.user = null;
  assert.equal((await playerCenterGet(request('sport=nba&season=2027&playerId=1'), 'profile')).status, 401);
  state.user = { id: 'user' }; state.active = null;
  assert.equal((await playerCenterGet(request('sport=nba&season=2027&playerId=1'), 'profile')).status, 404);
  assert.equal(state.calls.length, 0); assert.equal(state.queries.length, 0);
});
test('API rejects invalid years/windows and cross-Group slates without loading player data', async () => {
  reset();
  assert.equal((await playerCenterGet(request('sport=nba&season=all&playerId=1'), 'profile')).status, 400);
  assert.equal((await playerCenterGet(request('sport=nfl&season=2026&window=recent'), 'comparisons')).status, 400);
  state.authorization.target.groupId = 'group-b';
  assert.equal((await playerCenterGet(request('sport=nba&season=2027&playerId=1&slateId=10'), 'profile')).status, 404);
  assert.equal(state.calls.length, 0); assert.equal(state.queries.length, 0);
});
test('API uses authorized frozen snapshots and intentional legacy defaults, never changed league settings', async () => {
  reset(); state.tables.slates = [{ id: 10, league_id: 'league-a', rules_snapshot: { sport: 'nba', scoring: { points: 2 } } }];
  let response = await playerCenterGet(request('sport=nba&season=2027&playerId=1&slateId=10'), 'profile');
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.equal((await response.json()).groupId, 'group-a');
  assert.deepEqual(state.calls.at(-1).scoring, { sport: 'nba', basis: 'slate_snapshot', settings: { sport: 'nba', scoring: { points: 2 } } });
  state.tables.slates[0].rules_snapshot = null;
  response = await playerCenterGet(request('sport=nba&season=2027&playerId=1&slateId=10'), 'profile');
  assert.equal(response.status, 200); assert.equal(state.calls.at(-1).scoring.basis, 'legacy_defaults'); assert.equal(state.calls.at(-1).scoring.settings, null);
});

const {decodeSeasonCache}=require('../lib/player-center/durableCache.ts');
const {compareHistories}=require('../lib/player-center/comparison.ts');
const {PlayerCenterService}=require('../lib/player-center/service.ts');
const capture=require('../data/player-center-preview/captured.json');
const canary=require('../supabase/manual/player-center/20261023-canary/batch-manifest.json');
// Replayed mock acquisition times; unchanged box scores, not a new real season certification.
const cacheNow=Math.max(...capture.histories.flatMap(h=>h.games.map(g=>Date.parse(g.fetchedAt))))+60000;
const scoring=sport=>({sport,settings:null,basis:'legacy_defaults'});
function cacheFixture(sport='nba',id=sport==='nba'?6:435){
 const h=structuredClone(capture.histories.find(h=>h.player.sport===sport&&h.player.playerId===id&&h.season===(sport==='nba'?2027:2026)));
 const row={sport,provider:'espn',provider_player_id:h.player.providerPlayerId,season:h.season,phase:h.phase,nba_local_player_id:sport==='nba'?id:null,nfl_local_player_id:sport==='nfl'?id:null,as_of:new Date(cacheNow-1000).toISOString(),checked_at:new Date(cacheNow-1000).toISOString(),expected_games:h.coverage.expectedGames,observed_games:h.games.filter(g=>g.status==='final'&&g.participation==='played').length,complete:true,games:h.games,season_stats:h.seasonStats,issues:[],content_hash:'a'.repeat(64),rollout_batch_id:'isolated-test'};
 return{h,row};
}
function catalogTables(h){
 if(h.player.sport==='nba'){
  state.tables.players=[{id:h.player.playerId,name:h.player.name,nba_player_id:Number(h.player.nativePlayerId),position_group:h.player.position,is_active:true}];
  state.tables.nba_player_provider_identities=[{provider:'espn',provider_player_id:h.player.providerPlayerId,player_id:h.player.playerId,resolution_status:'resolved',resolution_method:'reviewed_provider_evidence',evidence:'native/provider reviewed',is_locked:true}];
 }else state.tables.players_nfl=[{id:h.player.playerId,name:h.player.name,nfl_player_id:h.player.providerPlayerId,position:h.player.position,is_active:true}];
}
test('durable reader accepts the exact staged NBA canary and preserves nullable NFL/K/DST facts',()=>{
 const h=capture.histories.find(h=>h.player.sport==='nba'&&h.player.playerId===6&&h.season===2027);
 const decoded=decodeSeasonCache(canary.cache[0],h.player,2027,cacheNow);assert.equal(decoded.games.length,2);assert.equal(decoded.coverage.cache.complete,true);assert.equal(decoded.seasonStats.season,2027);
 for(const id of [435,1,2387,2424]){const {h,row}=cacheFixture('nfl',id);const p=decodeSeasonCache(row,h.player,2026,cacheNow);assert.deepEqual(p.games,h.games);assert.equal(p.coverage.freshness,id===2424?'stale':'fresh');}
});
test('cache boundary rejects wrong players/seasons, duplicates, malformed stats, future checks and GP conflicts',()=>{
 const {h,row}=cacheFixture();
 for(const mutate of [r=>r.nba_local_player_id=99,r=>r.provider_player_id='99',r=>r.season=2026,r=>r.games[0].phase='postseason',r=>r.games.push(r.games[0]),r=>r.games[0].stats.points='17',r=>r.games[0].stats.fantasy_points=99,r=>r.checked_at='2030-01-01T00:00:00Z',r=>r.observed_games=99,r=>r.season_stats.expectedGames=99]){const bad=structuredClone(row);mutate(bad);assert.throws(()=>decodeSeasonCache(bad,h.player,2027,cacheNow),/Invalid durable/);}
});
test('durable freshness uses source checks and cutoff, with seven-day prior season policy',()=>{
 const {h,row}=cacheFixture();assert.equal(decodeSeasonCache(row,h.player,2027,cacheNow+86400000).coverage.freshness,'stale');
 row.checked_at=new Date(cacheNow+86400000).toISOString();assert.equal(decodeSeasonCache(row,h.player,2027,cacheNow+86400000).coverage.freshness,'stale','a newer poll cannot certify an old cutoff');
 const prior=structuredClone(capture.histories.find(h=>h.player.sport==='nba'&&h.season===2026));Object.assign(row,{season:2026,games:prior.games,expected_games:60,observed_games:60,season_stats:prior.seasonStats,checked_at:new Date(cacheNow-1000).toISOString()});
 assert.equal(decodeSeasonCache(row,prior.player,2026,cacheNow+86400000).coverage.freshness,'fresh');assert.equal(decodeSeasonCache(row,prior.player,2026,cacheNow+8*86400000).coverage.freshness,'stale');
});
test('both sports use fresh durable profiles without ESPN calls and score them per Group/frozen context',async()=>{
 for(const sport of ['nba','nfl']){reset();const {h,row}=cacheFixture(sport);catalogTables(h);state.tables.player_center_season_cache=[row];let requests=0;
  const repo=new SupabaseCenterRepository(db,()=>cacheNow),service=new PlayerCenterService(repo,{history:async()=>{requests++;throw Error('provider forbidden');}},()=>cacheNow);
  for(const basis of ['league_settings','slate_snapshot']){const settings={sport,scoring:sport==='nba'?{points:2}:{passingTouchdowns:6}};const profile=await service.profile({sport,playerId:h.player.playerId,season:h.season,phase:'regular',scoring:{sport,settings,basis}});assert.equal(profile.scoringBasis,basis);assert.equal(profile.source,'stored');assert.equal(profile.asOf,row.as_of);assert.equal(profile.providerRequests,0);}
  assert.equal(requests,0);assert.ok(state.queries.every(q=>!q.table.includes('projection')));
 }
});
test('absent/invalid/stale caches fall back read-only, while comparisons cannot use legacy-only coverage',async()=>{
 reset();const {h,row}=cacheFixture();catalogTables(h);const repo=new SupabaseCenterRepository(db,()=>cacheNow);let requests=0;
 const provider={history:async()=>{requests++;return structuredClone(h);}},service=new PlayerCenterService(repo,provider,()=>cacheNow);
 await service.profile({sport:'nba',playerId:6,season:2027,phase:'regular',scoring:scoring('nba')});assert.equal(requests,1);
 const comparisons=await service.comparisons({sport:'nba',season:2027,window:'season',metric:'points',ascending:false,scoring:scoring('nba')});assert.equal(comparisons.coverage.canSort,false);assert.equal(requests,1,'comparisons never call ESPN');
 state.tables.player_center_season_cache=[{...row,checked_at:'2000-01-01T00:00:00Z'}];assert.equal(await repo.profileSnapshot(h.player,2027),null);
 state.tables.player_center_season_cache=[row];const staleRepo=new SupabaseCenterRepository(db,()=>cacheNow+2*86400000);
 const fallback=new PlayerCenterService(staleRepo,{history:async()=>({...structuredClone(h),coverage:{...h.coverage,freshness:'unavailable'}})},()=>cacheNow+2*86400000);
 const profile=await fallback.profile({sport:'nba',playerId:6,season:2027,phase:'regular',scoring:scoring('nba')});assert.equal(profile.coverage.freshness,'stale');assert.equal(profile.windows.season.metricComparable.points,false);assert.equal(profile.games.length,2);
});
test('durable comparisons require a common cutoff; known short samples stay missing-last without blocking complete peers',()=>{
 const {h,row}=cacheFixture();const a=decodeSeasonCache(row,h.player,2027,cacheNow),b=structuredClone(a);b.player={...b.player,playerId:4,name:'Other',providerPlayerId:'different'};
 b.games=b.games.slice(0,1).map(g=>({...g,providerPlayerId:'different'}));b.coverage.expectedGames=1;
 const input={sport:'nba',season:2027,window:'last1',metric:'points',ascending:false,scoring:scoring('nba')};
 assert.equal(compareHistories(input,[a,b],new Date(cacheNow).toISOString(),new Date(cacheNow).toISOString()).coverage.canSort,true);
 b.coverage.cache.asOf='2026-10-26T14:00:00Z';assert.equal(compareHistories(input,[a,b],new Date(cacheNow).toISOString(),new Date(cacheNow).toISOString()).coverage.canSort,false);
 b.coverage.cache.asOf=a.coverage.cache.asOf;
 assert.equal(compareHistories({...input,window:'last3'},[a,b],new Date(cacheNow).toISOString(),new Date(cacheNow).toISOString()).players[0].rankableAverage,null);
 a.games.push({...structuredClone(a.games[0]),eventId:'999999999'});a.coverage.expectedGames=3;
 for(const ascending of [true,false]){const result=compareHistories({...input,window:'last3',ascending},[a,b],new Date(cacheNow).toISOString(),null);assert.equal(result.coverage.canSort,true);assert.equal(result.players.at(-1).player.playerId,b.player.playerId);assert.equal(result.players.at(-1).rankableAverage,null);}
 b.coverage.cache.complete=false;assert.equal(compareHistories(input,[a,b],new Date(cacheNow).toISOString(),new Date(cacheNow).toISOString()).coverage.canSort,false);
});
test('production launch gate is opt-in and prevents all Player Center data access when disabled',async()=>{
 const previous=process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED;process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED='false';reset();
 try{assert.equal((await playerCenterGet(request('sport=nba&season=2027&playerId=6'),'profile')).status,404);assert.equal(state.calls.length,0);assert.equal(state.queries.length,0);}finally{process.env.NEXT_PUBLIC_PLAYER_CENTER_ENABLED=previous;}
});
test('cache paging is bounded and a later failed page never publishes a partial comparison pool',async()=>{
 reset();const {h,row}=cacheFixture('nfl',2387);const players=Array.from({length:31},(_,i)=>({...h.player,playerId:i+1,providerPlayerId:String(800000+i),nativePlayerId:String(800000+i)}));
 state.tables.player_center_season_cache=players.map(p=>({...structuredClone(row),provider_player_id:p.providerPlayerId,nfl_local_player_id:p.playerId,games:row.games.map(g=>({...structuredClone(g),providerPlayerId:p.providerPlayerId}))}));
 const repo=new SupabaseCenterRepository(db,()=>cacheNow),catalog={players,readAt:new Date(cacheNow).toISOString()};const full=await repo.histories('nfl',2026,catalog,new Date(cacheNow).toISOString());
 assert.equal(full.length,31);assert.ok(full.every(h=>h.coverage.cache?.complete));assert.equal(state.queries.filter(q=>q.table==='player_center_season_cache').length,2);assert.ok(!state.queries.some(q=>q.table==='nfl_player_game_observations'));
 state.failPage=(table,first)=>table==='player_center_season_cache'&&first>=25;
 const partial=await repo.histories('nfl',2026,catalog,new Date(cacheNow).toISOString());assert.ok(partial.every(h=>h.coverage.comparisonEligible===false));assert.ok(partial.every(h=>h.games.length===0));
});
