-- LOCAL RESTORED DATABASE ONLY. No need to repeat this export in production.
SET timezone = 'UTC';
SELECT jsonb_build_object(
  'first', to_jsonb(f),
  'last', to_jsonb(l),
  'eligible',
    to_jsonb(c) = ((to_jsonb(l) - 'id') || jsonb_build_object('version_id', l.id))
    AND f.id <> l.id
    AND s.ordinary AND s.same_facts AND s.distinct_fetches = s.n
    AND s.latest_id = l.id AND s.n BETWEEN 43 AND 44,
  'observations', s.observations
)
FROM public.nba_player_game_current_observations c
CROSS JOIN LATERAL (
  SELECT v.* FROM public.nba_player_game_observation_versions v
  WHERE (v.provider, v.provider_player_id, v.provider_event_id)
      = (c.provider, c.provider_player_id, c.provider_event_id)
  ORDER BY v.provider_fetched_at, v.id LIMIT 1
) f
JOIN public.nba_player_game_observation_versions l ON l.id = c.version_id
CROSS JOIN LATERAL (
  SELECT count(*) AS n, count(DISTINCT v.provider_fetched_at) AS distinct_fetches,
    (array_agg(v.id ORDER BY v.provider_fetched_at DESC, v.id DESC))[1] AS latest_id,
    bool_and(v.provider_known_at IS NOT NULL
      AND v.provider_known_at = v.provider_fetched_at
      AND v.provider_known_at >= v.game_at
      AND (v.completed_at IS NULL OR v.provider_known_at >= v.completed_at)) AS ordinary,
    bool_and(
      to_jsonb(v) - ARRAY['id','created_at','provider_fetched_at','provider_known_at','observation_hash']
      = to_jsonb(f) - ARRAY['id','created_at','provider_fetched_at','provider_known_at','observation_hash']
    ) AS same_facts,
    jsonb_agg(jsonb_build_object(
      'id', v.id, 'provider_fetched_at', v.provider_fetched_at,
      'created_at', v.created_at, 'observation_hash', v.observation_hash
    ) ORDER BY v.id) AS observations
  FROM public.nba_player_game_observation_versions v
  WHERE (v.provider, v.provider_player_id, v.provider_event_id)
      = (c.provider, c.provider_player_id, c.provider_event_id)
) s
ORDER BY c.provider, c.provider_player_id, c.provider_event_id;
