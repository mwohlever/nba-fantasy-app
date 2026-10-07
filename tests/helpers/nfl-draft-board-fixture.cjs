const teams = [{id:2,name:'Josh'},{id:4,name:'Mark'},{id:1,name:'Andy'}];
const snapshot = {sport:'nfl',schemaVersion:1,draft:{type:'snake'},roster:{slots:[
  {position:'QB',slotCount:1},{position:'RB',slotCount:2},{position:'WR',slotCount:2},{position:'TE',slotCount:1},{position:'FLEX',slotCount:1},
]},scoring:{}};
const positions = {2:['RB','QB','WR','WR','TE','RB','WR'],4:['RB','RB','WR','TE','RB','WR','QB'],1:['RB','WR','WR','RB','WR','TE','QB']};
const slots = {2:['RB:1','QB:0','WR:1','WR:0','TE:0','RB:0','FLEX:0'],4:['RB:1','RB:0','WR:0','TE:0','FLEX:0','WR:1','QB:0'],1:['RB:1','WR:1','WR:0','RB:0','FLEX:0','TE:0','QB:0']};
function history(lastPick=20,corrected=true) {
  const picks=[];
  for(let index=0;index<lastPick;index++) {
    const round=Math.floor(index/3)+1,offset=index%3,team=(round%2?[2,4,1]:[1,4,2])[offset];
    const overall=index+1, [slot,slotIndex]=slots[team][round-1].split(':');
    picks.push({id:overall===17?105:overall,overall_pick:overall,round_number:round,pick_in_round:offset+1,
      team_id:team,team_name:teams.find(t=>t.id===team).name,player_id:overall===17?335:overall===21?899:1000+overall,
      player_name:overall===17?'Nico Collins':overall===18?'Chase Brown':overall===19?'Chris Olave':overall===20?'Matthew Stafford':overall===21?'Final QB':`Player ${overall}`,
      player_position:positions[team][round-1],roster_slot_position:slot,roster_slot_index:Number(slotIndex),
      actor_user_id:'mark',actor_name:'Mark',is_proxy:team!==4,occurred_at:'2026-10-07T19:00:00Z',status:corrected&&overall===17?'reversed':'active'});
  }
  const corrections=corrected&&lastPick>=17 ? [
    {id:3,pick_id:105,team_id:4,old_player_id:335,new_player_id:null,old_player_name:'Nico Collins',new_player_name:null,actor_name:'Mark',created_at:'2026-10-07T19:00:01Z'},
    {id:4,pick_id:null,team_id:4,old_player_id:null,new_player_id:900,old_player_name:null,new_player_name:'Replacement receiver',actor_name:'Mark',created_at:'2026-10-07T19:00:02Z'},
  ] : [];
  const roundIndex=Math.floor(lastPick/3),offset=lastPick%3;
  return {available:true,initialized:lastPick>0,board:{participantIds:[2,4,1],rosterSize:7},picks,corrections,
    turn:lastPick===21?{state:'complete'}:{state:lastPick?'active':'empty',overallPick:lastPick+1,round:roundIndex+1,pickInRound:offset+1,teamId:(roundIndex%2?[1,4,2]:[2,4,1])[offset]}};
}
module.exports={teams,snapshot,positions,slots,history};
