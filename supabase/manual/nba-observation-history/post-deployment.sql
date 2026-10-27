-- MANUAL SQL EDITOR USE ONLY. All blocks are read-only; run separately.
-- No ingestion calls, migrations, cleanup, or production execution by Codex.

-- A. Capture immediately before the first post-deployment ingestion, then repeat
-- after each of two completed scheduled runs. Save every result off-database.
-- For unchanged input: version count, watermark and current checksum stay fixed.
begin read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
set local timezone = 'UTC';
with history as (
  select count(*) as version_count, max(id) as version_id_watermark,
    max(created_at) as latest_version_created_at
  from public.nba_player_game_observation_versions
), current_state as (
  select count(*) as current_rows,
    md5(string_agg(md5(to_jsonb(c)::text), ''
      order by provider, provider_player_id, provider_event_id)) as current_checksum
  from public.nba_player_game_current_observations c
)
select current_timestamp as captured_at_utc, h.*, c.*,
  pg_database_size(current_database()) as database_bytes,
  pg_total_relation_size('public.nba_player_game_observation_versions') as versions_total_bytes
from history h cross join current_state c;
commit;

-- B. Replace NULL::bigint with A's ORIGINAL version_id_watermark before running.
-- Keep that same baseline across both daily runs. This is an insertion watermark,
-- not an estimate derived from row count: sequence gaps are normal.
-- baseline_supplied must be true. This classifies newly retained versions against
-- their immediate historical predecessor, preserving A -> B -> A transitions.
-- In the controlled chronological refresh window, metadata_only_versions should
-- be zero. A first version, changed facts or changed availability can be legitimate.
begin read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
with params as (
  select NULL::bigint as baseline_version_id
), compared as (
  select n.id, prior.id as prior_id,
    (to_jsonb(n) - array['id','created_at','provider_fetched_at',
      'provider_known_at','observation_hash','source_url','normalization_version']::text[])
    is not distinct from
    (to_jsonb(prior) - array['id','created_at','provider_fetched_at',
      'provider_known_at','observation_hash','source_url','normalization_version']::text[])
      as same_facts,
    coalesce(
      (n.provider_known_at is not distinct from prior.provider_known_at)
      or (n.provider_known_at = n.provider_fetched_at
        and prior.provider_known_at = prior.provider_fetched_at), false
    ) as equivalent_availability
  from public.nba_player_game_observation_versions n
  cross join params p
  left join lateral (
    select h.*
    from public.nba_player_game_observation_versions h
    where h.provider = n.provider
      and h.provider_player_id = n.provider_player_id
      and h.provider_event_id = n.provider_event_id
      and (h.provider_fetched_at, h.id) < (n.provider_fetched_at, n.id)
    order by h.provider_fetched_at desc, h.id desc
    limit 1
  ) prior on true
  where n.id > p.baseline_version_id
)
select
  (select baseline_version_id is not null from params) as baseline_supplied,
  (select baseline_version_id from params) as baseline_version_id,
  count(*) as new_versions,
  count(*) filter(where prior_id is null) as first_versions,
  count(*) filter(where prior_id is not null and not same_facts) as fact_change_versions,
  count(*) filter(where prior_id is not null and same_facts
    and not equivalent_availability) as availability_change_versions,
  count(*) filter(where prior_id is not null and same_facts
    and equivalent_availability) as metadata_only_versions
from compared;
commit;

-- C. Repeat after deployment and after each completed ingestion. All three error
-- counts must remain zero. All current observations must retain their referenced
-- version payload and existing latest-by-fetch-time, then ID ordering.
begin read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
select count(*) as current_rows,
  count(*) filter(where v.id is null) as missing_referenced_versions,
  count(*) filter(where (to_jsonb(c) - 'version_id')
    is distinct from (to_jsonb(v) - 'id')) as current_payload_mismatches,
  count(*) filter(where latest.id is distinct from c.version_id) as current_not_latest
from public.nba_player_game_current_observations c
left join public.nba_player_game_observation_versions v on v.id = c.version_id
left join lateral (
  select h.id
  from public.nba_player_game_observation_versions h
  where h.provider = c.provider and h.provider_player_id = c.provider_player_id
    and h.provider_event_id = c.provider_event_id
  order by h.provider_fetched_at desc, h.id desc
  limit 1
) latest on true;
commit;

-- D. Daily insertion trend. Mixed old/new deployments on cutover day may still
-- show old churn. Judge complete post-cutover runs against their saved baseline.
-- Zero inserts alone does NOT prove successful fetching: also inspect job logs.
begin read only;
set local statement_timeout = '120s';
set local lock_timeout = '5s';
select (created_at at time zone 'UTC')::date as inserted_day_utc,
  count(*) as new_versions,
  count(distinct (provider, provider_player_id, provider_event_id)) as player_games,
  min(game_at) as oldest_game, max(game_at) as newest_game
from public.nba_player_game_observation_versions
where created_at >= current_timestamp - interval '4 days'
group by (created_at at time zone 'UTC')::date
order by inserted_day_utc desc;
commit;
