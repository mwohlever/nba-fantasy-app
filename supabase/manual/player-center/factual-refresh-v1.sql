-- REVIEW ONLY: manual Supabase SQL Editor installation, never auto-applied.
-- After approval, change ONLY the installation setting below to INSTALL_NBA_FACTUAL_REFRESH_V1.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
set local sports111.factual_refresh_approval = 'REVIEW_ONLY';
do $guard$ begin
  if current_setting('sports111.factual_refresh_approval',true) <> 'INSTALL_NBA_FACTUAL_REFRESH_V1' then
    raise exception 'Factual refresh installation is not approved';
  end if;
  if to_regprocedure('public.append_nba_projection_observations(jsonb)') is null then
    raise exception 'Existing semantic append RPC must be installed first';
  end if;
  if (select md5(prosrc) from pg_proc where oid='public.append_nba_projection_observations(jsonb)'::regprocedure) is distinct from '9308a04b52fecc6993b7730490cf686a' then raise exception 'Reviewed semantic append RPC changed'; end if;
  if to_regclass('public.player_center_season_cache') is not null and
     obj_description(to_regclass('public.player_center_season_cache'),'pg_class') is distinct from '111 Sports Player Center raw season cache v1' then
    raise exception 'Unreviewed season cache exists';
  end if;
  if to_regclass('public.player_center_season_cache') is not null and
    (select array_agg(attname::text order by attnum) from pg_attribute where attrelid=to_regclass('public.player_center_season_cache') and attnum>0 and not attisdropped)
    is distinct from array['sport','provider','provider_player_id','season','phase','nba_local_player_id','nfl_local_player_id','as_of','checked_at','expected_games','observed_games','complete','games','season_stats','issues','content_hash','rollout_batch_id'] then raise exception 'Unexpected season cache columns'; end if;
  if to_regclass('public.player_center_nba_refresh_status') is not null and obj_description(to_regclass('public.player_center_nba_refresh_status'),'pg_class') is distinct from '111 Sports NBA latest refresh status v1' then raise exception 'Unreviewed refresh status exists'; end if;
end $guard$;
create table if not exists public.player_center_season_cache (
  sport text not null check(sport in('nba','nfl')),
  provider text not null default 'espn' check(provider='espn'),
  provider_player_id text not null check(provider_player_id ~ '^[0-9]+$'),
  season integer not null check(season between 2000 and 2100),
  phase text not null check(phase='regular'),
  nba_local_player_id bigint references public.players(id) on delete restrict,
  nfl_local_player_id bigint references public.players_nfl(id) on delete restrict,
  as_of timestamptz not null,
  checked_at timestamptz not null check(checked_at>=as_of),
  expected_games integer check(expected_games between 0 and 110),
  observed_games integer not null check(observed_games between 0 and 110),
  complete boolean not null default false,
  games jsonb not null check(jsonb_typeof(games)='array'),
  season_stats jsonb,
  issues jsonb not null check(jsonb_typeof(issues)='array'),
  content_hash text not null check(content_hash ~ '^[0-9a-f]{64}$'),
  rollout_batch_id text not null,
  primary key(sport,provider,provider_player_id,season,phase),
  check((sport='nba' and nba_local_player_id is not null and nfl_local_player_id is null) or (sport='nfl' and nfl_local_player_id is not null and nba_local_player_id is null)),
  check(jsonb_array_length(games)<=case when sport='nba' then 110 else 25 end),
  check(observed_games<=jsonb_array_length(games)),
  check(not complete or (expected_games is not null and observed_games=expected_games)),
  check(octet_length(games::text)<=524288),
  check(not jsonb_path_exists(games,'$[*].stats.fantasy_points'))
);
comment on table public.player_center_season_cache is '111 Sports Player Center raw season cache v1';
alter table public.player_center_season_cache enable row level security;
revoke all on public.player_center_season_cache from public,anon,authenticated,service_role;
grant select on public.player_center_season_cache to service_role;

