const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
function load(file, mocks = {}) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(id => {
    if (id in mocks) return mocks[id];
    throw Error(`Unexpected import ${id}`);
  }, exports);
  return exports;
}
const rules = load('lib/rules/leagueRules.ts');
const model = load('lib/lineups/draftHistory.ts');
const db = { rpc: async () => ({ data: null, error: null }) };
const server = load('lib/lineups/draftHistory.server.ts', { '@/lib/supabaseAdmin': { supabaseAdmin: db }, '@/lib/rules/leagueRules': rules, './draftHistory': model });
const migration = fs.readFileSync('supabase/migrations/20260912000100_fantasy_draft_history.sql', 'utf8');
const backfill = fs.readFileSync('supabase/manual/20260912_nfl_week1_draft_backfill.sql', 'utf8');
const verified = require('../docs/nfl-week1-draft-verification.json');

test('generic snake walks every configured round for 2, 3, 4, 5 and 7 participants', () => {
  for (const n of [2,3,4,5,7]) for (const size of [1,3,6,9]) {
    const ids = Array.from({length:n}, (_,i) => 100+i), counts = {};
    const expected = Array.from({length:size}, (_,round) => round % 2 ? [...ids].reverse() : ids).flat();
    for (let i=0;i<expected.length;i++) {
      const turn = model.getDraftTurn(ids,size,i,counts);
      assert.equal(turn.overallPick,i+1); assert.equal(turn.round,Math.floor(i/n)+1);
      assert.equal(turn.pickInRound,i%n+1); assert.equal(turn.teamId,expected[i]);
      counts[turn.teamId]=(counts[turn.teamId]??0)+1;
    }
    assert.deepEqual(model.getDraftTurn(ids,size,expected.length,counts),{state:'complete'});
  }
});
test('corrections never rewind chronology or manufacture a pick after completion', () => {
  assert.deepEqual(model.getDraftTurn([2,1,4,3],6,24,{2:6,1:6,4:6,3:6}),{state:'complete'});
  assert.deepEqual(model.getDraftTurn([2,1,4,3],6,24,{2:5,1:6,4:6,3:6}),{state:'needs_review'});
  assert.deepEqual(model.getDraftTurn([1,2],3,2,{1:0,2:1}),{state:'needs_review'});
  assert.deepEqual(model.getDraftTurn([],6,0,{}),{state:'needs_review'});
});
test('NBA and NFL custom slots preserve explicit assignments and reject occupied/ineligible slots', () => {
  const nba=rules.getRosterSlotsFromRulesSnapshot({roster:{slots:[{position:'G',slotCount:1},{position:'F/C',slotCount:0},{position:'UTIL',slotCount:1}]}},'nba');
  const result=server.buildDraftAssignments('nba',[{id:1,position:'G'},{id:2,position:'G'}],nba,[{player_id:1,roster_slot_position:'UTIL',roster_slot_index:0}],{playerId:2,position:'G',slotIndex:0});
  assert.equal(result.find(x=>x.player_id===1).position,'UTIL');
  assert.throws(()=>server.buildDraftAssignments('nba',[{id:1,position:'G'},{id:2,position:'F/C'}],nba,[{player_id:1,roster_slot_position:'UTIL',roster_slot_index:0}],{playerId:2,position:'UTIL',slotIndex:0}),/occupied/);
  const nfl=rules.getRosterSlotsFromRulesSnapshot({roster:{slots:[{position:'QB',slotCount:0},{position:'RB',slotCount:0},{position:'WR',slotCount:0},{position:'TE',slotCount:0},{position:'K',slotCount:1},{position:'SF',slotCount:1},{position:'D\/ST',slotCount:1}]}},'nfl');
  assert.equal(server.buildDraftAssignments('nfl',[{id:1,position:'QB'},{id:2,position:'K'},{id:3,position:'D/ST'}],nfl,[]).length,3);
  assert.throws(()=>server.buildDraftAssignments('nfl',[{id:1,position:'WR'}],nfl,[],{playerId:1,position:'K',slotIndex:0}),/invalid/);
});
test('history read sends full scope; unavailable migration is explicit and never falls back to inferred chronology', async () => {
  const calls=[];
  db.rpc=async (name,args)=>{calls.push([name,args]);return {error:{code:'PGRST202'}}};
  assert.equal((await server.readDraftHistory(179,'a','league','nfl')).available,false);
  assert.deepEqual(calls[0],['read_fantasy_draft',{p_slate_id:179,p_group_id:'a',p_league_id:'league',p_sport:'nfl'}]);
  db.rpc=async()=>({data:{initialized:false,rules_snapshot:null,participant_ids:[1],roster_counts:{1:2},picks:[],corrections:[]},error:null});
  assert.equal((await server.readDraftHistory(1,'b','nba-league','nba')).turn.state,'needs_review');
  db.rpc=async()=>({error:{code:'42501',message:'Denied'}});
  await assert.rejects(server.readDraftHistory(1,'a','league','nba'),/Denied/);
});
test('verified Week 1 has exact canonical IDs, ownership, six rounds and no inferred actor/time', () => {
  const names=['Jahmyr Gibbs','Josh Allen','Christian McCaffrey','Bijan Robinson','Puka Nacua','Kyle Pitts Sr.',"Ja'Marr Chase",'Jonathan Taylor','Jaxon Smith-Njigba','Amon-Ra St. Brown','Saquon Barkley','James Cook III','CeeDee Lamb','Justin Jefferson',"De'Von Achane",'Nico Collins','Trey McBride','Chase Brown','Lamar Jackson','Jalen Hurts','Colston Loveland','Chris Olave','Tyler Warren','Bo Nix'];
  assert.deepEqual(verified.picks.map(p=>p.name),names);
  assert.deepEqual(verified.picks.map(p=>p.id),[283,80,774,44,518,43,169,385,809,300,701,85,232,569,532,335,18,166,66,711,151,635,388,270]);
  const ids=verified.participants.map(p=>p.team_id),counts={};
  for (const pick of verified.picks) {
    const turn=model.getDraftTurn(ids,6,pick.overall_pick-1,counts);
    assert.equal(turn.teamId,pick.team_id); assert.equal(turn.round,pick.round_number); assert.equal(turn.pickInRound,pick.pick_in_round);
    counts[pick.team_id]=(counts[pick.team_id]??0)+1;
    assert.ok(pick.nfl_player_id>0); assert.equal(pick.assignment.player_id,pick.id);
    assert.equal(pick.actor_user_id,undefined); assert.equal(pick.occurred_at,undefined);
  }
  assert.deepEqual(model.getDraftTurn(ids,6,24,counts),{state:'complete'});
  const input=backfill.split('insert into verified_week1_picks values\n')[1].split(';')[0];
  const rows=[...input.matchAll(/\((\d+), (\d+), (\d+), (\d+),/g)].map(m=>m.slice(1).map(Number));
  assert.equal(rows.length,24);
  assert.deepEqual(rows,verified.picks.map(p=>[p.overall_pick,p.id,p.nfl_player_id,p.team_id]));
  assert.deepEqual(rows[5],[6,43,4360248,4]);
  assert.equal(verified.picks[5].lineup_id,1064);
  assert.deepEqual(verified.picks[5].assignment,{id:3936,player_id:43,roster_slot_index:0,roster_slot_position:'TE'});
  assert.match(backfill,/\(6, 43, 4360248, 4, 1064, 'TE', 0\)/);
  assert.doesNotMatch(backfill,/Brock Bowers|4432665|\(6, 452,/);
  assert.doesNotMatch(backfill,/insert\s+into\s+(?:public\.)?draft_corrections/i);
  assert.match(backfill,/l\.id=v\.lineup_id and l\.team_id=v\.team_id and lp\.player_id=v\.player_id/);
  assert.match(backfill,/lp\.roster_slot_position=v\.slot_position and lp\.roster_slot_index=v\.slot_index/);
  assert.equal(verified.picks[22].name,'Tyler Warren');
  assert.equal(verified.picks[23].name,'Bo Nix');
  assert.match(backfill,/null,null,null,'verified_backfill'/);
  assert.match(backfill,/History already exists; STOP/);
  for (const field of ['rules_snapshot','rules_version','group_memberships','roster_slot_position','nfl_player_id','participant_ids','lineup_id']) assert.ok(backfill.includes(field));
  assert.ok(backfill.includes(verified.group_id)); assert.ok(backfill.includes(verified.slate.league_id));
});
// Static SQL contract checks, NOT a substitute for running two real PostgreSQL
// transactions after manual migration approval. No test in this file writes DB data.
test('SQL contract: serialized cursor, duplicate constraints, atomic roster/history and immutable audit', () => {
  assert.match(migration,/from slates where id=p_slate_id for update/);
  assert.match(migration,/coalesce\(max\(overall_pick\),0\)\+1/);
  assert.match(migration,/unique \(slate_id, overall_pick\)/);
  assert.match(migration,/draft_picks_active_player.*where status = 'active'/);
  assert.match(migration,/old_ids is distinct from expected_ids/);
  assert.match(migration,/expected_team<>p_team_id/);
  assert.match(migration,/Player is already rostered in this slate/);
  assert.match(migration,/insert into lineup_players/); assert.match(migration,/insert into draft_picks/);
  assert.match(migration,/Draft history\/configuration is immutable/);
  assert.match(migration,/insert into draft_corrections/);
  assert.doesNotMatch(migration,/delete from draft_picks|update draft_picks set overall_pick/i);
  assert.match(migration,/actor_user_id,actor_name,is_proxy,source/);
  assert.match(migration,/receiver.user_id is distinct from p_actor_id/);
  assert.match(migration,/revoke all on public.fantasy_drafts/);
  assert.match(migration,/grant execute on function.*to service_role/);
  assert.match(migration,/Use the authoritative fantasy draft\/correction API/);
  assert.doesNotMatch(migration,/create policy/i);
});

function routeFixture({role='player', commissioner=false, rpcError=null, sport='nfl'}={}) {
  const calls=[],notifications=[];
  const slate={id:1,date:'2026-09-09',sport,league_id:'l',is_locked:false};
  const rows={slates:slate,teams:{id:1,name:'Owner'},players_nfl:[{id:10,name:'Player',position:'QB',is_active:true}],players:[{id:10,name:'Player',position_group:'G',is_active:true}],lineups:null};
  const database={from(table){const q={select(){return q},eq(){return q},in(){return q},single(){return q},maybeSingle(){return q},then(resolve){resolve({data:rows[table],error:null})}};return q}};
  const route=load('app/api/lineups/route.ts',{
    'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}},
    '@/lib/supabaseAdmin':{supabaseAdmin:database},'@/lib/auth':{getCurrentUser:async()=>({id:'actor',role})},
    '@/lib/groups/context':{getActiveSlateAccessForUser:async()=>({context:{group:{id:'g'},team:{id:1},canAdministerGroup:commissioner},league:{id:'l'},slate:{rulesSnapshot:null}}),teamBelongsToGroup:async()=>true},
    '@/lib/lineups/draftPermissions':load('lib/lineups/draftPermissions.ts'),
    '@/lib/rules/leagueRules':rules,'@/lib/playerProjections':{getPlayerProjectionsForSeason:async()=>({projections:{}})},
    '@/lib/draftNotifications':{notifyNextDrafter:async(...args)=>{notifications.push(args)}},
    '@/lib/lineups/draftHistory.server':{isMissingDraftInfrastructure:server.isMissingDraftInfrastructure,mutateFantasyDraft:async input=>{calls.push(input);return {data:{lineupId:1,isPick:true,overallPick:7},error:rpcError}}},
  });
  return {calls,notifications,post:(extra={})=>route.POST({json:async()=>({slateId:1,teamId:1,playerIds:[10],expectedPlayerIds:[],overallPick:999,isProxy:false,actorId:'forged',...extra})})};
}
for (const sport of ['nba','nfl']) test(`${sport}: successful self pick uses one RPC with session actor, ignores forged chronology, and notifies committed pick`,async()=>{
  const f=routeFixture({sport});const result=await f.post();assert.equal(result.status,200);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].actorId,'actor');assert.equal(f.calls[0].teamId,1);
  assert.equal(f.calls[0].overallPick,undefined);assert.equal(f.calls[0].sport,sport);assert.equal(result.body.overallPick,7);
  assert.deepEqual(f.notifications,[[1,7]]);
});
test('proxy uses authorized receiver and actual session actor; ordinary members stop before RPC',async()=>{
  const denied=routeFixture();assert.equal((await denied.post({teamId:2})).status,403);assert.equal(denied.calls.length,0);
  for(const flags of [{commissioner:true},{role:'admin'}]){
    const f=routeFixture(flags);assert.equal((await f.post({teamId:2,notifyNextDrafter:true})).status,200);
    assert.equal(f.calls[0].teamId,2);assert.equal(f.calls[0].actorId,'actor');
  }
  const muted=routeFixture({role:'admin'});await muted.post({teamId:2,notifyNextDrafter:false});assert.equal(muted.notifications.length,0);
});
test('rejected stale/duplicate RPC picks send no notification; missing infrastructure blocks writes explicitly',async()=>{
  for(const message of ['Roster changed','Player is already rostered','It is another participant\'s turn']){
    const f=routeFixture({rpcError:{code:'P0001',message}});assert.equal((await f.post()).status,409);assert.equal(f.notifications.length,0);
  }
  const missing=routeFixture({rpcError:{code:'PGRST202'}});assert.equal((await missing.post()).status,503);
  const staleApp=routeFixture();assert.equal((await staleApp.post({expectedPlayerIds:undefined})).status,409);assert.equal(staleApp.calls.length,0);
});

