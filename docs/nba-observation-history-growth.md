# NBA observation version growth

## Finding and scope

The repository explains the reported daily growth without a statistical change.
`fetchEspnNbaGameLog` assigns the acquisition instant to both `fetchedAt` and
`knownAt`. `observationRecordFromNbaObservation` computes:

```ts
createHash("sha256").update(JSON.stringify(body)).digest("hex")
```

`body` contains provider/player/event/local identity, season/phase, game and
completion times, team/opponent IDs and abbreviations, home/away, minutes, the
six counting statistics, **source URL, fetched time, known time and normalization
version**. Database `id` and `created_at` are not hashed. It hashes the normalized
record, not the raw ESPN response. The normalizer label is currently constant
(`espn_nba_gamelog_v1`); changing it or the source URL also changes the hash.
The changing fetch/known times alone are sufficient to cause daily churn.

The original writer used `upsert(..., { ignoreDuplicates: true })` with unique
key `(provider, provider_player_id, provider_event_id, observation_hash)`.
Every acquisition therefore passed that uniqueness check. There was no
statistical comparison before inserting. The current-observation trigger then
selected the new version as the latest observation.

The GitHub workflow runs daily at **10:23 UTC**. Its worker fetches every eligible
athlete's entire game log for `[season - 1, season]`, not just new games. The
default season is the UTC calendar year, so during 2026 this requests ESPN seasons
2025 and 2026 (the 2024–25 and 2025–26 seasons). That explains the October 2024
through April 2026 coverage. Stable eligible players/appearances produce a fixed
daily row count. 34,386 observations x 43 acquisitions = 1,478,598 versions,
consistent with the reported approximate total. The server-side batch ingestion
path also fetches both seasons and uses the same persistence function.

The reported production counts and 954 MB size were supplied by the user; this
investigation did not connect to production or independently verify deployed
functions, scheduler configuration, or individual records. Migration filenames
are not evidence of their actual deployment dates. Run the reviewed, read-only
`supabase/manual/nba-observation-history/audit.sql` off peak to confirm production
counts, semantic changes, sizes, triggers and FK dependencies. Inventory any
custom pg_cron/external schedules too. There is no additional observation-writing
SQL scheduler in the checked-in migrations.

## Code and data flow

| File/function | Responsibility |
| --- | --- |
| `.github/workflows/nba-projection-shadow-refresh.yml` | Daily `23 10 * * *` schedule; existing historical filename |
| `scripts/run-nba-projection-shadow-refresh.cjs` | Eligible athletes, current/prior season full game logs, bounded HTTP batches |
| `lib/analytics/providers/espnNbaGameLog.ts`: `fetchEspnNbaGameLog` | Fetch, normalize and timestamp observations |
| `app/api/internal/nba/projection-ingest/route.ts` | Secret-protected ingestion entry point |
| `lib/analytics/nba/projectionRefresh.server.ts` | Server-side ingestion entry point |
| `lib/analytics/nba/projectionIngestion.server.ts` | Validate final regular-season appearances and bind reviewed local identities |
| `lib/analytics/nba/projectionInfrastructure.ts`: `observationRecordFromNbaObservation` | Database record and SHA-256 acquisition hash |
| `lib/analytics/nba/projectionRepository.server.ts`: `upsertNbaProjectionObservations` | Shared production persistence path; now calls atomic RPC in batches of 200 |
| `20260925000100_nba_projection_observation_foundation.sql` | Version table, unique hash key, latest-version view, immutable-history trigger and grants |
| `20260925000200_nba_current_observations.sql`: `sync_nba_current_observation` | Insert trigger maintaining current rows by fetched time, then version ID |
| `20261027000100_nba_observation_semantic_append.sql`: `append_nba_projection_observations` | Additive semantic append RPC; no data cleanup |

Manual Player Center rollout SQL also directly inserts reviewed observations
after comparing current facts. Those one-time scripts are not the daily job.
They do not participate in the RPC's advisory locks; do not run a manual import
concurrently with the factual refresh. Review any external direct insert clients.

## Fix

The acquisition hash is retained for exact retries and provenance. A facts-only
hash under the existing lifetime UNIQUE constraint would silently lose an
`A -> B -> A` correction reversal. Instead, the RPC serializes each player/event
key, loads its current observation and compares typed, null-safe game facts:
local identity, season/phase, game/completion times, teams/opponent/home-away,
minutes, points, rebounds, assists, steals, blocks and turnovers.

