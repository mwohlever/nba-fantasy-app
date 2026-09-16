-- MANUAL EXECUTION ONLY. NBA V2 shadow evidence is provider-wide, immutable, and never slate-owned.
begin;
create table public.nba_player_provider_identities (
  provider text not null check (provider='espn'), provider_player_id text not null check (provider_player_id ~ '^[0-9]+$'),
  player_id bigint references public.players(id) on delete restrict, provider_name text,
  resolution_status text not null check (resolution_status in ('resolved','unresolved','ambiguous')),
  resolution_method text not null check (resolution_method in ('reviewed_provider_evidence','reviewed_exact_name','unresolved','ambiguous')),
  evidence text not null, is_locked boolean not null default false, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
  primary key(provider,provider_player_id), check ((resolution_status='resolved')=(player_id is not null))
);
create unique index nba_provider_identity_resolved_player on public.nba_player_provider_identities(provider,player_id) where resolution_status='resolved';
-- Identical evidence deduplicates; a correction appends a new content hash. Nothing valid is overwritten.
create table public.nba_player_game_observation_versions (
 id bigint generated always as identity primary key, provider text not null check(provider='espn'), provider_player_id text not null check(provider_player_id ~ '^[0-9]+$'), provider_event_id text not null,
 local_player_id bigint references public.players(id) on delete restrict, season integer not null check(season between 2000 and 2100), phase text not null check(phase='regular'), game_at timestamptz not null, completed_at timestamptz,
 team_provider_id text,team_abbreviation text,opponent_provider_id text,opponent_abbreviation text,home_away text check(home_away in ('home','away')),minutes numeric not null check(minutes>0),
 points numeric not null check(points>=0),rebounds numeric not null check(rebounds>=0),assists numeric not null check(assists>=0),steals numeric not null check(steals>=0),blocks numeric not null check(blocks>=0),turnovers numeric not null check(turnovers>=0),
  source_url text not null,provider_fetched_at timestamptz not null,provider_known_at timestamptz,normalization_version text not null,observation_hash text not null check(observation_hash ~ '^[a-f0-9]{64}$'),created_at timestamptz not null default clock_timestamp(),
  check (provider_known_at is null or provider_known_at <= provider_fetched_at),
  check (completed_at is null or completed_at >= game_at),
  unique(provider,provider_player_id,provider_event_id,observation_hash)
);
create index nba_observation_versions_lookup on public.nba_player_game_observation_versions(provider,provider_player_id,provider_event_id,provider_fetched_at desc);
create index nba_observation_versions_history on public.nba_player_game_observation_versions(local_player_id,season,game_at,provider_fetched_at desc);
create view public.nba_player_game_observations as select distinct on(provider,provider_player_id,provider_event_id) * from public.nba_player_game_observation_versions order by provider,provider_player_id,provider_event_id,provider_fetched_at desc,id desc;
create table public.nba_projection_stat_cache (
 player_id bigint not null references public.players(id) on delete restrict,model_version text not null,as_of timestamptz not null,generated_at timestamptz not null,
 projected_stats jsonb not null check(jsonb_typeof(projected_stats)='object'),projected_participation jsonb not null check(jsonb_typeof(projected_participation)='object'),confidence text not null check(confidence in ('high','medium','low')),
 sample jsonb not null check(jsonb_typeof(sample)='object'),components jsonb not null default '{}'::jsonb check(jsonb_typeof(components)='object'),fallback_reason text,source_latest_game_at timestamptz,source_latest_updated_at timestamptz,
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),primary key(player_id,model_version)
);
create index nba_projection_stat_cache_freshness on public.nba_projection_stat_cache(model_version,generated_at desc);
create function public.set_nba_projection_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end; $$;
create function public.reject_nba_projection_observation_version_mutation() returns trigger language plpgsql as $$ begin raise exception 'NBA player-game observation versions are immutable'; end; $$;
create trigger nba_provider_identity_updated_at before update on public.nba_player_provider_identities for each row execute function public.set_nba_projection_updated_at();
create trigger nba_projection_cache_updated_at before update on public.nba_projection_stat_cache for each row execute function public.set_nba_projection_updated_at();
create trigger nba_observation_versions_immutable before update or delete on public.nba_player_game_observation_versions for each row execute function public.reject_nba_projection_observation_version_mutation();
alter table public.nba_player_provider_identities enable row level security; alter table public.nba_player_game_observation_versions enable row level security; alter table public.nba_projection_stat_cache enable row level security;
revoke all on public.nba_player_provider_identities,public.nba_player_game_observation_versions,public.nba_projection_stat_cache,public.nba_player_game_observations from public,anon,authenticated;
revoke all on function public.set_nba_projection_updated_at() from public,anon,authenticated,service_role;
revoke all on function public.reject_nba_projection_observation_version_mutation() from public,anon,authenticated,service_role;
grant select on public.nba_player_provider_identities to service_role;
grant select,insert on public.nba_player_game_observation_versions to service_role;
grant select,insert,update on public.nba_projection_stat_cache to service_role;
grant select on public.nba_player_game_observations to service_role;
grant usage on sequence public.nba_player_game_observation_versions_id_seq to service_role;
commit;
