-- Read-only, reviewable production diagnostics. NOT a migration.
-- Full scans/sorts can be expensive: run off peak and inspect timeouts first.
begin read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';

select pg_size_pretty(pg_database_size(current_database())) as database_size,
  pg_size_pretty(pg_table_size('public.nba_player_game_observation_versions')) as heap_and_toast,
  pg_size_pretty(pg_indexes_size('public.nba_player_game_observation_versions')) as indexes,
  pg_size_pretty(pg_total_relation_size('public.nba_player_game_observation_versions')) as total;

select provider_fetched_at::date as fetched_day, count(*) as versions,
  count(distinct (provider, provider_player_id, provider_event_id)) as player_games,
  min(game_at) as oldest_game, max(game_at) as newest_game
from public.nba_player_game_observation_versions
group by provider_fetched_at::date
order by fetched_day desc;

-- Distinguish actual fact changes from acquisition-only hashes. No hash rewrite.
with per_game as (
  select provider, provider_player_id, provider_event_id, count(*) as versions,
    count(distinct observation_hash) as hashes,
    count(distinct (local_player_id, season, phase, game_at, completed_at,
      team_provider_id, team_abbreviation, opponent_provider_id,
      opponent_abbreviation, home_away, minutes, points, rebounds, assists,
      steals, blocks, turnovers)) as fact_sets,
    bool_and(provider_known_at is not null and provider_known_at = provider_fetched_at) as ordinary_fetches
  from public.nba_player_game_observation_versions
  group by provider, provider_player_id, provider_event_id
)
select count(*) as player_games, sum(versions) as versions,
  sum(hashes) as hashes, sum(fact_sets) as distinct_game_fact_sets,
  count(*) filter(where versions > 1 and fact_sets = 1 and ordinary_fetches) as unchanged_repeated_games
from per_game;

select tgname, tgenabled, pg_get_triggerdef(oid)
from pg_trigger
where tgrelid = 'public.nba_player_game_observation_versions'::regclass and not tgisinternal;

select conrelid::regclass as referencing_table, conname, pg_get_constraintdef(oid)
from pg_constraint
where contype = 'f' and confrelid = 'public.nba_player_game_observation_versions'::regclass;

-- The current row must remain the exact immutable version selected by its FK.
select count(*) as mismatched_current_rows
from public.nba_player_game_current_observations c
left join public.nba_player_game_observation_versions v on v.id = c.version_id
where (to_jsonb(c) - 'version_id') is distinct from (to_jsonb(v) - 'id');

-- Inspect custom production schedulers separately if pg_cron is installed.
-- Avoid exporting job command text, which may contain credentials.
-- select jobid, jobname, schedule, active from cron.job order by jobid;
commit;
