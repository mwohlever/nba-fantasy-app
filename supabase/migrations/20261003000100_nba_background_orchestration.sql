-- NBA only. Apply manually before deployment. Installs no schedule and performs no historical backfill.
begin;

create table public.nba_sync_state (
  task text not null check (task in ('fantasy','skins')),
  target_id bigint not null,
  slate_id bigint references public.slates(id) on delete cascade,
  season_id bigint references public.nba_skins_seasons(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  primary key(task,target_id),
  check ((task='fantasy' and slate_id=target_id and season_id is null and slate_id is not null)
    or (task='skins' and season_id=target_id and slate_id is null and season_id is not null)),
  status text not null default 'idle' check(status in ('idle','running','succeeded','failed')),
  last_attempt_at timestamptz, last_success_at timestamptz, next_attempt_at timestamptz,
  consecutive_failures integer not null default 0 check(consecutive_failures >= 0),
  lease_token uuid, lease_expires_at timestamptz,
  check ((lease_token is null)=(lease_expires_at is null)),
  last_error text check(last_error is null or char_length(last_error)<=400),
  last_summary jsonb not null default '{}' check(jsonb_typeof(last_summary)='object' and octet_length(last_summary::text)<=8192),
  -- Recover notification dispatch if a process dies after atomic scoring/locking.
  pending_notifications jsonb check(pending_notifications is null or
    (task='fantasy' and jsonb_typeof(pending_notifications)='object' and octet_length(pending_notifications::text)<=262144)),
  updated_at timestamptz not null default clock_timestamp()
);
create index nba_sync_state_due_idx on public.nba_sync_state(task,next_attempt_at);
create table public.nba_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check(source in ('background','manual','heartbeat')),
  started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  status text not null default 'running' check(status in ('running','succeeded','partial_failure','failed')),
  processed integer not null default 0, succeeded integer not null default 0, failed integer not null default 0,
  duration_ms integer not null default 0, budget_stopped boolean not null default false,
  details jsonb not null default '[]' check(jsonb_typeof(details)='array' and octet_length(details::text)<=32768),
  provider_counts jsonb not null default '{}' check(jsonb_typeof(provider_counts)='object' and octet_length(provider_counts::text)<=1024),
  provider_failures jsonb not null default '{}' check(jsonb_typeof(provider_failures)='object' and octet_length(provider_failures::text)<=1024)
);
create index nba_sync_runs_started_idx on public.nba_sync_runs(started_at desc);
alter table public.nba_sync_state enable row level security;
alter table public.nba_sync_runs enable row level security;
revoke all on public.nba_sync_state,public.nba_sync_runs from public,anon,authenticated,service_role;
grant select,insert,update on public.nba_sync_state to service_role;
grant select,insert,update,delete on public.nba_sync_runs to service_role;

create function public.discover_nba_work(p_task text)
returns table(task text,target_id bigint,league_id uuid,group_id uuid)
language sql security invoker set search_path=public as $$
  select p_task, x.id, x.league_id, l.group_id from (
    select s.id,s.league_id from public.slates s
    left join public.nba_sync_state n on n.task='fantasy' and n.target_id=s.id
    where p_task='fantasy' and s.sport='nba' and s.archived_at is null
      and (not s.is_locked or n.pending_notifications is not null)
      and (n.pending_notifications is not null or (s.start_date::date <= (clock_timestamp() at time zone 'America/New_York')::date + 7
        and s.end_date::date >= (clock_timestamp() at time zone 'America/New_York')::date - 7))
      and exists(select 1 from public.lineups lu join public.lineup_players lp on lp.lineup_id=lu.id where lu.slate_id=s.id)
    union all
    select s.id,s.league_id from public.nba_skins_seasons s
    where p_task='skins' and s.status<>'final'
      and make_date(s.season,10,1)<=(clock_timestamp() at time zone 'America/New_York')::date+30
      and (select count(*) from public.nba_skins_picks p where p.season_id=s.id)=s.participant_count*s.nba_teams_per_participant
      -- Preserve newest completely drafted year selection separately for each league.
      and not exists(select 1 from public.nba_skins_seasons newer where newer.league_id=s.league_id and newer.status<>'final'
        and make_date(newer.season,10,1)<=(clock_timestamp() at time zone 'America/New_York')::date+30
        and newer.season>s.season and (select count(*) from public.nba_skins_picks p where p.season_id=newer.id)=newer.participant_count*newer.nba_teams_per_participant)
  ) x join public.leagues l on l.id=x.league_id and l.is_enabled
    and l.sport_key=case p_task when 'fantasy' then 'nba' when 'skins' then 'nba_skins' end
  left join public.nba_sync_state n on n.task=p_task and n.target_id=x.id
  where n.next_attempt_at is null or n.next_attempt_at<=clock_timestamp()
  order by n.last_attempt_at nulls first,x.id limit 30;
