const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { host, nodes, context } = require('./helpers/scores-harness.cjs');
context.capturePull = true;
require('react').useId = () => 'test-settings';
const Builder = require('../components/lineups/LineupBuilder.tsx').default;
const Court = require('../components/lineups/DraftRosterCourt.tsx').default;
const Pool = require('../components/lineups/PlayerPool.tsx').default;
const Modal = require('../components/lineups/DraftPlayerModal.tsx').default;
const Research = require('../components/lineups/PlayerResearchModal.tsx').default;
const Panel = require('../components/ui/SecondaryControlsPanel.tsx').default;
const Refresh = require('../components/ui/ScoresRefreshButton.tsx').default;
const Sync = require('../components/lineups/RefreshPlayersButton.tsx').default;
const GameCenter = require('../components/lineups/NflFantasyGameCenter.tsx').NflFantasyGameCenter;
const Indicator = require('../components/ui/PullToRefreshIndicator.tsx').default;
const DraftOrder = require('../components/lineups/DraftOrder.tsx').default;
const tick = () => new Promise(resolve => setImmediate(resolve));
const reply = (body, ok = true) => ({ ok, json: async () => body });
const find = (tree, type) => nodes(tree).find(n => n.type === type);
const read = file => fs.readFileSync(file, 'utf8');
global.window = { innerWidth: 390, setTimeout, clearTimeout, addEventListener() {}, removeEventListener() {} };
global.document = { addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' };
async function setup(sport = 'nfl', user = { role: 'player', systemRole: 'user' }) {
  context.pathname = '/lineups/draft'; context.sport = sport; context.group = 'a'; context.team = 1; context.loading = false; context.switching = false;
  const participants = [{ id: 1, name: 'Mark' }, { id: 2, name: 'Josh' }, { id: 3, name: 'Andy' }, { id: 4, name: 'Jon' }];
  const players = [{ id: 10, name: 'Player Ten', position_group: sport === 'nfl' ? 'QB' : sport === 'nba' ? 'G' : 'GOLFER', nfl_player_id: '123', nba_player_id: '456', is_active: true }];
  const props = { players, teams: participants, slates: [1, 2].map(id => ({ id, sport, date: '2026-09-09', label: `Week ${id}`, is_locked: false })),
    slateTeamConfigs: participants.map(team => ({ slate_id: 1, team_id: team.id, is_participating: true, draft_order: team.id })),
    playerAverages: [], initialSelectedSlateId: 1, savedLineupsForInitialSlate: [], playerStats: [], teamResults: [], defaultViewMode: 'draft', sport };
  let roster = [{ team_id: 2, player_ids: [10], player_slots: [{ player_id: 10, roster_slot_position: players[0].position_group, roster_slot_index: 0 }] }];
  let history = {available:true,initialized:true,picks:[],corrections:[],turn:{state:'empty',overallPick:1,round:1,pickInRound:1,teamId:1}};
  const calls = [];
  const respond = url => {
    if (url === '/api/me') return { user, groupContext: { team: { id: 1, name: 'Mark' } } };
    const id = Number(new URL(url, 'http://local').searchParams.get('slateId') ?? 1);
    if (url.startsWith('/api/lineups?')) return { lineups: roster, draftContext: { history, canProxyDraft: user.role === "admin" || user.systemRole === "super_admin" || user.groupCommissioner === true, groupId: context.group, slateId: id, participants: id === 1 ? participants : [participants[2]], slate: { id, is_locked: false } } };
    if (url.startsWith('/api/player-stats')) return { sport, playerStats: [], teamResults: [], acceptedRevision: 1 };
    if (url.startsWith('/api/team-results')) return { teamResults: [] };
    if (url.startsWith('/api/slate-availability')) return { availablePlayerIds: [10] };
    if (url.startsWith('/api/lineups/nfl-games')) return { slateId: id, gamesByTeam: {} };
    return {};
  };
  global.fetch = async (url, options) => { calls.push([url, options]); return reply(respond(url)); };
  const h = host(Builder);
  h.render(props, true); await tick(); h.render(props, true); await tick();
  const tree = h.render(props); calls.length = 0;
  return { h, props, tree, calls, respond, setRoster: next => { roster = next; }, setHistory: next => { history = next; } };
}
test('compact header/settings retain Week, status, controls and exact role gates', async () => {
  for (const [role, systemRole] of [['player','user'], ['admin','user'], ['player','super_admin']]) {
    const {h, props, tree} = await setup('nfl', {role, systemRole});
    assert.ok(nodes(tree).some(n => n.type === 'h1' && n.props.children === 'Draft'));
    const settings = find(tree, Panel); assert.equal(settings.props.open, false);
    assert.equal(nodes(settings.props.children).filter(n => n.type === 'select').length, 2);
    assert.equal(Boolean(nodes(settings.props.children).find(n => n.props?.className === 'draft-admin-toggle')), role === 'admin');
    assert.equal(Boolean(find(settings.props.children, Sync)), systemRole === 'super_admin');
    assert.ok(nodes(settings.props.children).some(n => n.props?.href === '/standings?sport=nfl'));
    settings.props.onOpenChange(true); h.render(props); assert.equal(context.pullOptions.enabled, false);
    settings.props.onOpenChange(false); h.render(props); assert.equal(context.pullOptions.enabled, true);
    if (role === 'admin') {
      const toggle = nodes(settings.props.children).find(n => n.type === 'input' && n.props.type === 'checkbox');
      assert.equal(toggle.props.checked, false); toggle.props.onChange({target: {checked: true}});
      assert.equal(nodes(find(h.render(props), Panel).props.children).find(n => n.type === 'input').props.checked, true);
    }
    h.unmount();
  }
  assert.doesNotMatch(read('app/lineups/draft/page.tsx'), /draft-page-intro|RefreshPlayersButton/);
});

test('Draft Order remains selected on refresh and successful pick; PlayerPool stays mounted', async () => {
  for(const sport of ['nba','nfl']){
    const {h,props,tree,respond,setHistory,calls}=await setup(sport,{role:'admin'});
    const orderButton=nodes(tree).find(n=>n.type==='button' && n.props.children?.props?.children==='Draft Order');
    orderButton.props.onClick();let next=h.render(props);
    assert.ok(find(next,DraftOrder));assert.ok(find(next,Pool));
    find(next,Pool).props.setSearchTerm('research');
    const pick={id:1,overall_pick:1,round_number:1,pick_in_round:1,team_id:1,team_name:'Mark',player_id:11,player_name:'New pick',player_position:sport==='nfl'?'RB':'G',status:'active',actor_user_id:'mark',occurred_at:'2026-09-09',is_proxy:false};
    global.fetch=async(url,options)=>{
      calls.push([url,options]);
      if(options?.method==='POST'){setHistory({available:true,initialized:true,picks:[pick],corrections:[],turn:{state:'active',overallPick:2,round:1,pickInRound:2,teamId:2}});return reply({success:true});}
      return reply(respond(url));
    };
    assert.equal(await find(next,Modal).props.handleAssignPlayerToTeam({id:11,name:'New pick',position_group:pick.player_position,is_active:true},1,{position:pick.player_position,slotIndex:0}),true);
    await tick(); next=h.render(props);
    assert.equal(find(next,DraftOrder).props.history.picks[0].overall_pick,1);
    await context.pullOptions.onRefresh(); next=h.render(props);
    assert.ok(find(next,DraftOrder));assert.ok(find(next,Pool));
    assert.ok(calls.every(([url])=>!/sync-players/.test(url)));
    context.group='b';const switched=h.render(props);assert.equal(find(switched,DraftOrder).props.history,null);
    h.unmount();
  }
});

test('completed/reversed Draft Order renders exact Week 1 rows without pick 25',()=>{
  const data=require('../docs/nfl-week1-draft-verification.json');
  const picks=data.picks.map(p=>({...p,id:p.overall_pick,player_id:p.id,player_name:p.name,player_position:p.position,actor_user_id:null,occurred_at:null,is_proxy:null,status:p.overall_pick===8?'reversed':'active'}));
  const tree=DraftOrder({history:{available:true,initialized:true,picks,corrections:[],turn:{state:'complete'}},teams:[]});
  assert.equal(nodes(tree).filter(n=>n.type==='tr').length,25,'one header plus 24 real picks');
  const text=JSON.stringify(tree);assert.match(text,/Draft complete/);assert.match(text,/Corrected \/ reversed/);
  assert.match(text,/Original pick times and actors are unknown/);assert.doesNotMatch(text,/Pick 25/);
});
test('one current Group participant by default; opponents are read-only, inspectable, and retain saved slots', async () => {
  const {h, props, tree} = await setup();
  assert.equal(find(tree, Court).props.teamId, 1); assert.equal(find(tree, Court).props.canDraft, true);
  const josh = nodes(tree).find(n => n.type === 'button' && Array.isArray(n.props.children) && n.props.children[0] === 'Josh');
  josh.props.onClick(); let next = h.render(props);
  const court = find(next, Court); assert.equal(court.props.teamId, 2); assert.equal(court.props.canDraft, false);
  assert.equal(court.props.slotAssignments[0].roster_slot_position, 'QB');
  court.props.setDraftingPlayer(props.players[0]); next = h.render(props);
  assert.equal(find(next, Modal).props.draftingPlayer, null); assert.equal(find(next, Research).props.player.id, 10);
  assert.equal(find(next, GameCenter).props.slateId, 1);
  assert.doesNotMatch(read('components/lineups/LineupBuilder.tsx'), /LeagueLineupCards|Around the League/);
  context.team = 99; const withoutTeam = h.render(props); assert.equal(find(withoutTeam, Court).props.canDraft, false);
  h.unmount();
});
test('view and player pool identity/state survive selection and routine reload for NBA, NFL and Golf', async () => {
  for (const sport of ['nba', 'nfl', 'golf']) {
    const {h, props, tree, calls} = await setup(sport);
    nodes(tree).find(n => n.type === 'button' && n.props.children?.[0] === 'Josh').props.onClick();
    const pool = find(tree, Pool); pool.props.setSearchTerm('quarter'); pool.props.setPositionFilter('QB');
    nodes(tree).find(n => n.type === 'button' && n.props.children?.some?.(child => child?.props?.children === 'Players')).props.onClick();
    const before = h.render(props); const pending = context.pullOptions.onRefresh();
    assert.equal((await context.pullOptions.onRefresh()).status, 'skipped'); assert.equal((await pending).status, 'success');
    const after = h.render(props);
    assert.equal(find(after, Court).props.teamId, 2); assert.equal(find(after, Pool).props.searchTerm, 'quarter');
    assert.equal(find(after, Pool).props.positionFilter, 'QB'); assert.equal(find(after, Pool).type, find(before, Pool).type);
    assert.equal(nodes(after).find(n => n.props?.hidden === false && find(n, Pool))?.props.hidden, false);
    assert.equal(find(after, Indicator).props.feedback, 'Updated just now');
    assert.ok(calls.every(([url]) => !/sync-players|refresh-stats|refresh-golf|reconcil/.test(url)));
    calls.length = 0; find(after, Refresh).props.onRefresh(); await tick();
    assert.ok(calls.some(([url]) => url === '/api/lineups?slateId=1&draft=true'));
    h.unmount();
  }
});
test('refresh errors are atomic; Group A-B-A, slate switches and unmount reject pending results', async () => {
  for (const action of ['error', 'group', 'sport', 'slate', 'unmount']) {
    const {h, props, respond} = await setup();
    const resolvers = []; global.fetch = url => new Promise(resolve => resolvers.push(() => resolve(reply(respond(url), action !== 'error'))));
    const pending = context.pullOptions.onRefresh();
    if (action === 'group') { context.group = 'b'; h.render(props); context.group = 'a'; h.render(props); }
    if (action === 'sport') { context.sport = 'nba'; h.render(props); }
    if (action === 'slate') { nodes(find(h.render(props), Panel).props.children).filter(n => n.type === 'select')[1].props.onChange({target: {value: '2'}}); h.render(props); }
    if (action === 'unmount') h.unmount();
    resolvers.forEach(resolve => resolve());
    assert.equal((await pending).status, action === 'error' ? 'error' : 'skipped');
    if (action === 'error') assert.equal(find(h.render(props), Court).props.teamId, 1);
    h.unmount();
  }
});
test('selected slate uses refreshed participants, never legacy or absent Group teams', async () => {
  const {h, props, tree} = await setup();
  nodes(find(tree, Panel).props.children).filter(n => n.type === 'select')[1].props.onChange({target: {value: '2'}});
  h.render(props, true); await tick(); const next = h.render(props);
  assert.equal(find(next, Court).props.teamId, 3); assert.equal(find(next, Court).props.canDraft, false);
  h.unmount();
});
test('read-only empty slots cannot target draft; owned empty slots retain targeting across sports and custom slots', () => {
  for (const sport of ['nba','nfl','golf']) {
    for (const canDraft of [false,true]) {
      const calls = [];
      const slots = sport === 'nfl' ? ['QB','RB','WR','TE','K','FLEX','SF','D/ST'] : sport === 'nba' ? ['G','F/C','UTIL'] : ['GOLFER'];
      const tree = Court({teamId: 2, teamName: 'Josh', players: [], rosterSlots: slots.map(position => ({sport, position, slot_count: 2})), isLocked: false, canDraft,
        setDraftingPlayer() {}, setTargetDraftSlot: slot => calls.push(slot)});
      const slotNodes = nodes(tree).filter(n => typeof n.type === 'function' && n.type.name === 'DraftRosterSlot');
      assert.equal(slotNodes.length, slots.length * 2);
      for (const slot of slotNodes) { assert.equal(slot.props.disabled, !canDraft); slot.props.onEmptyClick(slot.props.positionGroup, 0); }
      assert.equal(calls.length, canDraft ? slots.length * 2 : 0);
    }
  }
});
test('directory action retains original maintenance endpoints', async () => {
  global.alert = () => {}; global.window.location = {reload() {}};
  for (const sport of ['nba','nfl']) {
    let endpoint; global.fetch = async url => { endpoint = url; return reply({}); };
    const button = Sync({sport}); assert.equal(button.props.children, 'Sync Player Directory');
    await button.props.onClick(); assert.equal(endpoint, sport === 'nfl' ? '/api/sync-players-nfl' : '/api/sync-players');
  }
});
test('assignment invalidates pre-save refresh and blocks another refresh until save finishes', async () => {
  const {h, props, tree, respond} = await setup("nfl", {role: "admin"});
  const reads = []; let finishSave;
  global.fetch = (url, options) => options?.method === 'POST'
    ? new Promise(resolve => { finishSave = resolve; })
    : new Promise(resolve => reads.push(() => resolve(reply(respond(url)))));
  const refreshing = context.pullOptions.onRefresh();
  // Player Ten belongs to Josh; a removal exercises the entire mutation gate without production writes.
  const removing = find(tree, Modal).props.handleRemovePlayerFromTeam(props.players[0]);
  assert.ok(finishSave);
  assert.equal((await context.pullOptions.onRefresh()).status, 'skipped');
  reads.splice(0).forEach(resolve => resolve()); assert.equal((await refreshing).status, 'skipped');
  h.render(props); assert.equal(context.pullOptions.enabled, false);
  finishSave(reply({success: true})); await removing;
  reads.splice(0).forEach(resolve => resolve()); await tick();
  h.render(props); assert.equal(context.pullOptions.enabled, true);
  h.unmount();
});
test('settings Escape, outside click and explicit close restore trigger focus; keyboard label is present', () => {
  const listeners = new Map(); let focused = '';
  global.document = {addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key)};
  const h = host(Panel); let open = false;
  const props = () => ({open, onOpenChange: value => {open = value;}, label: 'Draft settings', children: null});
  let tree = h.render(props(), true);
  const trigger = nodes(tree).find(n => n.type === 'button');
  trigger.props.ref.current = {focus: () => {focused = 'trigger';}};
  tree.props.ref.current = {contains: target => target === 'inside'};
  trigger.props.onClick(); tree = h.render(props());
  nodes(tree).find(n => n.props?.['aria-label'] === 'Close Draft settings').props.ref.current = {focus: () => {focused = 'close';}};
  h.render(props(), true); assert.equal(focused, 'close');
  listeners.get('keydown')({key: 'Escape', preventDefault() {}}); assert.equal(open, false); assert.equal(focused, 'trigger');
  h.render(props(), true); open = true; h.render(props(), true);
  listeners.get('pointerdown')({target: 'inside'}); assert.equal(open, true);
  listeners.get('pointerdown')({target: 'outside'}); assert.equal(open, false); assert.equal(focused, 'trigger');
  h.render(props(), true); open = true; tree = h.render(props(), true);
  nodes(tree).find(n => n.props?.['aria-label'] === 'Close Draft settings').props.onClick();
  h.render(props(), true); assert.equal(open, false); assert.equal(focused, 'trigger'); h.unmount();
  global.document = {addEventListener() {}, removeEventListener() {}, visibilityState: 'visible'};
});
test('Draft top pull invokes routine handler; mid-page pull and open overlay do not', async () => {
  const {attachPullToRefresh} = require('../lib/client/pullToRefresh.ts');
  const {h, calls} = await setup(); const options = context.pullOptions;
  const listeners = new Map();
  const target = {contains: () => true, addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key)};
  const doc = {querySelector: () => null, scrollingElement: {scrollTop: 0}, documentElement: {style: {
    getPropertyValue: () => '', getPropertyPriority: () => '', setProperty() {}, removeProperty() {},
  }}};
  const cleanup = attachPullToRefresh({target, document: doc, getContext: () => options, onChange() {}, onRefresh: options.onRefresh});
  const emit = (key,y) => listeners.get(key)?.({target: {closest: () => null}, touches: key === 'touchend' ? [] : [{identifier: 0, clientX: 0, clientY: y}], cancelable: true, preventDefault() {}});
  const pull = async () => {emit('touchstart',0); emit('touchmove',90); emit('touchend',90); await tick();};
  doc.scrollingElement.scrollTop = 100; await pull(); assert.equal(calls.length,0);
  doc.scrollingElement.scrollTop = 0; doc.querySelector = () => ({}); await pull(); assert.equal(calls.length,0);
  doc.querySelector = () => null; await pull(); assert.ok(calls.some(([url]) => url.includes('&draft=true')));
  cleanup(); h.unmount();
});
test('saved placement preserves headshot provider IDs and roster Game Center wrapper', () => {
  const player = {id: 10, name: 'Defense', position_group: 'D/ST', nfl_player_id: 'dst-1', nba_player_id: 'nba-1', espn_player_id: 'golf-1', headshot_url: 'https://example.test/logo.png'};
  const tree = Court({teamId: 1, teamName: 'Mark', players: [player], rosterSlots: [{sport: 'nfl', position: 'D/ST', slot_count: 2}],
    slotAssignments: [{player_id: 10, roster_slot_position: 'D/ST', roster_slot_index: 1}], isLocked: true, canDraft: true,
    setDraftingPlayer() {}, setTargetDraftSlot() {throw new Error('locked');}});
  const slots = nodes(tree).filter(n => n.type?.name === 'DraftRosterSlot');
  assert.equal(slots[0].props.player, null); assert.equal(slots[1].props.player, player);
  const rendered = slots[1].type(slots[1].props);
  assert.equal(rendered.type.name, 'NflFantasyRosterPlayer');
  const headshot = nodes(rendered).find(n => n.type?.name === 'PlayerHeadshot');
  assert.equal(headshot.props.nflPlayerId, 'dst-1'); assert.equal(headshot.props.nbaPlayerId, 'nba-1');
  assert.equal(headshot.props.espnGolfPlayerId, 'golf-1'); assert.equal(headshot.props.imageUrl, player.headshot_url);
});
test('NFL Game Center keeps its selected game across participant changes and does not reload a supplied map', () => {
  let calls = 0; global.fetch = async () => { calls++; return reply({}); };
  const h = host(GameCenter);
  const game = {espnEventId: 'game-1', status: 'live'};
  const props = {slateId: 1, refreshKey: null, draftGames: {slateId: 1, gamesByTeam: {BUF: game}}, children: 'Mark roster'};
  const tree = h.render(props, true);
  tree.props.value.openGameCenter({sport:'nfl',eventId:'game-1'});
  const switched = h.render({...props,children:'Josh roster'}, true);
  assert.equal(calls,0);
  assert.ok(nodes(switched).some(n => n.props?.game?.espnEventId === 'game-1'));
  h.unmount();
});
test('real Draft participant, tab and slot buttons opt into pull without a trailing action; other actions stay excluded', async () => {
  const {element, pullHarness} = require('./helpers/pull-harness.cjs');
  const {h, props, tree} = await setup();
  const participant = nodes(tree).find(n => n.type === 'button' && n.props.children?.[0] === 'Josh');
  const tab = nodes(tree).find(n => n.type === 'button' && n.props.children?.some?.(child => child?.props?.children === 'Players'));
  const court = find(tree,Court); const roster = Court(court.props);
  const slotComponent = nodes(roster).find(n => n.type?.name === 'DraftRosterSlot');
  const slot = nodes(slotComponent.type(slotComponent.props)).find(n => n.type === 'button');
  for (const button of [participant,tab,slot]) {
    let refreshed = 0, clicked = 0;
    const target = element({type:'span'}, element(button));
    const before = pullHarness(async () => {refreshed++;});
    before.emit('touchstart',target); before.emit('touchmove',target,0,90); before.emit('touchend',target,0,90);
    await tick(); assert.equal(refreshed,0,'unconfigured shared gesture rejects Draft buttons'); before.dispose();
    const f = pullHarness(async () => {refreshed++; return {status:'success'};}, {buttonStartSelector:context.pullOptions.buttonStartSelector});
    f.emit('touchstart',target); f.emit('touchmove',target,0,90); const end = f.emit('touchend',target,0,90);
    if (!end.defaultPrevented) clicked++;
    await tick(); assert.equal(refreshed,1); assert.equal(clicked,0);
    // A tap remains an ordinary button interaction.
    f.emit('touchstart',target); const tap = f.emit('touchend',target);
    assert.equal(tap.defaultPrevented,false);
    f.dispose();
  }
  for (const button of [Refresh(find(tree,Refresh).props), {type:'button',props:{'aria-label':'View Game'}}, {type:'button',props:{'aria-label':'Settings'}}]) {
    let called = false;
    const f = pullHarness(async () => {called = true;}, {buttonStartSelector:context.pullOptions.buttonStartSelector});
    const target = element(button); f.emit('touchstart',target); f.emit('touchmove',target,0,90); f.emit('touchend',target,0,90);
    await tick(); assert.equal(called,false); f.dispose();
  }
  assert.equal(find(h.render(props),Court).props.teamId,1); h.unmount();
});
test('Draft opt-in preserves short pulls, mid-page exclusion and horizontal participant scrolling', async () => {
  const {element,pullHarness} = require('./helpers/pull-harness.cjs');
  const {h,tree} = await setup();
  const target = element(nodes(tree).find(n => n.type === 'button' && n.props.children?.[0] === 'Josh'));
  for (const mode of ['short','mid','horizontal','uncancelable']) {
    let count = 0;
    const f = pullHarness(async () => {count++;}, {buttonStartSelector:context.pullOptions.buttonStartSelector});
    if (mode === 'mid') f.document.scrollingElement.scrollTop = 100;
    f.emit('touchstart',target); f.emit('touchmove',target,mode === 'horizontal' ? 80 : 0,mode === 'short' ? 30 : 90);
    f.emit('touchend',target,0,90,mode !== 'uncancelable'); await tick(); assert.equal(count,0); f.dispose();
  }
  h.unmount();
});
test('member opponent slots stay read-only and assignment is blocked even through the player dialog', async () => {
  const {h,props,tree,calls} = await setup();
  nodes(tree).find(n => n.type === 'button' && n.props.children?.[0] === 'Josh').props.onClick();
  const next = h.render(props), court = find(next,Court);
  assert.equal(court.props.canProxyDraft,false); assert.match(JSON.stringify(Court(court.props)),/Read-only/);
  assert.equal(await find(next,Modal).props.handleAssignPlayerToTeam(props.players[0],2),false);
  assert.equal(calls.length,0); h.unmount();
});
test('commissioner empty-slot picks target the viewed team, preserve inspection/selection and existing notification semantics', async () => {
  const SlotModal = require('../components/lineups/SlotDraftModal.tsx').default;
  for (const user of [{role:'player',groupCommissioner:true},{role:'admin'},{role:'admin',toggle:true},{role:'player',systemRole:'super_admin'}]) {
    const {h,props,tree,respond,setRoster,calls} = await setup('nfl',user);
    props.players.push({id:11,name:'Runner',position_group:'RB',is_active:true});
    nodes(tree).find(n => n.type === 'button' && n.props.children?.[0] === 'Josh').props.onClick();
    if (user.toggle) nodes(find(tree,Panel).props.children).find(n => n.type === 'input').props.onChange({target:{checked:true}});
    let next = h.render(props); const court = find(next,Court);
    assert.equal(court.props.canDraft,false); assert.equal(court.props.canProxyDraft,true);
    assert.match(JSON.stringify(Court(court.props)),/Commissioner/);
    court.props.setDraftingPlayer(props.players[0]); next = h.render(props);
    assert.equal(find(next,Modal).props.draftingPlayer,null); assert.equal(find(next,Research).props.player.id,10);
    // Close research, then deliberately choose Josh's RB slot.
    find(next,Research).props.onClose();
    const rb = nodes(Court(court.props)).find(n => n.type?.name === 'DraftRosterSlot' && n.props.positionGroup === 'RB');
    assert.match(rb.type(rb.props).props.children.props['aria-label'],/Draft for Josh/);
    rb.props.onEmptyClick('RB',0); next = h.render(props);
    const target = find(next,SlotModal).props.targetDraftSlot;
    assert.deepEqual(target,{teamId:2,teamName:'Josh',positionGroup:'RB',slotIndex:0});
    let post;
    global.fetch = async (url,options) => {
      calls.push([url,options]);
      if (options?.method === 'POST') {
        post = JSON.parse(options.body);
        setRoster([{team_id:2,player_ids:[10,11],player_slots:[{player_id:10,roster_slot_position:'QB',roster_slot_index:0},{player_id:11,roster_slot_position:'RB',roster_slot_index:0}]}]);
        return reply({success:true});
      }
      return reply(respond(url));
    };
    assert.equal(await find(next,SlotModal).props.handleAssignPlayerToTeam(props.players[1],target.teamId,{position:target.positionGroup,slotIndex:target.slotIndex}),true);
    await tick(); next = h.render(props);
    assert.equal(post.teamId,2); assert.notEqual(post.teamId,context.team);
    assert.equal(post.notifyNextDrafter,user.role === 'admin' ? Boolean(user.toggle) : true);
    assert.equal(find(next,Court).props.teamId,2); assert.equal(find(next,Court).props.players.length,2);
    // Participant changes invalidate the previously selected target.
    nodes(next).find(n => n.type === 'button' && n.props.children?.[0] === 'Andy').props.onClick(); next = h.render(props);
    assert.equal(find(next,SlotModal).props.targetDraftSlot,null);
    const andySlot = nodes(Court(find(next,Court).props)).find(n => n.type?.name === 'DraftRosterSlot');
    andySlot.props.onEmptyClick('QB',0); assert.equal(find(h.render(props),SlotModal).props.targetDraftSlot.teamId,3);
    h.unmount();
  }
});

