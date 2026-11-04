-- Runs under history/current table locks, before disabling immutability.
WITH expected AS (
  SELECT key_no, array_agg(id ORDER BY id) AS ids,
    count(*) AS n, count(DISTINCT fetched) AS times,
    min(fetched) AS earliest, max(fetched) AS latest,
    count(*) FILTER (WHERE keep) AS keepers
  FROM nr_versions GROUP BY key_no
)
SELECT
  (SELECT count(*) FROM nr_keys k JOIN expected e USING(key_no)
   WHERE e.n <> k.expected_count OR e.n NOT BETWEEN 43 AND 44
      OR e.times <> e.n OR e.keepers <> 2 OR k.first_id = k.last_id
      OR NOT (k.first_id = ANY(e.ids) AND k.last_id = ANY(e.ids))) AS invalid_manifest,
  (SELECT count(*) FROM nr_keys k JOIN expected e USING(key_no)
   CROSS JOIN LATERAL (
     SELECT array_agg(v.id ORDER BY v.id) AS ids
     FROM public.nba_player_game_observation_versions v
     WHERE (v.provider,v.provider_player_id,v.provider_event_id)
         = (k.provider,k.provider_player_id,k.provider_event_id)
   ) live WHERE live.ids IS DISTINCT FROM e.ids) AS changed_keysets,
  (SELECT count(*) FROM nr_boundaries b
   LEFT JOIN LATERAL (
     SELECT * FROM public.nba_player_game_observation_versions v WHERE v.id=b.id LIMIT 1
   ) v ON true
   WHERE v.id IS NULL OR to_jsonb(v) IS DISTINCT FROM to_jsonb(b)) AS boundary_errors,
  (SELECT count(*) FROM nr_keys k
   JOIN nr_boundaries f ON f.id=k.first_id
   JOIN nr_boundaries l ON l.id=k.last_id
   JOIN expected e USING(key_no)
   WHERE f.provider_fetched_at <> e.earliest OR l.provider_fetched_at <> e.latest
      OR (f.provider,f.provider_player_id,f.provider_event_id)
         IS DISTINCT FROM (k.provider,k.provider_player_id,k.provider_event_id)
      OR (l.provider,l.provider_player_id,l.provider_event_id)
         IS DISTINCT FROM (k.provider,k.provider_player_id,k.provider_event_id)) AS boundary_order_errors,
  (SELECT count(*) FROM nr_keys k JOIN nr_boundaries b ON b.id=k.last_id
   LEFT JOIN public.nba_player_game_current_observations c
     ON (c.provider,c.provider_player_id,c.provider_event_id)
      = (k.provider,k.provider_player_id,k.provider_event_id)
   WHERE c.version_id IS NULL OR to_jsonb(c) IS DISTINCT FROM
     ((to_jsonb(b)-'id') || jsonb_build_object('version_id',b.id))) AS current_errors,
  (SELECT count(*) FROM nr_versions e JOIN nr_keys k USING(key_no)
   JOIN nr_boundaries b ON b.id=k.first_id
   LEFT JOIN public.nba_player_game_observation_versions v ON v.id=e.id
   WHERE v.id IS NULL OR v.id < 1 OR v.id > 1502203
      OR e.keep IS DISTINCT FROM (e.id IN (k.first_id,k.last_id))
      OR ROW(__FACTS_V__) IS DISTINCT FROM ROW(__FACTS_B__)
      OR ROW(v.provider_fetched_at,v.created_at,v.observation_hash)
         IS DISTINCT FROM ROW(e.fetched,e.created,e.observation_hash)
      OR v.provider_known_at IS DISTINCT FROM v.provider_fetched_at
      OR v.provider_known_at < v.game_at
      OR (v.completed_at IS NOT NULL AND v.provider_known_at < v.completed_at)) AS observation_errors,
  (SELECT count(*) FROM nr_versions e
   JOIN public.nba_player_game_current_observations c ON c.version_id=e.id
   WHERE NOT e.keep) AS referenced_candidates;
