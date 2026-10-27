-- GENERATED REVIEW FILE. Approval gate is closed unless deliberately released.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL work_mem = '4MB';
SET LOCAL timezone = 'UTC';
DO $maintenance$
DECLARE
  approval constant text := '__APPROVAL__';
  plan constant jsonb := $approved_manifest$__PLAN__$approved_manifest$::jsonb;
  k jsonb;
  expected_first public.nba_player_game_observation_versions%rowtype;
  expected_last public.nba_player_game_observation_versions%rowtype;
  live_first public.nba_player_game_observation_versions%rowtype;
  live_last public.nba_player_game_observation_versions%rowtype;
  live_current public.nba_player_game_current_observations%rowtype;
  expected_ids bigint[];
  actual_ids bigint[];
  keeper_ids bigint[];
  delete_ids bigint[] := ARRAY[]::bigint[];
  bad bigint;
  deleted bigint := 0;
  skipped bigint := 0;
BEGIN
  IF approval <> 'ARCHIVE_RESTORED_AND_APPROVED_1502203' THEN
    RAISE EXCEPTION 'Review-only file: archive, restore rehearsal and explicit maintenance approval required';
  END IF;
  IF (plan->>'cutoff')::bigint <> 1502203 THEN
    RAISE EXCEPTION 'Wrong cleanup cutoff';
  END IF;

  LOCK TABLE public.nba_player_game_observation_versions IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.nba_player_game_current_observations IN SHARE MODE;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.nba_player_game_observation_versions'::regclass
      AND tgname = 'nba_observation_versions_immutable' AND tgenabled = 'O'
      AND tgfoid = 'public.reject_nba_projection_observation_version_mutation()'::regprocedure)
    OR NOT EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.nba_player_game_observation_versions'::regclass
      AND tgname = 'nba_observation_versions_sync_current' AND tgenabled = 'O'
      AND tgfoid = 'public.sync_nba_current_observation()'::regprocedure) THEN
    RAISE EXCEPTION 'Expected history triggers are not enabled';
  END IF;
  IF EXISTS (SELECT 1 FROM public.nba_player_game_observation_versions WHERE id > 1502203)
    OR EXISTS (SELECT 1 FROM public.nba_player_game_observation_versions WHERE id < 1) THEN
    RAISE EXCEPTION 'History changed outside the approved ID bounds; stop for review';
  END IF;
  IF (SELECT count(*) FROM public.nba_player_game_current_observations)
       <> (plan->>'current_count')::bigint THEN
    RAISE EXCEPTION 'Current key count changed';
  END IF;

  FOR k IN SELECT value FROM jsonb_array_elements(plan->'keys') LOOP
    SELECT * INTO expected_first FROM jsonb_populate_record(
      NULL::public.nba_player_game_observation_versions, k->'first');
    SELECT * INTO expected_last FROM jsonb_populate_record(
      NULL::public.nba_player_game_observation_versions, k->'last');
    SELECT * INTO live_first FROM public.nba_player_game_observation_versions WHERE id = expected_first.id;
    IF NOT FOUND OR to_jsonb(live_first) IS DISTINCT FROM to_jsonb(expected_first) THEN
      RAISE EXCEPTION 'Earliest retained row missing/changed: %', expected_first.id;
    END IF;
    SELECT * INTO live_last FROM public.nba_player_game_observation_versions WHERE id = expected_last.id;
    IF NOT FOUND OR to_jsonb(live_last) IS DISTINCT FROM to_jsonb(expected_last) THEN
      RAISE EXCEPTION 'Latest retained row missing/changed: %', expected_last.id;
    END IF;
    SELECT * INTO live_current FROM public.nba_player_game_current_observations c
    WHERE (c.provider,c.provider_player_id,c.provider_event_id)
        = (expected_last.provider,expected_last.provider_player_id,expected_last.provider_event_id);
    IF NOT FOUND OR to_jsonb(live_current) IS DISTINCT FROM
      ((to_jsonb(expected_last) - 'id') || jsonb_build_object('version_id', expected_last.id)) THEN
      RAISE EXCEPTION 'Current reference/payload changed: %', expected_last.id;
    END IF;

    SELECT array_agg(e.id ORDER BY e.id) INTO expected_ids
    FROM jsonb_to_recordset(k->'observations') AS e(id bigint);
    SELECT array_agg(x ORDER BY x) INTO keeper_ids
    FROM unnest(ARRAY[expected_first.id,expected_last.id]) x;
    IF cardinality(expected_ids) NOT BETWEEN 43 AND 44
      OR expected_first.id = expected_last.id
      OR NOT (keeper_ids <@ expected_ids)
      OR EXISTS (SELECT 1 FROM unnest(expected_ids) x WHERE x < 1 OR x > 1502203)
      OR (SELECT count(DISTINCT x) FROM unnest(expected_ids) x) <> cardinality(expected_ids) THEN
      RAISE EXCEPTION 'Invalid approved manifest';
    END IF;
    SELECT array_agg(v.id ORDER BY v.id) INTO actual_ids
    FROM public.nba_player_game_observation_versions v
    WHERE (v.provider,v.provider_player_id,v.provider_event_id)
        = (expected_first.provider,expected_first.provider_player_id,expected_first.provider_event_id);
    IF actual_ids = keeper_ids THEN
      skipped := skipped + cardinality(expected_ids) - 2;
      CONTINUE;
    END IF;
    IF actual_ids IS DISTINCT FROM expected_ids THEN
      RAISE EXCEPTION 'Partial/unexpected history; stop rather than guess: %', expected_first.id;
    END IF;

    SELECT count(*) INTO bad
    FROM jsonb_to_recordset(k->'observations') AS e(
      id bigint, provider_fetched_at timestamptz, created_at timestamptz, observation_hash text)
    LEFT JOIN public.nba_player_game_observation_versions v ON v.id = e.id
    WHERE v.id IS NULL
      OR ROW(v.provider,v.provider_player_id,v.provider_event_id,v.local_player_id,
        v.season,v.phase,v.game_at,v.completed_at,v.team_provider_id,v.team_abbreviation,
        v.opponent_provider_id,v.opponent_abbreviation,v.home_away,v.minutes,
        v.points,v.rebounds,v.assists,v.steals,v.blocks,v.turnovers,v.source_url,v.normalization_version)
      IS DISTINCT FROM ROW(expected_first.provider,expected_first.provider_player_id,
        expected_first.provider_event_id,expected_first.local_player_id,expected_first.season,
        expected_first.phase,expected_first.game_at,expected_first.completed_at,
        expected_first.team_provider_id,expected_first.team_abbreviation,
        expected_first.opponent_provider_id,expected_first.opponent_abbreviation,
        expected_first.home_away,expected_first.minutes,expected_first.points,
        expected_first.rebounds,expected_first.assists,expected_first.steals,
        expected_first.blocks,expected_first.turnovers,expected_first.source_url,expected_first.normalization_version)
      OR ROW(v.provider_fetched_at,v.created_at,v.observation_hash)
         IS DISTINCT FROM ROW(e.provider_fetched_at,e.created_at,e.observation_hash)
      OR v.provider_known_at IS DISTINCT FROM v.provider_fetched_at
      OR v.provider_known_at < v.game_at
      OR (v.completed_at IS NOT NULL AND v.provider_known_at < v.completed_at);
    IF bad <> 0 THEN RAISE EXCEPTION 'Archived observation no longer matches live history'; END IF;
    IF (SELECT count(DISTINCT e.provider_fetched_at)
        FROM jsonb_to_recordset(k->'observations') AS e(provider_fetched_at timestamptz))
      <> cardinality(expected_ids) THEN
      RAISE EXCEPTION 'Tied acquisition times in manifest';
    END IF;
    IF expected_first.id <> (SELECT v.id FROM public.nba_player_game_observation_versions v
       WHERE v.id = ANY(expected_ids) ORDER BY v.provider_fetched_at,v.id LIMIT 1)
      OR expected_last.id <> (SELECT v.id FROM public.nba_player_game_observation_versions v
       WHERE v.id = ANY(expected_ids) ORDER BY v.provider_fetched_at DESC,v.id DESC LIMIT 1) THEN
      RAISE EXCEPTION 'Manifest does not preserve chronological boundaries';
    END IF;
    delete_ids := delete_ids || ARRAY(
      SELECT x FROM unnest(expected_ids) x WHERE NOT (x = ANY(keeper_ids)));
  END LOOP;

  IF EXISTS (SELECT 1 FROM public.nba_player_game_current_observations WHERE version_id = ANY(delete_ids)) THEN
    RAISE EXCEPTION 'Deletion would remove a current reference';
  END IF;
  IF cardinality(delete_ids) > 0 THEN
    ALTER TABLE public.nba_player_game_observation_versions DISABLE TRIGGER nba_observation_versions_immutable;
    DELETE FROM public.nba_player_game_observation_versions v
    WHERE v.id = ANY(delete_ids) AND v.id <= 1502203
      AND NOT EXISTS (SELECT 1 FROM public.nba_player_game_current_observations c WHERE c.version_id = v.id);
    GET DIAGNOSTICS deleted = ROW_COUNT;
    ALTER TABLE public.nba_player_game_observation_versions ENABLE TRIGGER nba_observation_versions_immutable;
    IF deleted <> cardinality(delete_ids) THEN RAISE EXCEPTION 'Deletion count mismatch'; END IF;
  END IF;

  FOR k IN SELECT value FROM jsonb_array_elements(plan->'keys') LOOP
    SELECT * INTO expected_first FROM jsonb_populate_record(NULL::public.nba_player_game_observation_versions,k->'first');
    SELECT * INTO expected_last FROM jsonb_populate_record(NULL::public.nba_player_game_observation_versions,k->'last');
    SELECT array_agg(v.id ORDER BY v.id) INTO actual_ids
    FROM public.nba_player_game_observation_versions v
    WHERE (v.provider,v.provider_player_id,v.provider_event_id)
        = (expected_first.provider,expected_first.provider_player_id,expected_first.provider_event_id);
    SELECT array_agg(x ORDER BY x) INTO keeper_ids FROM unnest(ARRAY[expected_first.id,expected_last.id]) x;
    IF actual_ids IS DISTINCT FROM keeper_ids THEN RAISE EXCEPTION 'Retained rows mismatch'; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.nba_player_game_observation_versions'::regclass
      AND tgname IN ('nba_observation_versions_immutable','nba_observation_versions_sync_current')
      AND tgenabled <> 'O') THEN RAISE EXCEPTION 'History trigger state changed'; END IF;
  PERFORM set_config('nba_observation_cleanup.deleted',deleted::text,true);
  PERFORM set_config('nba_observation_cleanup.previously_deleted',skipped::text,true);
END;
$maintenance$;
SELECT current_setting('nba_observation_cleanup.deleted')::bigint AS deleted_this_transaction,
  current_setting('nba_observation_cleanup.previously_deleted')::bigint AS already_deleted_on_prior_attempt;
COMMIT;