test('Draft Order entry reuses the pool, targets only the authoritative team, confirms, and refreshes success or conflict', async () => {
  for (const sport of ['nba','nfl']) for (const succeeds of [true, false]) {
    const {h,props,tree,setHistory,respond,calls} = await setup(sport, {role:'admin'});
    const history = {available:true,initialized:true,picks:[],corrections:[],turn:{state:'active',overallPick:7,round:2,pickInRound:3,teamId:3}};
    setHistory(history);
    await context.pullOptions.onRefresh();
    nodes(tree).find(n=>n.type==='button' && n.props.children?.props?.children==='Draft Order').props.onClick();
    let next=h.render(props);
    assert.equal(find(next,DraftOrder).props.actionLabel,'Make Pick for Andy');
    const rendered=DraftOrder(find(next,DraftOrder).props);
    assert.match(JSON.stringify(rendered),/Pick 7 · Round 2.3 · Andy on the clock/);
    nodes(rendered).find(n=>n.type==='button').props.onClick();
    next=h.render(props);
    assert.deepEqual(find(next,Modal).props.orderedTeamsForSlate.map(t=>t.id),[3]);
    assert.equal(nodes(next).filter(n=>n.type===Pool).length,1);
    find(next,Pool).props.setSearchTerm('retained research');
    next=h.render(props);
    let confirmation, post;
    window.confirm = text => { confirmation=text; return true; };
    global.fetch=async(url,options)=>{
      calls.push([url,options]);
      if(options?.method==='POST') {
        post=JSON.parse(options.body);
        setHistory({...history,turn:{state:'active',overallPick:8,round:2,pickInRound:4,teamId:4}});
        return reply(succeeds ? {success:true} : {error:'Draft has advanced'},succeeds);
      }
      return reply(respond(url));
    };
    const player={id:11,name:'New pick',position_group:sport==='nba'?'G':'RB',is_active:true};
    window.confirm=()=>false;
    assert.equal(await find(next,Pool).props.speedEntry.onSelect(player),false);
    assert.ok(!calls.some(([,o])=>o?.method==='POST'));
    window.confirm=text=>{confirmation=text;return true;};
    assert.equal(await find(next,Pool).props.speedEntry.onSelect(player),succeeds);
    assert.equal(find(h.render(props),Modal).props.draftingPlayer,null);
    await tick(); next=h.render(props);
    assert.equal(confirmation,'Draft New pick for Andy at pick #7?');
    assert.equal(post.teamId,3);
    for(const key of ['overallPick','round','actor','is_proxy']) assert.equal(post[key],undefined);
    assert.equal(find(next,DraftOrder).props.history.turn.overallPick,8);
    assert.equal(find(next,DraftOrder).props.actionLabel,'Make Pick for Jon');
    assert.equal(find(next,Pool).props.searchTerm,'retained research');
    assert.ok(calls.some(([url])=>url.startsWith('/api/lineups?')));
    assert.ok(calls.every(([url])=>!/sync-players/.test(url)));
    h.unmount();
  }
});

