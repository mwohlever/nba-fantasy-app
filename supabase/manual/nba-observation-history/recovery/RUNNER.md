# Direct PostgreSQL cleanup runner — review before production execution

The runner turns the reviewed archive manifest into one operator-started cleanup command. It performs bounded transactions, not a single 1.43-million-row transaction. **No production execution authorization file has been created.** Earlier pilot/batch-0002 approvals do not authorize this runner.

## Files and prerequisites

- `cleanup_runner.py`: archive/cache validation, database checks, transaction loop, storage/WAL monitoring, resume and reporting.
- `runner-setup.sql`: three session-local temporary staging tables, emptied on each commit. No persistent production table/function is installed.
- `runner-validate.sql` and `runner-postcheck.sql`: fixed-size SQL. Archive rows/metadata are streamed with parameter binding/COPY, not embedded as giant JSON SQL literals.
- `run-runner.sh`: uses the existing private PostgreSQL libraries and private Python environment.
- `runner-requirements.txt`: exact Python dependency versions; no system-wide install.
- `test_runner.py`: disposable local-database failure/resume tests.

On this Chromebook, the private environment is already prepared at `~/.local/share/111sports-recovery/runner-venv`. Psycopg 3.3.3 uses the verified private libpq shipped with the existing PGDG tools; all local SQL tests use PostgreSQL 17.11. The installed `pg_dump`, `pg_restore`, `psql` remain PostgreSQL 17 tools. Docker is unnecessary.

For a new environment, create that private virtual environment and install `runner-requirements.txt`. The private library directory needs the unversioned `libpq.so` symlink pointing to its existing `libpq.so.5`; no system library is replaced.

## What is protected

The existing external archive checksums, manifest SHA-256, baseline current checksum, 1,502,003 original versions, 34,386 keys, 68,772 retained versions, 1,433,231 candidates and cutoff 1502203 are binding inputs. A local SQLite cache holds compact manifest metadata and full first/latest rows; its own SHA-256 is checked before use. No archive data/cache is placed permanently in Supabase.

Startup reconciles all archived IDs with live IDs, independently of any ledger:

- A key with every original ID is pending.
- A key with exactly its two original boundaries is complete and skipped.
- A partial/different set, missing boundary, extra/unaccounted row, changed current checksum/reference, changed routine/schema/trigger/index/FK/RLS state, changed sequence/watermark or retention hazard stops the run.

This handles the already committed manual pilot and any later manual batch, and handles a lost COMMIT acknowledgement. Never infer that a timeout means rollback. The database is the authority; the ledger is an audit trail.

Each transaction stages at most 250 whole keys (at most 10,500 candidates), then locks history and current observations in the reviewed order. It checks every affected live observation against the archived facts/acquisition metadata and full boundary/current payloads. Only then does it temporarily disable the named immutability trigger, delete the exact staged candidate IDs, and re-enable the trigger. Foreign keys, RLS and the INSERT/current-sync trigger stay active. Row counts, boundary payloads/keysets, current checksum and trigger states are checked before COMMIT. A database/Python error or interruption rolls the transaction back; a disconnect is resolved by reclassification on resume. No trigger is left disabled at a transaction boundary.

The application can still read these relations while the ordinary table locks are held; writes to the observation tables wait during the short transaction. Pause the factual observation workflow/manual imports for the real maintenance window. Keep unrelated sports/live scoring running. If a real observation correction/new version arrives, the strict watermark/current checks stop rather than deleting around it.

## Disk/WAL and timing limits

The **256 MiB available-disk reserve** is retained. Admission requires additional conservative next-batch room: 8 KiB heap page image plus record allowance per candidate, plus 64 MiB for staging, WAL segments and other traffic. At 10,500 candidates this allowance is about 149 MiB *above* the reserve; a bare `free > 256 MiB` check is insufficient.

The runner checks physical `/data` metrics, read-only status, WAL allocation, WAL LSN generation, database growth, transaction age, replication slots and current/trigger state. It accounts conservatively for up to 90 seconds of backend metrics caching by deducting WAL/database growth since an older observation. Missing/stale HTTP metrics, a WAL-vs-metrics discrepancy above 32 MiB, database-size lag above 16 MiB, or insufficient conservative headroom stops further writes. It never assumes future checkpoints/vacuum will return space. Current space cannot guarantee the entire run will fit; a safe stop may require waiting for recycling or separately arranging more capacity before resuming.

