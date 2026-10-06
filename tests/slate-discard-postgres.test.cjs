/* eslint-disable @typescript-eslint/no-require-imports */
/* Real migrations, permissions, triggers, FK fencing and rollback. Local only. */
const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const { createDiscardPostgres, ids, snapshot, json } = require('./helpers/slate-discard-postgres.cjs');
const bin = process.env.SLATE_DISCARD_TEST_PG_BIN;
const db = bin && createDiscardPostgres(bin);
const pgtest = (name, fn) => test(name, { skip: !bin && 'Set SLATE_DISCARD_TEST_PG_BIN to local PostgreSQL binaries' }, fn);
before(() => { if (db) db.start(); });
after(() => { if (db) db.stop(); });
beforeEach(() => { if (db) db.reset(); });
const empty = { slates: 0, drafts: 0, picks: 0, corrections: 0, lineups: 0, players: 0, teams: 0, context: 0 };

for (const state of [{ pick: false }, { pick: false, initialized: true }, { pick: true }, { pick: true, corrections: true }]) {
  pgtest(`NFL discard removes complete graph: ${JSON.stringify(state)}`, () => {
    db.reset(state); assert.equal(db.inspect().eligible, true);
    assert.equal(db.discard().success, true); assert.deepEqual(db.graph(), empty);
    assert.equal(db.sql('select count(*) from slates where id in (190,300)'), '2');
    assert.equal(db.sql('select count(*) from team_slate_results where slate_id=190'), '4');
    assert.equal(db.sql('select count(*) from group_memberships where is_active'), '5');
  });
}
pgtest('sent delivery audit is detached, annotated and retained; no broken slate reference', () => {
  assert.equal(db.discard().notificationsDetached, 1);
  const row = db.scalar('select to_jsonb(n) from notification_history n');
  assert.equal(row.slate_id, null); assert.equal(row.status, 'sent'); assert.equal(row.team_id, 3);
  assert.equal(row.league_id, ids.league); assert.equal(row.metadata.delivery, 'retained');
  assert.equal(row.metadata.discardedSlate.id, 191); assert.equal(row.metadata.discardedSlate.actorUserId, ids.mark);
});
pgtest('a late forced dependency error really rolls back deletes AND notification detach', () => {
  const before = db.graph();
  db.sql("create function reject_test_discard() returns trigger language plpgsql as $$begin raise exception 'forced dependency failure'; end$$; create trigger reject_test_discard before delete on slates for each row execute function reject_test_discard();");
  try {
    assert.equal(db.discard().code, 'dependency_failure'); assert.deepEqual(db.graph(), before);
    assert.equal(db.sql('select slate_id from notification_history'), '191');
    assert.equal(db.sql('select count(*) from nfl_slate_discard_context'), '0');
    assert.equal(db.sql('select count(*) from draft_picks'), '1');
  } finally { db.sql('drop trigger reject_test_discard on slates; drop function reject_test_discard();'); }
});
for (const [name, change, code] of [
  ['locked', 'update slates set is_locked=true where id=191', 'locked'],
  ['zero team results', 'insert into team_slate_results(slate_id,team_id,fantasy_points) values(191,2,0)', 'scoring_exists'],
  ['zero shared scoring', 'insert into player_slate_stats values(191,283,0)', 'scoring_exists'],
  ['zero NFL scoring', 'insert into player_nfl_slate_stats values(191,283,0)', 'scoring_exists'],
  ['start day', 'update slates set start_date=current_date,date=current_date where id=191', 'not_pre_game'],
  ['historical unscored', 'update slates set start_date=current_date-8,end_date=current_date-4 where id=191', 'not_pre_game'],
  ['known begun game with future dates', "update slates set first_game_start_time=clock_timestamp()-interval '1 minute' where id=191", 'not_pre_game'],
  ['missing schedule', 'update slates set start_date=null where id=191', 'schedule_uncertain'],
  ['invalid schedule', 'update slates set end_date=start_date-1 where id=191', 'schedule_uncertain'],
  ['idle scoring state', 'insert into nfl_sync_state(slate_id) values(191)', 'scoring_activity'],
  ['running scoring claim', 'set role service_role; select claim_nfl_sync(191,true)', 'scoring_activity'],
  ['expired scoring lease', "insert into nfl_sync_state(slate_id,status,lease_token,lease_expires_at) values(191,'running',gen_random_uuid(),clock_timestamp()-interval '1 hour')", 'scoring_activity'],
  ['failed scoring state', "insert into nfl_sync_state(slate_id,status,last_attempt_at) values(191,'failed',clock_timestamp())", 'scoring_activity'],
  ['verified historical draft', "insert into draft_picks(slate_id,group_id,league_id,sport,overall_pick,round_number,pick_in_round,team_id,player_id,player_name,player_position,team_name,roster_slot_position,roster_slot_index,source) values(191,'"+ids.group+"','"+ids.league+"','nfl',2,1,2,3,284,'RB','RB','Jon','RB',0,'verified_backfill')", 'historical_draft'],
  ['unexpected Golf cascade dependency', 'insert into golf_roster_periods values(99,191)', 'unreviewed_dependencies'],
]) pgtest(`${name} is rejected without partial cleanup`, () => {
  db.sql(change); const before = db.graph();
  assert.equal(db.inspect().code, code); assert.equal(db.discard().code, code); assert.deepEqual(db.graph(), before);
});
for (const [name, actor, group, league] of [
  ['ordinary member', ids.josh, ids.group, ids.league],
  ['other-Group commissioner', ids.outsider, ids.group, ids.league],
  ['forged Group', ids.mark, ids.other, ids.league],
  ['forged league', ids.mark, ids.group, ids.otherLeague],
]) pgtest(`database rejects ${name}`, () => {
  const before = db.graph(); assert.equal(db.discard(191, actor, group, league).code, 'not_found'); assert.deepEqual(db.graph(), before);
});
pgtest('revoked/inactive commissioner cannot discard after an eligible preview', () => {
  assert.equal(db.inspect().eligible, true); db.sql(`update group_memberships set is_active=false where user_id='${ids.mark}'`);
  assert.equal(db.discard().code, 'not_found'); assert.equal(db.graph().picks, 1);
});
pgtest('inactive account fails even for super admin; explicit active super admin can discard another Group', () => {
  db.sql(`update app_users set is_active=false where id='${ids.super}'`);
  assert.equal(db.discard(191, ids.super).code, 'not_found');
  db.sql(`update app_users set is_active=true where id='${ids.super}'`);
  assert.equal(db.discard(300, ids.super, ids.other, ids.otherLeague).success, true);
  assert.equal(db.graph().picks, 1);
});
pgtest('RPC/capability/history grants are narrow; browser roles and forged context cannot bypass guards', () => {
  for (const role of ['anon', 'authenticated']) assert.throws(() => db.sql(`set role ${role}; ${db.call()}`), /permission denied/);
  assert.equal(db.sql("select has_table_privilege('service_role','draft_picks','DELETE')"), 'f');
  assert.equal(db.sql("select has_table_privilege('service_role','fantasy_drafts','DELETE')"), 'f');
  assert.equal(db.sql("select has_table_privilege('service_role','draft_corrections','DELETE')"), 'f');
  assert.throws(() => db.sql('set role service_role; insert into nfl_slate_discard_context values(txid_current(),pg_backend_pid(),191)'), /permission denied/);
  assert.throws(() => db.sql('set role service_role; select is_nfl_slate_discard_authorized(191)'), /permission denied/);
  assert.throws(() => db.sql("set app.nfl_slate_discard='191'; delete from draft_picks where slate_id=191"), /immutable/);
  for (const table of ['fantasy_drafts', 'draft_picks', 'draft_corrections']) {
    if (table === 'draft_corrections') db.reset({ corrections: true });
    assert.throws(() => db.sql(`delete from ${table} where slate_id=191`), /immutable/);
  }
  assert.throws(() => db.sql('set role service_role; delete from lineup_players'), /authoritative fantasy/);
  assert.throws(() => db.sql('set role service_role; delete from lineups'), /authoritative fantasy/);
  assert.throws(() => db.sql('delete from slate_teams where slate_id=191'), /participant order is frozen/);
  assert.throws(() => db.sql("update slates set rules_version=6 where id=191"), /rules and ownership are frozen/);
});
pgtest('normal audited corrections retain immutability and a successful discard does not leak its capability', () => {
  db.sql(`set role service_role; ${db.pickSql(191,2,284,ids.mark,[283],true)}`);
  assert.equal(db.sql("select status from draft_picks where overall_pick=1"), 'reversed');
  assert.equal(db.graph().corrections, 1); assert.equal(db.discard().success, true);
  db.reset(); assert.throws(() => db.sql('delete from draft_picks'), /immutable/);
});
for (const sport of ['nba', 'golf']) pgtest(`${sport} stays unsupported and its graph survives`, () => {
  db.sql(`update slates set sport='${sport}' where id=300; update leagues set sport_key='${sport}' where id='${ids.otherLeague}'`);
  assert.equal(db.discard(300, ids.outsider, ids.other, ids.otherLeague).code, 'unsupported_sport');
  assert.equal(db.sql('select count(*) from slates where id=300'), '1');
});
pgtest('same-week replacement has active members, Jon opt-out, fresh chronology, and Week 4 reseed', () => {
  const oldLineup = db.sql('select id from lineups where slate_id=191');
  assert.equal(db.discard().success, true);
  db.sql(`insert into slates(id,league_id,sport,date,start_date,end_date,display_name,rules_snapshot,rules_version)
    values(400,'${ids.league}','nfl',current_date+2,current_date+2,current_date+6,'2026 Week 5',${json(snapshot)},5);
    insert into slate_teams(slate_id,team_id,draft_order,is_participating)
    select 400,t.id,row_number() over(order by case t.id when 2 then 1 when 4 then 2 when 1 then 3 else 4 end),t.id<>3
    from teams t join group_memberships m on m.group_id=t.group_id and m.user_id=t.user_id and m.is_active where t.group_id='${ids.group}';`);
  assert.deepEqual(db.scalar('select jsonb_agg(team_id order by draft_order) from slate_teams where slate_id=400'), [2,4,1,3]);
  assert.equal(db.sql(`select is_active from group_memberships where user_id='${ids.jon}'`), 't');
  assert.equal(db.sql('select count(*) from fantasy_drafts where slate_id=400'), '0');
  assert.equal(db.sql('select count(*) from lineups where slate_id=400'), '0');
  assert.equal(db.sql(`select id from slates where league_id='${ids.league}' and sport='nfl' and is_locked and start_date<(select start_date from slates where id=400) order by start_date desc limit 1`), '190');
  db.sql(`set role service_role; ${db.pickSql(400)}`);
  assert.deepEqual(db.scalar('select to_jsonb(participant_ids) from fantasy_drafts where slate_id=400'), [2,4,1]);
  assert.equal(db.sql('select overall_pick from draft_picks where slate_id=400'), '1');
  assert.notEqual(db.sql('select id from lineups where slate_id=400'), oldLineup);
});

