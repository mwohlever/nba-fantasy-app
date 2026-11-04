-- Read-only. Actual free disk must also be read from the Supabase disk report.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SELECT pg_database_size(current_database()) AS database_bytes,
  pg_table_size('public.nba_player_game_observation_versions') AS history_heap_toast_bytes,
  pg_indexes_size('public.nba_player_game_observation_versions') AS history_index_bytes,
  (SELECT max(clock_timestamp() - xact_start) FROM pg_stat_activity
   WHERE pid <> pg_backend_pid() AND xact_start IS NOT NULL) AS oldest_other_transaction,
  (SELECT jsonb_agg(jsonb_build_object('slot',slot_name,'active',active,
    'retained_bytes',pg_wal_lsn_diff(pg_current_wal_lsn(),restart_lsn)))
   FROM pg_replication_slots) AS replication_slots;
COMMIT;
