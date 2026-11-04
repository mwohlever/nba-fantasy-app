# Player Center E3A — factual readiness repairs, review only

Prepared October 30, 2026 in the isolated E1 candidate. **No live acquisition,
refresh, SQL change, mapping application, publication, workflow activation or
deployment was executed.** E1 is the dated release snapshot; this document describes
the additional uncommitted E3A delta. It does not authorize the commands below.

The launch objective is one coordinated public release with Player Center enabled
and accepted real NBA/NFL data already available. A disabled public feature rollout
is not the proposed bootstrap strategy.

## Integrity diagnosis and replacement

E2 observed SQLSTATE 57014 for `player_center_nba_refresh_health(true)`, while its
light form and individual counts succeeded. The full SQL includes a correlated
latest-version lookup for each current row, wide JSONB comparisons, an orphan-key
query and an aggregate checksum. This explains the unbounded single-statement work;
no live EXPLAIN was available to attribute exact milliseconds to each operator.

`nbaIntegrity.ts` preserves the checks with complete, bounded REST scans:

- Retain the installed light health check: normalized append fingerprint, trigger
  identities/enabled state, valid indexes/constraints, RLS and FK checks.
- Independently read history/current counts and the history watermark.
- Read **every** immutable version, ordered by ID, and select the latest version
  per provider/player/event by fetched timestamp and then ID. No sampling.
- Compare every current row, reference and complete payload against that winner;
  reject duplicates, missing current keys, orphans, unknown columns or truncated pages.
- Cast all numeric comparison fields to text, preserving PostgreSQL NUMERIC precision.
  Numeric scale differences remain equal; rounded JavaScript values cannot hide changes.
- Repeat the entire current scan and recheck counts/watermark. Any drift aborts.
- Use a versioned SHA-256 current checksum. This replaces the SQL MD5 serialization
  format, not the integrity guarantee. A checkpoint from the old checksum protocol
  must not be resumed with the new code.
- Bound each page to 1,000 rows, requests to 10 seconds, the audit to 75 seconds,
  total pages to 500, decoded transfer to 256 MiB, history to 250,000 versions and
  current rows to 100,000. Reaching a cap stops verification, never certifies a subset.

The server health adapter and predeployment operator use the same verifier. Storage
metrics are acquired after the scan so a long verification cannot make them look fresh.
The legacy RPC full branch and historical verification scripts that call it directly
can still time out; use the new bounded server/operator path for full verification.
No installer, SQL function, semantic append body, fingerprint expression or grant was
changed. Production latency and PostgREST casts still require the separately approved
live read-only preflight. An audit cap failure is a blocker, not permission to skip it.

## Bounded operator tooling

`scripts/player-center-canary.cjs` offers three explicit commands:

- `prepare`: GET-only catalog/status/cache/integrity/metrics reads and bounded ESPN
  GETs for **1–3 exact players**, producing a local review bundle. No POST-capable
  transport exists in this mode. Neither `.env` nor application APIs are loaded.
- `preflight`: GET-only revalidation of a clean, approved bundle, exact identities,
  before images, complete integrity and payload/disk/WAL/cache budgets. No acquisition.
- `publish-nba`: one explicit call to the **installed**
  `publish_player_center_nba_refresh` RPC. No undeployed API is required. No new
  acquisition, automatic retry, generic RPC executor or service-role cache DML exists.

The production Supabase origin is pinned. Existing operator credentials must already
be supplied through a separately approved local process context; never paste them
into command arguments, reports or this document, or change production environment
settings for this procedure.

Targets bind local ID, provider/native IDs, exact name, position, active state and
unique identity. NBA also requires its existing locked, evidenced mapping. A new
mapping cannot be silently inferred. Targets and before images are rechecked after
acquisition and again before publication.

Bundles contain a UUID, professional season, common cutoff, code/tooling hash,
target/before images, health receipts, normalized facts, raw response hashes/URLs,
acquisition counts and a SHA-256 approval token. Publication requires an exact token
and unchanged tooling; bundles expire after one hour. Incomplete bundles are retained
for review, exit non-green and produce no apply SQL. The CLI never overwrites an
existing output path. NBA reports are checkpointed atomically.

NBA uses the existing acquisition classifier and paced provider reader with a 25%
retry allowance. All sources are acquired before publication. The three-player
payload must fit 2.5 MB and pass the existing six-times-payload storage allowances.
SQL remains responsible for transactional append/cache/status publication, exact
JSONB replay receipts and stale/conflicting-run rejection.

## NFL facts and cache path

An omitted fumbles group now produces unknown evidence instead of aborting all
acquisition. An explicit athlete LOST=0 or positive value is retained. An absent QB
only gets zero when that team's FUM/LOST athlete list reconciles with its totals.
Missing groups, unverified empty lists and conflicting/malformed evidence cannot
establish zero. Unknown QB rows are withheld, reported as incomplete, and the worker
exits non-green while retaining other validated facts. Canonical scorers are unchanged.

