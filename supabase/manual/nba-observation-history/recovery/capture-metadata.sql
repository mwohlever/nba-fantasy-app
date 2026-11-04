-- Read-only; run manually in SQL Editor after factual observation writers stop.
-- Save the single JSON value as metadata.json beside the external dump.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '30s';
SET LOCAL timezone = 'UTC';
SELECT jsonb_build_object(
  'captured_at', statement_timestamp(),
  'cutoff', 1502203,
  'expected_versions', 1502003,
  'expected_current', 34386,
  'expected_retained', 68772,
  'expected_candidates', 1433231,
  'watermark', (
    SELECT id FROM public.nba_player_game_observation_versions ORDER BY id DESC LIMIT 1
  ),
  'current_count', (SELECT count(*) FROM public.nba_player_game_current_observations),
  'current_checksum', (
    SELECT md5(string_agg(md5(to_jsonb(c)::text), ''
      ORDER BY provider, provider_player_id, provider_event_id))
    FROM public.nba_player_game_current_observations c
  ),
  'sequence', (SELECT jsonb_build_object('last_value', last_value, 'is_called', is_called)
    FROM public.nba_player_game_observation_versions_id_seq),
  'routines', (
    SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN (
      'append_nba_projection_observations', 'sync_nba_current_observation',
      'reject_nba_projection_observation_version_mutation'
    )
  ),
  'view', pg_get_viewdef('public.nba_player_game_observations'::regclass, true)
) AS archive_metadata;
COMMIT;