-- One latest status per player-season, not append-only fetch history.
create table if not exists public.player_center_nba_refresh_status (
  player_id bigint not null references public.players(id) on delete restrict,
  season integer not null check(season between 2000 and 2100),
  native_player_id bigint,
  provider_player_id text check(provider_player_id ~ '^[0-9]+$'),
  run_id uuid not null,
  as_of timestamptz not null,
  outcome text not null check(outcome in ('verified_data','verified_zero_appearances','coverage_incomplete','acquisition_failed','blocked_identity')),
  last_attempt_at timestamptz not null,
  last_acquired_at timestamptz,
  last_verified_at timestamptz,
  issues jsonb not null check(jsonb_typeof(issues)='array' and octet_length(issues::text)<=8192),
  receipt_hash text not null,
  appended_versions integer not null check(appended_versions>=0),
  expected_games integer check(expected_games between 0 and 110),
  observed_games integer check(observed_games between 0 and 110),
  last_failure_at timestamptz,
  last_failure_issues jsonb not null default '[]'::jsonb check(jsonb_typeof(last_failure_issues)='array' and octet_length(last_failure_issues::text)<=8192),
  primary key(player_id,season),
  check(last_attempt_at>=as_of),
  check(last_acquired_at is null or last_acquired_at<=last_attempt_at),
  check(last_verified_at is null or last_verified_at<=last_attempt_at)
);
comment on table public.player_center_nba_refresh_status is '111 Sports NBA latest refresh status v1';
alter table public.player_center_nba_refresh_status enable row level security;
revoke all on public.player_center_nba_refresh_status from public,anon,authenticated,service_role;
grant select on public.player_center_nba_refresh_status to service_role;

create or replace function public.player_center_nba_refresh_health(full_check boolean default false)
returns jsonb language sql security definer set search_path=pg_catalog,public as $fn$
  select jsonb_build_object(
    'append_source_hash',(select md5(prosrc) from pg_proc where oid='public.append_nba_projection_observations(jsonb)'::regprocedure),
    'database_bytes',pg_database_size(current_database()),
    'cache_bytes',pg_total_relation_size('public.player_center_season_cache')+pg_total_relation_size('public.player_center_nba_refresh_status'),
    'history_bytes',pg_total_relation_size('public.nba_player_game_observation_versions'),
    'wal_bytes',(select coalesce(sum(size),0) from pg_ls_waldir()),
    'schema_ok',(select md5(prosrc)='9308a04b52fecc6993b7730490cf686a' and prosecdef from pg_proc where oid='public.append_nba_projection_observations(jsonb)'::regprocedure) and (select count(*)=2 and bool_and(tgenabled='O' and ((tgname='nba_observation_versions_immutable' and tgfoid='public.reject_nba_projection_observation_version_mutation()'::regprocedure) or (tgname='nba_observation_versions_sync_current' and tgfoid='public.sync_nba_current_observation()'::regprocedure))) from pg_trigger where tgrelid='public.nba_player_game_observation_versions'::regclass and not tgisinternal)
      and (select count(*)=4 and bool_and(indisvalid and indisready) from pg_index where indrelid='public.nba_player_game_observation_versions'::regclass)
      and (select count(*)=2 and bool_and(relrowsecurity) from pg_class where oid in ('public.nba_player_game_observation_versions'::regclass,'public.nba_player_game_current_observations'::regclass))
      and not exists(select 1 from pg_index where indrelid in ('public.nba_player_game_observation_versions'::regclass,'public.nba_player_game_current_observations'::regclass) and not(indisvalid and indisready))
      and not exists(select 1 from pg_constraint where conrelid in ('public.nba_player_game_observation_versions'::regclass,'public.nba_player_game_current_observations'::regclass) and not convalidated)
      and exists(select 1 from pg_constraint where conrelid='public.nba_player_game_current_observations'::regclass and confrelid='public.nba_player_game_observation_versions'::regclass and contype='f' and confdeltype='r' and convalidated),
    'history_count',case when full_check then (select count(*) from public.nba_player_game_observation_versions) end,
    'current_count',case when full_check then (select count(*) from public.nba_player_game_current_observations) end,
    'watermark',case when full_check then (select max(id) from public.nba_player_game_observation_versions) end,
    'current_checksum',case when full_check then (select md5(string_agg(md5(to_jsonb(c)::text),'' order by provider,provider_player_id,provider_event_id)) from public.nba_player_game_current_observations c) end,
    'reference_errors',case when full_check then (select count(*) from public.nba_player_game_current_observations c left join public.nba_player_game_observation_versions v on v.id=c.version_id left join lateral (select h.id from public.nba_player_game_observation_versions h where h.provider=c.provider and h.provider_player_id=c.provider_player_id and h.provider_event_id=c.provider_event_id order by h.provider_fetched_at desc,h.id desc limit 1) latest on true where v.id is null or latest.id is distinct from c.version_id or (to_jsonb(c)-'version_id') is distinct from (to_jsonb(v)-'id')) + (select count(*) from (select distinct provider,provider_player_id,provider_event_id from public.nba_player_game_observation_versions) h where not exists(select 1 from public.nba_player_game_current_observations c where c.provider=h.provider and c.provider_player_id=h.provider_player_id and c.provider_event_id=h.provider_event_id)) end
  )
