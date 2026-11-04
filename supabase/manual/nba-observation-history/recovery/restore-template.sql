-- GENERATED REVIEW FILE. Restores archived missing rows; never replaces current.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';
SET LOCAL timezone = 'UTC';
DO $restore$
DECLARE
  rows constant jsonb := $archived_rows$__ROWS__$archived_rows$::jsonb;
  before_current jsonb;
  after_current jsonb;
  restored bigint;
BEGIN
  IF '__APPROVAL__' <> 'ARCHIVE_RESTORED_AND_APPROVED_1502203' THEN
    RAISE EXCEPTION 'Review-only restore file: separate incident recovery approval required';
  END IF;
  IF jsonb_array_length(rows) NOT BETWEEN 1 AND 1000
    OR EXISTS (SELECT 1 FROM jsonb_to_recordset(rows) AS x(id bigint) WHERE id < 1 OR id > 1502203)
    OR (SELECT count(DISTINCT id) FROM jsonb_to_recordset(rows) AS x(id bigint)) <> jsonb_array_length(rows) THEN
    RAISE EXCEPTION 'Invalid restore batch';
  END IF;
  LOCK TABLE public.nba_player_game_observation_versions IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.nba_player_game_current_observations IN SHARE MODE;
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.provider,c.provider_player_id,c.provider_event_id)
  INTO before_current FROM public.nba_player_game_current_observations c
  WHERE EXISTS (SELECT 1 FROM jsonb_to_recordset(rows) AS x(provider text,provider_player_id text,provider_event_id text)
    WHERE (x.provider,x.provider_player_id,x.provider_event_id) = (c.provider,c.provider_player_id,c.provider_event_id));
  INSERT INTO public.nba_player_game_observation_versions OVERRIDING SYSTEM VALUE
  SELECT * FROM jsonb_populate_recordset(NULL::public.nba_player_game_observation_versions,rows)
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS restored = ROW_COUNT;
  IF EXISTS (SELECT 1
    FROM jsonb_populate_recordset(NULL::public.nba_player_game_observation_versions,rows) a
    LEFT JOIN public.nba_player_game_observation_versions v ON v.id = a.id
    WHERE v.id IS NULL OR to_jsonb(a) IS DISTINCT FROM to_jsonb(v)) THEN
    RAISE EXCEPTION 'Restored data differs from complete archived rows';
  END IF;
  SELECT jsonb_agg(to_jsonb(c) ORDER BY c.provider,c.provider_player_id,c.provider_event_id)
  INTO after_current FROM public.nba_player_game_current_observations c
  WHERE EXISTS (SELECT 1 FROM jsonb_to_recordset(rows) AS x(provider text,provider_player_id text,provider_event_id text)
    WHERE (x.provider,x.provider_player_id,x.provider_event_id) = (c.provider,c.provider_player_id,c.provider_event_id));
  IF before_current IS DISTINCT FROM after_current THEN
    RAISE EXCEPTION 'Restore would change current observations';
  END IF;
  PERFORM set_config('nba_observation_cleanup.restored',restored::text,true);
END;
$restore$;
SELECT current_setting('nba_observation_cleanup.restored')::bigint AS restored_rows;
COMMIT;
