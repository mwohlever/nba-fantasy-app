/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
require('../scripts/lib/playerCenterRollout.cjs').registerTypescript();
const {resolveRosterAt,resolveHistoricalGameTeam,planSlateEligibility}=require('../lib/rosters/planning.ts');
const {planNbaRosterReconciliation}=require('../lib/rosters/nbaReconciliation.ts');
const {main:planCommand}=require('../scripts/plan-nba-roster-reconciliation.cjs');
const {normalizeCenterLog}=require('../lib/player-center/espn.ts');
const {presentProfile}=require('../lib/player-center/presentation.ts');
const player={sport:'nba',playerId:4,kind:'athlete'},teamA={provider:'espn',id:'1',abbreviation:'A'},teamB={provider:'espn',id:'2',abbreviation:'B'};
const at='2026-11-03T12:00:00Z',through='2026-11-10T12:00:00Z';
function interval(overrides={}){return {...player,evidenceId:'one',season:2027,type:'interval',effectiveFrom:'2026-10-01T00:00:00Z',effectiveTo:null,
  observedAt:through,verifiedThrough:through,confidence:'confirmed',status:'rostered',team:teamA,position:'G',sources:['https://provider.test/transaction'],...overrides};}
const slate={slateId:10,groupId:'group-a',leagueId:'league-a',sport:'nba',season:2027,eligibilityAt:at,evidenceAsOf:through,locked:false};
test('a same-season trade preserves one permanent player and resolves half-open team intervals',()=>{
  const boundary='2026-11-01T00:00:00Z',e=[interval({effectiveTo:boundary}),interval({evidenceId:'two',effectiveFrom:boundary,team:teamB})];
  assert.equal(resolveRosterAt(player,2027,'2026-10-31T23:59:59Z',e).team.id,'1');
  assert.equal(resolveRosterAt(player,2027,boundary,e).team.id,'2');
  assert.equal(resolveRosterAt(player,2027,at,e).team.id,'2');
  assert.equal(new Set(e.map(r=>r.playerId)).size,1);
});
test('release and later re-signing retain an explicit unrostered gap',()=>{
  const release='2026-11-01T00:00:00Z',signed='2026-11-05T00:00:00Z';
  const e=[interval({effectiveTo:release}),interval({evidenceId:'released',effectiveFrom:release,effectiveTo:signed,status:'unrostered',team:null}),
    interval({evidenceId:'resigned',effectiveFrom:signed,team:teamB})];
  assert.equal(resolveRosterAt(player,2027,at,e).state,'unrostered');
  assert.equal(resolveRosterAt(player,2027,signed,e).team.id,'2');
  assert.equal(planSlateEligibility(slate,[player],e,[teamA,teamB],['G']).players.length,0);
});
test('between-season team changes never use the current team for a previous season',()=>{
  const e=[interval({season:2026,effectiveFrom:'2025-10-01T00:00:00Z',observedAt:'2026-06-01T00:00:00Z',verifiedThrough:'2026-06-01T00:00:00Z'}),interval({evidenceId:'new-season',team:teamB})];
  assert.equal(resolveRosterAt(player,2026,'2026-01-01T00:00:00Z',e).team.id,'1');
  assert.equal(resolveRosterAt(player,2027,at,e).team.id,'2');
  assert.equal(resolveRosterAt(player,2025,at,e).state,'unknown');
});
test('rostered zero appearances and historical-only players are independent of observations/current flags',()=>{
  const rostered=interval();assert.equal(planSlateEligibility(slate,[player],[rostered],[teamA],['G']).players[0].playerId,4);
  const historical=interval({season:2026,effectiveFrom:'2025-10-01T00:00:00Z'});
  assert.equal(resolveRosterAt(player,2027,at,[historical]).state,'unknown');
  const result=planSlateEligibility(slate,[player],[historical],[teamA],['G']);assert.equal(result.state,'requires_review');assert.deepEqual(result.unresolved,[4]);
});
test('historical locked eligibility is scoped, copied, and unchanged after a transaction/current pool change',()=>{
  const frozen={...slate,capturedAt:through,players:[{...player,position:'G',team:teamA,onSlate:true}]};delete frozen.locked;
  const before=JSON.stringify(frozen),changed=interval({team:teamB,position:'F/C'});
  const result=planSlateEligibility({...slate,locked:true},[],[changed],[teamB],['F/C'],frozen);
  assert.equal(result.state,'frozen');assert.deepEqual(result.players,[{...player,position:'G',team:teamA,onSlate:true}]);
  result.players[0].team.id='99';assert.equal(JSON.stringify(frozen),before);
  for(const override of [{groupId:'other'},{leagueId:'other'},{season:2026},{slateId:11},{sport:'nfl'}])
    assert.throws(()=>planSlateEligibility({...slate,...override},[],[],[],['G'],frozen),/scope\/cutoff mismatch/);
});
test('a locked legacy slate without a snapshot requires review rather than silently deriving a replacement pool',()=>{
  const result=planSlateEligibility({...slate,locked:true},[player],[interval()],[teamA],['G']);
  assert.equal(result.state,'requires_review');assert.deepEqual(result.players,[]);assert.match(result.issues[0],/legacy_locked/);
});
test('later-acquired roster evidence cannot authorize an earlier draft knowledge cutoff',()=>{
  const result=planSlateEligibility({...slate,evidenceAsOf:at},[player],[interval()],[teamA],['G']);
  assert.equal(result.state,'requires_review');assert.deepEqual(result.unresolved,[4]);
});
test('On Slate uses namespaced teams and canonical position eligibility in the proposed pool',()=>{
  assert.equal(planSlateEligibility(slate,[player],[interval()],[teamA],['UTIL']).players.length,1);
  const offSlate=planSlateEligibility(slate,[player],[interval()],[teamB],['G']);assert.equal(offSlate.players.length,1);assert.equal(offSlate.players[0].onSlate,false);
  assert.equal(planSlateEligibility(slate,[player],[interval()],[{...teamA,provider:'nba'}],['G']).players[0].onSlate,false);
  assert.equal(planSlateEligibility(slate,[player],[interval()],[teamA],['F/C']).players.length,0);
});
test('unknown transaction times remain point observations; conflicting or future evidence is unresolved',()=>{
  const snapshot=interval({type:'snapshot',effectiveFrom:null,observedAt:at,verifiedThrough:at});
  assert.equal(resolveRosterAt(player,2027,at,[snapshot]).state,'rostered');
  assert.equal(resolveRosterAt(player,2027,'2026-11-02T12:00:00Z',[snapshot]).state,'unknown');
  assert.equal(resolveRosterAt(player,2027,'2026-11-04T12:00:00Z',[snapshot]).state,'unknown');
  assert.equal(resolveRosterAt(player,2027,at,[{...snapshot,confidence:'uncertain'}]).state,'unknown');
  assert.equal(resolveRosterAt(player,2027,at,[interval(),interval({evidenceId:'conflict',team:teamB})]).state,'conflict');
  assert.equal(resolveRosterAt(player,2027,'2026-11-11T12:00:00Z',[interval()]).state,'unknown');
});
test('game evidence preserves pre/post-trade teams; conflicts stay unresolved and no current-catalog fallback exists',()=>{
  const game=(eventId,gameAt,team)=>({...player,season:2027,eventId,gameAt,team,source:'https://espn.test/game'});
  const old=game('10','2026-10-25T12:00:00Z',teamA),recent=game('11',at,teamB);
  assert.equal(resolveHistoricalGameTeam(player,2027,'10',old.gameAt,[old,recent],[interval({team:teamB})]).team.id,'1');
  assert.equal(resolveHistoricalGameTeam(player,2027,'11',at,[old,recent]).team.id,'2');
  assert.equal(resolveHistoricalGameTeam(player,2027,'10',old.gameAt,[old,{...old,team:teamB}]).source,'unresolved');
  assert.equal(resolveHistoricalGameTeam(player,2027,'12',at,[]).team,null);
  assert.equal(resolveHistoricalGameTeam(player,2027,'12',at,[],[interval()]).source,'interval');
});
test('existing Player Center normalized logs/presentation retain each game team across a trade',()=>{
  const raw=structuredClone(require('./fixtures/player-center/nba-current-log.json'));
  const eventIds=raw.seasonTypes.find(t=>t.displayName==='2026-27 Regular Season').categories.flatMap(c=>c.events||[]).map(e=>e.eventId);
  assert.ok(eventIds.length>=2);
  raw.events[eventIds[0]].team={id:'1',abbreviation:'OLD'};raw.events[eventIds[1]].team={id:'2',abbreviation:'NEW'};
  const parsed=normalizeCenterLog(raw,{sport:'nba',providerPlayerId:'1966',season:2027,phase:'regular',fetchedAt:through});
  const profile=presentProfile({player:{sport:'nba',playerId:6,name:'LeBron James',position:'F/C',active:true,nativePlayerId:'2544',providerPlayerId:'1966',identity:'resolved'},
    season:2027,phase:'regular',source:'provider',games:parsed.games,coverage:{kind:'appearance_log',expectedGames:2,fetchedAt:through,freshness:'fresh',issues:[]},
    seasonStats:null,providerRequests:0},{sport:'nba',settings:null,basis:'legacy_defaults'},through);
  assert.equal(profile.games.find(g=>g.eventId===eventIds[0]).team,'OLD');assert.equal(profile.games.find(g=>g.eventId===eventIds[1]).team,'NEW');
});
test('NFL D/ST remains a distinct team entity; kicker slot eligibility does not invent fantasy scoring',()=>{
  const dst={sport:'nfl',playerId:50,kind:'team_defense'},k={sport:'nfl',playerId:51,kind:'athlete'};
  const e=[interval({...dst,evidenceId:'dst',season:2026,position:'D/ST'}),interval({...k,evidenceId:'k',season:2026,position:'K'})];
  const result=planSlateEligibility({...slate,sport:'nfl',season:2026},[dst,k],e,[teamA],['D/ST','K']);assert.equal(result.players.length,2);
  assert.throws(()=>resolveRosterAt({...dst,sport:'nba'},2027,at,[]),/permanent player/);
  assert.throws(()=>resolveRosterAt(dst,2026,at,[{...e[0],kind:'athlete'}]),/D\/ST/);
});