$$;

create function public.claim_nba_sync(p_task text,p_target_id bigint,p_manual boolean default false)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_state public.nba_sync_state%rowtype; v_league uuid; v_now timestamptz; v_token uuid:=gen_random_uuid();
begin
  if p_task='fantasy' then
    select s.league_id into v_league from public.slates s where s.id=p_target_id and s.sport='nba' and s.archived_at is null
      and (not s.is_locked or exists(select 1 from public.nba_sync_state n where n.task=p_task and n.target_id=s.id and n.pending_notifications is not null));
  elsif p_task='skins' then
    select s.league_id into v_league from public.nba_skins_seasons s where s.id=p_target_id and s.status<>'final'
      and (select count(*) from public.nba_skins_picks p where p.season_id=s.id)=s.participant_count*s.nba_teams_per_participant;
  else return jsonb_build_object('state','ineligible'); end if;
  if v_league is null or not exists(select 1 from public.leagues l where l.id=v_league and l.is_enabled
    and l.sport_key=case p_task when 'fantasy' then 'nba' else 'nba_skins' end) then
    return jsonb_build_object('state','ineligible');
  end if;
  insert into public.nba_sync_state(task,target_id,league_id,slate_id,season_id)
    values(p_task,p_target_id,v_league,case when p_task='fantasy' then p_target_id end,case when p_task='skins' then p_target_id end)
    on conflict(task,target_id) do nothing;
  select * into v_state from public.nba_sync_state where task=p_task and target_id=p_target_id for update;
  v_now:=clock_timestamp();
  if v_state.league_id<>v_league then raise exception 'NBA league identity changed'; end if;
  if v_state.lease_expires_at>v_now then return jsonb_build_object('state','leased'); end if;
  -- Explicit browser refresh bypasses polling delay, but never another active lease.
  if not p_manual and v_state.next_attempt_at>v_now then return jsonb_build_object('state','backoff'); end if;
  update public.nba_sync_state set status='running',lease_token=v_token,lease_expires_at=v_now+interval '5 minutes',
    last_attempt_at=v_now,updated_at=v_now where task=p_task and target_id=p_target_id;
  return jsonb_build_object('state','claimed','token',v_token,'recovered',v_state.lease_token is not null,
    'summary',v_state.last_summary,'pending',v_state.pending_notifications);
end; $$;

create function public.finish_nba_sync(p_task text,p_target_id bigint,p_token uuid,p_success boolean,
  p_summary jsonb default '{}',p_error text default null,p_delay integer default 240)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update public.nba_sync_state set status=case when p_success then 'succeeded' else 'failed' end,
    last_success_at=case when p_success then clock_timestamp() else last_success_at end,
    consecutive_failures=case when p_success then 0 else consecutive_failures+1 end,
    next_attempt_at=clock_timestamp()+make_interval(secs=>case when p_success then greatest(30,least(86400,coalesce(p_delay,240)))
      else least(21600,120*power(2,least(consecutive_failures,8)))::integer end),
    last_summary=last_summary||coalesce(p_summary,'{}'),
    last_error=case when p_success then null else left(coalesce(p_error,'nba:unknown_failure'),400) end,
    lease_token=null,lease_expires_at=null,updated_at=clock_timestamp()
  where task=p_task and target_id=p_target_id and lease_token=p_token and lease_expires_at>clock_timestamp();
  return found;
end; $$;

