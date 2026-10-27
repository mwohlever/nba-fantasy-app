# NBA history storage recovery — review only

No production SQL has been executed. These are manual-maintenance artifacts, not migrations or application changes. Existing audits are complete and are not repeated here. Scope: IDs 1–1502203; 1,502,003 original versions; 34,386 keys; retain 68,772 first/latest rows; remove 1,433,231 interior acquisition repeats.

For the checked Chromebook environment, use [CHROMEBOOK.md](CHROMEBOOK.md): private native PostgreSQL 17 tools and a Unix-socket-only local cluster avoid installing Docker or a system database service. The Docker instructions below remain an alternative.

## Recommended sequence

1. Confirm actual **free physical disk** in Supabase's disk report, not just database bytes. Run `storage-gate.sql` manually and check for old transactions or retained WAL. The reported database 1.201 GB plus WAL 128 MB does not establish available disk. If headroom cannot safely accommodate the deletion's WAL and later compaction, obtain additional capacity/Supabase assistance **before deletion**. No automatic slot removal, checkpoints, or database restart.
2. Pause only factual observation ingestion/manual imports. Keep NBA Fantasy/NBA Skins scoring and other sports running. Avoid schema changes during maintenance. Leave writers paused through archive, deletion, verification and compaction. The missing refresh interval is recovered by the next normal refresh after resuming.
3. Capture metadata and take an external archive; restore it locally and verify counts/current checksum. Generate the exact retained/candidate manifests **from the restored archive**, not from another production-wide audit.
4. Rehearse the generated batches locally. Release exactly those files only after archive/rehearsal and maintenance approval. Pilot 25 keys (~1,025–1,050 deletions), then 250 keys (~10,250–10,500 deletions) per independently committed transaction. There are 139 batch files, not 139 application changes. Inspect disk/WAL after the pilot and at least every ~100,000 deletions; stop if reserve is being consumed or retained WAL is growing. No unbounded retry loop.
5. Run ordinary VACUUM, verify data, then select the physical reclamation path below. Verify again and resume the normal observation workflow. Do not manually trigger ingestion without authorization.

Production SQL remains operator-run in SQL Editor. The optional production `psql` loop below and long-running maintenance are a workflow exception requiring explicit approval; they are not assumed authorized. CLI is necessary for a reliable complete external archive and useful for local rehearsal. SQL Editor result grids/CSV downloads are not a reliable million-row backup.

## External archive (operator CLI; production reads only)

Use PostgreSQL **17** clients and a saved libpq service named `111sports-production`, configured from Supabase Connect for the intended project `oororafwujfliscjasur`. Use a direct connection or session pooler, never transaction pooling. Keep credentials in the service/password files with restrictive permissions, not command arguments, Git, screenshots or logs. Allow at least **10 GB local free space** for archive, restore database, exported recovery rows and SQL files.

From the repository root, set an absolute private archive directory outside the repository:

```bash
set -euo pipefail
umask 077
NBA_RECOVERY_TOOLS="$PWD/supabase/manual/nba-observation-history/recovery"
NBA_RECOVERY_ARCHIVE="/absolute/private/nba-observation-archive-20261027"
mkdir -m 700 "$NBA_RECOVERY_ARCHIVE"
```

Manually run `capture-metadata.sql` in SQL Editor. Save the single complete JSON result as `$NBA_RECOVERY_ARCHIVE/metadata.json`. It captures the current checksum, installed routines, latest view and identity-sequence state. It must report watermark 1502203 and current_count 34386. Stop on a changed scope; do not silently update the approved cutoff/counts.

```bash
pg_dump --dbname='service=111sports-production' --format=custom \
  --lock-wait-timeout=5s \
  --table=public.nba_player_game_observation_versions \
  --table=public.nba_player_game_current_observations \
  --file="$NBA_RECOVERY_ARCHIVE/observations.dump"
pg_dump --dbname='service=111sports-production' --schema-only --schema=public \
  --lock-wait-timeout=5s --file="$NBA_RECOVERY_ARCHIVE/public-schema.sql"
pg_restore --list "$NBA_RECOVERY_ARCHIVE/observations.dump" > "$NBA_RECOVERY_ARCHIVE/archive.contents"
cd "$NBA_RECOVERY_ARCHIVE"
sha256sum observations.dump public-schema.sql metadata.json archive.contents > archive.sha256
sha256sum --check archive.sha256
```

