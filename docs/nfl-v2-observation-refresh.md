# NFL V2 factual observation refresh (Phase B)

This is the factual-evidence path for future NFL V2 shadow work. It stores only completed 2026 regular-season QB, RB, WR, and TE game observations. It does **not** generate projections or a projection cache, and no production NFL consumer reads it. D/ST and K remain outside NFL V2 scope.

## Sources and eligibility

- Athlete statistics: ESPN athlete game log, `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{athleteId}/gamelog?season={season}`.
- Final eligibility: ESPN regular-season scoreboard, `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={season}&seasontype=2&limit=1000`. An observation is accepted only when its event has `season.type = 2` and `status.type.completed = true` with `status.type.state = post`. Game logs do not reliably carry final status.
- QB fumbles lost: ESPN event summary, `https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={eventId}`. The worker deduplicates requests by event ID and validates the `fumbles` group plus `FUM` and `LOST` labels. A QB absent from an otherwise valid LOST structure is recorded as zero; an invalid or unavailable summary withholds that QB observation.

Eligibility comes directly from active `players_nfl` QB/RB/WR/TE rows and their numeric `nfl_player_id` ESPN athlete IDs. Duplicate or invalid active ESPN IDs fail the run; there is no name or fuzzy matching.

## Evidence semantics

The worker normalizes first and posts bounded batches of at most 500 records to the authenticated internal endpoint. `known_at` is the worker's completed-acquisition time; `completed_at` remains null because these sources do not provide a separately trustworthy completion timestamp. Game-log and QB-summary URLs/fetch times are retained as provenance.

The endpoint recomputes the Phase A1 factual hash and validates the direct local-player binding. The append-only table ignores an exact existing hash; an ESPN correction with changed facts appends a new version. Failed or incomplete refreshes never delete prior evidence and never trigger downstream generation.

## Operations

Required secret in both GitHub Actions and Vercel:

`NFL_PROJECTION_INGEST_SECRET`

The workflow also uses `NFL_PROJECTION_INGEST_BASE_URL` (set to `https://www.111sports.app`) and `NFL_PROJECTION_SEASON=2026`. It runs manually, Tuesday at 14:15 UTC, and Wednesday at 18:15 UTC. These correspond to 10:15 and 14:15 Eastern during daylight time; static UTC runs one hour earlier during standard time.

For a first run, add the matching secret to GitHub and Vercel, deploy this code, trigger the workflow manually with `dry_run=true`, review its deterministic totals, then trigger a normal manual run. Do not use a normal run until the dry run is clean.

The same authenticated endpoint accepts `{ "action": "audit", "season": 2026 }` and reports current rows, versions, position/player/event counts, local-ID resolution, duplicate current keys, QB fumble provenance and zero/positive counts, scope/phase/future-game anomalies, and active eligible players without stored history. Use it after the first write and before Phase C. The audit is factual validation, never model tuning.

See [the frozen research-data document](./nfl-projection-research-dataset.md) for the validated ESPN stat parser and fumble semantics.