-- Canonical read set: apply compares it again to reject changes to pins, rules, rosters or accepted stats.
create function public.load_nba_fantasy_context(p_slate_id bigint)
returns jsonb language sql security invoker set search_path=public as $$
  select jsonb_build_object('slate',jsonb_build_object('id',s.id,'league_id',s.league_id,'sport',s.sport,'date',s.date,
    'start_date',s.start_date,'end_date',s.end_date,'is_locked',s.is_locked,'archived_at',s.archived_at,
    'first_game_start_time',s.first_game_start_time,'nba_team_abbreviations',s.nba_team_abbreviations,'rules_snapshot',s.rules_snapshot),
    'lineups',coalesce((select jsonb_agg(jsonb_build_object('id',lu.id,'team_id',lu.team_id,'lineup_players',
      coalesce((select jsonb_agg(jsonb_build_object('player_id',lp.player_id) order by lp.player_id) from public.lineup_players lp where lp.lineup_id=lu.id),'[]'::jsonb)) order by lu.id)
      from public.lineups lu where lu.slate_id=s.id),'[]'::jsonb),
    'players',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'nba_player_id',p.nba_player_id,'team_abbreviation',p.team_abbreviation) order by p.id)
      from public.players p where p.id in(select lp.player_id from public.lineups lu join public.lineup_players lp on lp.lineup_id=lu.id where lu.slate_id=s.id)),'[]'::jsonb),
    'pins',coalesce((select jsonb_agg(jsonb_build_object('game_id',g.game_id,'game_code',g.game_code,'game_date',g.game_date) order by g.game_date,g.game_id)
      from public.slate_nba_games g where g.slate_id=s.id),'[]'::jsonb),
    'previous',coalesce((select jsonb_agg(to_jsonb(ps) order by ps.player_id) from public.player_slate_stats ps where ps.slate_id=s.id),'[]'::jsonb))
  from public.slates s where s.id=p_slate_id and s.sport='nba';
$$;

create function public.apply_nba_fantasy(p_slate_id bigint,p_token uuid,p_context jsonb,p_players jsonb,p_teams jsonb,p_final boolean,p_notifications jsonb,p_final_after timestamptz)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_state public.nba_sync_state%rowtype; v_slate public.slates%rowtype;
begin
  select * into v_state from public.nba_sync_state where task='fantasy' and target_id=p_slate_id for update;
  if not found or v_state.lease_token is distinct from p_token or v_state.lease_expires_at<=clock_timestamp() then raise exception 'NBA lease lost'; end if;
  select * into v_slate from public.slates where id=p_slate_id for update;
  if v_slate.is_locked or v_slate.archived_at is not null or v_slate.sport<>'nba' or v_slate.league_id<>v_state.league_id
    or v_state.lease_expires_at<=clock_timestamp() then raise exception 'NBA slate unavailable'; end if;
  if public.load_nba_fantasy_context(p_slate_id) is distinct from p_context then raise exception 'NBA context changed'; end if;
  if v_state.pending_notifications is not null then raise exception 'NBA notifications pending'; end if;
  if p_players is null or p_teams is null or jsonb_typeof(p_players)<>'array' or jsonb_typeof(p_teams)<>'array'
    or jsonb_array_length(p_players)>500 or jsonb_array_length(p_teams)>100 then raise exception 'NBA invalid batch'; end if;
  if exists(select 1 from jsonb_array_elements(p_players) r where (r->>'slate_id')::bigint<>p_slate_id)
    or exists(select 1 from jsonb_array_elements(p_teams) r where (r->>'slate_id')::bigint<>p_slate_id) then raise exception 'NBA batch scope'; end if;
  if (select array_agg((r->>'player_id')::bigint order by (r->>'player_id')::bigint) from jsonb_array_elements(p_players) r)
    is distinct from (select array_agg((r->>'id')::bigint order by (r->>'id')::bigint) from jsonb_array_elements(p_context->'players') r)
    or (select array_agg((r->>'team_id')::bigint order by (r->>'team_id')::bigint) from jsonb_array_elements(p_teams) r)
    is distinct from (select array_agg((r->>'team_id')::bigint order by (r->>'team_id')::bigint) from jsonb_array_elements(p_context->'lineups') r)
    then raise exception 'NBA roster scope'; end if;
  if exists(select 1 from public.lineups lu join public.teams t on t.id=lu.team_id join public.leagues l on l.id=v_slate.league_id
    where lu.slate_id=p_slate_id and t.group_id is distinct from l.group_id) then raise exception 'NBA Group scope'; end if;
  -- Cutoff is computed by the trusted server with the legacy runtime time-zone convention, never supplied by a browser.
  if p_final and (p_final_after is null or p_final_after>=clock_timestamp()) then raise exception 'NBA slate end day not passed'; end if;
  if p_final and jsonb_array_length(p_context->'pins')=0 then raise exception 'NBA finalization requires pinned game universe'; end if;
  insert into public.player_slate_stats(slate_id,player_id,points,rebounds,assists,steals,blocks,turnovers,fantasy_points,
    games_completed,games_in_progress,games_remaining,game_status,game_status_text,period,game_clock)
    select slate_id,player_id,points,rebounds,assists,steals,blocks,turnovers,fantasy_points,
      games_completed,games_in_progress,games_remaining,game_status,game_status_text,period,game_clock
    from jsonb_populate_recordset(null::public.player_slate_stats,p_players)
    on conflict(slate_id,player_id) do update set points=excluded.points,rebounds=excluded.rebounds,assists=excluded.assists,
      steals=excluded.steals,blocks=excluded.blocks,turnovers=excluded.turnovers,fantasy_points=excluded.fantasy_points,
      games_completed=excluded.games_completed,games_in_progress=excluded.games_in_progress,games_remaining=excluded.games_remaining,
      game_status=excluded.game_status,game_status_text=excluded.game_status_text,period=excluded.period,game_clock=excluded.game_clock;
  insert into public.team_slate_results(slate_id,team_id,fantasy_points,finish_position,games_completed,games_in_progress,games_remaining)
    select slate_id,team_id,fantasy_points,finish_position,games_completed,games_in_progress,games_remaining
    from jsonb_populate_recordset(null::public.team_slate_results,p_teams)
    on conflict(slate_id,team_id) do update set fantasy_points=excluded.fantasy_points,finish_position=excluded.finish_position,
      games_completed=excluded.games_completed,games_in_progress=excluded.games_in_progress,games_remaining=excluded.games_remaining;
  if p_final then update public.slates set is_locked=true where id=p_slate_id; end if;
  update public.nba_sync_state set pending_notifications=p_notifications where task='fantasy' and target_id=p_slate_id;
  return true;