For chronological acquisitions, matching facts and equivalent availability
evidence skip the insert. URL, normalizer label and ordinary fetch/known-time
changes do not create versions. Explicit provider-known times still matter:
re-fetching the same explicit revision is redundant, while different explicit
revision times and transitions between retrospective and recorded evidence are
retained. Earlier acquisitions are conservatively retained, rather than losing
earlier historical availability. Existing hashes require no backfill.

Changed facts append an immutable version and the existing trigger updates the
current row. Exact retries remain idempotent. Stable lock order and per-key
transaction advisory locks prevent cooperating concurrent identical acquisitions
from inserting duplicates; invalid insert batches roll back atomically.
The function is executable only by `service_role`, with a pinned search path.
It runs as its owner because the existing invoker-security sync trigger needs
current-table write privileges that the checked-in migrations do not grant to
`service_role`. No existing trigger, table policy or grant is weakened.

Unchanged acquisitions leave the retained version and its current row intact.
Their timestamps remain the retained evidence's timestamps, not a per-game
heartbeat. Use worker logs for refresh health; fallback Player Center coverage
and analytics freshness fields can consequently show an older acquisition time.
Do not overwrite first-known times with the last poll time.

The daily worker and server-side writer use the RPC. No scoring coefficients,
league rules or frozen slate snapshots change. Current/prior full-season fetches
remain in place to detect genuine corrections. Changing the seasonal window or
fetch frequency is a separate product/operational change.

## Consumers and historical limits

- `projectionRepository.server.ts` reads current observations for analytics
  history and source timestamps. `nba_player_game_observations` is the original
  latest-version view; it remains intact.
- `lib/player-center/repository.server.ts` uses current observations as a stored
  appearance fallback, including minutes/stats and fetch-time coverage metadata.
- `lib/analytics/nba/history.ts`: `observationsAsOf` resolves recorded revisions
  using `knownAt`, or explicitly approximate retrospective history; the backtest
  engine consumes it. Immutable correction transitions and first availability
  must be retained even though current application history readers use current
  rows. Current-only readers do not reconstruct superseded historical versions.
- Live NBA Fantasy scoring uses `lib/nba/refreshFantasy.server.ts`, NBA.com box
  scores, `player_slate_stats` and frozen slate rules. It does not read this ESPN
  observation history. NBA Skins uses standings/season records separately.
- Manual reviewed stat corrections and analytics replay must retain real changes
  and provenance. Unknown external consumers or references must be inventoried
  before cleanup. Version IDs and acquisition audit metadata can have value
  beyond the stat values shown in the UI.

This is chronological observation compression, not a historical reconciliation
engine. Do not replay older, conflicting provider acquisitions through the live
writer after suppressing newer identical polls: those suppressed poll instants
are no longer available to reconstruct every intervening historical transition.
The workflow concurrency group serializes scheduled/manual factual jobs; handle
out-of-order archived backfills in a separate
reviewed import using the original acquisition evidence. Ordinary late-published
provider corrections are fetched with a new acquisition time and are retained.

## Verification and deployment

1. Review/deploy **only** the observation fix files, separately from unrelated
   Player Center/projection-retirement changes already present in this checkout.
   Validate the production table/trigger definitions and privileges against the
   foundation migrations first. Do not blindly apply all pending migrations.
2. Run the regression suite against a fresh, socket-only local PostgreSQL 15
   cluster. The test harness creates/stops/removes its own cluster and never
   loads `.env`, database URLs or Supabase credentials:

   ```sh
   NBA_OBSERVATION_PG_BIN=/path/to/postgresql/15/bin \
     node --test tests/nba-observation-versioning.test.cjs
   node --test tests/nba-analytics.test.cjs tests/nba-projection-infrastructure.test.cjs \
     tests/nba-projection-v1.test.cjs tests/nba-projection-worker.test.cjs \
     tests/nba-projection-shadow-route.test.cjs
   npx tsc --noEmit
   git diff --check
   npm run build
   ```

   Without the binary-path variable, SQL tests explicitly skip; that is not
   sufficient validation for deployment. No UI behavior changes in this fix, so
   local database behavior is the relevant Dev verification.
3. Apply the **additive RPC migration first**, then deploy the repository writer.
   Confirm PostgREST exposes the new function and only the service role can call
   it. Old app code still works with the additive migration; it continues churn
   until replaced. New code without the migration fails visibly rather than
   falling back to the unsafe direct-insert path.
4. In staging, ingest a fixed batch twice with different fetch times. Expect no
   second version increase and identical current rows. Change one stat, then
   restore it in later acquisitions: expect one new version each time and the
   right recorded as-of stats at cutoffs between those revisions. Confirm live
   Fantasy scores and frozen-rule scoring remain unchanged by identical polls.