test('Draft Order action permissions, completion, unavailable history and scope remain safe', async () => {
  for(const user of [{role:'player'},{role:'player',groupCommissioner:true},{role:'player',systemRole:'super_admin'}]) {
    const {h,props,tree,setHistory}=await setup('nba',user);
    nodes(tree).find(n=>n.type==='button' && n.props.children?.props?.children==='Draft Order').props.onClick();
    let next=h.render(props);
    assert.equal(find(next,DraftOrder).props.actionLabel,'Make My Pick');
    const base={available:true,initialized:true,picks:[],corrections:[],turn:{state:'active',overallPick:2,round:1,pickInRound:2,teamId:2}};
    setHistory(base); await context.pullOptions.onRefresh(); next=h.render(props);
    assert.equal(find(next,DraftOrder).props.actionLabel,user.groupCommissioner || user.systemRole==='super_admin' ? 'Make Pick for Josh' : undefined);
    for(const state of ['complete','closed','needs_review']) {
      setHistory({...base,turn:{state}}); await context.pullOptions.onRefresh(); next=h.render(props);
      assert.equal(find(next,DraftOrder).props.actionLabel,undefined);
      assert.equal(nodes(DraftOrder(find(next,DraftOrder).props)).filter(n=>n.type==='button' && /Make/.test(n.props.children)).length,0);
    }
    setHistory({...base,available:false}); await context.pullOptions.onRefresh(); next=h.render(props);
    assert.equal(find(next,DraftOrder).props.actionLabel,undefined);
    context.group='b'; next=h.render(props,true);
    assert.equal(find(next,DraftOrder).props.actionLabel,undefined);
    h.unmount();
  }
});

