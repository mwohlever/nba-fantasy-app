-- Runs before COMMIT, after re-enabling the immutability trigger.
SELECT
  (SELECT count(*) FROM nr_versions e
   JOIN public.nba_player_game_observation_versions v ON v.id=e.id
   WHERE NOT e.keep) AS candidates_remaining,
  (SELECT count(*) FROM nr_keys k CROSS JOIN LATERAL (
    SELECT array_agg(v.id ORDER BY v.id) AS ids
    FROM public.nba_player_game_observation_versions v
    WHERE (v.provider,v.provider_player_id,v.provider_event_id)
        = (k.provider,k.provider_player_id,k.provider_event_id)
   ) live WHERE live.ids IS DISTINCT FROM
      ARRAY(SELECT x FROM unnest(ARRAY[k.first_id,k.last_id]) x ORDER BY x)) AS keyset_errors,
  (SELECT count(*) FROM nr_boundaries b
   LEFT JOIN LATERAL (
     SELECT * FROM public.nba_player_game_observation_versions v WHERE v.id=b.id LIMIT 1
   ) v ON true
   WHERE v.id IS NULL OR to_jsonb(v) IS DISTINCT FROM to_jsonb(b)) AS boundary_errors;
