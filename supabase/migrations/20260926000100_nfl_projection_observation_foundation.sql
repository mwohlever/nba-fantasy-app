-- MANUAL REVIEW/APPLICATION ONLY. NFL V2 factual evidence is provider-wide,
-- immutable, and not owned by a Group, League, or slate.
begin;

create table public.nfl_player_game_observation_versions (
  id bigint generated always as identity primary key,
  provider text not null check (provider = 'espn'),
  provider_player_id text not null check (provider_player_id ~ '^[0-9]+$'),
  provider_event_id text not null check (provider_event_id ~ '^[0-9]+$'),
  local_player_id bigint references public.players_nfl(id) on delete restrict,
  position text not null check (position in ('QB','RB','WR','TE')),
  season integer not null check (season between 2000 and 2100),
  week integer not null check (week between 1 and 18),
  phase text not null check (phase = 'regular'),
  game_at timestamptz not null,
  completed_at timestamptz,
  team_provider_id text not null check (team_provider_id ~ '^[0-9]+$'),
  team_abbreviation text,
  opponent_provider_id text not null check (opponent_provider_id ~ '^[0-9]+$'),
  opponent_abbreviation text,
  home_away text check (home_away in ('home','away')),
  completions integer check (completions is null or completions >= 0),
  passing_attempts integer check (passing_attempts is null or passing_attempts >= 0),
  passing_yards integer check (passing_yards is null or passing_yards >= 0),
  passing_touchdowns integer check (passing_touchdowns is null or passing_touchdowns >= 0),
  interceptions integer check (interceptions is null or interceptions >= 0),
  rushing_attempts integer check (rushing_attempts is null or rushing_attempts >= 0),
  rushing_yards integer check (rushing_yards is null or rushing_yards >= 0),
  rushing_touchdowns integer check (rushing_touchdowns is null or rushing_touchdowns >= 0),
  receiving_targets integer check (receiving_targets is null or receiving_targets >= 0),
  receptions integer check (receptions is null or receptions >= 0),
  receiving_yards integer check (receiving_yards is null or receiving_yards >= 0),
  receiving_touchdowns integer check (receiving_touchdowns is null or receiving_touchdowns >= 0),
  fumbles_lost integer check (fumbles_lost is null or fumbles_lost >= 0),
  game_log_source_url text not null,
  game_log_fetched_at timestamptz not null,
  fumble_summary_source_url text,
  fumble_summary_fetched_at timestamptz,
  known_at timestamptz not null,
  normalization_version text not null,
  observation_hash text not null check (observation_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  check (completed_at is null or completed_at >= game_at),
  check ((fumble_summary_source_url is null) = (fumble_summary_fetched_at is null)),
  check (known_at >= game_log_fetched_at),
  check (fumble_summary_fetched_at is null or known_at >= fumble_summary_fetched_at),
  unique (provider, provider_player_id, provider_event_id, observation_hash)
);

create index nfl_observation_versions_lookup
  on public.nfl_player_game_observation_versions
  (provider, provider_player_id, provider_event_id, known_at desc);
create index nfl_observation_versions_history
  on public.nfl_player_game_observation_versions
  (local_player_id, season, phase, game_at, known_at desc);
create index nfl_observation_versions_event
  on public.nfl_player_game_observation_versions (provider_event_id);

create view public.nfl_player_game_observations as
  select distinct on (provider, provider_player_id, provider_event_id) *
  from public.nfl_player_game_observation_versions
  order by provider, provider_player_id, provider_event_id, known_at desc, game_log_fetched_at desc, id desc;

create function public.reject_nfl_projection_observation_version_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'NFL player-game observation versions are immutable';
end;
$$;

create trigger nfl_observation_versions_immutable
  before update or delete on public.nfl_player_game_observation_versions
  for each row execute function public.reject_nfl_projection_observation_version_mutation();

alter table public.nfl_player_game_observation_versions enable row level security;
revoke all on public.nfl_player_game_observation_versions, public.nfl_player_game_observations
  from public, anon, authenticated, service_role;
revoke all on function public.reject_nfl_projection_observation_version_mutation()
  from public, anon, authenticated, service_role;
grant select, insert on public.nfl_player_game_observation_versions to service_role;
grant select on public.nfl_player_game_observations to service_role;
grant usage on sequence public.nfl_player_game_observation_versions_id_seq to service_role;

commit;