Require successful dump exit status and inspect warnings. This captures **all** history/current rows (including original IDs, timestamps and hashes), the identity sequence, table definitions/indexes/FKs/triggers/policies/ACLs, and public-schema/routine definitions. A table-filtered dump does not include referenced objects automatically; the schema/metadata files preserve those definitions. This is a complete archive of the scoped observations, **not** a whole-application disaster-recovery backup. Copy the archive/checksum files to a second encrypted, versioned external location and verify SHA-256 there too. No backup table is created in production.

## Full restore rehearsal (disposable local PostgreSQL 17 only)

Create the bootstrap from the archived production routine/view definitions. Its `players` table is an explicit local FK fixture, seeded with every archived local_player_id; it is not a proposed production table replacement.

```bash
python3 "$NBA_RECOVERY_TOOLS/prepare.py" bootstrap metadata.json bootstrap-local.sql
docker run --detach --name nba-observation-rehearsal \
  --env POSTGRES_DB=nba_observation_rehearsal \
  --env POSTGRES_PASSWORD=local-rehearsal-only \
  --mount "type=bind,source=$NBA_RECOVERY_ARCHIVE,target=/archive,readonly" \
  postgres:17.6
```

Wait until `docker exec nba-observation-rehearsal pg_isready -U postgres` succeeds. No host database port is published.

```bash
docker exec nba-observation-rehearsal pg_restore -U postgres \
  --exit-on-error --no-owner --no-privileges --section=pre-data \
  --dbname=nba_observation_rehearsal /archive/observations.dump
docker exec nba-observation-rehearsal pg_restore -U postgres \
  --exit-on-error --no-owner --no-privileges --section=data \
  --dbname=nba_observation_rehearsal /archive/observations.dump
docker exec nba-observation-rehearsal psql -X -U postgres \
  --dbname=nba_observation_rehearsal --set=ON_ERROR_STOP=1 --file=/archive/bootstrap-local.sql
docker exec nba-observation-rehearsal pg_restore -U postgres \
  --exit-on-error --no-owner --no-privileges --section=post-data \
  --dbname=nba_observation_rehearsal /archive/observations.dump
docker exec -i nba-observation-rehearsal psql -X -Atq -U postgres \
  --dbname=nba_observation_rehearsal --set=ON_ERROR_STOP=1 \
  < "$NBA_RECOVERY_TOOLS/verify.sql" > restored-baseline.txt
docker exec -i nba-observation-rehearsal psql -X -Atq -U postgres \
  --dbname=nba_observation_rehearsal --set=ON_ERROR_STOP=1 \
  < "$NBA_RECOVERY_TOOLS/manifest-local.sql" > manifest.jsonl
python3 "$NBA_RECOVERY_TOOLS/prepare.py" batches manifest.jsonl review-batches
```

Require restored history count **1502003**, current count **34386**, checksum equal to metadata.json, zero current payload/reference/latest errors, and enabled triggers/valid indexes/FKs. `review-batches/READY.json` must exist and report exactly 34386 keys / 1502003 versions / 68772 retained / 1433231 candidates. Failed generation leaves no READY receipt: do not use partial output. The manifest independently requires unchanged facts/source/normalizer, ordinary valid availability, unique acquisition times, 43–44 versions/key, and exact current/latest payload agreement. Retained and candidate ID lists are external CSVs.

Before modifying the local clone, export complete recovery rows from it. The temporary ID table below exists **only inside the disposable local database**:

```bash
docker exec -i nba-observation-rehearsal psql -X -Atq -U postgres \
  --dbname=nba_observation_rehearsal --set=ON_ERROR_STOP=1 \
  > archived-candidates.jsonl <<'SQL'
SET timezone = 'UTC';
CREATE TEMP TABLE candidate_ids(id bigint PRIMARY KEY);
\copy candidate_ids FROM '/archive/review-batches/candidate-ids.csv' WITH (FORMAT csv)
SELECT row_to_json(v)::text
FROM public.nba_player_game_observation_versions v JOIN candidate_ids a USING(id)
ORDER BY v.id;
SQL
python3 "$NBA_RECOVERY_TOOLS/prepare.py" restores archived-candidates.jsonl recovery-review
python3 "$NBA_RECOVERY_TOOLS/prepare.py" batches manifest.jsonl rehearsal-batches \
  --approval ARCHIVE_RESTORED_AND_APPROVED_1502203
for NBA_RECOVERY_BATCH in rehearsal-batches/batch-*.sql; do
  docker exec -i nba-observation-rehearsal psql -X -Atq -U postgres \
    --dbname=nba_observation_rehearsal --set=ON_ERROR_STOP=1 \
    < "$NBA_RECOVERY_BATCH" > "${NBA_RECOVERY_BATCH%.sql}.local.log"
done
docker exec -i nba-observation-rehearsal psql -X -Atq -U postgres \
  --dbname=nba_observation_rehearsal --set=ON_ERROR_STOP=1 \
  < "$NBA_RECOVERY_TOOLS/verify.sql" > local-after-cleanup.txt
```

