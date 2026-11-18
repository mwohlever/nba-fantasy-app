/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const {resolveNflDraftSort,nflDraftMetrics}=require('../lib/player-center/draftSort.ts');
const {normalizeCoreSeasonFacts}=require('../lib/player-center/seasonFacts.ts');
const {fantasyPointsFromStats}=require('../lib/player-center/comparison.ts');
const context='group:nfl:123',at='2026-11-16T21:00:00Z',scoring={sport:'nfl',basis:'legacy_defaults',settings:null};
const fixture=name=>require('./fixtures/player-center/nfl-fantasy-source/'+name+'.json');
for(const [position,metric]of Object.entries({All:'fantasy_points',QB:'fantasy_points',RB:'fantasy_points',WR:'fantasy_points',TE:'fantasy_points',K:'existing_order','D/ST':'existing_order',FLEX:'fantasy_points',SF:'fantasy_points'}))test(position+' gets a meaningful automatic descending sort',()=>{
 assert.deepEqual(resolveNflDraftSort(position,context,null),{metric,ascending:false});
});
test('kickers use FGM only when available; partial fantasy remains the offensive default and K/DST stay limited',()=>{
 assert.equal(resolveNflDraftSort('K',context,null,false,true).metric,'field_goals_made');
 for(const position of ['All','QB','RB','WR','TE'])assert.equal(resolveNflDraftSort(position,context,null,true).metric,'fantasy_points');
 for(const position of ['K','D/ST'])assert.equal(resolveNflDraftSort(position,context,null,true).metric,'existing_order');
});
test('explicit meaningful sorts/directions survive positions; automatic and incompatible sorts reset',()=>{
 const selected={metric:'receiving_yards',ascending:true,position:'WR',context,explicit:true};
 assert.deepEqual(resolveNflDraftSort('TE',context,selected),{metric:'receiving_yards',ascending:true});
 assert.deepEqual(resolveNflDraftSort('QB',context,selected),{metric:'fantasy_points',ascending:false});
 assert.deepEqual(resolveNflDraftSort('All',context,{...selected,explicit:false}),{metric:'fantasy_points',ascending:false});
 assert.deepEqual(resolveNflDraftSort('WR','other-group',selected),{metric:'fantasy_points',ascending:false});
 assert.deepEqual(resolveNflDraftSort('WR',context,{...selected,explicit:false}),{metric:'fantasy_points',ascending:false});
 assert.equal(resolveNflDraftSort('All',context,{...selected,metric:'fantasy_points'},false).metric,'fantasy_points');
 assert.ok(nflDraftMetrics('All',false).includes('fantasy_points'));
});
test('captured Burrow and Allen total fumbles lost differ from rushing fumbles lost',()=>{
 for(const id of [3915511,3918298]){
  const raw=fixture('core-'+id),facts=normalizeCoreSeasonFacts(raw,'nfl',String(id),2026,'regular',at);
  assert.equal(facts.gamesPlayed,9);assert.equal(facts.stats.fumbles_lost,1);
  assert.equal(raw.splits.categories.find(c=>c.name==='rushing').stats.find(s=>s.name==='rushingFumblesLost').value,0);
  const withoutLoss=fantasyPointsFromStats({...facts.stats,fumbles_lost:0},'QB',scoring);
  assert.equal(Math.round((withoutLoss-fantasyPointsFromStats(facts.stats,'QB',scoring))*100),200);
  assert.equal(fantasyPointsFromStats({...facts.stats,fumbles_lost:null},'QB',scoring),null);
 }
});
test('alternate actual-season feed contains losses for Burrow but omits Chase’s verified explicit zero',()=>{
 const rows=fixture('fantasy-sample').players;
 for(const p of rows){const s=p.stats[0];assert.equal(s.seasonId,2026);assert.equal(s.statSourceId,0);assert.equal(s.statSplitTypeId,0);assert.equal(s.scoringPeriodId,0);}
 const chase=normalizeCoreSeasonFacts(fixture('core-4362628'),'nfl','4362628',2026,'regular',at);
 assert.equal(chase.stats.fumbles_lost,0);assert.equal(Object.hasOwn(rows.find(p=>p.id===4362628).stats[0].stats,'72'),false);
 assert.equal(rows.find(p=>p.id===3915511).stats[0].stats['72'],1);
});
test('canonical fantasy totals reconcile to published individual inputs, retaining turnovers',()=>{
 for(const [id,position,expected]of [[3915511,'QB',232.3],[3918298,'QB',null],[4362628,'WR',null]]){
  const f=normalizeCoreSeasonFacts(fixture('core-'+id),'nfl',String(id),2026,'regular',at);
  const s=f.stats,manual=s.passing_yards*.04+s.passing_tds*4-s.passing_ints*2+s.rushing_yards*.1+s.rushing_tds*6+s.receiving_yards*.1+s.receiving_tds*6+s.receptions-s.fumbles_lost*2;
  assert.ok(Math.abs(fantasyPointsFromStats(s,position,scoring)-manual)<1e-9);
  if(expected!==null)assert.ok(Math.abs(manual-expected)<1e-9);
  const frozen=fantasyPointsFromStats(s,position,{sport:'nfl',basis:'slate_snapshot',settings:{sport:'nfl',scoring:{fumblesLost:-5}}});
  assert.ok(Math.abs(frozen-(manual-3*s.fumbles_lost))<1e-9);
 }
});
