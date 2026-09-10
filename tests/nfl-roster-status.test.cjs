const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const {host,nodes,context}=require('./helpers/scores-harness.cjs');
const {nflRosterStatusCounts:counts,nflRosterPlayerStatus}=require('../lib/lineups/nflRosterStatus.ts');
const {NflFantasyGameCenter,NflFantasyGameAction,NflFantasyGamesContext}=require('../components/lineups/NflFantasyGameCenter.tsx');
const ScoresDashboard=require('../components/lineups/ScoresDashboard.tsx').default;
const {normalizeNflGame}=require('../lib/providers/nflLiveScores.ts');
const {resolveNflFantasyGames}=require('../lib/live-scores/nflFantasyGames.ts');
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

test('expanded NFL rows, aggregate and action agree despite stale or missing player stats',()=>{
  const previous=NflFantasyGamesContext._currentValue;
  try {
    for(const position of ['WR','D/ST']) for(const raw of [null,{game_status:2,game_status_text:'Live'},{game_status:3,game_status_text:'Final'}]) {
      const player={id:1,name:'Rostered player',team_abbreviation:'SEA',position_group:position};
      const props={selectedSlate:{id:1,sport:'nfl'},teams:[{id:1,name:'Josh'}],rosterSlots:[{position,slot_count:1}],
        getPlayersForTeam:()=>[player],getTeamStats:()=>({total:20.6}),getPlayerStat:()=>({fantasy_points:20.6}),
        getRawPlayerStat:()=>raw,getLiveProjectedTeamTotal:()=>20.6,getPregameProjectedTeamTotal:()=>null,liveWinPctMap:new Map(),setProfilePlayer(){}};
      const h=host(ScoresDashboard(props).type);
      for(const [state,label,action,expected] of [['pre','Upcoming','View Game',[0,0,1]],['in','Live','View Live Game',[0,1,0]],['post','Final','View Final',[1,0,0]]]) {
        NflFantasyGamesContext._currentValue={slateId:1,gamesByTeam:{SEA:{status:state,espnEventId:'123'}},openGameCenter(){}};
        let tree=h.render(props);
        const find=cls=>nodes(tree).find(n=>n.props?.className===cls);
        if(!find('scores-standing-toggle').props['aria-expanded']) {find('scores-standing-toggle').props.onClick();tree=h.render(props);}
        const row=nodes(tree).find(n=>n.props?.className?.startsWith('scores-roster-status '));
        assert.equal(row.props.children[0],label);
        assert.equal(find('scores-standing-games').props.children.join(''),`${expected[0]} final · ${expected[1]} live · ${expected[2]} left`);
        assert.equal(host(NflFantasyGameAction).render({player}).props.children,action);
        assert.equal(find('scores-roster-points').props.children[0],'20.6');
      }
      h.unmount();
    }
  } finally {NflFantasyGamesContext._currentValue=previous;}
});

test('unknown mapping/text cannot invent a final; numeric fallback retains the existing partition',()=>{
  const player={id:1,team_abbreviation:'SEA'};
  assert.equal(nflRosterPlayerStatus(player,{},null).label,'Upcoming');
  assert.equal(nflRosterPlayerStatus(player,{}, {game_status_text:'Final'}).label,'Upcoming');
  assert.equal(nflRosterPlayerStatus(player,{SEA:{status:'unknown'}},{game_status:3}).label,'Upcoming');
  assert.equal(nflRosterPlayerStatus(player,{}, {game_status:3,game_status_text:'Live'}).label,'Final');
});

test('interrupted provider games stay mapped and override stale finals without a misleading final action',()=>{
  for(const [name,label] of [['STATUS_POSTPONED','Postponed'],['STATUS_CANCELED','Canceled'],['STATUS_CANCELLED','Canceled'],['STATUS_SUSPENDED','Suspended']]) {
    const game=normalizeNflGame({id:'1',date:'2026-09-10T20:00:00Z',competitions:[{
      status:{type:{state:'post',completed:true,name}},competitors:[
        {homeAway:'away',team:{id:'1',abbreviation:'SEA'}},{homeAway:'home',team:{id:'2',abbreviation:'NE'}},
      ],
    }]});
    const games=Object.fromEntries(resolveNflFantasyGames([game],{date:'2026-09-10'}));
    assert.equal(game.completed,false);
    assert.equal(nflRosterPlayerStatus(players[0],games,{game_status:3}).label,label);
    assert.deepEqual(counts([players[0]],games,()=>({game_status:3})),result(0,0,1));
    const previous=NflFantasyGamesContext._currentValue;
    NflFantasyGamesContext._currentValue={slateId:1,gamesByTeam:games};
    try {assert.equal(host(NflFantasyGameAction).render({player:players[0]}),null);}
    finally {NflFantasyGamesContext._currentValue=previous;}
  }
});