Require **68772** history rows, original watermark/current checksum/current count, zero errors and enabled triggers. Rerun a committed batch locally: expect zero new deletions and its candidates reported as previously deleted. Rehearse a bounded recovery by releasing `recovery-review` into a separate directory with `prepare.py restores ... --approval ...`, then run the first recovery file **locally**. Require exact archived-row matches and unchanged current observations; rerun it to prove idempotency. Do not resume deletion testing on partially restored keys: deletion intentionally rejects partial/unexpected histories.

Historical-as-of acceptance is **same factual values, eligibility, fantasy stat scores, correction/source boundaries and first recorded availability**, not every historical poll's fetched/known timestamp/hash/version ID. Every archived key has one fact set and ordinary unique availability; preserving its earliest observation preserves presence at all cutoffs, and preserving its latest/current observation preserves current freshness/payload. The manifest verifies this for all 34,386 keys, rather than sampling. `test-local.cjs` also exercises the actual application `observationsAsOf` implementation around every acquisition boundary in its fixture. Complete poll-by-poll provenance remains in the external archive. If an external consumer requires intermediate poll metadata in live SQL, do not release cleanup until that requirement is resolved.

Record SHA-256 of manifest, ID lists, READY receipts, templates and batch files. Copy these and rehearsal logs/recovery exports to the second external archive. The operator must retain both verified copies before production deletion.

## Production deletion — separate explicit approval

The SQL template is inspectable in `batch-template.sql`. Default generated files are blocked by a REVIEW_ONLY gate. After approval, generate a new directory with `prepare.py batches manifest.jsonl approved-batches --approval ARCHIVE_RESTORED_AND_APPROVED_1502203`. Its SQL must match the locally rehearsed files; its manifest digest/totals must match the reviewed receipt.

In SQL Editor, run the first approved file alone. It will lock out observation writes briefly, revalidate archive rows/IDs/boundaries/current payload, disable **only** `nba_observation_versions_immutable` for the DELETE, then re-enable it before commit. Foreign keys, RLS and the insert/current-sync trigger remain active throughout. A SQL error or cancellation rolls back both data changes and trigger state. Already-completed keys are skipped only if exactly their two original boundary rows remain; partial/unexpected history aborts. No persistent staging table or function is installed; no IDs/hashes/current rows/sequence are rewritten.

After the pilot, inspect disk/WAL and one application read, then run remaining files with periodic headroom checks. If an individual file times out, do not blindly increase its timeout; rerun the same file to discover a committed result or shrink its key batch after reviewing the archived manifest. Each transaction is independently restartable. DO NOT replace this with a single 1.43-million-row transaction.

Optional **operator-run production CLI**, only if expressly approved as an exception to SQL-Editor-only execution: execute files one at a time with `psql -X --dbname='service=111sports-production' --set=ON_ERROR_STOP=1 --file=...`. Stop on the first error. An automated loop must still stop for disk/WAL review after the pilot and after each ~100,000 rows; do not run all files unattended. SQL Editor needs no CLI for these individual transactions.

## Physical recovery — separate approval and disk gate

Do not execute these maintenance commands yet. Once deletion is complete and no long snapshot/retained WAL is blocking cleanup, run ordinary vacuum as a **standalone statement**, outside BEGIN/COMMIT:

```sql
VACUUM (ANALYZE, INDEX_CLEANUP ON, TRUNCATE FALSE, PARALLEL 0)
public.nba_player_game_observation_versions;
```

This makes space reusable; it normally does not return the 537 MB heap or 430 MB indexes to disk. Retained recent rows sit near the end of the file, so normal tail truncation is not a reliable solution.

**If measured headroom is sufficient:** one separately approved standalone command compacts the live heap and rebuilds all four indexes, preserving table identity/FKs/views/RPCs:

