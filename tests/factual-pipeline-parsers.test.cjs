/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const { classifyEspnNbaPhase, normalizeEspnNbaGameLog } = require('../lib/analytics/providers/espnNbaGameLog.ts');
const { normalizeEspnNflGameLog } = require('../lib/analytics/providers/espnNflGameLog.ts');
const { normalizeEspnNflEventFumbles } = require('../lib/analytics/providers/espnNflEventFumbles.ts');
const { normalizeCenterLog, normalizeCenterSeasonStats, normalizeCenterNflSummary, enrichNflGame } = require('../lib/player-center/espn.ts');
const { acquireNflObservations } = require('../lib/analytics/nfl/observationAcquisition.ts');
const { buildNflObservation, observationRecordFromNflObservation, nflObservationFromUnknown } = require('../lib/analytics/nfl/observationIngestion.ts');
const { canonicalNflObservationHashPayload, hashNflObservation } = require('../lib/analytics/nfl/observationFoundation.ts');
const { persistNflObservationBatch } = require('../lib/analytics/nfl/observationPersistence.server.ts');
const curry = require('./fixtures/factual-pipeline/nba-curry-2026-phases.json');
const seasonStats = require('./fixtures/factual-pipeline/nba-curry-2026-season.json');
const allgeier = require('./fixtures/factual-pipeline/nfl-allgeier-negative-yards.json');
const mahomesLog = require('./fixtures/player-center/nfl-log-3139477-401872945.json');
const mahomesSummary = require('./fixtures/player-center/nfl-summary-401872945.json');
const fetchedAt = '2026-11-03T18:40:00Z';

test('captured Curry 2026 has exactly 43 regular games and two separately classified play-in games', () => {
  const parsed = normalizeEspnNbaGameLog(curry, { espnPlayerId: '3975', season: 2026, fetchedAt, knownAt: fetchedAt });
  const regular = parsed.observations.filter(g => g.phase === 'regular');
  const playin = parsed.observations.filter(g => ['401866756', '401866759'].includes(g.eventId));
  assert.equal(regular.length, 43); assert.equal(playin.length, 2); assert.ok(playin.every(g => g.phase === 'postseason'));
  assert.ok(regular.every(g => !playin.some(p => p.eventId === g.eventId)));
  assert.equal(normalizeCenterSeasonStats(seasonStats, 'nba', 2026, 'regular', '3975').expectedGames, 43);
  assert.equal(normalizeCenterLog(curry, { sport:'nba', providerPlayerId:'3975', season:2026, phase:'regular', fetchedAt }).games.length,43);
});
test('NBA competition classification is an exact season-qualified allowlist', () => {
  for (const [label, expected] of [['Regular Season','regular'],['Preseason','preseason'],['Postseason','postseason'],['Play In Regular Season','postseason'],
    ['NBA Cup Championship','unknown'],['Exhibition Regular Season','unknown'],['Summer League','unknown'],['Postseason All-Star','unknown'],['','unknown']]) {
    assert.equal(classifyEspnNbaPhase(`2025-26 ${label}`,2026),expected,label);
  }
  for(const label of ['2024-25 Regular Season','2025-27 Regular Season','Regular Season',null,{}]) assert.equal(classifyEspnNbaPhase(label,2026),'unknown');
  const unknown=structuredClone(curry);unknown.seasonTypes[0].displayName='2025-26 Unknown Competition';
  const result=normalizeEspnNbaGameLog(unknown,{espnPlayerId:'3975',season:2026,fetchedAt,knownAt:null});
  assert.ok(result.observations.filter(g=>['401866756','401866759'].includes(g.eventId)).every(g=>g.phase==='unknown'&&g.missing.includes('season-phase')));
});

