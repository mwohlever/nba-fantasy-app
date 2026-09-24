/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const oldLoad = Module._load;
let activeDb;
const finishedInputs=[];
const database = { from(...args) { return activeDb.from(...args); }, rpc(...args) { return activeDb.rpc(...args); } };
Module._load = function(request, parent, ...args) {
  if (request === 'server-only') return {};
  if (request === '@/lib/supabaseAdmin') return { supabaseAdmin: database };
  if (request === '@/lib/playerFinishedNotifications') return { notifyNewlyFinishedPlayers: async input => {finishedInputs.push(input);return {attempted:0,sent:0,skipped:0,failed:0}} };
  if (request === '@/lib/slateCompleteNotifications') return { notifyCompletedSlate: async () => ({attempted:0,sent:0,skipped:0,failed:0}) };
  return oldLoad.call(this, request.startsWith('@/') ? path.join(root, request.slice(2)) : request, parent, ...args);
};
for (const ext of ['.ts', '.tsx']) require.extensions[ext] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }, fileName: filename,
}).outputText, filename);
const { nflSlateEligibility, nflSlateEndPassed, nflScheduleResolved, nflRelevantScheduleUnambiguous, nflGameIsFinal } = require('../lib/nfl/scoringPolicy.ts');
const { NflScoringProvider } = require('../lib/nfl/scoringProvider.ts');
const { refreshNflSlate } = require('../lib/nfl/refreshSlate.server.ts');
const date = '2026-09-24';
const kickoff = Date.parse('2026-09-24T20:00:00Z');
function game(status = {state:'pre',completed:false,name:'STATUS_SCHEDULED'}, at = kickoff) {
  return {id:'g1',date:new Date(at).toISOString(),competitions:[{status:{type:status},competitors:[{team:{id:'1',abbreviation:'AAA'}},{team:{id:'2',abbreviation:'BBB'}}]}]};
}
const teams = new Set(['AAA']);
const live = {state:'in',completed:false,name:'STATUS_IN_PROGRESS'};
const final = {state:'post',completed:true,name:'STATUS_FINAL'};

test('kickoff window, live, recent final, sparse corrections and stale final', () => {
  assert.equal(nflSlateEligibility([game()], teams, null, kickoff-61*60_000).eligible,false);
  assert.equal(nflSlateEligibility([game()], teams, null, kickoff-60*60_000).eligible,true);
  assert.equal(nflSlateEligibility([game(live)], teams, null, kickoff+60_000).eligible,true);
  assert.equal(nflSlateEligibility([game(final)], teams, null, kickoff+5*3_600_000).eligible,true);
  assert.equal(nflSlateEligibility([game(final)], teams, new Date(kickoff+9*3_600_000).toISOString(), kickoff+9.5*3_600_000).eligible,false);
  assert.equal(nflSlateEligibility([game(final)], teams, null, kickoff+29*3_600_000, true).reason,'stale_final');
  assert.equal(nflSlateEligibility([game(final)], teams, null, kickoff+29*3_600_000).eligible,true);
});

test('Thursday through Monday stays open and ambiguous or absent games cannot finalize', () => {
  assert.equal(nflSlateEndPassed('2026-09-28', new Date('2026-09-25T12:00:00Z')),false);
  assert.equal(nflSlateEndPassed('2026-09-28', new Date('2026-09-29T04:01:00Z')),true);
  assert.equal(nflScheduleResolved([],teams),false);
  assert.equal(nflScheduleResolved([game(),game()],teams),false);
  assert.equal(nflRelevantScheduleUnambiguous([game()],new Set(['AAA','BYE'])),true);
  assert.equal(nflScheduleResolved([game()],new Set(['AAA','BYE'])),false);
  for(const name of ['STATUS_POSTPONED','STATUS_SUSPENDED','STATUS_CANCELED']) assert.equal(nflGameIsFinal({state:'post',completed:true,name}),false);
});

