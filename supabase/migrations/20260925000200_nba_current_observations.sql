-- Maintain a small current-state table alongside immutable NBA observation history.
-- Historical versions remain append-only and authoritative.

begin;

create table public.nba_player_game_current_observations (
  provider text not null check (provider = 'espn'),
  provider_player_id text not null check (provider_player_id ~ '^[0-9]+$'),
  provider_event_id text not null,

  version_id bigint not null
    references public.nba_player_game_observation_versions(id)
    on delete restrict,

  local_player_id bigint references public.players(id) on delete restrict,
  season integer not null check (season between 2000 and 2100),
  phase text not null check (phase = 'regular'),
  game_at timestamptz not null,
  completed_at timestamptz,

  team_provider_id text,
  team_abbreviation text,
  opponent_provider_id text,
  opponent_abbreviation text,
  home_away text check (home_away in ('home', 'away')),

  minutes numeric not null check (minutes > 0),
  points numeric not null check (points >= 0),
  rebounds numeric not null check (rebounds >= 0),
  assists numeric not null check (assists >= 0),
  steals numeric not null check (steals >= 0),
  blocks numeric not null check (blocks >= 0),
  turnovers numeric not null check (turnovers >= 0),

  source_url text not null,
  provider_fetched_at timestamptz not null,
  provider_known_at timestamptz,
  normalization_version text not null,
  observation_hash text not null check (observation_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null,

  primary key (provider, provider_player_id, provider_event_id),

  check (provider_known_at is null or provider_known_at <= provider_fetched_at),
  check (completed_at is null or completed_at >= game_at)
);

create unique index nba_current_observations_version_id
  on public.nba_player_game_current_observations(version_id);

create index nba_current_observations_history
  on public.nba_player_game_current_observations(
    local_player_id,
    season,
    game_at
  );

-- Keep current state synchronized with every genuinely new immutable version.
--
-- Winner semantics intentionally match the existing
-- nba_player_game_observations view:
-- provider_fetched_at DESC, then id DESC.
create or replace function public.sync_nba_current_observation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  insert into public.nba_player_game_current_observations (
    provider,
    provider_player_id,
    provider_event_id,
    version_id,
    local_player_id,
    season,
    phase,
    game_at,
    completed_at,
    team_provider_id,
    team_abbreviation,
    opponent_provider_id,
    opponent_abbreviation,
    home_away,
    minutes,
    points,
    rebounds,
    assists,
    steals,
    blocks,
    turnovers,
    source_url,
    provider_fetched_at,
    provider_known_at,
    normalization_version,
    observation_hash,
    created_at
  )
  values (
    new.provider,
    new.provider_player_id,
    new.provider_event_id,
    new.id,
    new.local_player_id,
    new.season,
    new.phase,
    new.game_at,
    new.completed_at,
    new.team_provider_id,
    new.team_abbreviation,
    new.opponent_provider_id,
    new.opponent_abbreviation,
    new.home_away,
    new.minutes,
    new.points,
    new.rebounds,
    new.assists,
    new.steals,
    new.blocks,
    new.turnovers,
    new.source_url,
    new.provider_fetched_at,
    new.provider_known_at,
    new.normalization_version,
    new.observation_hash,
    new.created_at
  )
  on conflict (provider, provider_player_id, provider_event_id)
  do update
  set
    version_id = excluded.version_id,
    local_player_id = excluded.local_player_id,
    season = excluded.season,
    phase = excluded.phase,
    game_at = excluded.game_at,
    completed_at = excluded.completed_at,
    team_provider_id = excluded.team_provider_id,
    team_abbreviation = excluded.team_abbreviation,
    opponent_provider_id = excluded.opponent_provider_id,
    opponent_abbreviation = excluded.opponent_abbreviation,
    home_away = excluded.home_away,
    minutes = excluded.minutes,
    points = excluded.points,
    rebounds = excluded.rebounds,
    assists = excluded.assists,
    steals = excluded.steals,
    blocks = excluded.blocks,
    turnovers = excluded.turnovers,
    source_url = excluded.source_url,
    provider_fetched_at = excluded.provider_fetched_at,
    provider_known_at = excluded.provider_known_at,
    normalization_version = excluded.normalization_version,
    observation_hash = excluded.observation_hash,
    created_at = excluded.created_at
  where
    excluded.provider_fetched_at >
      nba_player_game_current_observations.provider_fetched_at
    or (
      excluded.provider_fetched_at =
        nba_player_game_current_observations.provider_fetched_at
      and excluded.version_id >
        nba_player_game_current_observations.version_id
    );

  return new;
end;
$$;

create trigger nba_observation_versions_sync_current
after insert on public.nba_player_game_observation_versions
for each row
execute function public.sync_nba_current_observation();

-- Backfill existing current state from immutable history.
--
-- Determine only the winning version IDs during deduplication, then retrieve
-- the full rows for those winners. This avoids carrying every full historical
-- observation through DISTINCT ON.
--
-- ON CONFLICT intentionally repeats the same winner rule as the trigger.
-- If a newer observation arrives while this migration is being applied, an
-- older historical winner cannot replace it.
with latest_ids as (
  select distinct on (
    provider,
    provider_player_id,
    provider_event_id
  )
    id
  from public.nba_player_game_observation_versions
  order by
    provider,
    provider_player_id,
    provider_event_id,
    provider_fetched_at desc,
    id desc
)
insert into public.nba_player_game_current_observations (
  provider,
  provider_player_id,
  provider_event_id,
  version_id,
  local_player_id,
  season,
  phase,
  game_at,
  completed_at,
  team_provider_id,
  team_abbreviation,
  opponent_provider_id,
  opponent_abbreviation,
  home_away,
  minutes,
  points,
  rebounds,
  assists,
  steals,
  blocks,
  turnovers,
  source_url,
  provider_fetched_at,
  provider_known_at,
  normalization_version,
  observation_hash,
  created_at
)
select
  v.provider,
  v.provider_player_id,
  v.provider_event_id,
  v.id,
  v.local_player_id,
  v.season,
  v.phase,
  v.game_at,
  v.completed_at,
  v.team_provider_id,
  v.team_abbreviation,
  v.opponent_provider_id,
  v.opponent_abbreviation,
  v.home_away,
  v.minutes,
  v.points,
  v.rebounds,
  v.assists,
  v.steals,
  v.blocks,
  v.turnovers,
  v.source_url,
  v.provider_fetched_at,
  v.provider_known_at,
  v.normalization_version,
  v.observation_hash,
  v.created_at
from public.nba_player_game_observation_versions v
join latest_ids latest
  on latest.id = v.id
on conflict (provider, provider_player_id, provider_event_id)
do update
set
  version_id = excluded.version_id,
  local_player_id = excluded.local_player_id,
  season = excluded.season,
  phase = excluded.phase,
  game_at = excluded.game_at,
  completed_at = excluded.completed_at,
  team_provider_id = excluded.team_provider_id,
  team_abbreviation = excluded.team_abbreviation,
  opponent_provider_id = excluded.opponent_provider_id,
  opponent_abbreviation = excluded.opponent_abbreviation,
  home_away = excluded.home_away,
  minutes = excluded.minutes,
  points = excluded.points,
  rebounds = excluded.rebounds,
  assists = excluded.assists,
  steals = excluded.steals,
  blocks = excluded.blocks,
  turnovers = excluded.turnovers,
  source_url = excluded.source_url,
  provider_fetched_at = excluded.provider_fetched_at,
  provider_known_at = excluded.provider_known_at,
  normalization_version = excluded.normalization_version,
  observation_hash = excluded.observation_hash,
  created_at = excluded.created_at
where
  excluded.provider_fetched_at >
    nba_player_game_current_observations.provider_fetched_at
  or (
    excluded.provider_fetched_at =
      nba_player_game_current_observations.provider_fetched_at
    and excluded.version_id >
      nba_player_game_current_observations.version_id
  );

alter table public.nba_player_game_current_observations
  enable row level security;

revoke all
  on public.nba_player_game_current_observations
  from public, anon, authenticated, service_role;

grant select
  on public.nba_player_game_current_observations
  to service_role;

revoke all
  on function public.sync_nba_current_observation()
  from public, anon, authenticated, service_role;

comment on table public.nba_player_game_current_observations is
  'Current NBA player-game observation selected from immutable version history by provider_fetched_at DESC, id DESC.';

commit;
