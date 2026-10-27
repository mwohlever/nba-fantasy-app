-- REVIEW ONLY: SELECT, with no mutations. Can be run in a read-only transaction.
-- Full history scan/sort: run off peak with a reviewed statement timeout.
-- Returns only INTERIOR repeats of an unchanged run, keeping BOTH boundaries.
-- Extra conservative: retain normalization/source changes and exclude an entire
-- player/event history if ANY availability is retrospective/custom or tied.
with evidence as (
  select v.*,
    to_jsonb(v) - array['id','created_at','provider_fetched_at',
      'provider_known_at','observation_hash']::text[] as facts
  from public.nba_player_game_observation_versions v
), eligible_keys as (
  select provider, provider_player_id, provider_event_id
  from evidence
  group by provider, provider_player_id, provider_event_id
  having bool_and(provider_known_at is not null
    and provider_known_at = provider_fetched_at)
    and count(distinct provider_fetched_at) = count(*)
), ordered as (
  select e.id, e.provider, e.provider_player_id, e.provider_event_id,
    e.provider_fetched_at, e.created_at, e.facts,
    lag(e.facts) over timeline as previous_facts,
    lead(e.facts) over timeline as next_facts
  from evidence e
  join eligible_keys k using (provider, provider_player_id, provider_event_id)
  window timeline as (partition by e.provider, e.provider_player_id, e.provider_event_id
    order by e.provider_fetched_at, e.id)
)
select o.id, o.provider, o.provider_player_id, o.provider_event_id,
  o.provider_fetched_at, o.created_at
from ordered o
where o.facts = o.previous_facts and o.facts = o.next_facts
  and not exists (
    select 1 from public.nba_player_game_current_observations c where c.version_id = o.id
  )
order by o.id;
