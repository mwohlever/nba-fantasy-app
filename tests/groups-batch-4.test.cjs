/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
function load(file, mocks = {}, extra = '') {
  const module = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source(file) + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { module, exports: module.exports, URL, Request, console,
    process: { env: { GOLF_CRON_SECRET: 'test-secret' } },
    require(id) { if (id in mocks) return mocks[id]; throw Error(`Unexpected import: ${id}`); },
  });
  return module.exports;
}
const next = { NextResponse: { json: (body, options) => ({ status: options?.status ?? 200, body }) } };
function database(tables) {
  const calls = [], writes = [];
  return { calls, writes, from(table) {
    calls.push([table, 'from']);
    let rows = [...(tables[table] ?? [])], single = false;
    const q = {
      select() { return q; },
      upsert(value,options) { writes.push({table,value,options}); return q; },
      update(value) { calls.push([table,'update',value]); return q; },
      eq(k,v) { calls.push([table,'eq',k,v]); rows = rows.filter(r => r[k] === v); return q; },
      in(k,v) { rows = rows.filter(r => v.includes(r[k])); return q; },
      order(k,{ascending}) { rows.sort((a,b) => String(a[k]).localeCompare(String(b[k])) * (ascending ? 1 : -1)); return q; },
      limit(n) { rows = rows.slice(0,n); return q; },
      single() { single = true; return q; }, maybeSingle() { single = true; return q; },
      then(resolve,reject) { return Promise.resolve({data: single ? rows[0] ?? null : rows, error: null}).then(resolve,reject); },
    };
    return q;
  }};
}
function fixture() {
  return {
    slates: [
      { id: 1, league_id: 'la', sport: 'golf', external_event_id: '401', start_date: '2025-04-01', is_locked: true },
      { id: 2, league_id: 'lb', sport: 'golf', external_event_id: '401', start_date: '2025-04-01', is_locked: true },
    ],
    leagues: [{id:'la',group_id:'a',sport_key:'golf'}, {id:'lb',group_id:'b',sport_key:'golf'}],
    groups: [{id:'a',slug:'111',is_active:true}, {id:'b',slug:'test',is_active:true}],
    teams: [{id:11,group_id:'a',name:'Same',user_id:'ua'}, {id:12,group_id:'b',name:'Same',user_id:'ub'},
      {id:13,group_id:'a',name:'Former',user_id:'former'}],
    group_memberships: [{group_id:'a',user_id:'ua',is_active:true},{group_id:'b',user_id:'ub',is_active:true},
      {group_id:'a',user_id:'former',is_active:false}],
    app_users: [{id:'ua',team_id:99,is_active:true,pin_salt:'salt',pin_hash:'hash'},
      {id:'ub',team_id:12,is_active:true,pin_salt:'salt',pin_hash:'hash'}],
    golf_slate_shotcast_manifests: [{slate_id:1,tournament_id:'R2025001',manifest:{owner:'a'}},
      {slate_id:2,tournament_id:'R2025001',manifest:{owner:'b'}}],
  };
}
function setup({ group = 'a', role = 'member', signedIn = true } = {}) {
  const db = database(fixture());
  const user = signedIn ? {id:'ua',systemRole:role} : null;
  const context = group ? {group:{id:group},canAdministerGroup:role==='admin',leagues:[{id:`l${group}`,isEnabled:true}]} : null;
  const mocks = {'next/server': next, '@/lib/supabaseAdmin': {supabaseAdmin:db},
    '@/lib/auth': {getCurrentUser:async()=>user}, '@/lib/groups/context':{getGroupContextForUser:async()=>context}};
  const policy = load('lib/security/resourcePolicy.ts');
  const auth = load('lib/security/resourceAuthorization.ts', {...mocks, '@/lib/security/resourcePolicy':policy});
  mocks['@/lib/security/resourceAuthorization'] = auth;
  return { db, mocks, auth };
}
const request = query => ({nextUrl:new URL(`http://localhost/?${query}`),headers:new Headers()});
for (const role of ['member','admin','super_admin']) {
  test(`/api/teams: ${role} sees only current Group, including historical teams`, async()=>{
    const {mocks} = setup({role});
    const result = await load('app/api/teams/route.ts',mocks).GET();
    assert.equal(result.status,200);
    assert.deepEqual(Array.from(result.body.teams,t=>t.id),[13,11]);
    assert.equal(result.body.groupId,'a');
  });
}
test('/api/teams rejects unauthenticated and missing Group context',async()=>{
  for (const [options,status] of [[{signedIn:false},401],[{group:null},403]]) {
    const {mocks,db}=setup(options);
    assert.equal((await load('app/api/teams/route.ts',mocks).GET()).status,status);
    assert.equal(db.calls.length,0);
  }
});
test('same external event remains distinct; authorized historical slate returns its own league resource',async()=>{
  for (const [group,id] of [['a',1],['b',2]]) {
    const {mocks}=setup({group});
    const route=load('app/api/golf/refresh-config/route.ts',mocks);
    const result=await route.GET(request(`slateId=${id}`));
    assert.equal(result.status,200);
    assert.equal(result.body.slateId,id);
    assert.equal(result.body.eventId,'401');
    assert.equal(result.body.year,'2025');
    assert.equal((await route.GET(request(`slateId=${id===1?2:1}`))).status,404);
  }
});
test('Golf authorization preserves commissioner, member refresh, internal, and super-admin policies',async()=>{
  const req=request('');
  for (const [role,id,modify,expected] of [['member',1,false,true],['member',1,true,false],
    ['admin',1,true,true],['admin',2,true,false],['super_admin',2,true,true]]) {
    const {auth}=setup({role});
    assert.equal((await auth.authorizeSlateResource(req,id,{requireCommissioner:modify})).ok,expected);
  }
  const {auth}=setup({signedIn:false});
  assert.equal((await auth.authorizeSlateResource(req,1)).response.status,401);
  const internal = new Request('http://localhost/',{headers:{authorization:'Bearer test-secret'}});
  assert.equal((await auth.authorizeSlateResource(internal,2,{allowInternal:true})).ok,true);
});
test('saved manifests require authorized slate and cannot resolve another Group via tournament ID',async()=>{
  const {mocks}=setup(); const route=load('app/api/golf/shotcast-manifest/route.ts',mocks);
  assert.equal((await route.GET(request('tournamentId=R2025001'))).status,400);
  assert.equal((await route.GET(request('slateId=2&tournamentId=R2025001'))).status,404);
  assert.equal((await route.GET(request('slateId=1&tournamentId=R2025001'))).body.owner,'a');
  const other=load('app/api/golf/shotcast-manifest/route.ts',setup({group:'b'}).mocks);
  assert.equal((await other.GET(request('slateId=2&tournamentId=R2025001'))).body.owner,'b');
});
test('Golf handlers reject cross-Group requests before providers or mutations',async()=>{
  for (const [file,method] of [['app/api/golf/hole-replay/route.ts','GET'],
    ['app/api/refresh-stats-golf/route.ts','POST'],['app/api/admin/golf/import-field/route.ts','POST'],
    ['app/api/admin/golf/shotcast/route.ts','POST']]) {
    const {mocks,db}=setup({role:'admin'});
    for (const match of source(file).matchAll(/from\s+["']([^"']+)["']/g)) {
      if (!(match[1] in mocks)) mocks[match[1]]=new Proxy({}, {get:()=>()=>{throw Error('Provider reached before authorization');}});
    }
    const req=request('slateId=2&playerId=7&round=1&hole=1');
    req.json=async()=>({slateId:2,tournamentId:'R2025001'});
    const result=await load(file,mocks)[method](req);
    assert.equal(result.status,404,file);
    assert.equal(db.calls.some(c=>!['slates','leagues'].includes(c[0])),false,file);
  }
});
test('PIN identity resolves names within Group and preserves ID-based legacy callers',async()=>{
  const db=database(fixture()); const pin=load('lib/security/pinIdentity.ts',{'@/lib/supabaseAdmin':{supabaseAdmin:db}});
  assert.equal(await pin.resolvePinAccountId({groupSlug:'111',teamName:'Same'}),'ua');
  assert.equal(await pin.resolvePinAccountId({groupSlug:'test',teamName:'Same'}),'ub');
  assert.equal(await pin.resolvePinAccountId({groupSlug:'111',teamName:'Former'}),null);
  assert.equal(await pin.resolvePinAccountId({groupSlug:'unknown',teamName:'Same',legacyTeamId:99}),null);
  assert.equal(await pin.resolvePinAccountId({legacyTeamId:99}),'ua');
});
test('PIN login verifies credentials before session creation for new and legacy contracts',async()=>{
  for (const body of [{groupSlug:'111',teamName:'Same',pin:'1234'},{teamId:99,pin:'1234'}]) {
    const db=database(fixture()), sessions=[];
    const mocks={'next/server':next,'@/lib/supabaseAdmin':{supabaseAdmin:db},
      '@/lib/auth':{verifyPin:async pin=>pin==='1234',createUserSession:async id=>sessions.push(id)}};
    mocks['@/lib/security/pinIdentity']=load('lib/security/pinIdentity.ts',mocks);
    const route=load('app/api/auth/login/route.ts',mocks);
    assert.equal((await route.POST({json:async()=>({...body,pin:'9999'})})).status,401);
    assert.equal(sessions.length,0);
    assert.equal((await route.POST({json:async()=>body})).status,200);
    assert.deepEqual(sessions,['ua']);
  }
});
test('invite naming allows duplicate names across Groups, preserving same-Group suffix behavior',async()=>{
  const file='app/api/group-invites/[token]/route.ts';
  const db=database(fixture()); const mocks={'@/lib/supabaseAdmin':{supabaseAdmin:db}};
  for (const match of source(file).matchAll(/from\s+["']([^"']+)["']/g)) if (!(match[1] in mocks)) mocks[match[1]]={};
  const {makeUniqueTeamName}=load(file,mocks,'\nexports.makeUniqueTeamName = makeUniqueTeamName;');
  assert.equal(await makeUniqueTeamName('c','Same','Third'),'Same');
  assert.equal(await makeUniqueTeamName('a','Same','111'),'Same (111)');
});
test('migration defines scoped identity, verifies old objects, and protects data before dropping indexes',()=>{
  const sql=source('supabase/migrations/20260910000100_groups_batch4_scoped_uniqueness.sql');
  assert.match(sql,/CREATE UNIQUE INDEX slates_league_sport_external_event_id_unique ON public\.slates USING btree \(league_id, sport, external_event_id\) WHERE \(external_event_id IS NOT NULL\)/);
  assert.doesNotMatch(sql,/^\s*(?:create\s+(?:unique\s+)?index|drop\s+index|alter\s+index).*slates/im);
  assert.doesNotMatch(sql,/slates_legacy_sport_external_event_id_unique/);
  assert.match(sql,/where league_id is not null and external_event_id is not null\s+group by league_id, sport, external_event_id having count\(\*\) > 1/);
  assert.match(sql,/on public\.teams \(name\) where group_id is null/);
  assert.match(sql,/pg_get_constraintdef\(oid\) = 'UNIQUE \(name\)'/);
  assert.match(sql,/^begin;/m);
  assert.match(sql,/^commit;/m);
  const proceduralBlock = sql.match(/do language plpgsql \$batch4_checks\$\s*begin\b([\s\S]*?)end;\s*\$batch4_checks\$;/i);
  assert.ok(proceduralBlock, 'verification requires a complete PL/pgSQL DO block');
  const outsideBlock = sql.replace(proceduralBlock[0], '');
  assert.doesNotMatch(outsideBlock, /^\s*(?:if\b|end if\b|raise exception\b)/im);
  assert.equal((proceduralBlock[1].match(/^\s*if\b/gm) ?? []).length, 5);
  assert.equal((proceduralBlock[1].match(/^\s*end if;/gm) ?? []).length, 5);
  assert.ok(sql.indexOf('lock table') < sql.indexOf(proceduralBlock[0]));
  assert.ok(sql.indexOf(proceduralBlock[0]) + proceduralBlock[0].length < sql.indexOf('create unique index teams_group_name_unique'));

  assert.equal((sql.match(/^\s*alter table .*drop constraint/gm) ?? []).length, 1);
  assert.match(sql,/on public\.teams \(group_id, name\)/);
  assert.match(sql,/pg_get_constraintdef/); assert.match(sql,/pg_get_indexdef/);
  assert.match(sql,/having count\(\*\) > 1/);
  assert.ok(sql.indexOf('create unique index teams_group_name_unique') < sql.indexOf('drop constraint teams_name_key'));
  assert.doesNotMatch(sql,/\b(delete from|update public|truncate)\b/i);
  const manifests=source('supabase/migrations/20260910000200_groups_batch4_golf_manifests.sql');
  assert.match(manifests,/primary key \(slate_id, tournament_id\)/);
  assert.match(manifests,/from public\.shotcast_manifests;/);
  assert.doesNotMatch(manifests,/drop table|delete from/i);
});
test('creation and refresh retain league/slate ownership, caller contracts stay aligned',()=>{
  const create=source('app/api/slates/route.ts');
  assert.match(create,/league_id: league\.id/);
  const refresh=source('app/api/refresh-stats-golf/route.ts');
  assert.doesNotMatch(refresh,/\.eq\(\s*"external_event_id"/);
  assert.match(refresh,/\.eq\("id", slateId\)/);
  assert.match(refresh,/onConflict:\s*"slate_id,player_id"/);
  assert.match(source('app/api/admin/golf/shotcast/route.ts'),/onConflict:\s*"slate_id,tournament_id"/);
  const login=source('app/login/page.tsx');
  assert.doesNotMatch(login,/\/api\/teams/);
  assert.match(login,/legacyGroupSlug: groupSlug/);
  assert.match(login,/legacyTeamName: teamName/);
  assert.match(source('app/api/auth/bridge/route.ts'),/resolvePinAccountId/);
  assert.match(source('components/lineups/GolfHoleReplayPanel.tsx'),/shotcast-manifest\?slateId=/);
});
test('commissioner imports save the same tournament independently for each slate',async()=>{
  for (const [group,id] of [['a',1],['b',2]]) {
    const {mocks,db}=setup({group,role:'admin'}), courses=[];
    mocks['@/lib/shotcast/importShotCastManifest']={importShotCastManifest:async()=>({course:{id:'course'},holes:[],generatedAt:'2025-04-01T00:00:00Z'})};
    mocks['@/lib/providers/pgaTourField']={};
    mocks['@/lib/golf/upsertGolfCourseHoles']={upsertGolfCourseHoles:async input=>{courses.push(input.slateId);return {holesUpserted:0};}};
    const req=request(''); req.json=async()=>({slateId:id,tournamentId:'R2025001'});
    const result=await load('app/api/admin/golf/shotcast/route.ts',mocks).POST(req);
    assert.equal(result.status,200);
    assert.deepEqual(courses,[id]);
    assert.equal(db.writes.length,1);
    assert.equal(db.writes[0].table,'golf_slate_shotcast_manifests');
    assert.equal(db.writes[0].value.slate_id,id);
    assert.equal(db.writes[0].options.onConflict,'slate_id,tournament_id');
  }
});
test('Golf lifecycle refresh writes only players belonging to the authorized historical slate',async()=>{
  for (const [group,id] of [['a',1],['b',2]]) {
    const {mocks,auth}=setup({group});
    const tables=fixture();
    tables.golf_event_players=[{id:101,slate_id:1,player_id:7},{id:102,slate_id:2,player_id:7}];
    tables.golf_players=[{id:7,espn_player_id:'p7'}];
    const db=database(tables);
    mocks['@/lib/supabaseAdmin']={supabaseAdmin:db};
    mocks['@/lib/security/resourceAuthorization']=auth;
    const file='app/api/refresh-stats-golf/route.ts';
    for (const match of source(file).matchAll(/from\s+["']([^"']+)["']/g)) if (!(match[1] in mocks)) mocks[match[1]]={};
    mocks['@/lib/scoring/golf']={GOLF_TOURNAMENT_ROUNDS:4};
    mocks['@/lib/providers/golf']={parseGolfTournamentByEventIdFromPayload:(_payload,eventId)=>({
      espnEventId:eventId,status:'final',completed:true,currentRound:4,
      competitors:[{espnPlayerId:'p7',status:'finished',rounds:[],roundsCompleted:4,holesCompleted:72,currentRound:4,lastHole:18}],
    })};
    const acceptedCalls = [];
    mocks['@/lib/golf/reconcileGolf'] = { reconcileGolf: async (slateId, batch) => {
      acceptedCalls.push({ slateId, batch });
      return { revision: 1, teamWrites: [], scoringChanged: false };
    } };
    const req=request('');req.json=async()=>({slateId:id,reconcileLockedLifecycle:true,scoreboardPayload:{}});
    const result=await load(file,mocks).POST(req);
    assert.equal(result.status,200);
    assert.equal(result.body.slateId,id);
    assert.equal(db.writes.filter(w=>w.table==='golf_event_players').length,0);
    assert.equal(acceptedCalls.length,1);
    assert.equal(acceptedCalls[0].slateId,id);
    assert.equal(acceptedCalls[0].batch.events.length,1);
    assert.equal(acceptedCalls[0].batch.events[0].slate_id,id);
    assert.equal(acceptedCalls[0].batch.events[0].id,id===1?101:102);
  }
});
test('account linking accepts scoped identity and legacy ID only after verified token and PIN',async()=>{
  for (const identity of [{legacyGroupSlug:'111',legacyTeamName:'Same'},{legacyTeamId:99}]) {
    const {mocks,db}=setup(), sessions=[];
    db.auth={getUser:async()=>({data:{user:{id:'auth-new',email:'new@example.com'}},error:null})};
    mocks['@/lib/auth']={verifyPin:async pin=>pin==='1234',createUserSession:async id=>sessions.push(id)};
    mocks['@/lib/security/pinIdentity']=load('lib/security/pinIdentity.ts',mocks);
    const route=load('app/api/auth/bridge/route.ts',mocks);
    const call=pin=>route.POST({json:async()=>({accessToken:'verified-by-mock',legacyPin:pin,...identity})});
    assert.equal((await call('9999')).status,401);
    assert.equal(db.calls.some(c=>c[1]==='update'),false);
    assert.equal((await call('1234')).status,200);
    assert.deepEqual(sessions,['ua']);
  }
});
test('shared player stats and availability protect their Golf branches',async()=>{
  for (const file of ['app/api/player-stats/route.ts','app/api/slate-availability/route.ts']) {
    for (const [options,id,status] of [[{signedIn:false},1,401],[{},2,404],[{},1,200]]) {
      const {mocks,db}=setup(options);
      const result=await load(file,mocks).GET(request(`slateId=${id}`));
      assert.equal(result.status,status,file);
      if(status!==200) assert.equal(db.calls.some(c=>c[0]==='golf_event_players'),false);
    }
  }
});
test('Golf player league profile authenticates and preserves only its own cross-season draft history',async()=>{
  const file='app/api/player-league-profile/route.ts';
  for (const group of ['a','b']) {
    const {mocks}=setup({group}), tables=fixture();
    tables.golf_players=[{id:7,display_name:'Golfer'}];
    tables.lineups=[{id:21,slate_id:1,team_id:11},{id:22,slate_id:2,team_id:12}];
    tables.lineup_players=[{lineup_id:21,player_id:7},{lineup_id:22,player_id:7}];
    const db=database(tables);mocks['@/lib/supabaseAdmin']={supabaseAdmin:db};
    mocks['@/lib/groups/context']={getActiveLeagueForSport:async()=>({context:{group:{id:group}},league:{id:`l${group}`}})};
    mocks['@/lib/statColumns']={};
    const route=load(file,mocks);
    const result=await route.GET(new Request('http://localhost/?sport=golf&playerId=7&season=all'));
    assert.equal(result.status,200);
    assert.equal(result.body.recentHistory.length,1);
    assert.equal(result.body.recentHistory[0].slateId,group==='a'?1:2);
    assert.equal(db.calls.some(c=>c[0]==='slates'&&c[2]==='league_id'&&c[3]===`l${group}`),true);
    assert.equal(db.calls.some(c=>c[0]==='teams'&&c[2]==='group_id'&&c[3]===group),true);
    mocks['@/lib/auth']={getCurrentUser:async()=>null};
    assert.equal((await load(file,mocks).GET(new Request('http://localhost/?sport=golf&playerId=7'))).status,401);
  }
});
