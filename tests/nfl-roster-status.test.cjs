const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const {host,context}=require('./helpers/scores-harness.cjs');
const {nflRosterStatusCounts:counts}=require('../lib/lineups/nflRosterStatus.ts');
const {NflFantasyGameCenter}=require('../components/lineups/NflFantasyGameCenter.tsx');
const players=Array.from({length:6},(_,i)=>({id:i+1,name:'Never used',team_abbreviation:['SEA','BUF','KC','SF','DEN','NE'][i]}));
const result=(final,live,left)=>({games_completed:final,games_in_progress:live,games_remaining:left});
test('six upcoming; one live + five upcoming; mixed partition preserves all six entries',()=>{
  const games=Object.fromEntries(players.map(p=>[p.team_abbreviation,{status:'pre'}]));
  assert.deepEqual(counts(players,games,()=>null),result(0,0,6));
  games.SEA.status='in';assert.deepEqual(counts(players,games,()=>null),result(0,1,5));
  games.BUF.status='post';games.KC.status='post';assert.deepEqual(counts(players,games,()=>null),result(2,1,3));
  assert.equal(Object.values(counts(players,games,()=>null)).reduce((a,b)=>a+b,0),6);
  games.SEA.status='post';assert.deepEqual(counts(players,games,()=>null),result(3,0,3));
});
test('live-only subset, unknown mapping, bye and inactive roster entries remain left; names never resolve teams',()=>{
  assert.deepEqual(counts(players,{SEA:{status:'in'}},()=>null),result(0,1,5));
  const unknown=[{id:1,name:'Seattle',is_active:false},{id:2,team_abbreviation:'BYE'}];
  assert.deepEqual(counts(unknown,{},()=>null),result(0,0,2));
  assert.deepEqual(counts(players,{SEA:{status:'unknown'}},()=>null),result(0,0,6));
  assert.deepEqual(counts(players,{SEA:{status:'pre'}},()=>({game_status:3})),result(5,0,1),'scheduled status overrides stale stored final');
});
test('D/ST uses its team code exactly like an offensive roster entry; scoring values remain untouched',()=>{
  const dst={id:80,position:'D/ST',nfl_player_id:100000001,team_abbreviation:'sea',fantasy_points:11.4};
  for(const [status,expected] of [['pre',result(0,0,1)],['in',result(0,1,0)],['post',result(1,0,0)]])assert.deepEqual(counts([dst],{SEA:{status}},()=>null),expected);
  assert.equal(dst.fantasy_points,11.4);
});
test('schedule provider rejects stale responses and A-B-A does not restore a cached live status',async()=>{
  const pending=[];global.fetch=(url,options)=>new Promise(resolve=>pending.push({url,options,resolve}));
  const h=host(NflFantasyGameCenter);const props={slateId:1,refreshKey:null,children:null};
  h.render(props,true);pending[0].resolve({ok:true,json:async()=>({slateId:1,gamesByTeam:{SEA:{status:'in',espnEventId:'1'}}})});
  await new Promise(r=>setImmediate(r));assert.equal(h.render(props).props.value.gamesByTeam.SEA.status,'in');
  h.render({...props,slateId:2},true);assert.deepEqual(h.render({...props,slateId:2}).props.value.gamesByTeam,{});
  assert.deepEqual(h.render(props,true).props.value.gamesByTeam,{});
  pending[1].resolve({ok:true,json:async()=>({slateId:2,gamesByTeam:{SEA:{status:'post'}}})});
  await new Promise(r=>setImmediate(r));assert.deepEqual(h.render(props).props.value.gamesByTeam,{});h.unmount();
});
test('scoring pipeline classifies scheduled/missing-boxscore rows and sums remaining instead of zero',()=>{
  const ts=require('typescript');const source=fs.readFileSync('app/api/refresh-stats-nfl/route.ts','utf8');
  const exports={};new Function('require','exports',ts.transpileModule(source+'\nexport const statusTest={blankRow,applyGameStatus};',{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(()=>({}),exports);
  for(const [state,expected] of [['pre',result(0,0,1)],['in',result(0,1,0)],['post',result(1,0,0)]]){
    const row=exports.statusTest.blankRow();row.fantasy_points=23.7;exports.statusTest.applyGameStatus(row,{state});
    for(const key of Object.keys(expected))assert.equal(row[key],expected[key]);assert.equal(row.fantasy_points,23.7);
  }
  for(const name of ['STATUS_POSTPONED','STATUS_CANCELED','STATUS_SUSPENDED']){
    const row=exports.statusTest.blankRow();exports.statusTest.applyGameStatus(row,{state:'post',name});assert.equal(row.games_remaining,1);assert.equal(row.games_completed,0);
  }
  assert.equal(exports.statusTest.blankRow().games_remaining,1);
  assert.match(source,/games_remaining: playerRows.reduce/);
  assert.match(source,/matchingEvents.length === 1/);
});
