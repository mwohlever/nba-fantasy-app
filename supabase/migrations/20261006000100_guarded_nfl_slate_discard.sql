-- MANUAL REVIEW/APPLICATION ONLY. No existing slate or history is changed.
-- Apply before deploying the matching Discard Slate UI/API. NFL only.
begin;

-- Verify the FKs that fence concurrent inserts while the parent is locked.
-- The pre-existing schema is not fully represented by repository migrations.
do $$
declare dependency text; protection record;
begin
  foreach dependency in array array['lineups','slate_teams','fantasy_drafts',
    'draft_corrections','team_slate_results','player_slate_stats',
    'player_nfl_slate_stats','nfl_sync_state','notification_history'] loop
    if not exists (
      select 1 from pg_constraint c
      join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
      join pg_attribute p on p.attrelid=c.confrelid and p.attnum=c.confkey[1]
      where c.contype='f' and c.convalidated and not c.condeferrable
        and c.conrelid=to_regclass('public.'||dependency)
        and c.confrelid='public.slates'::regclass
        and cardinality(c.conkey)=1 and a.attname='slate_id' and p.attname='id'
    ) then raise exception 'Discard migration stopped: missing immediate validated %.slate_id -> slates.id FK',dependency; end if;
  end loop;
  if not exists (select 1 from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    join pg_attribute p on p.attrelid=c.confrelid and p.attnum=c.confkey[1]
    where c.contype='f' and cardinality(c.conkey)=1 and a.attname='lineup_id' and p.attname='id'
    and c.convalidated and not c.condeferrable and c.conrelid='public.lineup_players'::regclass
    and c.confrelid='public.lineups'::regclass) then
    raise exception 'Discard migration stopped: missing immediate lineup_players -> lineups FK';
  end if;
  if exists(select 1 from pg_attribute where attrelid='public.notification_history'::regclass
    and attname='slate_id' and attnotnull) then
    raise exception 'Discard migration stopped: notification_history.slate_id must support detaching delivery audit'; end if;
  -- Replace only the already-installed protections, under their existing
  -- trusted owner. No new grants on protected history are introduced.
  for protection in select * from (values
    ('lineup_players','fantasy_roster_write_guard','guard_fantasy_roster_write'),
    ('lineups','fantasy_lineup_write_guard','guard_fantasy_roster_write'),
    ('draft_picks','draft_picks_immutable','guard_fantasy_history'),
    ('draft_corrections','draft_corrections_immutable','guard_fantasy_history'),
    ('fantasy_drafts','fantasy_drafts_immutable','guard_fantasy_history'),
    ('slate_teams','fantasy_participant_configuration_guard','guard_fantasy_configuration'),
    ('slates','fantasy_slate_configuration_guard','guard_fantasy_configuration')
  ) protections(table_name,trigger_name,function_name) loop
    if not exists(select 1 from pg_trigger t join pg_proc p on p.oid=t.tgfoid
      where t.tgrelid=to_regclass('public.'||protection.table_name)
        and t.tgname=protection.trigger_name and t.tgenabled in ('O','A')
        and p.oid=to_regprocedure('public.'||protection.function_name||'()')
        and p.proowner=(select oid from pg_roles where rolname=current_user)) then
      raise exception 'Discard migration stopped: unexpected or missing %; apply as the existing protection owner',protection.trigger_name; end if;
  end loop;
  foreach dependency in array array['fantasy_drafts','draft_picks','draft_corrections'] loop
    if has_table_privilege('service_role','public.'||dependency,'INSERT,UPDATE,DELETE') then
      raise exception 'Discard migration stopped: service_role has unexpected direct history writes on %',dependency; end if;
  end loop;
end;
$$;

-- Private capability, never a user-settable GUC. Created and removed in one
-- transaction by the owner-only body of discard_abandoned_nfl_slate().
create table public.nfl_slate_discard_context (
  transaction_id bigint not null,
  backend_pid integer not null,
  slate_id bigint not null,
  primary key(transaction_id,backend_pid)
);
alter table public.nfl_slate_discard_context enable row level security;
revoke all on public.nfl_slate_discard_context from public,anon,authenticated,service_role;

create function public.is_nfl_slate_discard_authorized(p_slate_id bigint)
returns boolean language sql security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.nfl_slate_discard_context
    where transaction_id=txid_current() and backend_pid=pg_backend_pid() and slate_id=p_slate_id);
$$;
revoke all on function public.is_nfl_slate_discard_authorized(bigint) from public,anon,authenticated,service_role;