function negativeRow() {
  return normalizeEspnNflGameLog(allgeier,{espnPlayerId:'4373626',season:2026,position:'RB',fetchedAt}).observations[0];
}
function build(row) {
  return buildNflObservation({gameLog:row,eligible:[{localPlayerId:1,providerPlayerId:row.providerPlayerId,position:row.position}],
    finalEvents:[{providerEventId:row.eventId,season:2026,phase:'regular',completed:true}],fumbles:[],knownAt:'2026-11-03T18:41:00Z',normalizationVersion:'espn_nfl_gamelog_fumbles_v1'});
}
test('Allgeier captured -1 rushing yards survives parser, canonical validation, hash, wire and DB-record conversion', () => {
  const row=negativeRow(); assert.equal(row.eventId,'401872958');assert.equal(row.stats.rushingYards,-1);assert.equal(row.stats.rushingAttempts,2);
  const normalized=build(row);assert.equal(canonicalNflObservationHashPayload(normalized).stats.rushingYards,-1);
  assert.equal(nflObservationFromUnknown(normalized).stats.rushingYards,-1);assert.equal(observationRecordFromNflObservation(normalized).rushing_yards,-1);
  const center=normalizeCenterLog(allgeier,{sport:'nfl',providerPlayerId:'4373626',season:2026,phase:'regular',fetchedAt});assert.equal(center.games[0].stats.rushing_yards,-1);
  assert.notEqual(hashNflObservation(normalized),hashNflObservation({...normalized,stats:{...normalized.stats,rushingYards:null}}));
  assert.notEqual(hashNflObservation(normalized),hashNflObservation({...normalized,stats:{...normalized.stats,rushingYards:0}}));
});
test('only yard fields allow signed int32; negative counts, nonfinite, fractional and out-of-range values fail validation', () => {
  const a=build(negativeRow());
  for(const field of ['passingYards','rushingYards','receivingYards']) assert.equal(canonicalNflObservationHashPayload({...a,stats:{...a.stats,[field]:-7}}).stats[field],-7);
  for(const [field,value] of [['fumblesLost',-1],['receptions',-1],['rushingTouchdowns',-1],['rushingYards',NaN],['receivingYards',-1.5],['passingYards',-2147483649]])
    assert.throws(()=>canonicalNflObservationHashPayload({...a,stats:{...a.stats,[field]:value}}),/Invalid NFL factual stat/);
});
test('research log parsing preserves signed receiving/passing yards without accepting negative attempts or receptions',()=>{
  const rb=structuredClone(allgeier),r=rb.seasonTypes.flatMap(t=>t.categories).flatMap(c=>c.events)[0];
  r.stats[rb.names.indexOf('receivingYards')]='-4';r.stats[rb.names.indexOf('receptions')]='-1';
  const skill=normalizeEspnNflGameLog(rb,{espnPlayerId:'4373626',season:2026,position:'RB',fetchedAt}).observations[0];
  assert.equal(skill.stats.receivingYards,-4);assert.equal(skill.stats.receptions,null);
  const qb=structuredClone(mahomesLog),qr=qb.seasonTypes.flatMap(t=>t.categories).flatMap(c=>c.events||[]).find(r=>r.eventId==='401872945');
  qr.stats[qb.names.indexOf('passingYards')]='-8';qr.stats[qb.names.indexOf('passingAttempts')]='-1';
  const passing=normalizeEspnNflGameLog(qb,{espnPlayerId:'3139477',season:2026,position:'QB',fetchedAt}).observations[0];
  assert.equal(passing.stats.passingYards,-8);assert.equal(passing.stats.passingAttempts,null);
});
test('signed facts are explicitly quarantined with their values before any incompatible storage attempt', async () => {
  const row=negativeRow(), issues=[];
  const result=await acquireNflObservations({eligible:[{localPlayerId:1,providerPlayerId:row.providerPlayerId,position:'RB'}],season:2026,
    finalEvents:[{providerEventId:row.eventId,season:2026,phase:'regular',completed:true}],gameLogs:[row],fetchFumbles:async()=>{throw Error('no QB fetch expected')},onIncomplete:x=>issues.push(x)});
  assert.deepEqual(result,[]);assert.equal(issues[0].reason,'signed_yards_storage_review_required');assert.deepEqual(issues[0].values,{rushingYards:-1});
  let writes=0,lookups=0;
  await assert.rejects(persistNflObservationBatch({observations:[build(row)],repository:{loadEligiblePlayers:async()=>[],existingHashes:async()=>{lookups++;return new Set()},insertVersions:async()=>{writes++}}}),/NFL_SIGNED_YARDS_STORAGE_REVIEW_REQUIRED/);
  assert.equal(writes,0);assert.equal(lookups,0);
});

