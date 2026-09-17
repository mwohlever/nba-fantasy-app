-- MANUAL REVIEW/APPLICATION ONLY. NFL V2 raw-stat shadow cache; never slate/group owned.
begin;

create table public.nfl_projection_stat_cache_versions (
  id bigint generated always as identity primary key,
  provider text not null check (provider = 'espn'),
  provider_player_id text not null check (provider_player_id ~ '^[0-9]+$'),
  local_player_id bigint not null references public.players_nfl(id) on delete restrict,
  position text not null check (position in ('QB','RB','WR','TE')),
  season integer not null check (season between 2000 and 2100),
  model_version text not null,
  as_of timestamptz not null,
  generated_at timestamptz not null,
  projected_stats jsonb not null check (jsonb_typeof(projected_stats) = 'object') check (not (projected_stats ?| array['fantasy_points','group_id','league_id','slate_id'])),
  confidence text not null check (confidence in ('low','normal')),
  sample jsonb not null check (jsonb_typeof(sample) = 'object') check (not (sample ?| array['fantasy_points','group_id','league_id','slate_id'])),
  components jsonb not null default '{}'::jsonb check (jsonb_typeof(components) = 'object') check (not (components ?| array['fantasy_points','group_id','league_id','slate_id'])),
  source_latest_game_at timestamptz,
  source_latest_known_at timestamptz,
  projection_hash text not null check (projection_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (provider, provider_player_id, season, model_version, as_of, projection_hash)
);

create index nfl_projection_cache_versions_player
  on public.nfl_projection_stat_cache_versions (local_player_id, model_version, as_of desc, created_at desc);
create index nfl_projection_cache_versions_season
  on public.nfl_projection_stat_cache_versions (season, model_version, as_of desc);

create view public.nfl_projection_stat_cache as
  select distinct on (provider, provider_player_id, season, model_version) *
  from public.nfl_projection_stat_cache_versions
  order by provider, provider_player_id, season, model_version, as_of desc, generated_at desc, id desc;

create function public.reject_nfl_projection_stat_cache_version_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'NFL projection stat-cache versions are immutable';
end;
$$;

create trigger nfl_projection_cache_versions_immutable
  before update or delete on public.nfl_projection_stat_cache_versions
  for each row execute function public.reject_nfl_projection_stat_cache_version_mutation();

alter table public.nfl_projection_stat_cache_versions enable row level security;
revoke all on public.nfl_projection_stat_cache_versions, public.nfl_projection_stat_cache
  from public, anon, authenticated, service_role;
revoke all on function public.reject_nfl_projection_stat_cache_version_mutation()
  from public, anon, authenticated, service_role;
grant select, insert on public.nfl_projection_stat_cache_versions to service_role;
grant select on public.nfl_projection_stat_cache to service_role;
grant usage on sequence public.nfl_projection_stat_cache_versions_id_seq to service_role;

commit;
