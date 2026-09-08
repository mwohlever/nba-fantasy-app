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
      select(columns) { calls.push([table, 'select', columns]); return q; },
      upsert() { throw Error('Unexpected write'); },
      update() { throw Error('Unexpected write'); },
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
function setup(sport, {group = 'a', role = 'member', signedIn = true, enabled = true, empty = false} = {}) {
  const slates = ['a', 'b'].map((owner, i) => ({
    id: i + 1, league_id: `l${owner}`, sport,
    start_date: '2025-04-01', end_date: '2025-04-02', is_locked: true,
    nba_team_abbreviations: empty ? [] : [owner === 'a' ? 'BOS' : 'LAL'],
  }));
  const stats = slates.map(s => ({slate_id:s.id, player_id:s.id * 10, fantasy_points:s.id * 100}));
  const db = database({slates,
    leagues: ['a','b'].map(owner => ({id:`l${owner}`,group_id:owner,sport_key:sport})),
    player_slate_stats: stats, player_nfl_slate_stats: stats,
    golf_event_players: stats.map(s => ({...s, fantasy_score:s.fantasy_points, golf_rounds:[]})),
    players: [{id:10,team_abbreviation:'BOS',is_active:true},{id:20,team_abbreviation:'LAL',is_active:true}],
  });
  const mocks = {'next/server':next, '@/lib/supabaseAdmin':{supabaseAdmin:db},
    '@/lib/auth':{getCurrentUser:async()=>signedIn ? {id:'viewer',systemRole:role} : null},
    '@/lib/groups/context':{getGroupContextForUser:async()=>group ? {
      group:{id:group}, canAdministerGroup:role === 'commissioner', leagues:[{id:`l${group}`,isEnabled:enabled}],
    } : null},
    '@/lib/security/resourcePolicy':load('lib/security/resourcePolicy.ts'),
  };
  mocks['@/lib/security/resourceAuthorization'] = load('lib/security/resourceAuthorization.ts',mocks);
  return {db,mocks};
}
const request = value => ({nextUrl:new URL(`http://localhost/?slateId=${value}`),headers:new Headers()});
for (const endpoint of ['player-stats','slate-availability']) {
  const file = `app/api/${endpoint}/route.ts`;
  for (const sport of ['nba','nfl','golf']) {
    test(`${endpoint}/${sport}: member, commissioner and super-admin read the requested historical slate only`,async()=>{
      for (const [role,group,id] of [['member','a',1],['member','b',2],['commissioner','a',1],['super_admin','a',2]]) {
        const {db,mocks} = setup(sport,{role,group});
        const result = await load(file,mocks).GET(request(id));
        assert.equal(result.status,200);
        if (endpoint === 'player-stats') {
          assert.deepEqual(Array.from(result.body.playerStats,r=>r.player_id),[id*10]);
          assert.equal(result.body.playerStats[0].fantasy_points,id*100);
          assert.equal(result.body.sport,sport);
        } else {
          assert.deepEqual(Array.from(result.body.availablePlayerIds),[id*10]);
          assert.equal(result.body.startDate,'2025-04-01');
        }
        assert.equal(db.calls.some(c=>c[0]==='group_memberships'),false);
        assert.equal(db.writes.length,0);
      }
    });
    test(`${endpoint}/${sport}: denies private reads before stats, availability or slate detail work`,async()=>{
      for (const [options,id,status] of [
        [{signedIn:false},1,401], [{group:'b'},1,404],
        [{role:'commissioner',group:'b'},1,404], [{group:null},1,404], [{enabled:false},1,404],
      ]) {
        const {db,mocks}=setup(sport,options);
        const result=await load(file,mocks).GET(request(id));
        assert.equal(result.status,status);
        assert.equal(db.calls.some(c=>!['slates','leagues'].includes(c[0])),false);
        assert.deepEqual(db.calls.filter(c=>c[0]==='slates'&&c[1]==='select').map(c=>c[2]),['id, league_id']);
        assert.equal(result.body.playerStats,undefined);
        assert.equal(result.body.availablePlayerIds,undefined);
      }
    });
  }
  test(`${endpoint}: invalid IDs rejected without database access; absent resource returns 404`,async()=>{
    for (const id of ['', 'abc','0','-1','1.5','Infinity','9007199254740992']) {
      const {db,mocks}=setup('nba');
      assert.equal((await load(file,mocks).GET(request(id))).status,400,id);
      assert.equal(db.calls.length,0);
    }
    const {mocks}=setup('nba');
    assert.equal((await load(file,mocks).GET(request(99))).status,404);
  });
}
test('availability: empty non-Golf response remains authorized',async()=>{
  for (const sport of ['nba','nfl']) {
    for (const [group,status] of [['a',200],['b',404]]) {
      const {mocks}=setup(sport,{group,empty:true});
      const result=await load('app/api/slate-availability/route.ts',mocks).GET(request(1));
      assert.equal(result.status,status);
      if(status===200) assert.equal(result.body.availablePlayerIds.length,0);
    }
  }
});
