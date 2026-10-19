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
const { mergeNflPlayerCategories, nflCategoryIndex } = require('../lib/nfl/boxscoreCorrections.ts');
const correctionSummary = require('./fixtures/nfl-week6-correction.json');
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
  const teamResults = [];
  const db = { from(table) {
    const q = {filters:{},mode:'read',eq(key,value){this.filters[key]=value;return this},in(){return this},is(){return this},select(){return this},single(){this.one=true;return this},upsert(rows){this.mode='write';this.rows=rows;writes.push({table,rows});return this},update(values){this.mode='update';this.values=values;return this},then(resolve,reject){
      if(this.mode==='write') {
        const saved = table==='player_nfl_slate_stats'?stats:teamResults;
        const key = table==='player_nfl_slate_stats'?'player_id':'team_id';
        for(const row of this.rows) {
          const existing=saved.find(item=>item.slate_id===row.slate_id&&item[key]===row[key]);
          if(existing)Object.assign(existing,structuredClone(row));else saved.push(structuredClone(row));
        }
        return Promise.resolve({error:null}).then(resolve,reject);
      }
      if(this.mode==='update') {if(table==='slates') slates.find(s=>s.id===this.filters.id).is_locked=true;return Promise.resolve({data:[{id:this.filters.id}],error:null}).then(resolve,reject)}
      let data = table==='slates'?slates:table==='lineups'?lineups[this.filters.slate_id]??[]:table==='players_nfl'?players:table==='player_nfl_slate_stats'?stats.filter(s=>s.slate_id===this.filters.slate_id):[];
      if(table==='slates') data=data.filter(s=>s.id===this.filters.id);
      return Promise.resolve({data:this.one?data[0]??null:data,error:null}).then(resolve,reject);
    }}; return q;
  }};
  return {db,writes,slates,stats,players,lineups,teamResults};
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