test('strict provider distinguishes valid empty schedule from failed or incomplete acquisition', async () => {
  const previous = global.fetch;
  try {
    global.fetch = async () => ({ok:true,json:async()=>({events:[]})});
    assert.deepEqual(await new NflScoringProvider().schedule(date,date),[]);
    const requested=[];
    global.fetch = async url => {requested.push(String(url));return {ok:true,json:async()=>({events:[]})}};
    assert.deepEqual(await new NflScoringProvider().schedule('2026-09-24','2026-09-28'),[]);
    assert.deepEqual(requested.map(url=>new URL(url).searchParams.get('dates')),
      ['20260924','20260925','20260926','20260927','20260928']);
    assert.ok(requested.every(url=>new URL(url).searchParams.size===1));
    global.fetch = async () => ({ok:false,status:503});
    await assert.rejects(new NflScoringProvider().schedule(date,date),/HTTP 503/);
    global.fetch = async () => ({ok:true,json:async()=>({})});
    await assert.rejects(new NflScoringProvider().schedule(date,date),/incomplete/);
    global.fetch = async () => ({ok:true,json:async()=>({events:[{}]})});
    await assert.rejects(new NflScoringProvider().schedule(date,date),/incomplete/);
    global.fetch = async () => ({ok:true,json:async()=>({header:{competitions:[]}})});
    await assert.rejects(new NflScoringProvider().summary('g1'),/incomplete/);
  } finally {global.fetch = previous;}
});

test('Thursday-Monday scoreboards merge all game days and reuse overlapping dates across slates', async () => {
  const previous=global.fetch, requested=[];
  const first=game(live), last={...game(live,Date.parse('2026-09-29T00:15:00Z')),id:'g2'};
  try {
    global.fetch=async url=>{
      const code=new URL(String(url)).searchParams.get('dates');requested.push(code);
      return {ok:true,json:async()=>({events:code==='20260924'?[first]:code==='20260928'?[last]:[]})};
    };
    const provider=new NflScoringProvider();
    assert.deepEqual((await provider.schedule('2026-09-24','2026-09-28')).map(event=>event.id),['g1','g2']);
    assert.deepEqual((await provider.schedule('2026-09-25','2026-09-28')).map(event=>event.id),['g2']);
    assert.equal(requested.length,5,'overlapping Group slate dates must be fetched once per invocation');
    assert.equal(provider.summariesFetched,0);
  } finally {global.fetch=previous}
});

test('duplicate scoreboard events are deduplicated and conflicting copies fail closed', async () => {
  const previous=global.fetch;
  const event=game(live);
  try {
    global.fetch=async()=>({ok:true,json:async()=>({events:[event]})});
    assert.deepEqual((await new NflScoringProvider().schedule('2026-09-24','2026-09-25')).map(row=>row.id),['g1']);
    let day=0;
    global.fetch=async()=>({ok:true,json:async()=>({events:[day++===0?event:{...event,date:'2026-09-26T00:00:00Z'}]})});
    await assert.rejects(new NflScoringProvider().schedule('2026-09-24','2026-09-25'),/scoreboard incomplete/);
  } finally {global.fetch=previous}
});

test('one failed day rejects the whole Thursday-Monday schedule and preserves accepted stats', async () => {
  const previous=global.fetch;
  const fixture=fakeDb();activeDb=fixture.db;
  fixture.slates[0].end_date='2026-09-28';
  try {
    global.fetch=async url=>new URL(String(url)).searchParams.get('dates')==='20260927'
      ? {ok:false,status:503} : {ok:true,json:async()=>({events:[]})};
    const provider=new NflScoringProvider();
    await assert.rejects(provider.schedule('2026-09-24','2026-09-28'),/NFL scoreboard HTTP 503/);
    const response=await refreshNflSlate(1,provider);
    assert.equal(response.status,500);
    assert.equal(fixture.writes.length,0);
    assert.equal(fixture.slates[0].is_locked,false);
  } finally {global.fetch=previous}
});

