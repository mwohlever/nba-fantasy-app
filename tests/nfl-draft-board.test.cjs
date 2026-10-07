const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const ts=require('typescript');
const {nodes}=require('./helpers/scores-harness.cjs');
const fixture=require('./helpers/nfl-draft-board-fixture.cjs');
const model=require('../lib/lineups/draftHistory.ts');
const DraftOrder=require('../components/lineups/DraftOrder.tsx').default;
const rows=tree=>nodes(tree).filter(n=>n.type==='tr'&&n.props['data-draft-slot']);
const text=tree=>JSON.stringify(tree);
function render(history=fixture.history(),extra={}) {return DraftOrder({history,teams:fixture.teams,showCompleteBoard:true,...extra});}
test('NFL shows all 21 predetermined slots before any pick, in exact seven-round snake order',()=>{
  const tree=render(fixture.history(0,false));
  assert.equal(rows(tree).length,21);
  assert.deepEqual(model.buildDraftBoard(fixture.history(0).board,[]).map(r=>r.teamId),[2,4,1,1,4,2,2,4,1,1,4,2,2,4,1,1,4,2,2,4,1]);
  assert.equal(rows(tree)[0].props['data-draft-state'],'current');
  assert.equal(rows(tree).filter(r=>r.props['data-draft-state']==='future').length,20);
});
test('board sizes generalize independently of six/seven rounds and historical row order',()=>{
  for(const n of [1,2,3,4,5,7])for(const rosterSize of [1,3,6,7,9]){
    const participantIds=Array.from({length:n},(_,i)=>i+1);
    const board=model.buildDraftBoard({participantIds,rosterSize},[]);
    assert.equal(board.length,n*rosterSize);
    for(let r=0;r<rosterSize;r++)assert.deepEqual(board.slice(r*n,(r+1)*n).map(x=>x.teamId),r%2?[...participantIds].reverse():participantIds);
  }
  const h=fixture.history();const shuffled=[...h.picks].reverse();
  assert.deepEqual(model.buildDraftBoard(h.board,shuffled).map(r=>r.pick?.overall_pick),Array.from({length:21},(_,i)=>i<20?i+1:undefined));
});
test('normal/completed metadata and original corrected #17 stay on their numbered rows; standalone replacement stays in audit',()=>{
  const h=fixture.history(),tree=render(h),board=rows(tree);
  assert.match(text(board[17]),/Chase Brown/); assert.match(text(board[19]),/Matthew Stafford/);
  assert.match(text(board[0]),/Proxy/);
  assert.equal(board[16].props['data-draft-state'],'corrected');
  assert.match(text(board[16]),/Removed/);assert.match(text(board[16]),/Corrected \/ reversed/);assert.match(text(board[16]),/Originally /);assert.match(text(board[16]),/Nico Collins/);
  assert.doesNotMatch(text(board[16]),/Replacement receiver/);
  assert.match(text(tree),/Roster adjustment/);assert.match(text(tree),/Replacement receiver/);
  assert.deepEqual(h,fixture.history(),'render must not mutate history');
});
test('only the legitimate current row has one action, gated by existing commissioner/normal-player permission',()=>{
  for(const label of ['Make Pick for Andy','Make My Pick',undefined]) {
    let calls=0;const tree=render(fixture.history(),{actionLabel:label,onMakePick:()=>calls++});
    const current=rows(tree)[20];assert.equal(current.props['aria-current'],'step');assert.match(text(current),/Current pick/);
    const buttons=nodes(tree).filter(n=>n.type==='button');assert.equal(buttons.length,label?1:0);
    for(const row of rows(tree).filter(r=>r.props['data-draft-state']==='future'))assert.equal(nodes(row).filter(n=>n.type==='button').length,0);
    if(label){assert.ok(nodes(current).includes(buttons[0]));buttons[0].props.onClick();assert.equal(calls,1);}
  }
  for(const state of ['closed','needs_review','complete']) {
    const h=fixture.history();h.turn={...h.turn,state};assert.equal(nodes(render(h,{actionLabel:'Make Pick for Andy',onMakePick(){}})).filter(n=>n.type==='button').length,0);
  }
});
test('ordinary current picks populate the same row, advance the authoritative cursor, and final #21 completes the board',()=>{
  const counts={};const ids=[2,4,1];
  for(let last=0;last<=21;last++){
    const h=fixture.history(last,false);h.turn=model.getDraftTurn(ids,7,last,counts);
    const tree=render(h);
    assert.equal(rows(tree).length,21);
    assert.equal(rows(tree).filter(r=>r.props['data-draft-state']==='completed').length,last);
    if(last===21){assert.match(text(tree),/Draft complete/);assert.equal(rows(tree).filter(r=>r.props['aria-current']).length,0);}
    else{assert.equal(rows(tree)[last].props['data-draft-state'],'current');assert.equal(h.turn.overallPick,last+1);counts[h.turn.teamId]=(counts[h.turn.teamId]??0)+1;}
  }
});
test('ambiguous configuration/history falls back without hiding or rewriting historical records; NBA remains unchanged',()=>{
  const h=fixture.history();
  for(const config of [{participantIds:[2,2],rosterSize:7},{participantIds:[],rosterSize:7},{participantIds:[2,4,1],rosterSize:0}]) assert.equal(model.buildDraftBoard(config,h.picks),null);
  for(const picks of [[...h.picks,h.picks[0]],h.picks.slice(1),[{...h.picks[0],team_id:999}]])assert.equal(model.buildDraftBoard(h.board,picks),null);
  const legacy={...h,board:undefined};assert.equal(rows(render(legacy)).length,0);assert.match(text(render(legacy)),/Nico Collins/);
  const nba=DraftOrder({history:h,teams:fixture.teams});assert.equal(rows(nba).length,0);assert.equal(nodes(nba).filter(n=>n.type==='tr').length,21);
  assert.equal(nodes(DraftOrder({history:fixture.history(0,false),teams:fixture.teams})).filter(n=>n.type==='table').length,0);
});
test('history reader exposes frozen NFL order/roster size, including pre-pick config; omits unsupported/legacy and NBA boards',async()=>{
  const rules=require('../lib/rules/leagueRules.ts');let data;
  const exports={};new Function('require','exports',ts.transpileModule(fs.readFileSync('lib/lineups/draftHistory.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>({
    '@/lib/supabaseAdmin':{supabaseAdmin:{rpc:async()=>({data,error:null})}},'@/lib/rules/leagueRules':rules,'./draftHistory':model,
  })[name],exports);
  const read=sport=>exports.readDraftHistory(193,'group','league',sport);
  data={initialized:true,participant_ids:[2,4,1],roster_slots:[{slot_count:7}],rules_snapshot:fixture.snapshot,roster_counts:{2:7,4:7,1:6},picks:fixture.history().picks,corrections:fixture.history().corrections};
  const result=await read('nfl');assert.deepEqual(result.board,{participantIds:[2,4,1],rosterSize:7});assert.equal(result.turn.overallPick,21);
  assert.equal((await read('nba')).board,undefined);
  data={...data,initialized:false,roster_slots:null,roster_counts:{},picks:[],corrections:[]};assert.deepEqual((await read('nfl')).board,{participantIds:[2,4,1],rosterSize:7});
  data.roster_counts={2:1};assert.equal((await read('nfl')).board,undefined);
  data={...data,initialized:true,rules_snapshot:{draft:{type:'auction'}}};assert.equal((await read('nfl')).board,undefined);
});