test('research and Player Center use the same final exact-team zero evidence for the captured Mahomes event', async () => {
  const summary=normalizeEspnNflEventFumbles(mahomesSummary,{eventId:'401872945',fetchedAt});
  assert.ok(summary.zeroEligibleTeams.includes('12'));assert.equal(summary.final,true);
  const log=normalizeEspnNflGameLog(mahomesLog,{espnPlayerId:'3139477',season:2026,position:'QB',fetchedAt}).observations[0];
  const rows=await acquireNflObservations({eligible:[{localPlayerId:435,providerPlayerId:'3139477',position:'QB'}],season:2026,
    finalEvents:[{providerEventId:log.eventId,season:2026,phase:'regular',completed:true}],gameLogs:[log],fetchFumbles:async()=>summary});
  const game=normalizeCenterLog(mahomesLog,{sport:'nfl',providerPlayerId:'3139477',season:2026,phase:'regular',fetchedAt}).games[0];
  const enriched=enrichNflGame(game,normalizeCenterNflSummary(mahomesSummary,log.eventId),'https://espn.test/summary');
  assert.equal(rows.length,1);assert.equal(rows[0].stats.fumblesLost,0);assert.equal(enriched.stats.fumbles_lost,0);
});
test('omitted groups without independent evidence stay unknown and other factual cohort rows survive', async () => {
  const p=structuredClone(mahomesSummary);for(const t of p.boxscore.players)t.statistics=t.statistics.filter(g=>g.name!=='fumbles');
  for(const t of p.boxscore.teams)t.statistics=t.statistics.filter(s=>s.name!=='fumblesLost');
  const summary=normalizeEspnNflEventFumbles(p,{eventId:'401872945',fetchedAt});assert.deepEqual(summary.zeroEligibleTeams,[]);
  const qb=normalizeEspnNflGameLog(mahomesLog,{espnPlayerId:'3139477',season:2026,position:'QB',fetchedAt}).observations[0];
  const rb={...qb,providerPlayerId:'4373626',position:'RB',stats:{...qb.stats,fumblesLost:0}};const issues=[];
  const rows=await acquireNflObservations({eligible:[{localPlayerId:435,providerPlayerId:qb.providerPlayerId,position:'QB'},{localPlayerId:1,providerPlayerId:rb.providerPlayerId,position:'RB'}],
    season:2026,finalEvents:[{providerEventId:qb.eventId,season:2026,phase:'regular',completed:true}],gameLogs:[qb,rb],fetchFumbles:async()=>summary,onIncomplete:x=>issues.push(x)});
  assert.equal(rows.length,1);assert.equal(rows[0].position,'RB');assert.equal(issues[0].reason,'fumbles_lost_unknown');
});
test('explicit QB log LOST survives missing summary evidence; conflicting sources are withheld and reported', async () => {
  const qb=normalizeEspnNflGameLog(mahomesLog,{espnPlayerId:'3139477',season:2026,position:'QB',fetchedAt}).observations[0];qb.stats.fumblesLost=1;
  const input={eligible:[{localPlayerId:435,providerPlayerId:qb.providerPlayerId,position:'QB'}],season:2026,
    finalEvents:[{providerEventId:qb.eventId,season:2026,phase:'regular',completed:true}],gameLogs:[qb]};
  const retained=await acquireNflObservations({...input,fetchFumbles:async()=>{throw Error('missing')}});assert.equal(retained[0].stats.fumblesLost,1);
  assert.equal(retained[0].provenance.fumbleSummarySourceUrl,null);
  const issues=[];const rows=await acquireNflObservations({...input,fetchFumbles:async()=>normalizeEspnNflEventFumbles(mahomesSummary,{eventId:qb.eventId,fetchedAt}),onIncomplete:x=>issues.push(x)});
  assert.deepEqual(rows,[]);assert.equal(issues[0].reason,'fumbles_lost_conflicting');
});
test('nonfinal, wrong-season, malformed or conflicting zero evidence cannot become an absent QB zero', async () => {
  const qb=normalizeEspnNflGameLog(mahomesLog,{espnPlayerId:'3139477',season:2026,position:'QB',fetchedAt}).observations[0];
  for(const alter of [p=>{p.header.competitions[0].status.type={state:'in',completed:false}},p=>{p.header.season.year=2025},
    p=>{p.boxscore.teams.find(t=>t.team.id==='12').statistics.find(s=>s.name==='fumblesLost').displayValue='--'},
    p=>{p.boxscore.teams.find(t=>t.team.id==='12').statistics.push({name:'fumblesLost',displayValue:'1',value:1})}]) {
    const p=structuredClone(mahomesSummary);alter(p);const summary=normalizeEspnNflEventFumbles(p,{eventId:qb.eventId,fetchedAt});const issues=[];
    const rows=await acquireNflObservations({eligible:[{localPlayerId:435,providerPlayerId:qb.providerPlayerId,position:'QB'}],season:2026,
      finalEvents:[{providerEventId:qb.eventId,season:2026,phase:'regular',completed:true}],gameLogs:[qb],fetchFumbles:async()=>summary,onIncomplete:x=>issues.push(x)});
    assert.equal(rows.length,0);assert.equal(issues.length,1);
  }
});
test('an explicit athlete positive contradicting final team zero is unknown in both acquisition and Player Center',()=>{
  const p=structuredClone(mahomesSummary),team=p.boxscore.players.find(t=>t.team.id==='12'),group=team.statistics.find(g=>g.name==='fumbles');
  group.athletes=[{athlete:{id:'3139477'},stats:group.labels.map(l=>l==='FUM'||l==='LOST'?'1':'0')}];group.totals=[];
  const research=normalizeEspnNflEventFumbles(p,{eventId:'401872945',fetchedAt});
  assert.ok(research.conflictedPlayerIds.includes('3139477'));assert.ok(!research.athletes.some(a=>a.providerPlayerId==='3139477'));
  const game=normalizeCenterLog(mahomesLog,{sport:'nfl',providerPlayerId:'3139477',season:2026,phase:'regular',fetchedAt}).games[0];
  const result=enrichNflGame(game,normalizeCenterNflSummary(p,game.eventId),'https://espn.test/summary');
  assert.equal(result.stats.fumbles_lost,null);assert.ok(result.issues.includes('conflicting_log_summary_stat:fumbles_lost'));
});
test('an unavailable summary cell preserves an explicit log zero instead of erasing the fact',()=>{
  const raw=require('./fixtures/player-center/nfl-log-4373626-401872991.json'),p=structuredClone(require('./fixtures/player-center/nfl-summary-401872991.json'));
  const game=normalizeCenterLog(raw,{sport:'nfl',providerPlayerId:'4373626',season:2026,phase:'regular',fetchedAt}).games[0];
  const group=p.boxscore.players.find(t=>t.team.id===game.teamId).statistics.find(g=>g.name==='fumbles');
  group.athletes=[{athlete:{id:game.providerPlayerId},stats:group.labels.map(l=>l==='LOST'?'--':'0')}];
  const enriched=enrichNflGame(game,normalizeCenterNflSummary(p,game.eventId),'https://espn.test/summary');
  assert.equal(game.stats.fumbles_lost,0);assert.equal(enriched.stats.fumbles_lost,0);
});
test('existing lifetime NFL hashes still suppress an A-to-B-to-A reversal: preserved known limitation, not a repair',async()=>{
  const log=negativeRow();log.stats.rushingYards=1;const a=build(log),b={...a,stats:{...a.stats,rushingYards:2}};
  const stored=[],hashes=new Set(),repo={loadEligiblePlayers:async()=>[{localPlayerId:1,providerPlayerId:a.providerPlayerId,position:'RB'}],
    existingHashes:async incoming=>new Set(incoming.filter(h=>hashes.has(h))),insertVersions:async rows=>rows.forEach(r=>{stored.push(r);hashes.add(r.observation_hash)})};
  await persistNflObservationBatch({observations:[a],repository:repo});await persistNflObservationBatch({observations:[b],repository:repo});
  const receipt=await persistNflObservationBatch({observations:[{...a,provenance:{...a.provenance,knownAt:'2026-11-03T18:42:00Z'}}],repository:repo});
  assert.equal(receipt.duplicate,1);assert.equal(stored.length,2);assert.equal(stored.at(-1).rushing_yards,2);
});