function fakeDb() {
  const writes = [];
  const slates = [{id:1,sport:'nfl',date,start_date:date,end_date:date,is_locked:false,rules_snapshot:{scoring:{receptions:1}}},
    {id:2,sport:'nfl',date,start_date:date,end_date:date,is_locked:false,rules_snapshot:{scoring:{receptions:0.5}}}];
  const lineups = {1:[{id:11,team_id:101,lineup_players:[{player_id:10}]}],2:[{id:22,team_id:202,lineup_players:[{player_id:10}]}]};
  const players = [{id:10,name:'Receiver',nfl_player_id:42,team_abbreviation:'AAA',position:'WR'}];
  const stats = [{slate_id:1,player_id:10,game_status:2,fantasy_points:17,games_completed:0,games_in_progress:1,games_remaining:0}];
  const db = { from(table) {
    const q = {filters:{},mode:'read',eq(key,value){this.filters[key]=value;return this},in(){return this},is(){return this},select(){return this},single(){this.one=true;return this},upsert(rows){this.mode='write';writes.push({table,rows});return this},update(values){this.mode='update';this.values=values;return this},then(resolve,reject){
      if(this.mode==='write') return Promise.resolve({error:null}).then(resolve,reject);
      if(this.mode==='update') {if(table==='slates') slates.find(s=>s.id===this.filters.id).is_locked=true;return Promise.resolve({data:[{id:this.filters.id}],error:null}).then(resolve,reject)}
      let data = table==='slates'?slates:table==='lineups'?lineups[this.filters.slate_id]??[]:table==='players_nfl'?players:table==='player_nfl_slate_stats'?stats.filter(s=>s.slate_id===this.filters.slate_id):[];
      if(table==='slates') data=data.filter(s=>s.id===this.filters.id);
      return Promise.resolve({data:this.one?data[0]??null:data,error:null}).then(resolve,reject);
    }}; return q;
  }};
  return {db,writes,slates,stats,players};
}
function summary() { return {header:{competitions:[{status:{type:live},competitors:game(live).competitions[0].competitors}]},boxscore:{players:[{team:{id:'1',displayName:'AAA'},statistics:[{name:'receiving',labels:['REC','YDS','TD'],athletes:[{athlete:{id:'42',displayName:'Receiver'},stats:['4','60','0']}]}]}]}}; }

test('provider failure preserves accepted stats; no drafted players is a cheap success', async () => {
  const fixture=fakeDb();activeDb=fixture.db;
  const failed=await refreshNflSlate(1,{schedule:async()=>[game(live)],summary:async()=>{throw new Error('summary unavailable')}});
  assert.equal(failed.status,500);assert.equal(fixture.writes.length,0);
  const empty=await refreshNflSlate(1,{schedule:async()=>[],summary:async()=>{throw Error('must not fetch summary')}});
  assert.equal((await empty.json()).success,true);assert.equal(fixture.writes.length,0);
  // A slate without any lineup players exits before provider acquisition.
  const noDraft=fakeDb();activeDb=noDraft.db;noDraft.db.from=(function(original){return function(table){const q=original.call(this,table);if(table==='lineups')q.then=(resolve)=>Promise.resolve({data:[],error:null}).then(resolve);return q}})(noDraft.db.from);
  const skipped=await refreshNflSlate(1,{schedule:async()=>{throw Error('must not fetch')}});
  assert.equal((await skipped.json()).success,true);assert.equal(noDraft.writes.length,0);
});

test('an omitted or malformed player stat group cannot erase accepted live stats', async () => {
  const fixture=fakeDb();activeDb=fixture.db;
  Object.assign(fixture.stats[0],{receiving_yards:60,receptions:4,receiving_tds:0});
  const omitted=summary();omitted.boxscore.players[0].statistics=[];
  assert.equal((await refreshNflSlate(1,{schedule:async()=>[game(live)],summary:async()=>omitted})).status,500);
  assert.equal(fixture.writes.length,0);
  const malformed=summary();malformed.boxscore.players[0].statistics[0].labels=['REC','TD'];
  assert.equal((await refreshNflSlate(1,{schedule:async()=>[game(live)],summary:async()=>malformed})).status,500);
  assert.equal(fixture.writes.length,0);
});

