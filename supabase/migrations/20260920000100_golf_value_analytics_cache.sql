-- MANUAL EXECUTION ONLY. Golf Value observations are provider-wide, never slate-owned.
begin;

create table public.golf_analytics_season_refreshes (
  id bigint generated always as identity primary key,
  provider text not null check (provider = 'espn_pga'),
  season integer not null check (season between 2000 and 2100),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  normalized_hash text not null check (normalized_hash ~ '^[a-f0-9]{64}$'),
  normalization_version text not null,
  source_bytes integer not null check (source_bytes > 0),
  observed_at timestamptz not null,
  last_checked_at timestamptz not null,
  status text not null check (status in ('ingesting','ready')),
  event_ids jsonb not null check (jsonb_typeof(event_ids) = 'array'),
  event_version_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(event_version_ids) = 'array'),
  diagnostics jsonb not null default '[]'::jsonb check (jsonb_typeof(diagnostics) = 'array'),
  ready_at timestamptz,
  check (last_checked_at >= observed_at),
  check (status <> 'ready' or (ready_at is not null and ready_at >= observed_at)),
  unique(provider,season,source_hash,normalized_hash,normalization_version)
);
create index golf_analytics_refresh_lookup on public.golf_analytics_season_refreshes(provider,season,status,last_checked_at desc);

create table public.golf_analytics_event_versions (
  id bigint generated always as identity primary key,
  provider text not null check (provider = 'espn_pga'),
  provider_event_id text not null,
  season integer not null,
  event_name text not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  observed_at timestamptz not null,
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  normalized_hash text not null check (normalized_hash ~ '^[a-f0-9]{64}$'),
  normalization_version text not null,
  eligibility text not null,
  diagnostics jsonb not null default '{}'::jsonb check (jsonb_typeof(diagnostics) = 'object'),
  -- One deduplicated real event snapshot per content/version, never per board.
  raw_event text not null,
  status text not null check (status in ('ingesting','ready')),
  ready_at timestamptz,
  check (status <> 'ready' or (ready_at is not null and ready_at >= observed_at)),
  unique(provider,provider_event_id,source_hash,normalized_hash,normalization_version)
);
create index golf_analytics_event_cutoff on public.golf_analytics_event_versions(provider,season,ends_at);

create table public.golf_analytics_observations (
  id bigint generated always as identity primary key,
  event_version_id bigint not null references public.golf_analytics_event_versions(id) on delete restrict,
  provider_player_id text not null,
  player_id bigint references public.golf_players(id) on delete restrict,
  provider_name text not null,
  history jsonb not null check (jsonb_typeof(history) = 'object'),
  diagnostics jsonb not null default '[]'::jsonb check (jsonb_typeof(diagnostics) = 'array'),
  unique(event_version_id,provider_player_id)
);
create index golf_analytics_observations_player on public.golf_analytics_observations(player_id,event_version_id);

create table public.golf_salary_board_inputs (
  price_set_id bigint primary key references public.golf_salary_price_sets(id) on delete restrict,
  as_of_at timestamptz not null,
  target_cutoff_at timestamptz not null,
  model_version text not null,
  input_hash text not null check (input_hash ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  check (as_of_at < target_cutoff_at)
);

create function public.guard_golf_analytics_evidence() returns trigger
language plpgsql as $$
begin
  raise exception 'Golf analytics evidence is immutable';
end;
$$;
create function public.guard_ready_golf_analytics_version() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Golf analytics event evidence cannot be deleted';
  end if;
  if old.status = 'ready' or (to_jsonb(new) - 'status' - 'ready_at') is distinct from
     (to_jsonb(old) - 'status' - 'ready_at') then
    raise exception 'Ready Golf analytics event evidence cannot change';
  end if;
  return new;
end;
$$;
create trigger golf_analytics_event_version_guard before update or delete on public.golf_analytics_event_versions
for each row execute function public.guard_ready_golf_analytics_version();
create function public.guard_ready_golf_analytics_refresh() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Golf analytics season evidence cannot be deleted';
  end if;
  -- An ingesting refresh is a staging record: finalization must attach the
  -- complete version manifest before it becomes immutable evidence.
  if old.status = 'ready' and
     (to_jsonb(new) - 'last_checked_at') is distinct from (to_jsonb(old) - 'last_checked_at') then
    raise exception 'Ready Golf analytics season evidence cannot change';
  end if;
  return new;
end;
$$;
create trigger golf_analytics_refresh_guard before update or delete on public.golf_analytics_season_refreshes
for each row execute function public.guard_ready_golf_analytics_refresh();
create trigger golf_analytics_observation_immutable before update or delete on public.golf_analytics_observations
for each row execute function public.guard_golf_analytics_evidence();
create trigger golf_salary_board_inputs_immutable before update or delete on public.golf_salary_board_inputs
for each row execute function public.guard_golf_analytics_evidence();

-- Create prices and the exact input manifest in one transaction. The legacy
-- manifest-free RPC is no longer callable by the application service role.
create function public.create_golf_salary_price_set_with_manifest(
  p_slate bigint,p_group uuid,p_league uuid,p_actor uuid,p_prices jsonb,p_manifest jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare created jsonb; v_set bigint;
begin
  if jsonb_typeof(p_manifest) is distinct from 'object' or
     jsonb_typeof(p_manifest->'field') is distinct from 'array' or
     jsonb_typeof(p_manifest->'eventVersions') is distinct from 'array' or
     jsonb_typeof(p_manifest->'observations') is distinct from 'array' or
     p_manifest->>'modelVersion' is null or p_manifest->>'inputHash' is null or
     (p_manifest->>'asOfAt')::timestamptz >= (p_manifest->>'targetCutoffAt')::timestamptz or
     (p_manifest->>'asOfAt')::timestamptz > clock_timestamp()
  then raise exception 'Complete, pre-tournament Golf board input manifest required'; end if;
  created:=public.create_golf_salary_price_set(p_slate,p_group,p_league,p_actor,p_prices);
  v_set:=(created->>'priceSetId')::bigint;
  insert into public.golf_salary_board_inputs(price_set_id,as_of_at,target_cutoff_at,model_version,input_hash,manifest)
  values(v_set,(p_manifest->>'asOfAt')::timestamptz,(p_manifest->>'targetCutoffAt')::timestamptz,
         p_manifest->>'modelVersion',p_manifest->>'inputHash',p_manifest);
  return created;
end;
$$;
revoke execute on function public.create_golf_salary_price_set(bigint,uuid,uuid,uuid,jsonb) from service_role;
revoke all on function public.create_golf_salary_price_set_with_manifest(bigint,uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_golf_salary_price_set_with_manifest(bigint,uuid,uuid,uuid,jsonb,jsonb) to service_role;

alter table public.golf_analytics_season_refreshes enable row level security;
alter table public.golf_analytics_event_versions enable row level security;
alter table public.golf_analytics_observations enable row level security;
alter table public.golf_salary_board_inputs enable row level security;
revoke all on public.golf_analytics_season_refreshes,public.golf_analytics_event_versions,
  public.golf_analytics_observations,public.golf_salary_board_inputs from public,anon,authenticated;
grant select,insert,update on public.golf_analytics_season_refreshes,public.golf_analytics_event_versions to service_role;
grant select,insert on public.golf_analytics_observations to service_role;
grant select,usage on sequence public.golf_analytics_season_refreshes_id_seq,
  public.golf_analytics_event_versions_id_seq,public.golf_analytics_observations_id_seq to service_role;
grant select on public.golf_salary_board_inputs to service_role;

commit;