create or replace function public.guard_fantasy_roster_write() returns trigger language plpgsql security definer set search_path=public as $$
declare target_slate bigint; target_sport text;
begin
  if tg_table_name='lineup_players' then
    select l.slate_id,s.sport into target_slate,target_sport from lineups l join slates s on s.id=l.slate_id
      where l.id=case when tg_op='DELETE' then old.lineup_id else new.lineup_id end;
    if tg_op='UPDATE' and old.lineup_id<>new.lineup_id and (target_sport in ('nba','nfl') or exists(
      select 1 from lineups l join slates s on s.id=l.slate_id where l.id=old.lineup_id and s.sport in ('nba','nfl')))
      then raise exception 'Moving fantasy lineup player rows is not supported'; end if;
  else
    target_slate := case when tg_op='DELETE' then old.slate_id else new.slate_id end;
    select sport into target_sport from slates where id=target_slate;
    if tg_op='UPDATE' and (old.slate_id<>new.slate_id or old.team_id<>new.team_id) and
      (target_sport in ('nba','nfl') or exists(select 1 from slates where id=old.slate_id and sport in ('nba','nfl')))
      then raise exception 'Moving fantasy lineups is not supported'; end if;
  end if;
  if target_sport in ('nba','nfl') then
    perform 1 from slates where id=target_slate for update;
    if not (tg_op='DELETE' and public.is_nfl_slate_discard_authorized(target_slate))
      and current_setting('app.fantasy_draft_mutation',true) is distinct from 'on' then raise exception 'Use the authoritative fantasy draft/correction API'; end if;
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create or replace function public.guard_fantasy_history() returns trigger language plpgsql set search_path=public as $$
begin
  if tg_op='DELETE' and public.is_nfl_slate_discard_authorized(old.slate_id) then return old; end if;
  -- Dispatch before accessing table-specific record fields: configuration and
  -- correction rows have no status field. The permitted reversal is unchanged.
  if tg_table_name='draft_picks' and tg_op='UPDATE' then
    if old.status='active' and new.status='reversed'
      and current_setting('app.fantasy_draft_mutation',true)='on'
      and (to_jsonb(old)-array['status','reversed_at','reversed_by'])=(to_jsonb(new)-array['status','reversed_at','reversed_by']) then return new; end if;
  end if;
  raise exception 'Draft history/configuration is immutable; record a correction';
end;
$$;

