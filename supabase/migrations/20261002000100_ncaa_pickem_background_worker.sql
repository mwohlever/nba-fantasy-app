-- NCAAF workers only. Apply manually before deployment; no jobs are installed. See docs/ncaaf-background-worker.md.
begin;

create table public.ncaa_pickem_sync_state (
  week_id bigint not null references public.ncaa_pickem_weeks(id) on delete restrict,
  task text not null check (task in ('results','reminders')),
  primary key (week_id, task),
  status text not null default 'idle' check (status in ('idle','running','succeeded','failed')),
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  next_attempt_at timestamptz,
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text check (last_error is null or char_length(last_error) <= 400),
  last_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(last_summary) = 'object' and octet_length(last_summary::text) <= 2048),
  updated_at timestamptz not null default clock_timestamp(),
  constraint ncaa_pickem_sync_lease_pair check ((lease_token is null) = (lease_expires_at is null))
);
create index ncaa_pickem_sync_state_retry_idx on public.ncaa_pickem_sync_state (next_attempt_at);

create table public.ncaa_pickem_sync_runs (
  id uuid primary key default gen_random_uuid(),
  task text not null check (task in ('results','reminders')),
  source text not null check (source in ('manual','background')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','partial_failure','failed')),
  considered integer not null default 0,
  eligible integer not null default 0,
  budget_stopped boolean not null default false,
  duration_ms integer not null default 0,
  processed integer not null default 0,
  lease_skipped integer not null default 0,
  backoff_skipped integer not null default 0,
  recovered integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  details jsonb not null default '[]'::jsonb
    check (jsonb_typeof(details) = 'array' and octet_length(details::text) <= 16384)
);
create index ncaa_pickem_sync_runs_started_idx on public.ncaa_pickem_sync_runs (started_at desc);

alter table public.ncaa_pickem_sync_state enable row level security;
alter table public.ncaa_pickem_sync_runs enable row level security;
revoke all on public.ncaa_pickem_sync_state, public.ncaa_pickem_sync_runs from public, anon, authenticated, service_role;
grant select, insert, update on public.ncaa_pickem_sync_state to service_role;
grant select, insert, update, delete on public.ncaa_pickem_sync_runs to service_role;

-- Atomic claim. The token is the fencing identity for release; expiration recovers dead workers.
create function public.claim_ncaa_pickem_sync(p_week_id bigint, p_task text, p_ignore_retry boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_state public.ncaa_pickem_sync_state%rowtype;
  v_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_week public.ncaa_pickem_weeks%rowtype;
begin
  if p_task not in ('results','reminders') or p_ignore_retry and p_task <> 'results' then
    return jsonb_build_object('state', 'ineligible');
  end if;
  select * into v_week from public.ncaa_pickem_weeks where id = p_week_id;
  if not found or v_week.league_id is null
     or not exists (select 1 from public.leagues where id = v_week.league_id and sport_key = 'ncaa_pickem')
     or (v_week.status = 'final' and not p_ignore_retry)
     or (p_task = 'reminders' and (v_week.status <> 'open' or v_week.lock_at is null
         or v_week.lock_at <= v_now or v_week.lock_at > v_now + interval '7 days')) then
    return jsonb_build_object('state', 'ineligible');
  end if;
  insert into public.ncaa_pickem_sync_state (week_id, task) values (p_week_id, p_task)
    on conflict (week_id, task) do nothing;
  select * into v_state from public.ncaa_pickem_sync_state
    where week_id = p_week_id and task = p_task for update;
  v_now := clock_timestamp();
  if v_state.lease_expires_at is not null and v_state.lease_expires_at > v_now then
    return jsonb_build_object('state', 'leased');
  end if;
  if not p_ignore_retry and v_state.next_attempt_at is not null and v_state.next_attempt_at > v_now then
    return jsonb_build_object('state', 'backoff');
  end if;
  update public.ncaa_pickem_sync_state
     set status = 'running', lease_token = v_token,
         lease_expires_at = v_now + interval '5 minutes',
         last_attempt_at = v_now, updated_at = v_now
   where week_id = p_week_id and task = p_task;
  return jsonb_build_object('state', 'claimed', 'token', v_token,
    'recovered', v_state.lease_token is not null);
end;
$$;

create function public.finish_ncaa_pickem_sync(p_week_id bigint, p_task text, p_lease_token uuid,
  p_succeeded boolean, p_summary jsonb default '{}'::jsonb, p_error text default null, p_delay_seconds integer default 240)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.ncaa_pickem_sync_state
     set status = case when p_succeeded then 'succeeded' else 'failed' end,
         last_success_at = case when p_succeeded then clock_timestamp() else last_success_at end,
         consecutive_failures = case when p_succeeded then 0 else consecutive_failures + 1 end,
         next_attempt_at = case when p_succeeded then
           clock_timestamp() + make_interval(secs => greatest(240, least(21600, coalesce(p_delay_seconds, 240)))) else
           clock_timestamp() + make_interval(secs => least(21600, 120 * power(2, least(consecutive_failures, 8)))::integer) end,
         last_summary = coalesce(p_summary, '{}'::jsonb),
         last_error = case when p_succeeded then null else left(coalesce(p_error, 'Unknown failure'), 400) end,
         lease_token = null, lease_expires_at = null, updated_at = clock_timestamp()
   where week_id = p_week_id and task = p_task and lease_token = p_lease_token and lease_expires_at > clock_timestamp();
  return found;
end;
$$;

create function public.ncaa_pickem_sync_lease_owned(p_week_id bigint, p_task text, p_lease_token uuid)
returns boolean language sql security invoker set search_path = public as $$
  select exists(select 1 from public.ncaa_pickem_sync_state
    where week_id = p_week_id and task = p_task and lease_token = p_lease_token
      and status = 'running' and lease_expires_at > clock_timestamp());
$$;

-- Each worker invocation removes at most 100 runs older than 60 days.
-- State and retry records are intentionally untouched.
create function public.prune_ncaa_pickem_sync_runs()
returns integer language plpgsql security invoker set search_path = public as $$
declare v_deleted integer;
begin
  delete from public.ncaa_pickem_sync_runs
  where id in (
    select id from public.ncaa_pickem_sync_runs
    where started_at < clock_timestamp() - interval '60 days'
    order by started_at
    limit 100
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.claim_ncaa_pickem_sync(bigint, text, boolean),
  public.finish_ncaa_pickem_sync(bigint, text, uuid, boolean, jsonb, text, integer),
  public.ncaa_pickem_sync_lease_owned(bigint, text, uuid),
  public.prune_ncaa_pickem_sync_runs() from public, anon, authenticated, service_role;
grant execute on function public.claim_ncaa_pickem_sync(bigint, text, boolean),
  public.finish_ncaa_pickem_sync(bigint, text, uuid, boolean, jsonb, text, integer),
  public.ncaa_pickem_sync_lease_owned(bigint, text, uuid),
  public.prune_ncaa_pickem_sync_runs() to service_role;
comment on table public.ncaa_pickem_sync_state is 'Week/task-scoped NCAAF sync lease and retry state; server service role only.';
comment on table public.ncaa_pickem_sync_runs is 'One durable summary per NCAAF background worker invocation.';


-- Fencing is enforced IN the mutation transaction, not just by a pre-write ownership check.
create function public.apply_ncaa_pickem_results(p_week_id bigint, p_lease_token uuid, p_games jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_week public.ncaa_pickem_weeks%rowtype;
  v_game public.ncaa_pickem_games%rowtype;
  v_stored public.ncaa_pickem_games%rowtype;
  v_item jsonb;
  v_previous text;
  v_updated integer := 0;
  v_graded integer := 0;
  v_included integer;
  v_completed integer;
  v_now timestamptz := clock_timestamp();
begin
  -- Holding this row prevents a replacement claim until this transaction completes.
  perform 1 from public.ncaa_pickem_sync_state where week_id = p_week_id and task = 'results'
    and lease_token = p_lease_token and lease_expires_at > v_now for update;
  if not found or not public.ncaa_pickem_sync_lease_owned(p_week_id, 'results', p_lease_token) then
    raise exception 'NCAA result lease lost';
  end if;
  select * into strict v_week from public.ncaa_pickem_weeks where id = p_week_id for update;
  v_previous := v_week.status;
  if p_games is null or jsonb_typeof(p_games) <> 'array' or jsonb_array_length(p_games) > 200 then
    raise exception 'Invalid NCAA result batch';
  end if;
  if jsonb_array_length(p_games) = 0 and exists(select 1 from public.ncaa_pickem_games where week_id = p_week_id) then
    raise exception 'ESPN returned no mapped games for an imported NCAA week';
  end if;
  for v_item in select value from jsonb_array_elements(p_games) loop
    select * into v_stored from public.ncaa_pickem_games
      where week_id = p_week_id and espn_event_id = v_item->>'espn_event_id' for update;
    if not found then continue; end if; -- Never create provider games or change commissioner selection.
    v_game := jsonb_populate_record(v_stored, v_item);
    update public.ncaa_pickem_games set
        kickoff_at = v_game.kickoff_at,
        away_team_id = v_game.away_team_id,
        away_team_name = v_game.away_team_name,
        away_team_abbreviation = v_game.away_team_abbreviation,
        away_team_logo_url = v_game.away_team_logo_url,
        away_rank = v_game.away_rank,
        away_record = v_game.away_record,
        away_score = v_game.away_score,
        home_team_id = v_game.home_team_id,
        home_team_name = v_game.home_team_name,
        home_team_abbreviation = v_game.home_team_abbreviation,
        home_team_logo_url = v_game.home_team_logo_url,
        home_rank = v_game.home_rank,
        home_record = v_game.home_record,
        home_score = v_game.home_score,
        status = v_game.status,
        status_detail = v_game.status_detail,
        winner_team_id = v_game.winner_team_id,
        spread_favorite_team_id = case when v_week.status = 'open' and (v_week.lock_at is null or v_week.lock_at > v_now)
          and v_stored.status = 'pre' and v_stored.kickoff_at > v_now and v_game.status = 'pre' and v_game.kickoff_at > v_now
          then v_game.spread_favorite_team_id else v_stored.spread_favorite_team_id end,
        spread = case when v_week.status = 'open' and (v_week.lock_at is null or v_week.lock_at > v_now)
          and v_stored.status = 'pre' and v_stored.kickoff_at > v_now and v_game.status = 'pre' and v_game.kickoff_at > v_now
          then v_game.spread else v_stored.spread end,
        over_under = case when v_week.status = 'open' and (v_week.lock_at is null or v_week.lock_at > v_now)
          and v_stored.status = 'pre' and v_stored.kickoff_at > v_now and v_game.status = 'pre' and v_game.kickoff_at > v_now
          then v_game.over_under else v_stored.over_under end,
        odds_provider = case when v_week.status = 'open' and (v_week.lock_at is null or v_week.lock_at > v_now)
          and v_stored.status = 'pre' and v_stored.kickoff_at > v_now and v_game.status = 'pre' and v_game.kickoff_at > v_now
          then v_game.odds_provider else v_stored.odds_provider end,
        odds_updated_at = case when v_week.status = 'open' and (v_week.lock_at is null or v_week.lock_at > v_now)
          and v_stored.status = 'pre' and v_stored.kickoff_at > v_now and v_game.status = 'pre' and v_game.kickoff_at > v_now
          then v_game.odds_updated_at else v_stored.odds_updated_at end,
        updated_at = v_now
      where id = v_stored.id and week_id = p_week_id;
    v_updated := v_updated + 1;
  end loop;

  -- Compare against current picked_team_id, so a concurrent commissioner correction cannot be graded from an old read.
  update public.ncaa_pickem_picks p set
    is_correct = p.picked_team_id = g.winner_team_id, updated_at = v_now
  from public.ncaa_pickem_games g, public.teams t, public.leagues l, public.app_users u
  where p.week_id = p_week_id and g.week_id = p_week_id and p.game_id = g.id and g.included
    and g.winner_team_id is not null and p.team_id = t.id and t.group_id = l.group_id
    and l.id = v_week.league_id and t.user_id = u.id and u.is_active = true
    and exists(select 1 from public.group_memberships m
      where m.group_id = l.group_id and m.user_id = t.user_id and m.is_active = true)
    and exists(select 1 from jsonb_array_elements(p_games) e
      where e->>'espn_event_id' = g.espn_event_id and (e->>'completed')::boolean = true)
    and p.is_correct is distinct from (p.picked_team_id = g.winner_team_id);
  get diagnostics v_graded = row_count;

  select count(*), count(*) filter (where exists(select 1 from jsonb_array_elements(p_games) e
      where e->>'espn_event_id' = g.espn_event_id and (e->>'completed')::boolean = true))
    into v_included, v_completed
    from public.ncaa_pickem_games g where week_id = p_week_id and included;
  if v_week.status = 'open' and v_week.lock_at <= v_now then v_week.status := 'locked'; end if;
  if v_week.status <> 'final' and v_included > 0 and v_included = v_completed then v_week.status := 'final'; end if;
  if v_week.status <> v_previous then
    update public.ncaa_pickem_weeks set status = v_week.status, updated_at = v_now where id = p_week_id;
  end if;
  return jsonb_build_object('gamesUpdated', v_updated, 'gradedPicks', v_graded, 'weekStatus', v_week.status,
    'previousWeekStatus', v_previous, 'statusChanged', v_week.status <> v_previous,
    'includedGames', v_included, 'completedIncludedGames', v_completed,
    'allIncludedGamesComplete', v_included > 0 and v_included = v_completed);
end;
$$;

-- NCAAF-only at-most-once event reservation; historical notification keys remain authoritative.
-- Do not delete these to retry failed pushes: the legacy reminder policy does not resend a logged event.
create table public.ncaa_pickem_reminder_events (
  event_key text primary key,
  week_id bigint not null references public.ncaa_pickem_weeks(id) on delete restrict,
  user_id uuid not null references public.app_users(id) on delete restrict,
  reserved_at timestamptz not null default clock_timestamp()
);
create index ncaa_pickem_reminder_events_week_idx on public.ncaa_pickem_reminder_events (week_id);
alter table public.ncaa_pickem_reminder_events enable row level security;
revoke all on public.ncaa_pickem_reminder_events from public, anon, authenticated, service_role;
grant select, insert on public.ncaa_pickem_reminder_events to service_role;

create function public.reserve_ncaa_pickem_reminder(p_week_id bigint, p_lease_token uuid, p_team_id bigint, p_user_id uuid)
returns text language plpgsql security invoker set search_path = public as $$
declare
  v_week public.ncaa_pickem_weeks%rowtype;
  v_key text := 'ncaa_pickem_lock_reminder:' || p_week_id || ':' || p_user_id;
begin
  perform 1 from public.ncaa_pickem_sync_state where week_id = p_week_id and task = 'reminders'
    and lease_token = p_lease_token and lease_expires_at > clock_timestamp() for update;
  if not found or not public.ncaa_pickem_sync_lease_owned(p_week_id, 'reminders', p_lease_token) then
    raise exception 'NCAA reminder lease lost';
  end if;
  select * into strict v_week from public.ncaa_pickem_weeks where id = p_week_id for share;
  if v_week.status <> 'open' or v_week.lock_at is null or v_week.lock_at <= clock_timestamp() then return 'ineligible'; end if;
  if not exists(select 1 from public.leagues l join public.teams t on t.group_id = l.group_id
      join public.app_users u on u.id = t.user_id and u.is_active
      join public.group_memberships m on m.group_id = l.group_id and m.user_id = u.id and m.is_active
      where l.id = v_week.league_id and l.sport_key = 'ncaa_pickem' and t.id = p_team_id and u.id = p_user_id)
    or exists(select 1 from public.notification_preferences
      where user_id = p_user_id and (notifications_enabled = false or pickem_reminder_enabled = false))
    or not exists(select 1 from public.ncaa_pickem_games g where g.week_id = p_week_id and g.included
      and not exists(select 1 from public.ncaa_pickem_picks p where p.week_id = p_week_id and p.game_id = g.id and p.team_id = p_team_id))
    then return 'ineligible'; end if;
  if exists(select 1 from public.notification_history where event_key = v_key) then return 'duplicate'; end if;
  insert into public.ncaa_pickem_reminder_events (event_key, week_id, user_id) values (v_key, p_week_id, p_user_id)
    on conflict (event_key) do nothing;
  if not found then return 'duplicate'; end if;
  return 'reserved';
end;
$$;
revoke all on function public.apply_ncaa_pickem_results(bigint, uuid, jsonb),
  public.reserve_ncaa_pickem_reminder(bigint, uuid, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.apply_ncaa_pickem_results(bigint, uuid, jsonb),
  public.reserve_ncaa_pickem_reminder(bigint, uuid, bigint, uuid) to service_role;
-- Server-only bounded discovery, with due-time filtering BEFORE limiting and fair attempt ordering.
create function public.discover_ncaa_pickem_work(p_task text)
returns setof public.ncaa_pickem_weeks language sql security invoker set search_path = public as $$
  select w.* from public.ncaa_pickem_weeks w
  join public.leagues l on l.id = w.league_id and l.sport_key = 'ncaa_pickem'
  left join public.ncaa_pickem_sync_state s on s.week_id = w.id and s.task = p_task
  where w.status <> 'final' and (s.next_attempt_at is null or s.next_attempt_at <= clock_timestamp())
    and ((p_task = 'reminders' and w.status = 'open' and w.lock_at > clock_timestamp()
          and w.lock_at <= clock_timestamp() + interval '7 days')
      or (p_task = 'results' and (w.status = 'locked' or w.lock_at <= clock_timestamp()
          or exists(select 1 from public.ncaa_pickem_games g where g.week_id = w.id
            and g.kickoff_at <= clock_timestamp() + interval '7 days'))))
  order by s.last_attempt_at asc nulls first, w.id
  limit 100;
$$;
revoke all on function public.discover_ncaa_pickem_work(text) from public, anon, authenticated, service_role;
grant execute on function public.discover_ncaa_pickem_work(text) to service_role;
commit;