end; $$;

create function public.ack_nba_notifications(p_slate_id bigint,p_token uuid)
returns boolean language plpgsql security invoker set search_path=public as $$
begin
  update public.nba_sync_state set pending_notifications=null where task='fantasy' and target_id=p_slate_id
    and lease_token=p_token and lease_expires_at>clock_timestamp();
  return found;
end; $$;

create function public.apply_nba_skins(p_season_id bigint,p_token uuid,p_season integer,p_records jsonb,p_projections jsonb default null)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_state public.nba_sync_state%rowtype; v_season public.nba_skins_seasons%rowtype; v_picks integer; v_expected integer;
begin
  select * into v_state from public.nba_sync_state where task='skins' and target_id=p_season_id for update;
  if not found or v_state.lease_token is distinct from p_token or v_state.lease_expires_at<=clock_timestamp() then raise exception 'NBA lease lost'; end if;
  select * into v_season from public.nba_skins_seasons where id=p_season_id for update;
  if not found or v_season.status='final' or v_season.season<>p_season or v_season.league_id<>v_state.league_id
    or v_state.lease_expires_at<=clock_timestamp() then raise exception 'NBA Skins season unavailable'; end if;
  v_expected:=v_season.participant_count*v_season.nba_teams_per_participant;
  select count(*) into v_picks from public.nba_skins_picks where season_id=p_season_id;
  if v_picks<>v_expected then raise exception 'NBA Skins draft incomplete'; end if;
  if p_records is null or jsonb_typeof(p_records)<>'array' or jsonb_array_length(p_records)<>30
    or (select count(distinct r->>'abbreviation') from jsonb_array_elements(p_records) r)<>30
    or exists(select 1 from jsonb_array_elements(p_records) r where not exists(select 1 from public.nba_skins_nba_teams t where t.abbreviation=r->>'abbreviation')
      or r->>'wins' is null or r->>'losses' is null or r->>'gamesPlayed' is null
      or (r->>'wins')::numeric<0 or (r->>'losses')::numeric<0
      or (r->>'wins')::numeric<>trunc((r->>'wins')::numeric) or (r->>'losses')::numeric<>trunc((r->>'losses')::numeric)
      or (r->>'gamesPlayed')::numeric<>(r->>'wins')::numeric+(r->>'losses')::numeric or (r->>'gamesPlayed')::numeric>82)
    then raise exception 'NBA Skins incomplete standings'; end if;
  if p_projections is not null and (jsonb_typeof(p_projections)<>'array' or jsonb_array_length(p_projections)<>30
    or (select count(distinct r->>'abbreviation') from jsonb_array_elements(p_projections) r)<>30
    or exists(select 1 from jsonb_array_elements(p_projections) r where not exists(select 1 from public.nba_skins_nba_teams t where t.abbreviation=r->>'abbreviation')
      or r->>'projectedWins' is null or r->>'projectedLosses' is null
      or (r->>'projectedWins')::numeric<0 or (r->>'projectedLosses')::numeric<0
      or abs((r->>'projectedWins')::numeric+(r->>'projectedLosses')::numeric-82)>0.05)) then raise exception 'NBA Skins incomplete projections'; end if;
  if exists(select 1 from public.nba_skins_picks p join public.teams t on t.id=p.team_id join public.leagues l on l.id=v_season.league_id
    where p.season_id=p_season_id and t.group_id is distinct from l.group_id) then raise exception 'NBA Skins Group scope'; end if;
  if exists(select 1 from jsonb_array_elements(p_records) r join public.nba_skins_team_records t
    on t.season_id=p_season_id and t.nba_team_abbreviation=r->>'abbreviation'
    where (r->>'gamesPlayed')::integer<t.games_played) then raise exception 'NBA Skins accepted record regression'; end if;
  insert into public.nba_skins_team_records(season_id,nba_team_abbreviation,wins,losses,games_played,projected_wins,projected_losses,projection_source,source_updated_at,updated_at)
    select p_season_id,r->>'abbreviation',(r->>'wins')::integer,(r->>'losses')::integer,(r->>'gamesPlayed')::integer,
      (pr->>'projectedWins')::numeric,(pr->>'projectedLosses')::numeric,case when pr is not null then 'ESPN BPI' end,clock_timestamp(),clock_timestamp()
    from jsonb_array_elements(p_records) r left join jsonb_array_elements(coalesce(p_projections,'[]')) pr on pr->>'abbreviation'=r->>'abbreviation'
    on conflict(season_id,nba_team_abbreviation) do update set wins=excluded.wins,losses=excluded.losses,games_played=excluded.games_played,
      projected_wins=coalesce(excluded.projected_wins,nba_skins_team_records.projected_wins),
      projected_losses=coalesce(excluded.projected_losses,nba_skins_team_records.projected_losses),
      projection_source=coalesce(excluded.projection_source,nba_skins_team_records.projection_source),
      source_updated_at=excluded.source_updated_at,updated_at=excluded.updated_at;
  update public.nba_skins_nba_teams t set display_name=r->>'displayName',espn_team_id=r->>'espnTeamId',updated_at=clock_timestamp()
    from jsonb_array_elements(p_records) r where t.abbreviation=r->>'abbreviation';
  update public.nba_skins_picks p set final_points=case p.pick_type when 'losses' then t.losses else t.wins end,updated_at=clock_timestamp()
    from public.nba_skins_team_records t where p.season_id=p_season_id and t.season_id=p_season_id and t.nba_team_abbreviation=p.nba_team_abbreviation;
  get diagnostics v_picks=row_count;
  -- Deliberately do not finalize the season or assign a champion: preserve the explicit existing workflow.
  return jsonb_build_object('picksUpdated',v_picks);