const snapshot=require('./fixtures/factual-pipeline/nba-roster-audit-20261103.json');
test('dated audit reconciliation reproduces all five headline deltas without applying changes',()=>{
  const before=JSON.stringify(snapshot),plan=planNbaRosterReconciliation(snapshot);
  assert.deepEqual(Object.fromEntries(['rosterAdditions','newNativeIdentities','inactiveExistingIdentities','rosterAbsences','teamDifferences','unresolvedActiveMappings'].map(k=>[k,plan.summary[k]])),
    {rosterAdditions:82,newNativeIdentities:76,inactiveExistingIdentities:6,rosterAbsences:89,teamDifferences:112,unresolvedActiveMappings:163});
  assert.equal(plan.databaseWrites,0);assert.equal(plan.changesApplied,0);assert.equal(plan.liveDraftEligibilityChanged,false);assert.equal(JSON.stringify(snapshot),before);
  assert.ok(plan.additions.every(p=>p.effectiveAt===null));assert.ok(plan.removals.every(p=>p.effectiveAt===null&&!p.deactivatePlayer));
  assert.ok(plan.teamChanges.every(p=>p.effectiveAt===null&&p.transactionType==='unknown'));
  assert.ok(plan.noCurrentSeasonObservations.every(p=>p.verifiedGamesPlayed===null));
  assert.equal(plan.preservation.allExistingPlayerIds.length,595);assert.ok(plan.historicalOnly.length>0);
});
test('reconciliation fails closed on incomplete rosters or native-ID collisions; ambiguous names never authorize a merge',()=>{
  assert.throws(()=>planNbaRosterReconciliation({...snapshot,completeEspnTeams:29}),/Complete/);
  assert.throws(()=>planNbaRosterReconciliation({...snapshot,players:[...snapshot.players,{...snapshot.players[0],id:9999}]}),/Duplicate catalog native/);
  const p=structuredClone(snapshot),native=p.native.find(n=>!p.players.some(c=>c.nba_player_id===n.nbaPlayerId));
  p.players[0].name=native.name;const plan=planNbaRosterReconciliation(p);const addition=plan.additions.find(a=>a.nativePlayerId===native.nbaPlayerId);
  assert.equal(addition.existingPlayerId,null);assert.equal(addition.identity.state,'uncertain');assert.equal(addition.identity.providerCandidate,null);
});
test('offline reconciliation CLI refuses overwrite/apply flags and reproduces a deterministic plan',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'111-roster-plan-test-'));
  try{const input=path.resolve('tests/fixtures/factual-pipeline/nba-roster-audit-20261103.json'),output=path.join(dir,'review.json');
    const first=planCommand([input,output]);assert.equal(first.databaseWrites,0);assert.throws(()=>planCommand([input,output]),/already exists/);
    const second=planCommand([input,path.join(dir,'second.json')]);assert.deepEqual(first,second);
    assert.throws(()=>planCommand(['--apply',output]),/Usage/);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
