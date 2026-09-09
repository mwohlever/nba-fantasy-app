const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
function fixture({authorized = true, failure = null, role = "player", canAdministerGroup = false, teamInGroup = true} = {}) {
  const calls = [];
  const rows = {
    teams: [{id: 1, name: 'Mark', user_id: 'mark', group_id: 'a'}, {id: 2, name: 'Inactive', user_id: 'inactive', group_id: 'a'}, {id: 3, name: 'Other Group', user_id: 'mark', group_id: 'b'}, {id: 4, name: 'Not participating', user_id: 'mark', group_id: 'a'}],
    group_memberships: [{user_id: 'mark', group_id: 'a', is_active: true}, {user_id: 'inactive', group_id: 'a', is_active: false}],
    slate_teams: [{team_id: 1, slate_id: 1, is_participating: true, draft_order: 1}, {team_id: 2, slate_id: 1, is_participating: true, draft_order: 2}, {team_id: 3, slate_id: 1, is_participating: true, draft_order: 3}, {team_id: 4, slate_id: 1, is_participating: false, draft_order: 4}],
    slates: [{id: 1, is_locked: true, rules_snapshot: {roster: 'frozen'}}],
    lineups: [],
  };
  const admin = {from(table) {
    calls.push(table); let data = [...rows[table]], single = false;
    const query = {select() {return query;}, eq(key,value) {data = data.filter(row => row[key] === value); return query;},
      order() {return query;}, single() {single = true; return query;},
      then(resolve) {resolve({data: single ? data[0] : data, error: failure === table ? {message: 'failed'} : null});}};
    return query;
  }};
  const source = ts.transpileModule(fs.readFileSync('app/api/lineups/route.ts','utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  new Function('require', 'exports', source)(name => {
    if (name === 'next/server') return {NextResponse: {json: (body, options) => ({body, status: options?.status ?? 200})}};
    if (name.includes('supabaseAdmin')) return {supabaseAdmin: admin};
    if (name.includes('/auth')) return {getCurrentUser: async () => ({id: 'mark', role})};
    if (name.includes('draftPermissions')) {
      const helper = {}; new Function('exports', ts.transpileModule(fs.readFileSync('lib/lineups/draftPermissions.ts','utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText)(helper); return helper;
    }
    if (name.includes('/groups/context')) return {getActiveSlateAccessForUser: async () => authorized ? {context: {group: {id: 'a'}, team: {id: 1}, canAdministerGroup}, league: {id: 'league-a'}} : null, teamBelongsToGroup: async () => teamInGroup};
    return {};
  }, exports);
  return {post: async (teamId) => { rows.slates = []; return exports.POST({json: async () => ({slateId: 1, teamId, playerIds: [10]})}); }, get: (draft = true) => exports.GET({nextUrl: new URL(`http://test/api/lineups?slateId=1${draft ? '&draft=true' : ''}`)}), calls};
}
test('Draft GET includes only active participating teams from authorized Group and frozen slate data, including empty lineups', async () => {
  const f = fixture(); const result = await f.get();
  assert.equal(result.status,200); assert.deepEqual(result.body.lineups,[]);
  assert.deepEqual(result.body.draftContext.participants.map(team => team.id),[1]);
  assert.equal(result.body.draftContext.slate.is_locked,true);
  assert.deepEqual(result.body.draftContext.slate.rules_snapshot,{roster:'frozen'});
});
test('Draft context denies unauthorized slate before querying; failed context cannot claim success', async () => {
  const f = fixture({authorized:false}); assert.equal((await f.get()).status,404); assert.deepEqual(f.calls,[]);
  assert.equal((await fixture({failure:'group_memberships'}).get()).status,500);
});
test('ordinary lineup GET retains its existing query scope without Draft metadata work', async () => {
  const f = fixture(); const result = await f.get(false);
  assert.equal(result.status,200); assert.deepEqual(f.calls,['lineups']); assert.equal(result.body.draftContext,undefined);
});
test('proxy capability follows Group commissioner/super-admin capability or legacy admin, never ordinary membership', async () => {
  for (const [role, canAdministerGroup, expected] of [['player',false,false], ['player',true,true], ['admin',false,true]]) {
    const f = fixture({role,canAdministerGroup});
    assert.equal((await f.get()).body.draftContext.canProxyDraft,expected);
    const result = await f.post(2);
    // Authorized requests reach the deliberately missing slate; unauthorized ones stop before it.
    assert.equal(result.status,expected ? 404 : 403);
    assert.equal(result.body.error,expected ? 'Selected slate not found.' : 'Commissioner access is required to draft for another participant.');
  }
});
test('own-team save still reaches slate validation; cross-Group targets and inaccessible slate never pass', async () => {
  assert.equal((await fixture().post(1)).body.error,'Selected slate not found.');
  const cross = await fixture({role:'admin',canAdministerGroup:true,teamInGroup:false}).post(2);
  assert.equal(cross.status,404); assert.equal(cross.body.error,'Selected team does not belong to the active Group.');
  assert.equal((await fixture({authorized:false,role:'admin'}).post(2)).status,404);
});