-- Read-only eligibility for Slate Admin. The destructive RPC rechecks under
-- locks; a successful preview is never authorization to bypass these checks.
create function public.inspect_nfl_slate_discard(
  p_slate_id bigint,p_group_id uuid,p_league_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.slates%rowtype; dependency record; predicate text; populated boolean;
begin
  select * into s from public.slates where id=p_slate_id;
  if not found or s.league_id is distinct from p_league_id or not exists (
    select 1 from public.leagues l join public.groups g on g.id=l.group_id
    join public.app_users a on a.id=p_actor_id and a.is_active
    where l.id=s.league_id and l.group_id=p_group_id
      and (a.system_role='super_admin' or (g.is_active and l.is_enabled and exists (
        select 1 from public.group_memberships m where m.group_id=l.group_id
          and m.user_id=a.id and m.is_active and m.role='admin')))
  ) then return jsonb_build_object('eligible',false,'code','not_found','reason','Slate not found in an authorized Group.'); end if;
  if s.sport is distinct from 'nfl' or not exists (
    select 1 from public.leagues where id=s.league_id and sport_key='nfl'
  ) then return jsonb_build_object('eligible',false,'code','unsupported_sport','reason','Discard is available only for pre-game NFL slates.'); end if;
  if s.is_locked is distinct from false then
    return jsonb_build_object('eligible',false,'code','locked','reason','Locked slates cannot be discarded.'); end if;
  if s.start_date is null or s.end_date is null or s.end_date<s.start_date then
    return jsonb_build_object('eligible',false,'code','schedule_uncertain','reason','The slate schedule cannot establish pre-game status.'); end if;
  if s.start_date <= (clock_timestamp() at time zone 'America/New_York')::date
    or (s.first_game_start_time is not null and s.first_game_start_time<=clock_timestamp()) then
    return jsonb_build_object('eligible',false,'code','not_pre_game','reason','Discard is allowed only before the slate start day.'); end if;
  if exists(select 1 from public.team_slate_results where slate_id=s.id)
    or exists(select 1 from public.player_slate_stats where slate_id=s.id)
    or exists(select 1 from public.player_nfl_slate_stats where slate_id=s.id) then
    return jsonb_build_object('eligible',false,'code','scoring_exists','reason','Slates with any result or scoring records cannot be discarded.'); end if;
  -- Even an idle/expired/failed row is evidence of scoring setup/activity.
  -- Reject all state, including leases whose workers may still be running.
  if exists(select 1 from public.nfl_sync_state where slate_id=s.id) then
    return jsonb_build_object('eligible',false,'code','scoring_activity','reason','NFL scoring activity prevents discard.'); end if;
  if exists(select 1 from public.draft_picks where slate_id=s.id and source='verified_backfill') then
    return jsonb_build_object('eligible',false,'code','historical_draft','reason','Verified historical draft records cannot be discarded.'); end if;
  if exists(select 1 from public.fantasy_drafts where slate_id=s.id and
      (group_id is distinct from p_group_id or league_id is distinct from s.league_id or sport is distinct from 'nfl'))
    or exists(select 1 from public.draft_corrections where slate_id=s.id and
      (group_id is distinct from p_group_id or league_id is distinct from s.league_id or sport is distinct from 'nfl'))
    or exists(select 1 from public.lineups l join public.teams t on t.id=l.team_id
      where l.slate_id=s.id and t.group_id is distinct from p_group_id)
    or exists(select 1 from public.slate_teams st join public.teams t on t.id=st.team_id
      where st.slate_id=s.id and t.group_id is distinct from p_group_id)
    or exists(select 1 from public.draft_picks p join public.teams t on t.id=p.team_id
      where p.slate_id=s.id and t.group_id is distinct from p_group_id)
    or exists(select 1 from public.draft_corrections c join public.teams t on t.id=c.team_id
      where c.slate_id=s.id and t.group_id is distinct from p_group_id)
    or exists(select 1 from public.fantasy_drafts d cross join lateral unnest(d.participant_ids) participant(team_id)
      left join public.teams t on t.id=participant.team_id
      where d.slate_id=s.id and t.group_id is distinct from p_group_id) then
    return jsonb_build_object('eligible',false,'code','scope_mismatch','reason','Slate dependencies require ownership review.'); end if;

  -- Refuse populated dependencies outside the reviewed NFL graph, including
  -- Golf/NBA records or newly added CASCADE children. Never silently erase them.
  for dependency in
    select c.conrelid,c.confrelid,c.conkey,c.confkey,n.nspname,t.relname,p.relname parent_name
    from pg_constraint c join pg_class t on t.oid=c.conrelid
    join pg_namespace n on n.oid=t.relnamespace join pg_class p on p.oid=c.confrelid
    where c.contype='f' and c.confrelid in (
      'public.slates'::regclass,'public.fantasy_drafts'::regclass,'public.draft_picks'::regclass,
      'public.draft_corrections'::regclass,'public.lineups'::regclass,
      'public.lineup_players'::regclass,'public.slate_teams'::regclass)
      and not (n.nspname='public' and (
        (p.relname='slates' and t.relname=any(array['fantasy_drafts','draft_corrections',
          'lineups','slate_teams','team_slate_results','player_slate_stats',
          'player_nfl_slate_stats','nfl_sync_state','notification_history']))
        or (p.relname='fantasy_drafts' and t.relname='draft_picks')
        or (p.relname='draft_picks' and t.relname='draft_corrections')
        or (p.relname='lineups' and t.relname='lineup_players')))
  loop
    select string_agg(format('child.%I=parent.%I',a.attname,b.attname),' and ')
      into predicate from unnest(dependency.conkey,dependency.confkey) keys(child_key,parent_key)
      join pg_attribute a on a.attrelid=dependency.conrelid and a.attnum=keys.child_key
      join pg_attribute b on b.attrelid=dependency.confrelid and b.attnum=keys.parent_key;
    execute format('select exists(select 1 from %I.%I child join %s parent on %s %s where %s=$1)',
      dependency.nspname,dependency.relname,dependency.confrelid::regclass,predicate,
      case when dependency.parent_name='lineup_players' then 'join public.lineups l on l.id=parent.lineup_id' else '' end,
      case when dependency.parent_name='slates' then 'parent.id'
        when dependency.parent_name='lineup_players' then 'l.slate_id' else 'parent.slate_id' end)
      into populated using s.id;
    if populated then return jsonb_build_object('eligible',false,'code','unreviewed_dependencies',
      'reason','Additional slate dependencies require review before discard.'); end if;
  end loop;
  return jsonb_build_object('eligible',true,'code','eligible','reason',null);
end;
$$;

create function public.discard_abandoned_nfl_slate(
  p_slate_id bigint,p_group_id uuid,p_league_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.slates%rowtype; eligibility jsonb; notifications_detached integer; deleted_slate bigint;
  lineup_ids bigint[]; lineup_player_ids bigint[];
begin
  -- Draft/correction RPCs use this same first lock. Immediate child FKs take
  -- KEY SHARE locks, so concurrent scoring claims/inserts must wait or win
  -- before this lock; the subsequent checks then see their committed state.
  select * into s from public.slates where id=p_slate_id for update;
  if not found then return jsonb_build_object('success',false,'code','not_found','reason','Slate not found.'); end if;
  -- Keep ownership/authorization stable through the destructive transaction.
  perform id from public.app_users where id=p_actor_id for share;
  perform id from public.leagues where id=s.league_id for share;
  perform id from public.groups where id=p_group_id for share;
  perform id from public.group_memberships where group_id=p_group_id and user_id=p_actor_id for share;
  -- Fence concurrent inserts referencing any existing descendant before
  -- inspecting unexpected dependencies (including cascade children).
  perform slate_id from public.fantasy_drafts where slate_id=s.id for update;
  perform id from public.draft_picks where slate_id=s.id for update;
  perform id from public.draft_corrections where slate_id=s.id for update;
  perform id from public.lineups where slate_id=s.id for update;
  select coalesce(array_agg(id::bigint),'{}'::bigint[]) into lineup_ids from public.lineups where slate_id=s.id;
  perform lp.id from public.lineup_players lp join public.lineups l on l.id=lp.lineup_id where l.slate_id=s.id for update of lp;
  select coalesce(array_agg(id::bigint),'{}'::bigint[]) into lineup_player_ids from public.lineup_players where lineup_id=any(lineup_ids);
  perform id from public.slate_teams where slate_id=s.id for update;
  eligibility:=public.inspect_nfl_slate_discard(s.id,p_group_id,p_league_id,p_actor_id);
  if not (eligibility->>'eligible')::boolean then
    return (eligibility-'eligible')||jsonb_build_object('success',false); end if;

  -- This exception block is a PostgreSQL subtransaction: any dependency or
  -- trigger failure rolls back EVERY delete, detach and capability insert.
  begin
    insert into public.nfl_slate_discard_context values(txid_current(),pg_backend_pid(),s.id);
    delete from public.draft_corrections where slate_id=s.id;
    delete from public.draft_picks where slate_id=s.id;
    delete from public.lineup_players where id=any(lineup_player_ids);
    delete from public.lineups where slate_id=s.id;
    delete from public.fantasy_drafts where slate_id=s.id;
    delete from public.slate_teams where slate_id=s.id;
    -- Delivery audit survives; competitive records do not. Retain league,
    -- recipient, content and delivery outcome, with no dangling slate FK.
    update public.notification_history set slate_id=null,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('discardedSlate',
        jsonb_build_object('id',s.id,'label',s.display_name,'discardedAt',clock_timestamp(),'actorUserId',p_actor_id))
      where slate_id=s.id;
    get diagnostics notifications_detached=row_count;
    -- Scoring/result/state tables were proven empty, not erased to make an
    -- otherwise ineligible slate pass. Unexpected non-FK dependencies fail
    -- normally, rolling back this entire block.
    if exists(select 1 from public.draft_corrections where slate_id=s.id)
      or exists(select 1 from public.draft_picks where slate_id=s.id)
      or exists(select 1 from public.fantasy_drafts where slate_id=s.id)
      or exists(select 1 from public.lineups where slate_id=s.id)
      or exists(select 1 from public.lineup_players where id=any(lineup_player_ids) or lineup_id=any(lineup_ids))
      or exists(select 1 from public.slate_teams where slate_id=s.id)
      or exists(select 1 from public.notification_history where slate_id=s.id) then
      raise exception 'Incomplete dependency cleanup'; end if;
    -- Also fail closed if a trigger suppresses deletion without raising.
    delete from public.slates where id=s.id returning id into deleted_slate;
    if deleted_slate is distinct from s.id then raise exception 'Slate was not removed'; end if;
    delete from public.nfl_slate_discard_context where transaction_id=txid_current() and backend_pid=pg_backend_pid();
  exception when others then
    return jsonb_build_object('success',false,'code','dependency_failure',
      'reason','Discard failed while removing dependencies. No records were removed.');
  end;
  return jsonb_build_object('success',true,'code','discarded','slateId',s.id,'notificationsDetached',notifications_detached);
end;
$$;

revoke all on function public.inspect_nfl_slate_discard(bigint,uuid,uuid,uuid),
  public.discard_abandoned_nfl_slate(bigint,uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inspect_nfl_slate_discard(bigint,uuid,uuid,uuid),
  public.discard_abandoned_nfl_slate(bigint,uuid,uuid,uuid) to service_role;
-- Existing draft table privileges and participant/rule freeze triggers remain unchanged.
commit;
