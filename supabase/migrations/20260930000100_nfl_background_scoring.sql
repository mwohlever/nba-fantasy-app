-- NFL scoring state only. Configure pg_cron separately after deployment.
begin;

create table public.nfl_sync_state (
  slate_id bigint primary key references public.slates(id) on delete restrict,
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
  constraint nfl_sync_lease_pair check ((lease_token is null) = (lease_expires_at is null))
);
create index nfl_sync_state_retry_idx on public.nfl_sync_state (next_attempt_at);

create table public.nfl_sync_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running','succeeded','partial_failure','failed')),
  considered integer not null default 0,
  eligible integer not null default 0,
  budget_stopped boolean not null default false,
  duration_ms integer not null default 0,
  claimed integer not null default 0,
  processed integer not null default 0,
  lease_skipped integer not null default 0,
  backoff_skipped integer not null default 0,
  recovered integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  details jsonb not null default '[]'::jsonb
    check (jsonb_typeof(details) = 'array' and octet_length(details::text) <= 16384)
);
create index nfl_sync_runs_started_idx on public.nfl_sync_runs (started_at desc);

alter table public.nfl_sync_state enable row level security;
alter table public.nfl_sync_runs enable row level security;
revoke all on public.nfl_sync_state, public.nfl_sync_runs from public, anon, authenticated, service_role;
grant select, insert, update on public.nfl_sync_state to service_role;
grant select, insert, update, delete on public.nfl_sync_runs to service_role;

-- Atomic claim. The token is the fencing identity for release; expiration recovers dead workers.
create function public.claim_nfl_sync(p_slate_id bigint, p_ignore_retry boolean default false)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_state public.nfl_sync_state%rowtype;
  v_token uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_sport text;
  v_locked boolean;
begin
  select sport, is_locked into v_sport, v_locked from public.slates where id = p_slate_id;
  if v_sport is distinct from 'nfl' or v_locked then return jsonb_build_object('state', 'ineligible'); end if;
  insert into public.nfl_sync_state (slate_id) values (p_slate_id)
    on conflict (slate_id) do nothing;
  select * into v_state from public.nfl_sync_state
    where slate_id = p_slate_id for update;
  if v_state.lease_expires_at is not null and v_state.lease_expires_at > v_now then
    return jsonb_build_object('state', 'leased');
  end if;
  if not p_ignore_retry and v_state.last_success_at is not null and v_state.last_success_at > v_now - interval '4 minutes' then
    return jsonb_build_object('state', 'recent_success');
  end if;
  if not p_ignore_retry and v_state.next_attempt_at is not null and v_state.next_attempt_at > v_now then
    return jsonb_build_object('state', 'backoff');
  end if;
  update public.nfl_sync_state
     set status = 'running', lease_token = v_token,
         lease_expires_at = v_now + interval '5 minutes',
         last_attempt_at = v_now, updated_at = v_now
   where slate_id = p_slate_id;
  return jsonb_build_object('state', 'claimed', 'token', v_token,
    'recovered', v_state.lease_token is not null);
end;
$$;

create function public.finish_nfl_sync(p_slate_id bigint, p_lease_token uuid,
  p_succeeded boolean, p_summary jsonb default '{}'::jsonb, p_error text default null)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.nfl_sync_state
     set status = case when p_succeeded then 'succeeded' else 'failed' end,
         last_success_at = case when p_succeeded then clock_timestamp() else last_success_at end,
         consecutive_failures = case when p_succeeded then 0 else consecutive_failures + 1 end,
         next_attempt_at = case when p_succeeded then null else
           clock_timestamp() + make_interval(secs => least(21600, 120 * power(2, least(consecutive_failures, 7)))::integer) end,
         last_summary = case when p_succeeded then coalesce(p_summary, '{}'::jsonb) else last_summary end,
         last_error = case when p_succeeded then null else left(coalesce(p_error, 'Unknown failure'), 400) end,
         lease_token = null, lease_expires_at = null, updated_at = clock_timestamp()
   where slate_id = p_slate_id and lease_token = p_lease_token;
  return found;
end;
$$;

create function public.nfl_sync_lease_owned(p_slate_id bigint, p_lease_token uuid)
returns boolean language sql security invoker set search_path = public as $$
  select exists(select 1 from public.nfl_sync_state
    where slate_id = p_slate_id and lease_token = p_lease_token
      and status = 'running' and lease_expires_at > clock_timestamp());
$$;

-- Each worker invocation removes at most 100 runs older than 60 days.
-- State and retry records are intentionally untouched.
create function public.prune_nfl_sync_runs()
returns integer language plpgsql security invoker set search_path = public as $$
declare v_deleted integer;
begin
  delete from public.nfl_sync_runs
  where id in (
    select id from public.nfl_sync_runs
    where started_at < clock_timestamp() - interval '60 days'
    order by started_at
    limit 100
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.claim_nfl_sync(bigint, boolean),
  public.finish_nfl_sync(bigint, uuid, boolean, jsonb, text),
  public.nfl_sync_lease_owned(bigint, uuid),
  public.prune_nfl_sync_runs() from public, anon, authenticated, service_role;
grant execute on function public.claim_nfl_sync(bigint, boolean),
  public.finish_nfl_sync(bigint, uuid, boolean, jsonb, text),
  public.nfl_sync_lease_owned(bigint, uuid),
  public.prune_nfl_sync_runs() to service_role;
comment on table public.nfl_sync_state is 'Slate-scoped NFL sync lease and retry state; server service role only.';
comment on table public.nfl_sync_runs is 'One durable summary per NFL background worker invocation.';
commit;