NFL `prepare` uses the existing game-log/season-stat reader and validated event-summary
enrichment, including independent zero evidence. Three bounded passes reuse summaries
to complete longer histories. The entire batch has a 40-GET/180-second cap and pacing;
if necessary, reduce to one player rather than bypass the cap. K/DST use their existing
special paths. Unknown required inputs keep caches incomplete and FP unavailable.

For a clean NFL bundle, the CLI prepares the existing **owner-reviewed cache-only SQL**
with additional complete-coverage, schema/storage and fresh disk-receipt guards. The
service role still has SELECT-only cache access; no direct service writer was added.
Apply requires exact batch/backup tokens, matching catalog/before images and a disk
preflight no older than 90 seconds. Postflight exports exact after rows; withdrawal
refuses a newer/different publication. Neither path deletes observation history or
saved fantasy results. Existing general staging behavior is retained; the new stricter
canary guards apply to bundles generated by this CLI.

There is no NFL automatic full-cohort cache publisher/scheduler in this phase. The
manual 1–3-player publication path is ready for a separately approved canary; scalable
checkpointed orchestration, monitoring and workflow activation remain separate work.
Kicker fantasy scoring remains explicitly unavailable. No field is filled with an
invented zero to make a cache complete.

## Later canary approvals and commands — not executed

**Approval 1: exact scope and bounded GET acquisition.** Reconfirm the candidate
diff/tooling, professional seasons, target identities, existing grants and fresh
storage/integrity receipts. Example one-player files, based on dated reviewed IDs:

```json
[{"playerId":4,"name":"Stephen Curry","position":"G","nativePlayerId":"201939","providerPlayerId":"3975"}]
```

```json
[{"playerId":435,"name":"Patrick Mahomes","position":"QB","nativePlayerId":"3139477","providerPlayerId":"3139477"}]
```

The tool revalidates these against the live catalog. Expand only to explicitly
reviewed targets; test verified zero/DNP/bye scenarios only when independent evidence
exists. Never manufacture records to exercise those states.

```sh
node scripts/player-center-canary.cjs prepare --sport nba --season 2027 --targets /private/review/nba-targets.json --out /private/review/nba-canary-001
node scripts/player-center-canary.cjs prepare --sport nfl --season 2026 --targets /private/review/nfl-targets.json --out /private/review/nfl-canary-001
```

Inspect `bundle.json`: `clean:true`, exact players/season/cutoff, complete GP/log/
summary/metric coverage, all source hashes, unchanged before/after history and
complete integrity receipts. Incomplete/no-data/unresolved results require review,
not publication. `rollback-plan.json` preserves before images and the backup hash.

**Approval 2: exact NBA bundle publication.** Approve its `bundleSha256`, then:

```sh
node scripts/player-center-canary.cjs preflight --bundle /private/review/nba-canary-001/bundle.json --approve EXACT_BUNDLE_SHA256 --out /private/review/nba-preflight-001.json
node scripts/player-center-canary.cjs publish-nba --bundle /private/review/nba-canary-001/bundle.json --approve EXACT_BUNDLE_SHA256 --out /private/review/nba-receipt-001.json
```

Expected first receipt: `players=N`, `accepted` equals the approved observation count,
`0 <= appended <= accepted`, `not_appended=accepted-appended`, `replayed_players=0`.
Existing identical facts can legitimately append zero. Postflight requires matching
status UUID/outcome/receipt, every raw cache fact and metadata, complete caches, zero
reference errors and history growth exactly equal to appended versions.

A dropped acknowledgement stops with `STOPPED_RECONCILE_RECEIPTS`. Read receipts first;
never reacquire or change the UUID/payload as an automatic retry. Separately approve
an exact replay of the same unexpired bundle into a **new** report path. Expected replay:
`replayed_players=N`, accepted/appended zero, unchanged history/current. Expired bundles
require operator reconciliation and a new review, not an expiry bypass.

**Approval 3: NFL owner publication, separate from NBA.** Run the analogous GET-only
`preflight` for the NFL bundle, then review `01-preflight-backup.sql`, `00-cache-inputs.sql`,
`02-apply-cache.sql`, `03-postflight.sql` and `04-rollback-cache.sql`. No CLI executes SQL.
The owner must capture before CSVs, verify target before images, and set the session
approval/backup values from `nflBatch.batchSha256` / `backupReceiptSha256`. Also set
`sports111.cache_metrics_receipt` and `sports111.cache_metrics_at` to the values emitted
by the fresh preflight. If its 90-second validity expires, obtain another preflight.
Only then may the separately approved apply and postflight files be executed.

Expected NFL receipt: exactly N target cache rows matching the manifest, complete
coverage, unchanged observation/history counts, exact before/after exports, real
Season Stats and finite actual FP for supported offensive/DST examples. Accept K's
explicit scoring limitation separately. This is not certification of the whole pool.