$fn$;

-- The existing semantic append RPC, history triggers and current-table privileges are not changed.
create or replace function public.publish_player_center_nba_refresh(run_id uuid, season integer, as_of timestamptz, publications jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public set lock_timeout='3s' as $fn$
#variable_conflict use_variable
declare
  item jsonb; snapshot jsonb; record jsonb; old public.player_center_nba_refresh_status%rowtype;
  cache_row public.player_center_season_cache%rowtype;
  native_id bigint; actual_native_id bigint; local_id bigint; provider_id text; valid_identity boolean;
  fingerprint text; received timestamptz; acquired timestamptz; outcome text;
  appended integer; accepted integer; total_appended integer:=0; total_accepted integer:=0; replayed integer:=0;
  records jsonb; part jsonb; pos integer; item_count integer;
begin
  if run_id is null or season is null or season not between 2000 and 2100 or season>(extract(year from clock_timestamp())::integer+(case when extract(month from clock_timestamp())>=10 then 1 else 0 end)) or as_of is null or as_of>clock_timestamp()
     or jsonb_typeof(publications) is distinct from 'array' then raise exception 'Invalid refresh envelope'; end if;
  item_count:=jsonb_array_length(publications);
  if item_count not between 1 and 5 or octet_length(publications::text)>3000000 then raise exception 'Publication batch cap exceeded'; end if;
  if (select count(distinct (x->>'player_id')::bigint) from jsonb_array_elements(publications) x)<>item_count then raise exception 'Duplicate publication player'; end if;
  perform pg_advisory_xact_lock(hashtextextended('111sports:player-center-nba-publication',0));
  lock table public.players in share mode;
  lock table public.nba_player_provider_identities in share mode;
  if pg_database_size(current_database())+octet_length(publications::text)*6+4194304>450000000 or
     pg_total_relation_size('public.player_center_season_cache')+pg_total_relation_size('public.player_center_nba_refresh_status')+octet_length(publications::text)*6+1048576>67108864 then
    raise exception 'Factual refresh storage budget exceeded';
  end if;
  if not coalesce((public.player_center_nba_refresh_health(false)->>'schema_ok')::boolean,false) then raise exception 'Observation integrity gate failed'; end if;
  for item in select x from jsonb_array_elements(publications) x order by (x->>'player_id')::bigint loop
    local_id:=(item->>'player_id')::bigint; native_id:=(item->>'native_player_id')::bigint;
    provider_id:=item->>'provider_player_id'; outcome:=item->>'outcome';
    received:=(item->>'attempted_at')::timestamptz; acquired:=(item->>'acquired_at')::timestamptz;
    fingerprint:=md5(item::text); records:=item->'observations'; snapshot:=nullif(item->'cache','null'::jsonb);
    if received is null or received<as_of or received>clock_timestamp()+interval '5 seconds' or acquired>received or acquired<as_of or
       jsonb_typeof(records) is distinct from 'array' or jsonb_array_length(records)>110 or
       jsonb_typeof(item->'issues') is distinct from 'array' or octet_length((item->'issues')::text)>8192 or
       outcome is null or outcome not in ('verified_data','verified_zero_appearances','coverage_incomplete','acquisition_failed','blocked_identity') then raise exception 'Invalid acquisition metadata'; end if;
    select case when p.nba_player_id>0 then p.nba_player_id end into actual_native_id from public.players p where p.id=local_id and p.is_active for share;
    if not found then raise exception 'Player inactive/missing'; end if;
    if actual_native_id is distinct from native_id then raise exception 'Native catalog drift'; end if;
    perform 1 from public.nba_player_provider_identities i where i.player_id=local_id for share;
    select exists(select 1 from public.players p join public.nba_player_provider_identities i on i.player_id=p.id
      where p.id=local_id and p.nba_player_id=native_id and p.is_active and i.provider='espn' and i.provider_player_id=provider_id
        and i.resolution_status='resolved' and length(trim(i.evidence))>0
        and (select count(*) from public.nba_player_provider_identities j where j.player_id=p.id and j.resolution_status='resolved' and j.provider='espn')=1
        and (select count(*) from public.players q where q.nba_player_id=p.nba_player_id)=1) into valid_identity;
    if (item->>'identity'='resolved' and not valid_identity) or (item->>'identity' is distinct from 'resolved' and (outcome<>'blocked_identity' or snapshot is not null or jsonb_array_length(records)<>0)) then raise exception 'Identity drift or unreviewed publication'; end if;
    if outcome='blocked_identity' and exists(select 1 from public.players p join public.nba_player_provider_identities i on i.player_id=p.id
      where p.id=local_id and p.nba_player_id>0 and p.is_active and i.provider='espn' and i.resolution_status='resolved' and length(trim(i.evidence))>0
        and (select count(*) from public.nba_player_provider_identities j where j.player_id=p.id and j.provider='espn' and j.resolution_status='resolved')=1
        and (select count(*) from public.players q where q.nba_player_id=p.nba_player_id)=1) then raise exception 'Blocked identity changed; obtain a new cohort'; end if;
    select * into old from public.player_center_nba_refresh_status s where s.player_id=local_id and s.season=publish_player_center_nba_refresh.season for update;
    if found then
      if old.last_attempt_at>received or old.as_of>as_of or (old.as_of=as_of and old.run_id<>run_id) or (old.run_id=run_id and old.as_of<>as_of) then raise exception 'Stale/conflicting refresh run'; end if;
      if old.run_id=run_id then
        if old.receipt_hash<>fingerprint then raise exception 'Changed replay payload'; end if;
        replayed:=replayed+1; continue;
      end if;
    end if;
    if snapshot is null and outcome in ('verified_data','verified_zero_appearances','coverage_incomplete') then raise exception 'Missing cache publication'; end if;
    if snapshot is not null then
      select * into cache_row from jsonb_populate_record(null::public.player_center_season_cache,snapshot);
      if cache_row.sport is distinct from 'nba' or cache_row.provider is distinct from 'espn' or cache_row.provider_player_id is distinct from provider_id or
         cache_row.nba_local_player_id is distinct from local_id or cache_row.nfl_local_player_id is not null or cache_row.season is distinct from season or
         cache_row.phase is distinct from 'regular' or cache_row.as_of is distinct from as_of or cache_row.checked_at is distinct from acquired or
         cache_row.rollout_batch_id is distinct from run_id::text or (cache_row.season_stats is not null and (cache_row.season_stats->>'season' is distinct from season::text or cache_row.season_stats->>'phase' is distinct from 'regular')) or jsonb_typeof(cache_row.games) is distinct from 'array' or jsonb_array_length(cache_row.games)>110 or
         octet_length(snapshot::text)>524288 then raise exception 'Invalid cache binding'; end if;
      if outcome in ('verified_data','verified_zero_appearances') then
        if cache_row.complete is distinct from true or cache_row.expected_games is distinct from cache_row.observed_games or
           cache_row.expected_games is null or cache_row.season_stats->>'expectedGames' is distinct from cache_row.expected_games::text or
           cache_row.issues is distinct from '[]'::jsonb or item->'issues' is distinct from '[]'::jsonb then raise exception 'Unverified coverage'; end if;
        if (outcome='verified_zero_appearances') is distinct from (cache_row.expected_games=0) then raise exception 'Invalid zero/data classification'; end if;
      elsif outcome<>'coverage_incomplete' or cache_row.complete is distinct from false then raise exception 'Invalid incomplete cache'; end if;
      if exists(select 1 from public.player_center_season_cache c where c.sport='nba' and c.provider='espn' and c.provider_player_id=provider_id and c.season=season and c.phase='regular' and (c.as_of>as_of or c.checked_at>acquired)) then raise exception 'Newer cache already exists'; end if;
      if (select count(*) from jsonb_array_elements(cache_row.games) g where g->>'status'='final' and g->>'participation'='played' and (g->>'gameAt')::timestamptz<=as_of)<>cache_row.observed_games or
         (select count(distinct g->>'eventId') from jsonb_array_elements(cache_row.games) g)<>jsonb_array_length(cache_row.games) then raise exception 'Cache game counts/duplicates differ'; end if;
      if exists(select 1 from jsonb_array_elements(cache_row.games) g where not (g ?& array['provider','providerPlayerId','eventId','season','phase','gameAt','fetchedAt','stats','status','participation','issues']) or
        coalesce(g->>'eventId','') !~ '^[0-9]+$' or g->>'gameAt' is null or g->>'fetchedAt' is null or jsonb_typeof(g->'stats') is distinct from 'object' or
        coalesce(g->>'status','') not in ('final','live','scheduled','unknown') or coalesce(g->>'participation','') not in ('played','dnp','unknown') or
        (cache_row.complete and (((g->>'gameAt')::timestamptz<=as_of and (g->>'status'<>'final' or g->>'participation'='unknown' or g->'issues'<>'[]'::jsonb)) or ((g->>'gameAt')::timestamptz>as_of and g->>'status'<>'scheduled'))) or g->>'provider' is distinct from 'espn' or g->>'providerPlayerId' is distinct from provider_id or (g->>'season')::integer is distinct from season or g->>'phase' is distinct from 'regular' or
        (g->>'fetchedAt')::timestamptz>acquired or (g->>'gameAt')::timestamptz<make_timestamptz(season-1,9,1,0,0,0,'UTC') or (g->>'gameAt')::timestamptz>=make_timestamptz(season,9,1,0,0,0,'UTC') or
        exists(select 1 from jsonb_each(g->'stats') s where s.key ~* 'fantasy|projection' or jsonb_typeof(s.value) not in ('number','null'))) then raise exception 'Invalid raw game facts'; end if;
    end if;
    accepted:=jsonb_array_length(records); appended:=0;
    if (select count(distinct x->>'provider_event_id') from jsonb_array_elements(records) x)<>accepted then raise exception 'Duplicate incoming game'; end if;
    for record in select x from jsonb_array_elements(records) x loop
      if record->>'provider' is distinct from 'espn' or record->>'provider_player_id' is distinct from provider_id or (record->>'local_player_id')::bigint is distinct from local_id or
         (record->>'season')::integer is distinct from season or record->>'phase' is distinct from 'regular' or
         (record->>'provider_fetched_at')::timestamptz<as_of or (record->>'provider_fetched_at')::timestamptz>received or
         record->>'provider_known_at' is distinct from record->>'provider_fetched_at' or (record->>'game_at')::timestamptz>as_of then raise exception 'Invalid observation binding/availability'; end if;
      if snapshot is not null and not exists(select 1 from jsonb_array_elements(cache_row.games) g where g->>'eventId'=record->>'provider_event_id' and g->>'status'='final' and g->>'participation'='played' and (g->>'gameAt')::timestamptz=(record->>'game_at')::timestamptz and g->>'homeAway' is not distinct from record->>'home_away' and g->>'teamId' is not distinct from record->>'team_provider_id' and g->>'opponentId' is not distinct from record->>'opponent_provider_id' and
        (g->'stats'->>'points')::numeric=(record->>'points')::numeric and (g->'stats'->>'minutes')::numeric=(record->>'minutes')::numeric and
        (g->'stats'->>'rebounds')::numeric=(record->>'rebounds')::numeric and (g->'stats'->>'assists')::numeric=(record->>'assists')::numeric and
        (g->'stats'->>'steals')::numeric=(record->>'steals')::numeric and (g->'stats'->>'blocks')::numeric=(record->>'blocks')::numeric and (g->'stats'->>'turnovers')::numeric=(record->>'turnovers')::numeric)
      then raise exception 'Cache/observation facts differ'; end if;
    end loop;
    for pos in 0..greatest(accepted-1,0) by 200 loop
      select coalesce(jsonb_agg(value order by ordinal),'[]'::jsonb) into part from jsonb_array_elements(records) with ordinality x(value,ordinal) where ordinal>pos and ordinal<=pos+200;
      appended:=appended+public.append_nba_projection_observations(part);
    end loop;
    if exists(select 1 from jsonb_populate_recordset(null::public.nba_player_game_observation_versions,records) r left join public.nba_player_game_current_observations c
      on c.provider=r.provider and c.provider_player_id=r.provider_player_id and c.provider_event_id=r.provider_event_id where c.version_id is null or
      row(c.local_player_id,c.season,c.phase,c.game_at,c.completed_at,c.team_provider_id,c.team_abbreviation,c.opponent_provider_id,c.opponent_abbreviation,c.home_away,c.minutes,c.points,c.rebounds,c.assists,c.steals,c.blocks,c.turnovers)
      is distinct from row(r.local_player_id,r.season,r.phase,r.game_at,r.completed_at,r.team_provider_id,r.team_abbreviation,r.opponent_provider_id,r.opponent_abbreviation,r.home_away,r.minutes,r.points,r.rebounds,r.assists,r.steals,r.blocks,r.turnovers)) then raise exception 'Current facts conflict with acquired snapshot'; end if;
    if snapshot is not null then
      if cache_row.complete and cache_row.observed_games<>accepted then raise exception 'Incomplete complete-cache facts'; end if;
      insert into public.player_center_season_cache select cache_row.* on conflict on constraint player_center_season_cache_pkey do update set
        nba_local_player_id=excluded.nba_local_player_id,nfl_local_player_id=excluded.nfl_local_player_id,as_of=excluded.as_of,checked_at=excluded.checked_at,
        expected_games=excluded.expected_games,observed_games=excluded.observed_games,complete=excluded.complete,
        -- Keep unchanged TOAST payloads: checked_at records the new verification, not per-game metadata churn.
        games=case when public.player_center_season_cache.season_stats is not distinct from excluded.season_stats and
          (select jsonb_agg(g-'fetchedAt' order by g->>'eventId') from jsonb_array_elements(public.player_center_season_cache.games)g)
          is not distinct from (select jsonb_agg(g-'fetchedAt' order by g->>'eventId') from jsonb_array_elements(excluded.games)g)
          then public.player_center_season_cache.games else excluded.games end,
        season_stats=excluded.season_stats,
        issues=excluded.issues,content_hash=excluded.content_hash,rollout_batch_id=excluded.rollout_batch_id;
    end if;
    insert into public.player_center_nba_refresh_status(player_id,season,native_player_id,provider_player_id,run_id,as_of,outcome,last_attempt_at,last_acquired_at,last_verified_at,issues,receipt_hash,appended_versions,expected_games,observed_games,last_failure_at,last_failure_issues) values(local_id,season,native_id,provider_id,run_id,as_of,outcome,received,
      coalesce(acquired,old.last_acquired_at),case when outcome in ('verified_data','verified_zero_appearances') then acquired else old.last_verified_at end,item->'issues',fingerprint,appended,
      case when snapshot is not null then cache_row.expected_games end,case when snapshot is not null then cache_row.observed_games end,
      case when outcome in ('verified_data','verified_zero_appearances') then old.last_failure_at else received end,
      case when outcome in ('verified_data','verified_zero_appearances') then coalesce(old.last_failure_issues,'[]'::jsonb) else item->'issues' end)
    on conflict on constraint player_center_nba_refresh_status_pkey do update set native_player_id=excluded.native_player_id,provider_player_id=excluded.provider_player_id,run_id=excluded.run_id,
      as_of=excluded.as_of,outcome=excluded.outcome,last_attempt_at=excluded.last_attempt_at,last_acquired_at=excluded.last_acquired_at,last_verified_at=excluded.last_verified_at,
      issues=excluded.issues,receipt_hash=excluded.receipt_hash,appended_versions=excluded.appended_versions,expected_games=excluded.expected_games,observed_games=excluded.observed_games,last_failure_at=excluded.last_failure_at,last_failure_issues=excluded.last_failure_issues;
    total_appended:=total_appended+appended; total_accepted:=total_accepted+accepted;
  end loop;
  return jsonb_build_object('accepted',total_accepted,'appended',total_appended,'not_appended',total_accepted-total_appended,'replayed_players',replayed,'players',item_count);
end $fn$;
revoke all on function public.player_center_nba_refresh_health(boolean),public.publish_player_center_nba_refresh(uuid,integer,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.player_center_nba_refresh_health(boolean),public.publish_player_center_nba_refresh(uuid,integer,timestamptz,jsonb) to service_role;
commit;