test('Edit Picks replaces through corrections, confirms context, preserves pool and refreshes on success/rejection',async()=>{
  for(const sport of ['nba','nfl']) for(const succeeds of [true,false]) {
    const {h,props,tree,setHistory,respond,calls}=await setup(sport,{role:'player',systemRole:'super_admin'});
    const pick={id:6,overall_pick:6,round_number:2,pick_in_round:2,team_id:2,team_name:'Josh',player_id:10,player_name:'Player Ten',player_position:'QB',status:'active'};
    const history={available:true,initialized:true,picks:[pick],corrections:[],turn:{state:'complete'}};
    setHistory(history); await context.pullOptions.onRefresh();
    nodes(tree).find(n=>n.type==='button' && n.props.children?.props?.children==='Draft Order').props.onClick();
    let next=h.render(props); assert.match(JSON.stringify(nodes(next).find(n=>n.type==='h1')?.props),/Draft/);
    let board=find(next,DraftOrder);
    assert.equal(board.props.canEdit,true); assert.equal(board.props.editing,false);
    board.props.onToggleEdit(); next=h.render(props); board=find(next,DraftOrder);
    assert.equal(board.props.editing,true);
    const edit=nodes(DraftOrder(board.props)).find(n=>n.props?.['aria-label']==='Edit pick 6');
    assert.ok(edit); edit.props.onClick(); next=h.render(props);
    assert.deepEqual(find(next,Modal).props.orderedTeamsForSlate.map(t=>t.id),[2]);
    assert.equal(nodes(next).filter(n=>n.type===Pool).length,1);
    assert.ok(nodes(next).some(n=>n.type==='div' && Array.isArray(n.props.children) && n.props.children[0]==='Edit Pick #'));
    window.confirm=()=>false;
    assert.equal(await find(next,Pool).props.speedEntry.onSelect({id:11,name:'Replacement',position_group:sport==='nba'?'G':'QB'}),false);
    assert.equal(calls.filter(([,options])=>options?.method==='POST').length,0);
    let confirmation,post;
    window.confirm=text=>{confirmation=text;return true;};
    global.fetch=async(url,options)=>{
      calls.push([url,options]);
      if(options?.method==='POST') {
        assert.equal(url,'/api/admin/lineup-correction'); post=JSON.parse(options.body);
        if(succeeds) setHistory({...history,picks:[{...pick,status:'reversed'}],corrections:[{id:1,pick_id:6,team_id:2,old_player_id:10,old_player_name:'Player Ten',new_player_id:11,new_player_name:'Replacement'}]});
        return reply(succeeds?{success:true}:{error:'Roster changed'},succeeds);
      }
      return reply(respond(url));
    };
    assert.equal(await find(next,Pool).props.speedEntry.onSelect({id:11,name:'Replacement',position_group:sport==='nba'?'G':'QB'}),succeeds);
    await tick(); next=h.render(props);
    assert.equal(confirmation,'Replace Player Ten with Replacement for Josh at pick #6?');
    assert.deepEqual(post,{slateId:1,teamId:2,action:'replace',pickId:6,oldPlayerId:10,newPlayerId:11,expectedPlayerIds:[10]});
    const rendered=DraftOrder(find(next,DraftOrder).props);
    assert.doesNotMatch(JSON.stringify(rendered),/Pick 25/);
    if(succeeds) {assert.match(JSON.stringify(rendered),/Replacement/);assert.match(JSON.stringify(rendered),/Originally/);assert.match(JSON.stringify(rendered),/Corrected/);}
    find(next,DraftOrder).props.onToggleEdit();next=h.render(props);
    assert.equal(find(next,DraftOrder).props.editing,false);
    assert.ok(!nodes(DraftOrder(find(next,DraftOrder).props)).some(n=>n.props?.['aria-label']==='Edit pick 6'));
    context.group='b';next=h.render(props,true); assert.equal(find(next,DraftOrder).props.canEdit,false);
    h.unmount();
  }
});