test('commissioner add/remove/replace uses audited RPC; unauthorized corrections stop before DB access',async()=>{
  for(const action of ['add','remove','replace','denied']){
    const writes=[],recomputes=[];let reads=0;
    const db={from(table){reads++;const q={select(){return q},eq(){return q},maybeSingle(){return q},then(resolve){resolve({data:table==='lineups'?{id:20,lineup_players:[{player_id:10}]}:{id:11},error:null})}};return q}};
    const route=load('app/api/admin/lineup-correction/route.ts',{
      'next/server':{NextResponse:{json:(body,options)=>({body,status:options?.status??200})}},
      '@/lib/supabaseAdmin':{supabaseAdmin:db},
      '@/lib/security/resourceAuthorization':{authorizeSlateResource:async(_r,_id,options)=>{
        assert.equal(options.requireCommissioner,true);
        return action==='denied'?{ok:false,response:{status:404}}:{ok:true,user:{id:'commissioner'},target:{groupId:'a',leagueId:'nfl-a',sportKey:'nfl'}};
      }},
      '@/lib/corrections/recomputeSlateResults':{recomputeCorrectedSlateResults:async(...args)=>recomputes.push(args)},
      '@/lib/lineups/draftHistory.server':{isMissingDraftInfrastructure:server.isMissingDraftInfrastructure,mutateFantasyDraft:async input=>{writes.push(input);return {error:null}}},
    });
    const result=await route.POST({json:async()=>({slateId:1,teamId:2,action,oldPlayerId:10,newPlayerId:action==='remove'?null:11})});
    if(action==='denied'){assert.equal(result.status,404);assert.equal(reads,0);continue;}
    assert.equal(result.status,200);assert.equal(writes.length,1);assert.equal(writes[0].correction,true);
    assert.equal(writes[0].actorId,'commissioner');assert.equal(writes[0].teamId,2);assert.deepEqual(writes[0].expectedIds,[10]);
    assert.deepEqual(writes[0].desiredIds,action==='add'?[10,11]:action==='remove'?[]:[11]);
    assert.deepEqual(recomputes,[[1,'nfl']]);
  }
});