```sql
VACUUM (FULL, ANALYZE) public.nba_player_game_observation_versions;
```

The replacement contains only the **68772 live rows**, likely tens of MB, not a second full 967 MB history. Nevertheless the old relation remains allocated until completion; WAL, sort workspace and other database traffic require reserve. It takes ACCESS EXCLUSIVE on history and blocks history readers/FK checks while running. Current-table SELECTs remain separate, but monitor dependent requests. Do not promise free-tier safety from the current database/WAL numbers alone.

**If headroom is insufficient for that step:** use `reindex-commands.sql` to generate the four exact index names and rebuild one index at a time, with disk/WAL checks between them. Standard REINDEX is intentional during the paused-write window; it preserves constraints but can block queries using the rebuilt index. New indexes contain only live rows, so this may return roughly **400 MB** before heap compaction. Then reassess reserve and perform FULL only if safe. Index recovery alone likely leaves about **730–780 MB** of database allocation, still above 500 MB. If even the first index build or deletion WAL cannot fit, obtain capacity/support before proceeding.

There is no built-in zero-copy SQL operation that guarantees removal of scattered heap bloat while preserving these live tuples. `pg_repack` needs a client/extension and documented free space about twice the target table+indexes; it is not a low-headroom substitute here. Do not drop tables, drop/recreate FKs, swap table OIDs, change immutable rows to force relocation, or TRUNCATE/reload.

SQL Editor can submit VACUUM/REINDEX, but its upstream timeout can prevent reliable long-operation monitoring. Do not put SET + VACUUM into one multi-statement transaction. For a reliably monitored long command, obtain approval for a **user-run direct/session `psql`** maintenance session or have Supabase perform it. Example, after capacity/window approval:

```bash
PGOPTIONS='-c statement_timeout=0 -c lock_timeout=5000 -c maintenance_work_mem=32768' \
  psql -X --dbname='service=111sports-production' --set=ON_ERROR_STOP=1 \
  --command='VACUUM (FULL, ANALYZE) public.nba_player_game_observation_versions;'
```

This long-operation exception is not an invitation to raise deletion batch timeouts. If a dashboard request times out, check `pg_stat_activity`/`pg_stat_progress_cluster` before considering a retry; a gateway timeout is not proof that a backend operation stopped.

## Final verification and incident recovery

Run `verify.sql` manually after deletion/vacuum and after compaction. Require history **68772**, watermark **1502203**, current **34386**, current checksum identical to metadata.json, missing/payload/nonlatest counts **0**, both history triggers **O**, valid indexes/constraints, and unchanged sequence state. Measure database/heap/index bytes and disk/WAL separately. Project disk allocation may stay provisioned even when its used space falls.

Before resuming ingestion, open existing NBA analytics, an existing Player Center appearance, NBA Fantasy scores/rosters, NBA Skins and a historical scoring/as-of fixture. Existing scores and frozen slate rules should be identical. Resume the existing observation schedule and monitor its next normal run; unchanged observations must still add zero history rows. No application deployment is needed.

Proportional estimate: other database allocation ~187 MB plus compacted history ~46 MB = **~234 MB decimal**. Plan **230–300 MB**, not a guaranteed outcome. Relation page occupancy, TOAST, unrelated growth, other databases and WAL affect disk/headroom; WAL is not part of pg_database_size. Free-tier 500 MB database allowance and fixed 2 GB project disk are different limits.

Recovery procedure: stop observation writers; verify the external checksums; restore the archive to a disposable local PostgreSQL as above; select the original full rows for candidate IDs and generate reviewed recovery files with `prepare.py restores`. After separate incident approval, run the 1000-row restore files manually. They use INSERT ... OVERRIDING SYSTEM VALUE with normal FK/current-sync triggers, skip only identical existing IDs, assert exact archived payloads, and roll back if current observations change. They neither disable immutability nor reset the sequence. Do not restore the archived current table or replay the full dump into live production. Previously removed rows may require additional physical disk to restore; confirm capacity before recovery. Keep the archive even after successful reclamation.

References: [Supabase disk/WAL limits](https://supabase.com/docs/guides/platform/database-size), [PostgreSQL VACUUM](https://www.postgresql.org/docs/17/sql-vacuum.html), [REINDEX](https://www.postgresql.org/docs/17/sql-reindex.html), [pg_repack requirements](https://supabase.com/docs/guides/database/extensions/pg_repack), [pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).