test('a final summary without the drafted offense team boxscore cannot lock an empty result', async () => {
  const fixture=fakeDb();activeDb=fixture.db;fixture.slates[0].end_date='2026-09-22';
  const incomplete=summary();incomplete.header.competitions[0].status.type=final;
  incomplete.boxscore.players=[];incomplete.boxscore.teams=[{team:{id:'1'},statistics:[]}];
  const result=await refreshNflSlate(1,{schedule:async()=>[game(final)],summary:async()=>incomplete});
  assert.equal(result.status,500);assert.equal(fixture.writes.length,0);assert.equal(fixture.slates[0].is_locked,false);
});

test('an absent game leaves that player’s accepted live row intact while another game scores', async () => {
  const fixture=fakeDb();activeDb=fixture.db;
  fixture.players.push({id:11,name:'Other receiver',nfl_player_id:43,team_abbreviation:'BYE',position:'WR'});
  fixture.stats.push({slate_id:1,player_id:11,game_status:2,game_status_text:'Live',fantasy_points:13,
    receiving_yards:90,receptions:4,games_completed:0,games_in_progress:1,games_remaining:0});
  const original=fixture.db.from;fixture.db.from=function(table){const q=original.call(this,table);
    if(table==='lineups')q.then=(resolve,reject)=>Promise.resolve({data:[{id:11,team_id:101,lineup_players:[{player_id:10},{player_id:11}]}],error:null}).then(resolve,reject);
    return q;
  };
  const result=await refreshNflSlate(1,{schedule:async()=>[game(live)],summary:async()=>summary()});
  assert.equal(result.status,200);
  const other=fixture.writes.find(w=>w.table==='player_nfl_slate_stats').rows.find(r=>r.player_id===11);
  assert.equal(other.fantasy_points,13);assert.equal(other.game_status,2);
  assert.equal(other.receiving_yards,90);
  assert.equal(fixture.slates[0].is_locked,false);
});

test('missing D/ST evidence cannot replace an accepted score or finalize', async () => {
  const fixture=fakeDb();activeDb=fixture.db;
  Object.assign(fixture.players[0],{position:'D/ST',nfl_player_id:100000001});
  fixture.stats[0].fantasy_points=12;
  const incomplete=summary();incomplete.boxscore.players=[];
  incomplete.boxscore.teams=[{team:{id:'1'},statistics:[]},{team:{id:'2'},statistics:[]}];
  const result=await refreshNflSlate(1,{schedule:async()=>[game(live)],summary:async()=>incomplete});
  assert.equal(result.status,500);assert.equal(fixture.writes.length,0);assert.equal(fixture.slates[0].is_locked,false);
});

test('one Thursday-Monday scoreboard set and summary fan out to two slates with distinct frozen scoring', async () => {
  const fixture=fakeDb();activeDb=fixture.db;
  fixture.slates.forEach(slate=>{slate.end_date='2026-09-28'});
  const previous=global.fetch;const calls=[];
  try {
    global.fetch=async url=>{calls.push(String(url));return {ok:true,json:async()=>String(url).includes('summary')?summary():
      {events:new URL(String(url)).searchParams.get('dates')==='20260924'?[game(live)]:[]}}};
    const provider=new NflScoringProvider();
    assert.equal((await refreshNflSlate(1,provider)).status,200);
    assert.equal((await refreshNflSlate(2,provider)).status,200);
    assert.deepEqual(calls.filter(x=>x.includes('scoreboard')).map(x=>new URL(x).searchParams.get('dates')),
      ['20260924','20260925','20260926','20260927','20260928']);
    assert.equal(calls.filter(x=>x.includes('summary')).length,1);
    const rows=fixture.writes.filter(x=>x.table==='player_nfl_slate_stats');
    assert.equal(rows.length,2);
    assert.equal(rows[0].rows[0].fantasy_points,10);
    assert.equal(rows[1].rows[0].fantasy_points,8);
  } finally {global.fetch=previous;}
});