Transaction work has a 25-second deadline, server statement timeouts and a 2-second lock timeout. A transaction that commits slower than the budget is recorded and stops subsequent work. Failed/cancelled transactions are rolled back. A sudden process kill/disconnect relies on PostgreSQL rollback and the session's 30-second idle-transaction timeout. A later invocation reconciles uncertain outcomes before proceeding.

Full integrity/count/schema/current/latest/retained-payload verification runs at startup, after approximately every 100,000 new deletions, and at completion. Per-transaction archive/current/boundary validation is never skipped. SIGINT/SIGTERM stops the process safely. No automatic blind retries, batch-size increases, WAL setting changes, slot removal, or physical maintenance are implemented.

## Read-only readiness (authorized now)

```bash
cd /home/markwohlever/nba-fantasy-app
bash supabase/manual/nba-observation-history/recovery/run-runner.sh dry-run \
  --target production \
  --report "$HOME/.local/share/111sports-recovery/archive-20261027/runner-production-readiness.json"
```

This uses the existing private archive connection configuration. Its login is the existing `postgres` login; this is transaction-level read-only enforcement, not a newly provisioned read-only ACL role. The pooler ignores startup read-only options, so the driver requests **READ ONLY before its first SQL**, verifies it, and establishes session read-only defaults. Every audit transaction is explicitly READ ONLY. Dry-run creates no production temp tables, does not acquire the maintenance advisory lock, and never calls deletion/trigger/compaction SQL. Metrics are retrieved with a read-only HTTPS GET; credentials are neither printed nor placed in logs.

Readiness reports include the actual already-deleted/remaining counts. They do not assume whether manual batch 0002 was executed. `READY_FOR_REVIEW` is not permission to execute production writes.

## Local rehearsal (authorized now)

```bash
bash supabase/manual/nba-observation-history/recovery/run-runner.sh local-execute \
  --target local --max-transactions 3 \
  --report "$HOME/.local/share/111sports-recovery/archive-20261027/runner-local-interrupted.json"
bash supabase/manual/nba-observation-history/recovery/run-runner.sh local-execute \
  --target local \
  --report "$HOME/.local/share/111sports-recovery/archive-20261027/runner-local-complete.json"
```

These commands are restricted to the existing private Unix socket, `nba_recovery` role and exact local data directory, with no TCP server address. They must never be pointed at the production service. Existing report files are preserved: choose a fresh report filename when repeating a test. Local cleanup does not affect the external archive, which remains intact for recovery.

## Future single-command production run — NOT AUTHORIZED YET

After reviewing test/readiness results, the operator must explicitly authorize production cleanup. Only then create a **mode-600 authorization JSON** bound to the readiness report's exact runner package SHA-256, manifest SHA-256, cache SHA-256, baseline current checksum, cutoff, and an expiry of at most 24 hours. The authorization string must be `AUTHORIZE_PRODUCTION_NBA_CLEANUP_1502203`; it is different from the old single-file gate. No valid authorization file exists now. Missing/mismatched/expired authorization fails **before any production connection is opened**.

Only after that approval, the proposed operator command is:

```bash
bash supabase/manual/nba-observation-history/recovery/run-runner.sh production-execute \
  --target production \
  --authorization-file /absolute/private/reviewed-runner-authorization.json \
  --report /absolute/private/production-cleanup-report.json
```

The user runs it; Codex does not start production cleanup. One command can process every remaining key, subject to automatic stops. On interruption/stop, review the JSON report and append-only/fsynced JSONL ledger, resolve the condition, then use the same command with a fresh report name and still-valid approval. Completed keys are not deleted twice. The runner uses a local process lock plus a session-level maintenance advisory lock to prevent competing runners.

## Reports and physical reclamation

The JSON report records the package/manifest/cache digests, target/mode, actual initial and final counts, baseline checksum, current/retained/object verification, transaction counts/durations, deletions/skips, WAL generation, and stop reasons. The JSONL ledger records storage admission and each confirmed commit before the next batch. Never treat a missing ledger entry as proof that a transaction rolled back.

At completion expect exactly **68,772** history rows, **34,386** unchanged current rows, original sequence/watermark, every original retained payload, valid constraints/indexes, and enabled history triggers. Statistical facts, first availability and correction boundaries are preserved; intermediate poll provenance remains in the external archive.

The runner **does not reclaim physical heap/index files**. See the physical recovery section of [README.md](README.md): separately approve ordinary VACUUM, then capacity-gated compaction of the small live set; use individual index rebuilds first only if needed for headroom. No VACUUM FULL/REINDEX/checkpoint/slot deletion is automatically executed. Stop at a final storage report before that separate maintenance approval.
