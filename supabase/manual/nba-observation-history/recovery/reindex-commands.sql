-- Read-only generator. Review/run returned commands separately, only if approved.
SELECT format('REINDEX INDEX %I.%I;', n.nspname, c.relname) AS command,
  pg_relation_size(c.oid) AS index_bytes
FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE i.indrelid = 'public.nba_player_game_observation_versions'::regclass
ORDER BY pg_relation_size(c.oid) DESC;