end; $$;

create function public.prune_nba_sync_runs() returns integer language plpgsql security invoker set search_path=public as $$
declare v_deleted integer;
begin
  delete from public.nba_sync_runs where id in(select id from public.nba_sync_runs
    where started_at<clock_timestamp()-interval '60 days' order by started_at limit 100);
  get diagnostics v_deleted=row_count; return v_deleted;
end; $$;

revoke all on function public.discover_nba_work(text),public.claim_nba_sync(text,bigint,boolean),
  public.finish_nba_sync(text,bigint,uuid,boolean,jsonb,text,integer),public.load_nba_fantasy_context(bigint),
  public.apply_nba_fantasy(bigint,uuid,jsonb,jsonb,jsonb,boolean,jsonb,timestamptz),public.ack_nba_notifications(bigint,uuid),
  public.apply_nba_skins(bigint,uuid,integer,jsonb,jsonb),public.prune_nba_sync_runs() from public,anon,authenticated,service_role;
grant execute on function public.discover_nba_work(text),public.claim_nba_sync(text,bigint,boolean),
  public.finish_nba_sync(text,bigint,uuid,boolean,jsonb,text,integer),public.load_nba_fantasy_context(bigint),
  public.apply_nba_fantasy(bigint,uuid,jsonb,jsonb,jsonb,boolean,jsonb,timestamptz),public.ack_nba_notifications(bigint,uuid),
  public.apply_nba_skins(bigint,uuid,integer,jsonb,jsonb),public.prune_nba_sync_runs() to service_role;
commit;
