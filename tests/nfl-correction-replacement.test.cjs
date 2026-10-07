/* Runs the real lineup/correction handlers and deployed RPCs against fresh local PostgreSQL.
 * Never loads .env and never accepts a production database URL. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const { createDiscardPostgres, ids, json, quote } = require('./helpers/slate-discard-postgres.cjs');
const bin = process.env.SLATE_DISCARD_TEST_PG_BIN;
const pgtest = (name, fn) => test(name, { skip: !bin && 'Set SLATE_DISCARD_TEST_PG_BIN to local PostgreSQL binaries' }, fn);
const pg = bin && createDiscardPostgres(bin, 55440);
function load(file, mocks = {}) {
  const exports = {};
  new Function('require', 'exports', ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText)(id => { if (id in mocks) return mocks[id]; throw Error(`Unexpected import ${id}`); }, exports);
  return exports;
}
const rules = load('lib/rules/leagueRules.ts');
const model = load('lib/lineups/draftHistory.ts');
const response = { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } };
let snapshot, actor, mutations, notifications, database, server, route, corrections;
function query(table) {
  const filters = []; let singular = false, nested = false;
  const q = {
    select(columns) { nested = /lineup_players\(/.test(columns); return q; },
    eq(key, value) { filters.push(`t.${key}=${quote(value)}`); return q; },
    in(key, values) { filters.push(values.length ? `t.${key} in (${values.map(quote).join(',')})` : 'false'); return q; },
    single() { singular = true; return q; }, maybeSingle() { singular = true; return q; },
    then(resolve, reject) {
      try {
        const extra = nested ? ` || jsonb_build_object('lineup_players',(select coalesce(jsonb_agg(to_jsonb(lp)),'[]'::jsonb) from lineup_players lp where lp.lineup_id=t.id))` : '';
        const rows = pg.scalar(`select coalesce(jsonb_agg(row),'[]'::jsonb) from (select to_jsonb(t)${extra} as row from ${table} t${filters.length ? ' where '+filters.join(' and ') : ''}) x`);
        resolve({ data: singular ? rows[0] ?? null : rows, error: null });
      } catch (e) { reject(e); }
    },
  };
  return q;
}
async function rpc(name, args) {
  const values = ['p_slate_id','p_group_id','p_league_id','p_sport', ...(name === 'mutate_fantasy_draft' ? ['p_team_id','p_actor_id','p_intent'] : [])];
  if (name === 'mutate_fantasy_draft') mutations.push(args);
  try {
    const result = await pg.asyncSql(`set role service_role; select public.${name}(${values.map(k => k === 'p_intent' ? json(args[k]) : quote(args[k])).join(',')});`);
    return { data: JSON.parse(result), error: null };
  } catch (e) { return { data: null, error: { code: 'P0001', message: e.stderr.match(/ERROR:\s*([^\n]+)/)?.[1] ?? e.message } }; }
}
function setup(size = 6) {
  pg.reset({ pick: false });
  snapshot = { sport: 'nfl', schemaVersion: 1, draft: { type: 'snake' }, roster: { slots: [
    { position: 'QB', slotCount: 1 }, { position: 'RB', slotCount: 2 },
    { position: 'WR', slotCount: 2 }, { position: 'TE', slotCount: 1 },
    ...(size === 7 ? [{ position: 'FLEX', slotCount: 1 }] : []),
  ] }, scoring: {} };
  pg.sql(`update slates set rules_snapshot=${json(snapshot)} where id=191;
    update slate_teams set is_participating=false where slate_id=191 and team_id=3;
    update slate_teams set draft_order=case team_id when 2 then 1 when 4 then 2 when 1 then 3 else 4 end where slate_id=191;
    insert into players_nfl(id,name,position) values(335,'Nico Collins','WR'),(900,'Replacement WR','WR'),(901,'Replacement TE','TE'),(902,'Replacement QB','QB');`);
  for (const team of [2,4,1]) for (let round=1;round<=size;round++) {
    const position = (size === 7 ? ['RB','RB','WR','TE','RB','WR','QB'] : ['RB','RB','WR','TE','QB','WR'])[round-1];
    const player = team === 4 && round === 6 ? 335 : team*100+round;
    if (player !== 335) pg.sql(`insert into players_nfl(id,name,position) values(${player},'Team ${team} round ${round}','${position}')`);
  }
  actor = { id: ids.mark, role: 'player' }; mutations = []; notifications = [];
  database = { from: query, rpc };
  server = load('lib/lineups/draftHistory.server.ts', { '@/lib/supabaseAdmin': { supabaseAdmin: database }, '@/lib/rules/leagueRules': rules, './draftHistory': model });
  const context = () => ({ group: { id: ids.group }, team: { id: actor.id === ids.josh ? 2 : 4 }, canAdministerGroup: actor.id === ids.mark });
  const sportSecurity = load('lib/security/slateSport.ts', { 'next/server': response, '@/lib/lineups/draftContext': load('lib/lineups/draftContext.ts') });
  route = load('app/api/lineups/route.ts', {
    'next/server': response, '@/lib/supabaseAdmin': { supabaseAdmin: database }, '@/lib/auth': { getCurrentUser: async () => actor },
    '@/lib/groups/context': { getActiveSlateAccessForUser: async () => ({ context: context(), league: { id: ids.league }, slate: { sport: 'nfl', rulesSnapshot: snapshot } }), teamBelongsToGroup: async () => true },
    '@/lib/security/slateSport': sportSecurity, '@/lib/lineups/draftPermissions': load('lib/lineups/draftPermissions.ts'),
    '@/lib/rules/leagueRules': rules, '@/lib/playerProjections': { getPlayerProjectionsForSeason: async () => ({ projections: {} }) },
    '@/lib/draftNotifications': { notifyNextDrafter: async (...args) => notifications.push(args) }, '@/lib/lineups/draftHistory.server': server,
    '@/lib/lineups/draftHistory': model,
  });
  corrections = load('app/api/admin/lineup-correction/route.ts', {
    'next/server': response, '@/lib/supabaseAdmin': { supabaseAdmin: database }, '@/lib/lineups/draftHistory': model,
    '@/lib/security/resourceAuthorization': { authorizeSlateResource: async () => actor.id === ids.mark
      ? { ok: true, user: actor, target: { groupId: ids.group, leagueId: ids.league, sportKey: 'nfl' } }
      : { ok: false, response: { status: 403 } } },
    '@/lib/corrections/recomputeSlateResults': { recomputeCorrectedSlateResults: async () => {} }, '@/lib/lineups/draftHistory.server': server,
  });
}
function roster(team = 4) { return pg.scalar(`select coalesce(jsonb_agg(lp.player_id order by lp.player_id),'[]'::jsonb) from lineup_players lp join lineups l on l.id=lp.lineup_id where l.slate_id=191 and l.team_id=${team}`); }
function post(team, player, extra = {}) { const expected = roster(team); return route.POST({ json: async () => ({ sport: 'nfl', slateId: 191, teamId: team, playerIds: [...expected,player], expectedPlayerIds: expected, ...extra }) }); }
function remove(team, player) { return corrections.POST({ json: async () => ({ slateId: 191, teamId: team, action: 'remove', oldPlayerId: player }) }); }
async function draftThrough(count) {
  for (let pick=1;pick<=count;pick++) {
    const round = Math.floor((pick-1)/3)+1, offset = (pick-1)%3;
    const team = (round%2 ? [2,4,1] : [1,4,2])[offset];
    const result = await post(team, team===4 && round===6 ? 335 : team*100+round);
    assert.equal(result.status,200,JSON.stringify(result)); assert.equal(result.body.overallPick,pick);
  }
}
async function history() { return server.readDraftHistory(191,ids.group,ids.league,'nfl'); }
if (bin) { test.before(() => pg.start()); test.after(() => pg.stop()); }

pgtest('regression: sixth pick removed, existing reversed #17 survives, eligible replacement succeeds as a new audited roster event', async () => {
  setup(); await draftThrough(16); assert.equal(roster().length,5);
  assert.equal((await post(4,335)).status,200); assert.equal(roster().length,6);
  assert.equal((await remove(4,335)).status,200); assert.equal(roster().length,5);
  const before = await history(), original = before.picks.find(p => p.overall_pick===17);
  const otherRosters = [roster(1),roster(2)];
  // Prove the precise current-production RPC rejection independently of the fix.
  const rejected = await server.mutateFantasyDraft({ slateId:191,groupId:ids.group,leagueId:ids.league,sport:'nfl',teamId:4,actorId:ids.mark,expectedIds:roster(),desiredIds:[...roster(),900] });
  assert.deepEqual(rejected.error,{code:'P0001',message:'Roster correction required before drafting can continue'});
  const replacement = await post(4,900);
  assert.equal(replacement.status,200,JSON.stringify(replacement)); assert.equal(roster().length,6);
  assert.equal(replacement.body.isPick,false); assert.equal(notifications.length,17);
  const after = await history(); assert.deepEqual(after.picks,before.picks);
  assert.equal(model.effectiveDraftPick(original,after.corrections).playerId,null);
  assert.equal(after.corrections.at(-1).new_player_id,900); assert.equal(after.corrections.at(-1).pick_id,null);
  assert.deepEqual([roster(1),roster(2)],otherRosters);
  assert.equal(after.turn.overallPick,18); assert.equal(after.turn.teamId,2);
  assert.equal((await post(2,206)).body.overallPick,18); assert.equal((await history()).turn.state,'complete');
  assert.throws(()=>pg.sql('delete from draft_picks'),/immutable/);
  assert.throws(()=>pg.sql('delete from draft_corrections'),/immutable/);
});
pgtest('production-shaped seven-slot snapshot fills the open WR at 5/7 without consuming #18 or closing the open QB', async () => {
  setup(7); await draftThrough(17); await remove(4,335);
  assert.equal((await post(4,900)).status,200); assert.equal(roster().length,6);
  assert.equal((await history()).turn.overallPick,18);
  assert.equal((await post(2,206)).body.overallPick,18);
  assert.equal((await post(2,207)).body.overallPick,19);
  assert.equal((await post(4,407)).body.overallPick,20);
  assert.equal((await post(1,107)).body.overallPick,21);
  assert.equal((await history()).turn.state,'complete');
});
pgtest('earlier reversed pick can be refilled after later picks; removed player is available and normal chronology resumes', async () => {
  setup(); await draftThrough(17); assert.equal((await remove(4,403)).status,200);
  assert.equal((await post(4,403)).status,200); assert.equal(roster().length,6);
  assert.equal((await history()).picks.find(p=>p.overall_pick===8).status,'reversed');
  assert.equal((await post(2,206)).body.overallPick,18);
});
pgtest('different eligible position can refill a vacated FLEX and a replacement can itself be removed and refilled', async () => {
  setup(7); await draftThrough(17); await remove(4,405);
  assert.equal((await post(4,901)).status,200);
  const assignment=pg.scalar('select to_jsonb(lp) from lineup_players lp join lineups l on l.id=lp.lineup_id where l.team_id=4 and lp.player_id=901');
  assert.equal(assignment.roster_slot_position,'FLEX');
  assert.equal((await remove(4,901)).status,200); assert.equal((await post(4,900)).status,200);
  assert.equal((await history()).corrections.length,4);
});
pgtest('active ownership, slot eligibility, capacity, stale roster and normal turn enforcement remain authoritative', async () => {
  setup(); await draftThrough(17); await remove(4,335);
  let result=await post(4,203); assert.equal(result.status,409); assert.match(result.body.error,/already rostered/);
  result=await post(4,901); assert.equal(result.status,400); assert.match(result.body.error,/roster slot/);
  result=await post(4,900,{expectedPlayerIds:[...roster(),335]}); assert.equal(result.status,409); assert.match(result.body.error,/Roster changed/);
  assert.equal((await post(4,900)).status,200);
  assert.equal((await post(4,335)).status,400); // six-slot roster is full
  setup(7); await draftThrough(17); result=await post(4,407); assert.equal(result.status,409); assert.match(result.body.error,/another participant/);
  assert.equal(mutations.at(-1).p_intent.correction,false);
});
pgtest('only commissioners can refill correction vacancies; client correction flags and legacy proxy role cannot escalate', async () => {
  setup(); await draftThrough(17); await remove(2,203);
  actor={id:ids.josh,role:'player'};
  assert.equal((await remove(2,204)).status,403);
  let result=await post(2,900,{correction:true}); assert.equal(result.status,409);
  assert.equal(mutations.at(-1).p_intent.correction,false);
  actor={id:ids.josh,role:'admin'};
  result=await post(2,900); assert.equal(result.status,409);
  assert.equal(mutations.at(-1).p_intent.correction,false);
  actor={id:ids.mark,role:'player'}; assert.equal((await post(2,900)).status,200);
});
pgtest('inactive membership and opted-out receiving team cannot use refill; locked completed slates remain protected', async () => {
  for (const change of ["update group_memberships set is_active=false where user_id='"+ids.josh+"'",'alter table slate_teams disable trigger user; update slate_teams set is_participating=false where team_id=2 and slate_id=191; alter table slate_teams enable trigger user']) {
    setup(); await draftThrough(17); await remove(2,203); pg.sql(change);
    const result=await post(2,900); assert.equal(result.status,409); assert.match(result.body.error,/not active/); assert.equal(roster(2).length,4);
  }
  for (const [change,status] of [
    ['update slates set is_locked=true where id=191',400],
    ["update slates set archived_at=now() where id=191",409],
    ["update slates set end_date='2020-10-12' where id=191",409],
  ]) {
    setup(); await draftThrough(18); await remove(4,335); pg.sql(change);
    const before=await history(); assert.equal((await post(4,900)).status,status); assert.deepEqual(await history(),before);
  }
});
pgtest('unexplained roster holes and multi-player additions never acquire correction permission', async () => {
  setup(); await draftThrough(17);
  // Local fixture corruption, not production: an unrecorded deletion must not be repaired by Draft here.
  pg.sql("begin; select set_config('app.fantasy_draft_mutation','on',true); delete from lineup_players where player_id=335; commit;");
  const result=await post(4,900); assert.equal(result.status,409); assert.equal(mutations.at(-1).p_intent.correction,false);
  setup(7); await draftThrough(17); await remove(4,335);
  assert.equal((await post(4,900,{playerIds:[...roster(),900,902]})).status,409);
  assert.equal(mutations.at(-1).p_intent.correction,false);
});