pgtest('pick commits first: discard waits, then removes the entire committed attempt', async () => {
  db.reset({ pick: false });
  const pick = db.startSql(`begin; set local role service_role; ${db.pickSql()} select pg_sleep(0.8); commit;`, 'pick-first');
  await db.waitFor('pick-first', 'sleep');
  const discard = db.startSql(`set role service_role; ${db.call()}`, 'discard-after-pick');
  await db.waitFor('discard-after-pick', 'lock');
  assert.equal((await pick).ok, true); const result = await discard;
  assert.equal(result.ok, true); assert.equal(JSON.parse(result.stdout).success, true); assert.deepEqual(db.graph(), empty);
});
pgtest('discard wins: a concurrent pick fails cleanly after the parent disappears', async () => {
  const discard = db.startSql(`begin; set local role service_role; ${db.call()} select pg_sleep(0.8); commit;`, 'discard-first');
  await db.waitFor('discard-first', 'sleep');
  const pick = db.startSql(`set role service_role; ${db.pickSql(191,3,284,ids.jon)}`, 'pick-after-discard');
  await db.waitFor('pick-after-discard', 'lock');
  assert.equal((await discard).ok, true); assert.equal((await pick).ok, false); assert.deepEqual(db.graph(), empty);
});
pgtest('scoring claim wins: discard waits for FK fencing and rejects the committed state', async () => {
  const claim = db.startSql('begin; set local role service_role; select claim_nfl_sync(191,true); select pg_sleep(0.8); commit;', 'claim-first');
  await db.waitFor('claim-first', 'sleep');
  const discard = db.startSql(`set role service_role; ${db.call()}`, 'discard-after-claim');
  await db.waitFor('discard-after-claim', 'lock');
  assert.equal((await claim).ok, true); assert.equal(JSON.parse((await discard).stdout).code, 'scoring_activity');
  assert.equal(db.graph().picks, 1);
});
pgtest('discard wins: a scoring claim cannot create surviving state for a deleted slate', async () => {
  const discard = db.startSql(`begin; set local role service_role; ${db.call()} select pg_sleep(0.8); commit;`, 'discard-before-claim');
  await db.waitFor('discard-before-claim', 'sleep');
  const claim = db.startSql('set role service_role; select claim_nfl_sync(191,true);', 'claim-after-discard');
  await db.waitFor('claim-after-discard', 'lock');
  assert.equal((await discard).ok, true); const result = await claim;
  assert.ok(!result.ok || JSON.parse(result.stdout).state === 'ineligible');
  assert.equal(db.sql('select count(*) from nfl_sync_state'), '0'); assert.deepEqual(db.graph(), empty);
});
pgtest('result appears after preview: transaction sees it after waiting and deletes nothing', async () => {
  assert.equal(db.inspect().eligible, true);
  const insert = db.startSql('begin; insert into team_slate_results(slate_id,team_id,fantasy_points) values(191,2,0); select pg_sleep(0.8); commit;', 'result-first');
  await db.waitFor('result-first', 'sleep');
  const discard = db.startSql(`set role service_role; ${db.call()}`, 'discard-after-result');
  await db.waitFor('discard-after-result', 'lock');
  assert.equal((await insert).ok, true); assert.equal(JSON.parse((await discard).stdout).code, 'scoring_exists'); assert.equal(db.graph().picks, 1);
});
pgtest('late scoring insert cannot race deletion; immediate parent FK prevents orphaned results', async () => {
  const discard = db.startSql(`begin; set local role service_role; ${db.call()} select pg_sleep(0.8); commit;`, 'discard-before-result');
  await db.waitFor('discard-before-result', 'sleep');
  const insert = db.startSql('insert into player_nfl_slate_stats values(191,283,0);', 'result-after-discard');
  await db.waitFor('result-after-discard', 'lock');
  assert.equal((await discard).ok, true); assert.equal((await insert).ok, false);
  assert.equal(db.sql('select count(*) from player_nfl_slate_stats'), '0'); assert.deepEqual(db.graph(), empty);
});
pgtest('two simultaneous discards serialize to one success and one clean not-found', async () => {
  const results = await Promise.all([db.asyncSql(`set role service_role; ${db.call()}`), db.asyncSql(`set role service_role; ${db.call()}`)]);
  assert.deepEqual(results.map(r => JSON.parse(r).code).sort(), ['discarded','not_found']); assert.deepEqual(db.graph(), empty);
});
pgtest('a trigger silently suppressing slate deletion rolls back the entire attempt', () => {
  const before = db.graph();
  db.sql('create function suppress_test_discard() returns trigger language plpgsql as $$begin return null; end$$; create trigger suppress_test_discard before delete on slates for each row execute function suppress_test_discard();');
  try { assert.equal(db.discard().code, 'dependency_failure'); assert.deepEqual(db.graph(), before); assert.equal(db.sql('select slate_id from notification_history'), '191'); }
  finally { db.sql('drop trigger suppress_test_discard on slates; drop function suppress_test_discard();'); }
});
pgtest('unknown cascading descendant history is rejected, never silently removed', () => {
  db.sql('create table test_pick_notes(id bigint primary key,pick_id bigint references draft_picks(id) on delete cascade); insert into test_pick_notes select 1,id from draft_picks;');
  try { assert.equal(db.discard().code, 'unreviewed_dependencies'); assert.equal(db.graph().picks, 1); assert.equal(db.sql('select count(*) from test_pick_notes'), '1'); }
  finally { db.sql('drop table test_pick_notes'); }
});
pgtest('the private capability cannot delete another slate even from a nested trigger', () => {
  db.sql(`insert into slates(id,league_id,sport,date,start_date,end_date,rules_snapshot,rules_version)
    select 400,league_id,sport,date,start_date,end_date,rules_snapshot,rules_version from slates where id=191;
    insert into slate_teams(slate_id,team_id,draft_order,is_participating) select 400,team_id,draft_order,is_participating from slate_teams where slate_id=191;
    set role service_role; ${db.pickSql(400)}`);
  db.sql('create function cross_slate_test_discard() returns trigger language plpgsql as $$begin delete from draft_picks where slate_id=400; return old; end$$; create trigger cross_slate_test_discard before delete on slates for each row execute function cross_slate_test_discard();');
  try {
    assert.equal(db.discard().code, 'dependency_failure'); assert.equal(db.graph().picks, 1);
    assert.equal(db.sql('select count(*) from draft_picks where slate_id=400'), '1');
    assert.equal(db.sql('select count(*) from nfl_slate_discard_context'), '0');
  } finally { db.sql('drop trigger cross_slate_test_discard on slates; drop function cross_slate_test_discard();'); }
});
pgtest('migration preflight rejects a missing scoring FK before changing protections', () => {
  const fs = require('node:fs');
  const migration = fs.readFileSync('supabase/migrations/20261006000100_guarded_nfl_slate_discard.sql', 'utf8');
  db.sql('alter table player_nfl_slate_stats drop constraint player_nfl_slate_stats_slate_id_fkey');
  try { assert.throws(() => db.sql(migration), /missing immediate validated player_nfl_slate_stats/); }
  finally { db.sql('alter table player_nfl_slate_stats add foreign key(slate_id) references slates(id)'); }
  assert.equal(db.inspect().eligible, true); assert.equal(db.graph().picks, 1);
});
pgtest('migration preflight rejects unexpected direct service-role history grants', () => {
  const fs = require('node:fs');
  db.sql('grant delete on draft_picks to service_role');
  try { assert.throws(() => db.sql(fs.readFileSync('supabase/migrations/20261006000100_guarded_nfl_slate_discard.sql', 'utf8')), /unexpected direct history writes/); }
  finally { db.sql('revoke delete on draft_picks from service_role'); }
  assert.equal(db.inspect().eligible, true);
});
pgtest('suppressed roster-player deletion cannot leave an orphan even under CASCADE', () => {
  const before = db.graph();
  db.sql('create function suppress_player_test_discard() returns trigger language plpgsql as $$begin return null; end$$; create trigger suppress_player_test_discard before delete on lineup_players for each row execute function suppress_player_test_discard();');
  try { assert.equal(db.discard().code, 'dependency_failure'); assert.deepEqual(db.graph(), before); assert.equal(db.sql('select count(*) from lineup_players'), '1'); }
  finally { db.sql('drop trigger suppress_player_test_discard on lineup_players; drop function suppress_player_test_discard();'); }
});
pgtest('a started NBA draft remains immutable and cannot use the NFL discard capability', () => {
  const nba = { sport: 'nba', draft: { type: 'snake' }, roster: { slots: [{ position: 'F/C', slotCount: 3 }] } };
  db.sql(`update slates set sport='nba',rules_snapshot=${json(nba)} where id=300;
    update leagues set sport_key='nba' where id='${ids.otherLeague}';
    insert into players values(100,'NBA center','F/C',true);
    set role service_role;
    select mutate_fantasy_draft(300,'${ids.other}','${ids.otherLeague}','nba',6,'${ids.outsider}',${json({
      desired_ids: [100], expected_ids: [], rules_snapshot: nba,
      roster_slots: [{ position: 'F/C', slot_count: 3 }], assignments: [{ player_id: 100, position: 'F/C', slot_index: 0 }],
    })});`);
  assert.equal(db.discard(300, ids.outsider, ids.other, ids.otherLeague).code, 'unsupported_sport');
  assert.throws(() => db.sql('delete from draft_picks where slate_id=300'), /immutable/);
  assert.throws(() => db.sql('delete from fantasy_drafts where slate_id=300'), /immutable/);
  assert.throws(() => db.sql('set role service_role; delete from lineup_players where lineup_id in (select id from lineups where slate_id=300)'), /authoritative fantasy/);
  assert.throws(() => db.sql('update slate_teams set is_participating=false where slate_id=300'), /participant order is frozen/);
  assert.equal(db.sql('select count(*) from draft_picks where slate_id=300'), '1');
});
