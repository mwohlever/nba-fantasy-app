BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL timezone = 'UTC';
WITH current_stats AS (
  SELECT count(*) AS current_count,
    md5(string_agg(md5(to_jsonb(c)::text), '' ORDER BY c.provider,c.provider_player_id,c.provider_event_id)) AS current_checksum,
    count(*) FILTER (WHERE v.id IS NULL) AS missing_versions,
    count(*) FILTER (WHERE v.id IS NOT NULL AND
      (to_jsonb(c) - 'version_id') IS DISTINCT FROM (to_jsonb(v) - 'id')) AS payload_mismatches,
    count(*) FILTER (WHERE latest.id IS DISTINCT FROM c.version_id) AS nonlatest_current
  FROM public.nba_player_game_current_observations c
  LEFT JOIN LATERAL (
    SELECT v.* FROM public.nba_player_game_observation_versions v WHERE v.id = c.version_id LIMIT 1
  ) v ON true
  LEFT JOIN LATERAL (
    SELECT h.id FROM public.nba_player_game_observation_versions h
    WHERE (h.provider,h.provider_player_id,h.provider_event_id)
        = (c.provider,c.provider_player_id,c.provider_event_id)
    ORDER BY h.provider_fetched_at DESC,h.id DESC LIMIT 1
  ) latest ON true
)
SELECT s.*,
  (SELECT count(*) FROM public.nba_player_game_observation_versions) AS history_count,
  (SELECT id FROM public.nba_player_game_observation_versions ORDER BY id DESC LIMIT 1) AS watermark,
  (SELECT jsonb_agg(jsonb_build_object('trigger',tgname,'enabled',tgenabled))
   FROM pg_trigger WHERE tgrelid = 'public.nba_player_game_observation_versions'::regclass AND NOT tgisinternal) AS history_triggers,
  (SELECT bool_and(indisvalid AND indisready) FROM pg_index
   WHERE indrelid = 'public.nba_player_game_observation_versions'::regclass) AS indexes_valid,
  (SELECT bool_and(convalidated) FROM pg_constraint
   WHERE conrelid IN ('public.nba_player_game_observation_versions'::regclass,
     'public.nba_player_game_current_observations'::regclass)) AS constraints_valid,
  pg_database_size(current_database()) AS database_bytes,
  pg_table_size('public.nba_player_game_observation_versions') AS history_heap_toast_bytes,
  pg_indexes_size('public.nba_player_game_observation_versions') AS history_index_bytes,
  pg_total_relation_size('public.nba_player_game_observation_versions') AS history_total_bytes
FROM current_stats s;
COMMIT;