5. Compare production pre/post version counts around the first factual refresh
   and repeat the read-only audit after two daily runs. Historical unchanged
   games should stop adding daily versions; new appearances, changed identities,
   real corrections and new explicit availability evidence can still add rows.
   `accepted`/`observationsUpserted` in existing ingestion responses count eligible
   inputs, **not inserted versions**; use table counts/creation times for proof.
6. If rollout fails, pause only the factual observation workflow while resolving
   RPC exposure/privileges. Leave the independent Fantasy/Skins scoring workers
   running. The additive migration can stay installed. Reverting the app writer
   is possible, but restores storage churn; do not drop history to roll back.

Tests cover acquisition-only changes, SQL value normalization, null metadata,
each stored fact/stat/identity correction, reversals and recorded-as-of scoring,
retrospective/recorded transitions, stable explicit revisions, overlapping
writers, independent keys, atomic rollback, role restrictions and immutability.
The cleanup candidate selector is also tested against correction runs and
recorded-as-of stat values without deleting source history.

Local validation on 2026-10-27: all 15 final focused tests passed on isolated
PostgreSQL 15.19 with no skips. The related NBA suite passed 79 tests before the
final two focused additions. TypeScript, focused ESLint, `git diff --check` and
`npm run build` passed. Production deployment/verification has not been performed.

## Separate cleanup proposal — not executed

`supabase/manual/nba-observation-history/redundant-candidates.sql` is a read-only
candidate selector. It keeps both boundaries of each identical consecutive run
and selects only interior repeats. For comparison it excludes only version ID,
database creation time, fetch/known times and acquisition hash; URL and
normalizer changes are conservatively retained. It excludes entire player/event
histories containing retrospective/custom availability or tied fetch times.
It also excludes every `current.version_id` reference.

For a sequence `A,A,A,B,B,B,A,A,A`, only the middle repeat of each run is a
candidate. Keep the first-ever observation, first and last evidence in each run,
every correction/reversal, identity/time/team/completion change, explicit timing
evidence, source/normalizer change and every referenced version. Do not group by
stat hash across the whole lifetime or retain only the latest row. Those methods
destroy legitimate historical intervals.

For a clean 43-observation identical run this proposes keeping two boundary
rows, so at most 41/43 (~95%) are candidates. This is illustrative, not a measured
production reduction. Actual corrections, metadata changes and references reduce
the removable count. Indexes, TOAST, WAL and the rest of the database affect the
final storage result.

This preserves recorded-as-of **fact values and first availability** for eligible
runs, not the ability to audit every poll's timestamp, URL/hash pairing, creation
time or version ID. A consumer requiring acquisition-by-acquisition provenance
must use the external archive or block removal of those rows. Unknown dependencies
are not evidence that records are safe to delete.

`cleanup-proposal.sql` is deliberately commented out, ends its example transaction
with `ROLLBACK`, and is outside migrations. Before separately approving cleanup:

1. Pause factual writers; export schema, complete versions/current data and the
   exact candidate manifest off the over-quota database. Test restore.
2. Inventory production FKs, triggers, views/functions, external analytics and
   archived as-of requirements. Exclude all referenced IDs. Rehearse on a restored
   copy; compare current rows, latest view and historical fact selection at every
   revision boundary before/after candidate filtering.
3. Review exact IDs/count/checksum and a cutoff. Revalidate the manifest under
   bounded locks immediately before any approved batch. Transactionally disable
   only the named history immutability trigger, keep FK constraints active, delete
   only approved/revalidated candidates, restore the trigger, and assert counts,
   byte-identical current rows and historical fact equivalence. Failed checks
   roll back data and trigger state. Never rewrite current version references.

Deletion alone generally leaves disk files allocated. Standard `VACUUM (ANALYZE)`
makes dead space reusable but usually does not shrink the files. Physical
reclamation may require separately planned `VACUUM (FULL, ANALYZE)` on this table:
it takes an exclusive lock, rebuilds the table/indexes and needs temporary free
space plus WAL capacity. Do not run it automatically or inside the deletion
transaction. Confirm headroom with Supabase first; a near-full project may need
support or temporary additional capacity. Do not run a separate automatic REINDEX
or move the backup into this database. See [PostgreSQL VACUUM documentation](https://www.postgresql.org/docs/15/sql-vacuum.html)
and [Supabase database size guidance](https://supabase.com/docs/guides/platform/database-size).

Record `pg_total_relation_size`, `pg_table_size`, `pg_indexes_size` and
`pg_database_size` before and after approved maintenance; then check Supabase's
database-size report after its metrics update. Database size and allocated project
disk/WAL are separate metrics; shrinking a relation does not promise an immediate
change to every dashboard metric.
