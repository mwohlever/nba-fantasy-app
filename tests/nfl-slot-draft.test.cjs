/* eslint-disable @typescript-eslint/no-require-imports */
const test=require('node:test'),assert=require('node:assert/strict');
const {host,nodes}=require('./helpers/scores-harness.cjs');
const Slot=require('../components/lineups/SlotDraftModal.tsx').default;
const Pool=require('../components/lineups/PlayerPool.tsx').default;
const players=[{id:1,name:'Alpha',position_group:'QB'},{id:2,name:'Owned',position_group:'QB'},{id:3,name:'Off slate',position_group:'QB'},{id:4,name:'Runner',position_group:'RB'},{id:5,name:'Unknown score',position_group:'QB'},{id:6,name:'Kicker',position_group:'K'},{id:7,name:'Defense',position_group:'D/ST'}];
function setup(extra={}){const changes=[],assignments=[];const props={sport:'nfl',targetDraftSlot:{teamId:9,teamName:'Fixture team',positionGroup:'QB',slotIndex:0},setTargetDraftSlot:s=>changes.push(s),players,playerAverageMap:new Map(),playerProjections:{},availablePlayerIdsForSlate:[1,2,5,6,7],availablePlayerIdSet:new Set([1,2,5,6,7]),isAvailabilityLoading:false,slateAvailabilityReady:true,getOwnerTeamForPlayer:id=>id===2?{id:10,name:'Other team'}:null,setDraftingPlayer:()=>{},handleAssignPlayerToTeam:async(...args)=>{assignments.push(args);return true;},selectedSeason:'2026',nflSeason:'2026',slateId:193,centerSeason:2026,rosterSlots:[{position:'QB',slot_count:1},{position:'RB',slot_count:2},{position:'K',slot_count:1},{position:'D/ST',slot_count:1}],isAssigningPlayer:false,...extra};const h=host(Slot);const render=()=>h.render(props);const pool=()=>nodes(render()).find(n=>n.type===Pool).props;return{h,props,pool,render,changes,assignments};}
test('NFL circular slot view reuses PlayerPool with slate-only default, fixed slot position and canonical context',()=>{
 const s=setup(),p=s.pool();assert.equal(p.onSlateOnly,true);assert.equal(p.positionFilter,'QB');assert.equal(p.hidePositionFilter,true);assert.deepEqual(p.filteredPlayers.map(p=>p.id),[1,5]);assert.equal(p.slateId,193);assert.equal(p.centerSeason,2026);assert.equal(p.setDraftingPlayer,s.props.setDraftingPlayer);s.h.unmount();
});
test('All Players, search and hidden-profile round trips preserve selection state and exclude owned or incompatible players',()=>{
 const s=setup();s.pool().setOnSlateOnly(false);assert.deepEqual(s.pool().filteredPlayers.map(p=>p.id),[1,3,5]);s.pool().setSearchTerm('off');assert.deepEqual(s.pool().filteredPlayers.map(p=>p.id),[3]);s.props.hidden=true;assert.deepEqual(s.pool().filteredPlayers.map(p=>p.id),[3]);s.props.hidden=false;s.props.targetDraftSlot=null;assert.equal(s.render(),null);s.props.targetDraftSlot={teamId:9,teamName:'Fixture team',positionGroup:'QB',slotIndex:0};assert.equal(s.pool().onSlateOnly,false);assert.deepEqual(s.pool().filteredPlayers.map(p=>p.id),[3]);s.h.unmount();
});
test('unknown or stale-scope availability cannot leak off-slate rows; validated same-slate data survives refresh loading',()=>{
 const s=setup({slateAvailabilityReady:false});assert.deepEqual(s.pool().filteredPlayers,[]);s.props.isAvailabilityLoading=true;assert.deepEqual(s.pool().filteredPlayers,[]);s.props.slateAvailabilityReady=true;assert.deepEqual(s.pool().filteredPlayers.map(p=>p.id),[1,5]);s.pool().setOnSlateOnly(false);assert.deepEqual(s.pool().filteredPlayers.map(p=>p.id),[1,3,5]);s.h.unmount();
});
test('K/DST slot positions reach the shared supported-sort policy rather than offensive All defaults',()=>{
 for(const [position,id]of [['K',6],['D/ST',7]]){const s=setup({targetDraftSlot:{teamId:9,teamName:'Fixture team',positionGroup:position,slotIndex:0}});assert.equal(s.pool().positionFilter,position);assert.deepEqual(s.pool().filteredPlayers.map(p=>p.id),[id]);s.h.unmount();}
});
test('existing explicit slot assignment and failure handling are preserved',async()=>{
 const s=setup();let success=false;s.props.handleAssignPlayerToTeam=async(...args)=>{s.assignments.push(args);return success;};await s.pool().slotDraftContext.onDraftPlayer(players[0]);assert.deepEqual(s.changes,[]);success=true;await s.pool().slotDraftContext.onDraftPlayer(players[0]);assert.deepEqual(s.assignments[1],[players[0],9,{position:'QB',slotIndex:0}]);assert.deepEqual(s.changes,[null]);s.h.unmount();
});
test('NBA slot default and position context remain unchanged',()=>{
 const s=setup({sport:'nba',players:[{id:1,name:'Guard',position_group:'G'},{id:3,name:'Other guard',position_group:'G'}],targetDraftSlot:{teamId:9,teamName:'Fixture team',positionGroup:'G',slotIndex:0},rosterSlots:[{position:'G',slot_count:2}]});assert.equal(s.pool().onSlateOnly,false);assert.equal(s.pool().positionFilter,'All');assert.deepEqual(s.pool().filteredPlayers.map(p=>p.id),[1,3]);s.h.unmount();
});
