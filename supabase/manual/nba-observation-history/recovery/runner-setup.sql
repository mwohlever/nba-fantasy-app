-- EXECUTION MODE ONLY. Session-local bounded staging. No permanent objects.
CREATE TEMP TABLE nr_keys (
  key_no integer PRIMARY KEY, provider text NOT NULL,
  provider_player_id text NOT NULL, provider_event_id text NOT NULL,
  first_id bigint NOT NULL, last_id bigint NOT NULL, expected_count integer NOT NULL,
  UNIQUE(provider, provider_player_id, provider_event_id)
) ON COMMIT DELETE ROWS;
CREATE TEMP TABLE nr_boundaries (LIKE public.nba_player_game_observation_versions)
  ON COMMIT DELETE ROWS;
ALTER TABLE nr_boundaries ADD PRIMARY KEY(id);
CREATE TEMP TABLE nr_versions (
  key_no integer NOT NULL, id bigint PRIMARY KEY,
  fetched timestamptz NOT NULL, created timestamptz NOT NULL,
  observation_hash text NOT NULL, keep boolean NOT NULL
) ON COMMIT DELETE ROWS;
CREATE INDEX ON nr_versions(key_no);