test('Thursday-Monday slate does not lock on Thursday; postponed final never locks or sends final notifications', async () => {
  const fixture=fakeDb();activeDb=fixture.db;
  fixture.slates[0].end_date='2026-09-28';
  const finalSummary=summary();finalSummary.header.competitions[0].status.type=final;
  const provider={schedule:async()=>[game(final)],summary:async()=>finalSummary};
  const before=finishedInputs.length;
  const response=await refreshNflSlate(1,provider);
  assert.equal((await response.json()).slateAutoLocked,false);
  assert.equal(fixture.slates[0].is_locked,false);
  assert.equal(finishedInputs.length,before+1);
  assert.equal(finishedInputs.at(-1).previousStatuses[0].gameStatus,2);
  assert.equal(finishedInputs.at(-1).currentStats[0].game_status,3);
  const interrupted=fakeDb();activeDb=interrupted.db;interrupted.slates[0].end_date='2026-09-22';
  const postponed={state:'post',completed:true,name:'STATUS_POSTPONED'};
  const result=await refreshNflSlate(1,{schedule:async()=>[game(postponed)],summary:async()=>{throw Error('postponed summary must not be fetched')}});
  assert.equal((await result.json()).slateAutoLocked,false);
  assert.equal(interrupted.slates[0].is_locked,false);
});

test('a settled complete slate locks only after its Eastern end day', async () => {
  const fixture=fakeDb();activeDb=fixture.db;fixture.slates[0].end_date='2026-09-22';
  const finalSummary=summary();finalSummary.header.competitions[0].status.type=final;
  const result=await refreshNflSlate(1,{schedule:async()=>[game(final)],summary:async()=>finalSummary});
  assert.equal((await result.json()).slateAutoLocked,true);
  assert.equal(fixture.slates[0].is_locked,true);
});

