-- Additive writer fix only. No history rewrite, deletion, or trigger changes.
-- Deploy before the application switches its observation writer to this RPC.
begin;

create function public.append_nba_projection_observations(observations jsonb)
returns integer
language plpgsql
-- The existing current-table sync trigger is invoker security, while the
-- checked-in current-table migration grants service_role SELECT only. Execute
-- as the migration owner so that trigger can write without broadening grants.
security definer
set search_path = pg_catalog, public
as $$
declare
  incoming public.nba_player_game_observation_versions%rowtype;
  current_row public.nba_player_game_current_observations%rowtype;
  inserted integer := 0;
  affected integer;
begin
  if jsonb_typeof(observations) is distinct from 'array' then
    raise exception 'NBA observations must be an array';
  end if;
  if jsonb_array_length(observations) > 200 then
    raise exception 'NBA observation append accepts at most 200 rows';
  end if;

  -- Stable lock order across overlapping batches. Process repeated keys in
  -- acquisition order so A -> B -> A is retained, even within a single batch.
  for incoming in
    select r.*
    from jsonb_array_elements(observations) with ordinality as e(payload, ordinal)
    cross join lateral jsonb_populate_record(
      null::public.nba_player_game_observation_versions, e.payload
    ) as r
    order by r.provider, r.provider_player_id, r.provider_event_id,
             r.provider_fetched_at, e.ordinal
  loop
    -- Cooperating RPC callers serialize even when the current row doesn't exist.
    -- Existing insert/sync/immutability triggers and service-role grants remain.
    perform pg_advisory_xact_lock(hashtextextended(jsonb_build_array(
      'nba_observation_append', incoming.provider,
      incoming.provider_player_id, incoming.provider_event_id
    )::text, 0));

    select * into current_row
    from public.nba_player_game_current_observations c
    where c.provider = incoming.provider
      and c.provider_player_id = incoming.provider_player_id
      and c.provider_event_id = incoming.provider_event_id;

    if found
      -- Earlier acquisitions may establish historical availability: keep them.
      and incoming.provider_fetched_at >= current_row.provider_fetched_at
      -- Ordinary live fetches use known_at = fetched_at. Preserve transitions
      -- between retrospective/recorded evidence and explicit revision times.
      and ((incoming.provider_known_at is not distinct from current_row.provider_known_at)
        or (incoming.provider_known_at = incoming.provider_fetched_at
          and current_row.provider_known_at = current_row.provider_fetched_at))
      and row(incoming.local_player_id, incoming.season, incoming.phase,
        incoming.game_at, incoming.completed_at, incoming.team_provider_id,
        incoming.team_abbreviation, incoming.opponent_provider_id,
        incoming.opponent_abbreviation, incoming.home_away, incoming.minutes,
        incoming.points, incoming.rebounds, incoming.assists, incoming.steals,
        incoming.blocks, incoming.turnovers)
      is not distinct from
      row(current_row.local_player_id, current_row.season, current_row.phase,
        current_row.game_at, current_row.completed_at, current_row.team_provider_id,
        current_row.team_abbreviation, current_row.opponent_provider_id,
        current_row.opponent_abbreviation, current_row.home_away, current_row.minutes,
        current_row.points, current_row.rebounds, current_row.assists, current_row.steals,
        current_row.blocks, current_row.turnovers)
    then
      -- Acquisition time, URL and normalizer labels alone aren't new facts.
      -- Do not advance the retained version's first-known/fetched timestamps.
      continue;
    end if;

    insert into public.nba_player_game_observation_versions (
      provider, provider_player_id, provider_event_id, local_player_id,
      season, phase, game_at, completed_at, team_provider_id, team_abbreviation,
      opponent_provider_id, opponent_abbreviation, home_away, minutes,
      points, rebounds, assists, steals, blocks, turnovers, source_url,
      provider_fetched_at, provider_known_at, normalization_version, observation_hash
    ) values (
      incoming.provider, incoming.provider_player_id, incoming.provider_event_id,
      incoming.local_player_id, incoming.season, incoming.phase, incoming.game_at,
      incoming.completed_at, incoming.team_provider_id, incoming.team_abbreviation,
      incoming.opponent_provider_id, incoming.opponent_abbreviation, incoming.home_away,
      incoming.minutes, incoming.points, incoming.rebounds, incoming.assists,
      incoming.steals, incoming.blocks, incoming.turnovers, incoming.source_url,
      incoming.provider_fetched_at, incoming.provider_known_at,
      incoming.normalization_version, incoming.observation_hash
    ) on conflict (provider, provider_player_id, provider_event_id, observation_hash)
      do nothing;
    get diagnostics affected = row_count;
    inserted := inserted + affected;
  end loop;
  return inserted;
end;
$$;

revoke all on function public.append_nba_projection_observations(jsonb)
  from public, anon, authenticated;
grant execute on function public.append_nba_projection_observations(jsonb) to service_role;
comment on function public.append_nba_projection_observations(jsonb) is
  'Append changed NBA game facts atomically; retain provenance and correction reversals without daily fetch-only versions.';

commit;