test('ordinary member has no Edit Picks even on their own completed history',async()=>{
  const {h,props,tree}=await setup();
  nodes(tree).find(n=>n.type==='button' && n.props.children?.props?.children==='Draft Order').props.onClick();
  const board=find(h.render(props),DraftOrder);
  assert.equal(board.props.canEdit,false);
  assert.ok(!nodes(DraftOrder(board.props)).some(n=>n.props?.children==='Edit Picks'));
  h.unmount();
});

test('NBA/NFL card primary selects fixed target; Info researches; normal pool retains profile flow',async()=>{
  for(const sport of ['nba','nfl']) {
    const {h,props,tree}=await setup(sport,{role:'admin'});
    const poolProps=find(tree,Pool).props;
    let selected=null,researched=null;
    const p=host(Pool);
    const speedProps={...poolProps,speedEntry:{onSelect:async player=>{selected=player;return true;},onResearch:player=>{researched=player;}}};
    let pool=p.render(speedProps);
    const card=nodes(pool).find(n=>n.type==='button' && n.props.className?.startsWith('draft-player-card '));
    assert.ok(card); card.props.onClick();
    assert.equal(selected.id,10);
    assert.equal(find(p.render(speedProps),Research).props.player,null);
    nodes(pool).find(n=>n.props?.['aria-label']==='Info about Player Ten').props.onClick();
    assert.equal(researched.id,10);
    pool=p.render(poolProps);
    assert.ok(!nodes(pool).some(n=>n.props?.['aria-label']==='Info about Player Ten'));
    nodes(pool).find(n=>n.type==='button' && n.props.className?.startsWith('draft-player-card ')).props.onClick();
    assert.equal(find(p.render(poolProps),Research).props.player.id,10);
    assert.equal(find(h.render(props),Modal).props.draftingPlayer,null);
    p.unmount();h.unmount();
  }
});