test('migration provides atomic lease, expiry recovery, bounded retry and run retention',()=>{
  const sql=fs.readFileSync(path.join(root,'supabase/migrations/20260930000100_nfl_background_scoring.sql'),'utf8');
  for(const pattern of [/for update/,/lease_expires_at > v_now/,/v_state.lease_token is not null/,/where slate_id = p_slate_id and lease_token = p_lease_token/,/make_interval\(secs => least\(21600/,/limit 100/,/interval '60 days'/]) assert.match(sql,pattern);
  assert.doesNotMatch(sql,/cron\.schedule\s*\(/);
});

test('shared scorer keeps notification dedup inputs and the existing stable event keys',()=>{
  const scorer=fs.readFileSync(path.join(root,'lib/nfl/refreshSlate.server.ts'),'utf8');
  const finished=fs.readFileSync(path.join(root,'lib/playerFinishedNotifications.ts'),'utf8');
  const complete=fs.readFileSync(path.join(root,'lib/slateCompleteNotifications.ts'),'utf8');
  assert.match(scorer,/notifyNewlyFinishedPlayers\(\{/);
  assert.match(scorer,/previousStatuses,/);
  assert.match(scorer,/notifyCompletedSlate\(\{/);
  assert.match(finished,/eventKey:/);
  assert.match(complete,/slate_complete:\$\{input\.slate\.id\}:\$\{teamId\}/);
});

const { runClaimedNflSlate, runNflBackgroundScoring } = require('../lib/nfl/backgroundScoring.server.ts');

test('cron authentication fails closed before loading the worker', async () => {
  const { GET } = require('../app/api/cron/refresh-nfl/route.ts');
  const previous=process.env.NFL_CRON_SECRET;
  try {
    delete process.env.NFL_CRON_SECRET;
    assert.equal((await GET(new Request('http://localhost/api/cron/refresh-nfl',{headers:{authorization:'Bearer value'}}))).status,401);
    process.env.NFL_CRON_SECRET='expected';
    assert.equal((await GET(new Request('http://localhost/api/cron/refresh-nfl',{headers:{authorization:'Bearer wrong'}}))).status,401);
  } finally {if(previous===undefined)delete process.env.NFL_CRON_SECRET;else process.env.NFL_CRON_SECRET=previous}
});

test('overlapping lease and retry backoff never enter the scorer; expired lease recovers', async () => {
  const fixture=fakeDb();activeDb=fixture.db;
  let claimState='leased';const calls=[];
  activeDb.rpc=async(name,args)=>{calls.push(name);if(name==='claim_nfl_sync')return {data:claimState==='claimed'?{state:'claimed',token:'token',recovered:true}:{state:claimState},error:null};return {data:true,error:null}};
  const provider={schedule:async()=>{throw Error('scorer should not run')}};
  assert.equal((await runClaimedNflSlate(1,provider)).state,'leased');
  claimState='backoff';assert.equal((await runClaimedNflSlate(1,provider)).state,'backoff');
  assert.deepEqual(calls,['claim_nfl_sync','claim_nfl_sync']);
  // Recovered work with no drafted players completes cheaply and releases the fenced token.
  const original=activeDb.from;activeDb.from=function(table){const q=original.call(this,table);if(table==='lineups')q.then=resolve=>Promise.resolve({data:[],error:null}).then(resolve);return q};
  claimState='claimed';const outcome=await runClaimedNflSlate(1,provider);
  assert.equal(outcome.state,'succeeded');assert.equal(outcome.recovered,true);
  assert.ok(calls.includes('finish_nfl_sync'));
});

test('idle invocation still finishes one durable run; budget cutoff stops before new work', async () => {
  const records=[];
  function makeDb(candidates) {return {rpc:async()=>({data:0,error:null}),from(table){
    const query={mode:'read',select(){return this},single(){this.one=true;return this},eq(){return this},is(){return this},lte(){return this},gte(){return this},order(){return this},limit(){return this},in(){return this},insert(row){this.mode='insert';this.row=row;return this},update(row){this.mode='update';this.row=row;return this},then(resolve,reject){
      if(this.mode==='insert'){records.push(this.row);return Promise.resolve({data:{id:'run-id'},error:null}).then(resolve,reject)}
      if(this.mode==='update'){records.push(this.row);return Promise.resolve({data:{id:'run-id'},error:null}).then(resolve,reject)}
      return Promise.resolve({data:table==='slates'?candidates:[],error:null}).then(resolve,reject);
    }};return query;
  }}};
  activeDb=makeDb([]);const idle=await runNflBackgroundScoring(new Date('2026-09-24T18:00:00Z'));
  assert.equal(idle.processed,0);assert.equal(idle.status,'succeeded');assert.equal(records.length,2);assert.ok(records[1].finished_at);
  records.length=0;activeDb=makeDb([{id:1,start_date:date,end_date:date}]);
  const oldNow=Date.now;let ticks=0;Date.now=()=>ticks++===0?0:31_000;
  try {const result=await runNflBackgroundScoring(new Date('2026-09-24T18:00:00Z'));assert.equal(result.budgetStopped,true);assert.equal(result.processed,0)}
  finally {Date.now=oldNow}
});

function workerDiscoveryDb() {
  const rpcCalls=[], readTables=[], runs=[];
  const db={
    async rpc(name,args){rpcCalls.push({name,args});
      if(name==='claim_nfl_sync')return {data:{state:'claimed',token:'lease',recovered:false},error:null};
      return {data:true,error:null};
    },
    from(table){const query={mode:'read',select(){return this},single(){this.one=true;return this},eq(){return this},is(){return this},lte(){return this},gte(){return this},order(){return this},limit(){return this},in(){return this},insert(row){this.mode='insert';this.row=row;return this},update(row){this.mode='update';this.row=row;return this},then(resolve,reject){
      if(this.mode==='insert')return Promise.resolve({data:{id:'run-id'},error:null}).then(resolve,reject);
      if(this.mode==='update'){runs.push(this.row);return Promise.resolve({data:null,error:null}).then(resolve,reject)}
      readTables.push(table);
      const data=table==='slates'?[{id:189,start_date:date,end_date:date}]:
        table==='nfl_sync_state'?[]:table==='lineups'?[{lineup_players:[{player_id:10}]}]:
        table==='players_nfl'?[{team_abbreviation:'AAA'}]:[];
      return Promise.resolve({data,error:null}).then(resolve,reject);
    }};return query},
  };
  return {db,rpcCalls,readTables,runs};
}

test('failed acquisition is claimed for retry without entering the scorer and records its safe category', async () => {
  const original=global.fetch;
  try {
    for (const [response,expected] of [
      [{ok:false,status:503},'provider_request_failed:scoreboard:http_503'],
      [{ok:true,json:async()=>({events:[{}]})},'provider_response_malformed:scoreboard:structure'],
    ]) {
      const fixture=workerDiscoveryDb();activeDb=fixture.db;
      global.fetch=async url=>{assert.match(String(url),/scoreboard\?dates=20260924$/);return response};
      const result=await runNflBackgroundScoring(new Date('2026-09-24T19:30:00Z'));
      assert.equal(result.eligible,0);assert.equal(result.claimed,1);assert.equal(result.failed,1);
      assert.equal(result.details[0].error,expected);
      assert.equal(fixture.rpcCalls.find(call=>call.name==='finish_nfl_sync').args.p_error,expected);
      assert.equal(fixture.readTables.filter(table=>table==='slates').length,1,'scorer must not reread slate');
      assert.equal(result.summariesFetched,0);
    }
  } finally {global.fetch=original}
});

test('valid empty and unmatched schedules are distinct, safe discovery outcomes', async () => {
  const original=global.fetch;
  try {
    for (const [events,expected] of [[[],'no_games_for_range'],[[{...game(),competitions:[{...game().competitions[0],competitors:[
      {team:{id:'3',abbreviation:'CCC'}},{team:{id:'4',abbreviation:'DDD'}}]}]}],'no_matching_games']]) {
      const fixture=workerDiscoveryDb();activeDb=fixture.db;
      global.fetch=async()=>({ok:true,json:async()=>({events})});
      const result=await runNflBackgroundScoring(new Date('2026-09-24T19:30:00Z'));
      assert.equal(result.failed,0);assert.equal(result.claimed,0);
      assert.equal(result.details[0].state,expected);
      assert.equal(fixture.rpcCalls.some(call=>call.name==='claim_nfl_sync'),false);
    }
  } finally {global.fetch=original}
});

test('claimed scoring failures persist provider-summary and database categories without raw errors', async () => {
  for (const [kind,expected] of [
    ['summary','provider_request_failed:summary:http_503'],
    ['database','scoring_database_failed:lineups_read'],
  ]) {
    const fixture=fakeDb();activeDb=fixture.db;const calls=[];
    activeDb.rpc=async(name,args)=>{calls.push({name,args});return {data:name==='claim_nfl_sync'?{state:'claimed',token:'lease',recovered:false}:true,error:null}};
    if(kind==='database') {
      const original=activeDb.from;activeDb.from=function(table){const query=original.call(this,table);
        if(table==='lineups')query.then=resolve=>Promise.resolve({data:null,error:{message:'raw database detail'}}).then(resolve);
        return query;
      };
    }
    const provider={scoreboardMs:0,summaryMs:0,summariesFetched:0,
      schedule:async()=>[game(live)],summary:async()=>{throw Error('NFL game summary HTTP 503')}};
    const outcome=await runClaimedNflSlate(1,provider);
    assert.equal(outcome.state,'failed');assert.equal(outcome.error,expected);
    assert.equal(calls.find(call=>call.name==='finish_nfl_sync').args.p_error,expected);
    assert.equal(fixture.writes.length,0);
  }
});