**Abort:** any identity/before-image/code/approval drift; incomplete GP or score inputs;
unverified zero; wrong season/sport; provider conflict; integrity timeout/cap/mismatch;
stale/disagreeing metrics; insufficient reserve; database approaching 450 MB decimal;
combined cache/status approaching 64 MiB; unexplained append growth; unexpected receipt
or cache facts; or concurrent writers affecting the audit. Do not weaken a gate.

**Approval 4: rollback if needed.** Pause the relevant factual operation. Preserve all
immutable versions, mappings, results and saved picks. For NBA, use the exact
`withdrawalSql` saved in the **verified publication report**: it binds the actual
postflight cache (including intentionally reused game timestamps), UUID and before
receipt. The preparation-time SQL is only an incoming-cache template and may safely
refuse a timestamp-reused row. For NFL, use its separately approved guarded withdrawal
file and after receipt. Both refuse newer cache state and restore no stale prior cache.
NBA status receipts remain intact; a withdrawn UUID cannot be used to repopulate its
cache through replay. New population requires a new approved run. No forecast rollback.

## Proposed schedules and alerts — no workflow changes

Current GitHub state from E2: legacy NBA disabled; NFL factual observations active
Tuesday/Wednesday; NFL old projection generator active/manual-only. Candidate projection
code is retired/inert. Disabling the old NFL generator separately is a release gate.

| Proposed factual work | Cadence | Prerequisite |
| --- | --- | --- |
| NBA current season | Every six hours, e.g. `15 */6 * * *` UTC | Accepted canary/full run, mappings, storage and runtime budget |
| NFL current complete cache | Every six hours, offset, e.g. `45 */6 * * *` UTC | Checkpointed bounded cache orchestrator and publication capability still to be implemented/reviewed |
| Prior season during correction settling | Daily for 30 days after season end | Same verification gates |
| Historical seasons offered by default | Twice weekly, e.g. `30 8 * * 2,5` UTC | Accepted historical population; seven-day freshness rule |

Six-hour cadence leaves retry/incident time within the current 24-hour rule. Existing
NFL Tuesday/Wednesday raw acquisition is not a complete-cache schedule. Use one frozen
catalog/cutoff per cohort, bounded batches, serialized publication, persisted receipts
and safe resume. Do not make every UI request fetch a full pool.

Alert the designated operator through separately configured GitHub/job monitoring:
non-clean outcome arrays, missing/failed run, storage warning at 400 MB, failed integrity,
or changed identities immediately; current last-success age at 18 hours and historical
age at five days. At expiry keep stale/missing states and block ranks. No automatic
whole-run write retry after ambiguous acknowledgement. No game/draft notifications
are added. Monitoring configuration and scheduling require separate approval.

## Remaining launch gates

1. Approve and execute the bounded canaries above; live behavior/performance is unverified.
2. Review/apply exact identity changes separately. The 110 proposals are still unapplied;
   even all 110 leave 53 unresolved. Do not shrink eligibility to open ranking gates.
3. Implement/review NFL full-cohort orchestration and validate production acquisition
   resilience. Existing small-cache tooling is not an unattended full-pool system.
4. Populate current NBA 2027 / NFL 2026, then default historical NBA 2026/2025 and NFL
   2025/2024. Retain explicit unavailable states for unsupported older deep links.
5. Independently certify full relevant-pool identity, GP, per-metric completeness,
   common cutoff and freshness. Partial coverage needs an explicit product decision.
6. Complete authenticated multi-Group/frozen-slate/draft and real browser/mobile acceptance.
7. Separately approve publication of the reviewed application, one coordinated enabled
   production release, factual schedules and monitoring. The installed-RPC/operator
   bootstrap permits data acceptance before that public release. No disabled-feature
   production deployment or legacy projection worker is required for seeding facts.

Validation receipts and the exact E3A path/hash manifest are held outside the worktree
in the Phase E3A evidence directory. No production data was used by the tests.

## E3A validation

127 distinct focused checks passed across application/tooling and isolated PostgreSQL
receipts, including the final three-player canary case. Twenty PostgreSQL cases ran
only on a newly created Unix-socket-only temporary PostgreSQL 17 cluster, removed
afterward; none used production credentials or a network database. The original
LF/CRLF fingerprint, transaction, deduplication and correction tests remain passing.

Standalone TypeScript and the single Webpack production build passed. Scoped ESLint
comparison covers all 16 E3A code/test paths: zero diagnostics, zero introduced.
Final operator-only guards were exercised after the application build; no application
source changed afterward, and no second build was run. Existing E1 visual/draft
evidence is retained; no browser or live acquisition/publication test was performed.
The original worktrees, E1 recovery paths, approved profile/chart/CSS, canonical
scoring, installer, workflows and stash are checked by the final preservation manifest.