test('Thursday-Monday slate does not lock on Thursday; postponed final never locks or sends final notifications', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-24T23:00:00Z') });
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

function weekSixFixture() {
  const fixture=fakeDb();
  // Keep this correction test independent of the real date and slate auto-locking.
  fixture.slates.forEach(slate=>{slate.end_date='2099-10-19';slate.rules_snapshot.scoring={
    receptions:0.5,receivingYards:0.2,rushingYards:0.25,passingYards:0.05,passingTouchdowns:7,
  }});
  fixture.players.push(
    {id:18,name:'Trey McBride',nfl_player_id:4361307,team_abbreviation:'ARI',position:'TE'},
    {id:526,name:'Matthew Stafford',nfl_player_id:12483,team_abbreviation:'LAR',position:'QB'},
  );
  fixture.lineups[1]=[
    {id:11,team_id:101,lineup_players:[{player_id:18},{player_id:526}]},
    {id:12,team_id:102,lineup_players:[{player_id:10}]},
  ];
  fixture.stats.push({slate_id:1,player_id:18,rushing_yards:2,rushing_tds:0,receptions:2,receiving_yards:40,
    receiving_tds:0,game_status:2,fantasy_points:9.5},
  {slate_id:1,player_id:526,passing_yards:222,passing_tds:2,passing_ints:0,rushing_yards:2,
    game_status:2,fantasy_points:25.6});
  const corrected=structuredClone(correctionSummary);
  const event={id:'401873004',date:'2026-10-18T20:05Z',competitions:corrected.header.competitions};
  const other=game(live);
  const calls=[];
  const provider={summaryMs:0,schedule:async()=>[event,other],summary:async id=>{
    calls.push(id);return id===event.id?corrected:summary();
  }};
  return {...fixture,corrected,event,provider,calls};
}

test('verified Week 6 correction clears McBride rushing, preserves other categories and updates other games with frozen scoring', async () => {
  const fixture=weekSixFixture();activeDb=fixture.db;
  const response=await refreshNflSlate(1,fixture.provider);
  assert.equal(response.status,200);
  const mcbride=fixture.stats.find(row=>row.player_id===18);
  assert.equal(mcbride.rushing_yards,0);assert.equal(mcbride.rushing_tds,0);
  assert.equal(mcbride.receptions,7);assert.equal(mcbride.receiving_yards,53);
  assert.equal(mcbride.fantasy_points,14.1);assert.equal(mcbride.game_status,3);
  const stafford=fixture.stats.find(row=>row.player_id===526);
  assert.equal(stafford.rushing_yards,0);
  assert.equal(stafford.passing_yards,222);assert.equal(stafford.passing_tds,2);
  assert.equal(stafford.fantasy_points,25.1);
  assert.equal(fixture.stats.find(row=>row.player_id===10).fantasy_points,14);
  assert.deepEqual(fixture.calls,['401873004','g1']);
  assert.deepEqual(fixture.teamResults.map(row=>[row.team_id,row.fantasy_points,row.finish_position]),[
    [101,39.2,1],[102,14,2],
  ]);
  // Persisted state is used by the next refresh, not the original stale rows.
  const withoutTimestamps=rows=>structuredClone(rows).map(row=>{delete row.updated_at;return row});
  const statsBefore=withoutTimestamps(fixture.stats);
  const teamsBefore=structuredClone(fixture.teamResults);
  assert.equal((await refreshNflSlate(1,fixture.provider)).status,200);
  assert.deepEqual(withoutTimestamps(fixture.stats),statsBefore);
  assert.deepEqual(fixture.teamResults,teamsBefore);
});

test('the same corrected ESPN data respects a different slate snapshot', async () => {
  const fixture=weekSixFixture();activeDb=fixture.db;
  fixture.lineups[2]=structuredClone(fixture.lineups[1]);
  fixture.slates[1].rules_snapshot.scoring.receptions=1;
  assert.equal((await refreshNflSlate(1,fixture.provider)).status,200);
  assert.equal((await refreshNflSlate(2,fixture.provider)).status,200);
  assert.equal(fixture.stats.find(row=>row.slate_id===1&&row.player_id===18).fantasy_points,14.1);
  assert.equal(fixture.stats.find(row=>row.slate_id===2&&row.player_id===18).fantasy_points,17.6);
  assert.equal(fixture.teamResults.find(row=>row.slate_id===2&&row.team_id===101).fantasy_points,42.7);
});

test('Week 6 production snapshot scores corrected McBride at 8.8 FP with no obsolete rushing credit', async () => {
  const fixture=weekSixFixture();activeDb=fixture.db;
  fixture.slates[0].rules_snapshot.scoring={receptions:0.5,passingTouchdowns:5};
  fixture.stats.find(row=>row.player_id===18).fantasy_points=5.2;
  assert.equal((await refreshNflSlate(1,fixture.provider)).status,200);
  assert.equal(fixture.stats.find(row=>row.player_id===18).fantasy_points,8.8);
  assert.equal(fixture.teamResults.find(row=>row.team_id===101).fantasy_points,27.7);
});

test('empty ESPN categories with placeholder totals do not block unrelated valid corrections', async () => {
  const fixture=weekSixFixture();activeDb=fixture.db;
  for(const team of fixture.corrected.boxscore.players) {
    const fumbles=team.statistics.find(g=>g.name==='fumbles');
    fumbles.athletes=[];fumbles.totals=[];
  }
  assert.equal((await refreshNflSlate(1,fixture.provider)).status,200);
  assert.equal(fixture.stats.find(row=>row.player_id===18).rushing_yards,0);
  assert.equal(fixture.stats.find(row=>row.player_id===18).fantasy_points,14.1);
  const saved=fixture.stats.find(row=>row.player_id===18);
  saved.fumbles_lost=1;
  fixture.writes.length=0;
  assert.equal((await refreshNflSlate(1,fixture.provider)).status,500);
  assert.equal(fixture.writes.length,0);assert.equal(saved.fumbles_lost,1);
});

test('incomplete, malformed and unreconciled rushing corrections preserve all saved rows and report safe context', async () => {
  const variations=[
    ['missing category',s=>{s.boxscore.players[0].statistics=s.boxscore.players[0].statistics.filter(g=>g.name!=='rushing')}],
    ['missing totals',(_s,g)=>{delete g.totals}],
    ['missing athlete',(_s,g)=>{g.athletes.pop()}],
    ['wrong yards total',(_s,g)=>{g.totals[1]='119'}],
    ['wrong TD total',(_s,g)=>{g.totals[3]='1'}],
    ['wrong attempts total',(_s,g)=>{g.totals[0]='34'}],
    ['missing attempts label',(_s,g)=>{g.labels[0]='ATTEMPTS'}],
    ['malformed undrafted athlete',(_s,g)=>{g.athletes[0].stats[1]='--'}],
    ['empty athlete cell',(_s,g)=>{g.athletes[0].stats[1]=''}],
    ['null athlete cell',(_s,g)=>{g.athletes[0].stats[1]=null}],
    ['noninteger athlete cell',(_s,g)=>{g.athletes[0].stats[1]='1.5'}],
    ['missing team totals',s=>{s.boxscore.teams=[]}],
    ['duplicate team totals',s=>{s.boxscore.teams.push(structuredClone(s.boxscore.teams[0]))}],
    ['conflicting team total',s=>{s.boxscore.teams[0].statistics.push({name:'rushingYards',displayValue:'122'})}],
    ['self-consistent truncated category', (s,g)=>{
      g.athletes.pop();g.totals[0]='33';g.totals[1]='118';
      // Independent team totals still say 35 carries / 120 yards.
    }],
    ['duplicate athlete',(_s,g)=>{g.athletes.push(structuredClone(g.athletes[0]))}],
    ['duplicate category',(s,g)=>{s.boxscore.players[0].statistics.push(structuredClone(g))}],
  ];
  for(const [label,modify] of variations) {
    const fixture=weekSixFixture();activeDb=fixture.db;
    const original=structuredClone(fixture.stats);
    modify(fixture.corrected,fixture.corrected.boxscore.players[0].statistics.find(g=>g.name==='rushing'));
    const logs=[],previous=console.error;
    console.error=(...args)=>logs.push(args);
    try {
      assert.equal((await refreshNflSlate(1,fixture.provider)).status,500,label);
    } finally {console.error=previous}
    assert.equal(fixture.writes.length,0,label);assert.deepEqual(fixture.stats,original,label);
    assert.equal(fixture.teamResults.length,0,label);
    const details=logs.find(args=>args[0]==='nfl_refresh_failed')?.[1];
    assert.equal(details?.slateId,1,label);assert.equal(details?.eventId,'401873004',label);
    assert.equal(details?.category,'rushing',label);assert.ok(details?.reason,label);
    assert.ok(Object.hasOwn(details,'playerId'),label);
    assert.deepEqual(Object.keys(details).sort(),['category','eventId','playerId','reason','slateId']);
  }
});

function mergeCorrection(s,playerId,prior) {
  const groups=nflCategoryIndex(s,'401873004').get('22');
  return mergeNflPlayerCategories({groups,team:s.boxscore.teams.find(t=>t.team.id==='22'),
    playerId,eventId:'401873004',prior:{passing_yards:0,passing_tds:0,passing_ints:0,
      rushing_yards:0,rushing_tds:0,receiving_yards:0,receiving_tds:0,receptions:0,fumbles_lost:0,...prior}});
}

test('present rushing rows support reductions, explicit zeros, negative yards and subsequent increases without adding scores twice', () => {
  const s=structuredClone(correctionSummary),group=s.boxscore.players[0].statistics.find(g=>g.name==='rushing');
  let prior={rushing_yards:90,rushing_tds:1};
  let next=mergeCorrection(s,'4427728',prior);
  assert.equal(next.rushing_yards,80);assert.equal(next.rushing_tds,0);
  for(const yards of [0,-2,5]) {
    group.athletes[0].stats[1]=String(yards);
    group.totals[1]=String(yards+40);
    s.boxscore.teams[0].statistics.find(stat=>stat.name==='rushingYards').displayValue=group.totals[1];
    next=mergeCorrection(s,'4427728',next);
    assert.equal(next.rushing_yards,yards);
    assert.deepEqual(mergeCorrection(s,'4427728',next),next);
  }
  prior={rushing_yards:90};delete group.totals;
  assert.throws(()=>mergeCorrection(s,'4427728',prior),/boxscore incomplete/);
});

test('clearing McBride rushing leaves already valid receiving statistics intact', () => {
  const corrected=mergeCorrection(structuredClone(correctionSummary),'4361307',{
    rushing_yards:2,rushing_tds:0,receiving_yards:53,receptions:7,receiving_tds:0,
  });
  assert.equal(corrected.rushing_yards,0);assert.equal(corrected.rushing_tds,0);
  assert.equal(corrected.receiving_yards,53);assert.equal(corrected.receptions,7);assert.equal(corrected.receiving_tds,0);
});

test('an omitted player can reappear after correction, and a verified empty category can clear all prior rushing', () => {
  const s=structuredClone(correctionSummary);
  const group=s.boxscore.players[0].statistics.find(g=>g.name==='rushing');
  const cleared=mergeCorrection(s,'4361307',{rushing_yards:2});
  group.athletes.push({athlete:{id:'4361307',displayName:'Trey McBride'},stats:['1','2','2.0','0','2']});
  group.totals[0]='36';group.totals[1]='122';
  s.boxscore.teams[0].statistics.find(stat=>stat.name==='rushingAttempts').displayValue='36';
  s.boxscore.teams[0].statistics.find(stat=>stat.name==='rushingYards').displayValue='122';
  const restored=mergeCorrection(s,'4361307',cleared);
  assert.equal(restored.rushing_yards,2);assert.equal(restored.receiving_yards,53);
  assert.deepEqual(mergeCorrection(s,'4361307',restored),restored);
  group.athletes=[];group.totals=['0','0','0.0','0','0'];
  s.boxscore.teams[0].statistics.find(stat=>stat.name==='rushingAttempts').displayValue='0';
  s.boxscore.teams[0].statistics.find(stat=>stat.name==='rushingYards').displayValue='0';
  assert.equal(mergeCorrection(s,'4361307',restored).rushing_yards,0);
});

test('complete categories can clear a player absent from every scoring category without erasing teammate stats', () => {
  const s=structuredClone(correctionSummary);
  const corrected=mergeCorrection(s,'absent-player',{passing_yards:2,passing_tds:1,passing_ints:1,
    rushing_yards:2,rushing_tds:1,receiving_yards:2,receptions:1,receiving_tds:1,fumbles_lost:1});
  assert.ok(Object.values(corrected).every(value=>value===0));
  // Category absent entirely is not evidence for zero, including zero lost-fumble totals.
  s.boxscore.players[0].statistics=s.boxscore.players[0].statistics.filter(g=>g.name!=='fumbles');
  assert.throws(()=>mergeCorrection(s,'absent-player',{fumbles_lost:1}),/boxscore incomplete/);
});

test('passing corrections reconcile net team yards with gross athlete yards and reject unexplained differences', () => {
  const s=structuredClone(correctionSummary);
  const groups=nflCategoryIndex(s,'401873004').get('14');
  const args={groups,team:s.boxscore.teams.find(t=>t.team.id==='14'),playerId:'12483',eventId:'401873004',
    prior:{passing_yards:230,passing_tds:3,passing_ints:1,rushing_yards:0,rushing_tds:0,
      receiving_yards:0,receiving_tds:0,receptions:0,fumbles_lost:0}};
  const corrected=mergeNflPlayerCategories(args);
  assert.equal(corrected.passing_yards,222);assert.equal(corrected.passing_tds,2);assert.equal(corrected.passing_ints,0);
  // ESPN has 194 net passing yards plus 28 sack yards = 222 gross passing yards.
  groups.get('passing').totals[1]='193';
  assert.throws(()=>mergeNflPlayerCategories(args),/boxscore incomplete/);
});

test('receiving and fumble reductions require complete reconciled categories', () => {
  const s=structuredClone(correctionSummary);
  const corrected=mergeCorrection(s,'4361307',{receiving_yards:60,receptions:8,receiving_tds:1,fumbles_lost:1});
  assert.equal(corrected.receiving_yards,53);assert.equal(corrected.receptions,7);
  assert.equal(corrected.receiving_tds,0);assert.equal(corrected.fumbles_lost,0);
  s.boxscore.teams[0].statistics.find(stat=>stat.name==='netPassingYards').displayValue='219';
  assert.throws(()=>mergeCorrection(s,'4361307',{receiving_yards:60}),/boxscore incomplete/);
});

test('passing and receiving correction evidence must agree on zero-yard receptions and touchdowns', () => {
  for(const category of ['passing','receiving']) {
    const s=structuredClone(correctionSummary);
    const passing=s.boxscore.players[0].statistics.find(g=>g.name==='passing');
    // Both passing rows and their totals agree, but receiving still has 24 receptions / 0 TDs.
    passing.athletes[0].stats[0]='23/35';passing.totals[0]='23/35';
    passing.athletes[0].stats[3]='1';passing.totals[3]='1';
    const prior=category==='passing'?{passing_yards:220}:{receptions:8,receiving_yards:60};
    assert.throws(()=>mergeCorrection(s,category==='passing'?'2578570':'4361307',prior),/boxscore incomplete/);
  }
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
  activeDb.rpc=async(name)=>{calls.push(name);if(name==='claim_nfl_sync')return {data:claimState==='claimed'?{state:'claimed',token:'token',recovered:true}:{state:claimState},error:null};return {data:true,error:null}};
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
