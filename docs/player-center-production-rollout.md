# Player Center production rollout — review only

October 29 local implementation update: [NBA factual refresh](./nba-player-center-factual-refresh.md) supersedes the historical worker/resume and recurring-writer guidance below. Production SQL, deployment, mapping application, activation and scheduling remain pending separate approval. Frozen review bundles remain dated evidence.

Prepared October 23, 2026, on `main`. **Nothing in this plan has been executed
against production.** Both starting documents were read in full:
[`player-center-audit.md`](./player-center-audit.md) and
[`player-center-foundation.md`](./player-center-foundation.md).

The deliverable is a frozen mapping review, a separately proposed small cache
table, and a staged NBA canary. The preparation tools only SELECT database data,
GET public provider data, and write local artifacts. They have no SQL execution
or apply mode. All SQL lives under `supabase/manual/`, outside automatic migrations.

## Prepared files

| Location | Purpose |
| --- | --- |
| `supabase/manual/player-center/20261023-review/mapping-manifest.json` | All 98 exact targets, before/after values, independent evidence, 465-player proposed acquisition universe, checksums |
| `20261023-review/mapping-review.csv` | One spreadsheet-reviewable row per candidate |
| `20261023-review/unresolved-players.json` | All 65 protected unresolved players |
| `20261023-review/review-snapshot.json` | Fresh read-only database before image plus both provider roster snapshots; no credentials or private Group data |
| `20261023-review/00-mapping-inputs.sql` | Shared temporary expected rows; include only inside the provided transaction scripts |
| `20261023-review/01-preflight-and-backup.sql` | SELECT-only production preflight and client-side CSV backups |
| `20261023-review/02-apply-mappings.sql` | Guarded atomic insert of exactly 98 mappings; exact replay is a no-op |
| `20261023-review/03-postflight-and-receipt.sql` | Exact verification and after-image CSV receipt |
| `20261023-review/04-rollback-mappings.sql` | Guarded pre-ingestion rollback using the after receipt; refuses changed rows or dependencies |
| `supabase/manual/player-center/season-cache-v1.sql` | Separately proposed additive schema, RLS, SELECT-only service-role grant |
| `supabase/manual/player-center/season-cache-v1-rollback.sql` | Drop only this reviewed cache, only when empty, with separate approval |
| `supabase/manual/player-center/export-before-cache.sql` | SELECT-only export of exact target cache before images for a refresh |
| `supabase/manual/player-center/20261023-canary/` | Captured public acquisition, exact two-observation/one-cache-row manifest, guarded apply/postflight/cache-withdrawal SQL |
| Both bundle `SHA256SUMS` files | Detect modified review artifacts |
| `scripts/prepare-player-center-rollout.cjs` | Read-only fresh review, or deterministic offline regeneration into a new directory |
| `scripts/stage-player-center-nba.cjs` | Bounded current-season acquisition and SQL preparation; never applies it |
| `scripts/lib/playerCenterRollout.cjs`, `playerCenterNbaBatch.cjs` | Offline validation and SQL builders |
| `tests/player-center-rollout.test.cjs` | Isolated PostgreSQL transaction, permission, duplicate, correction, conflict, and rollback tests |

Paths beginning `20261023-review/` above are relative to
`supabase/manual/player-center/`. A reviewed directory must not be overwritten
with a new acquisition. New data requires a new directory, manifest, checksum,
and approval. The two preparation CLIs refuse existing output directories.

## NBA mapping review: every candidate rechecked

The new review performed 32 bounded public GETs and database SELECTs. All **98**
candidates still have exactly one native NBA ID, a unique matching normalized
name on both sides, and an agreeing current team in independently fetched NBA
and ESPN rosters. The local native ID, name, active flag, existing mappings, and
current provider IDs were rechecked. There were **zero conflicts or local drift**.
Team aliases such as NY/NYK are normalized; suffixes are not erased.

For each of the 98:

- Before identity row: **absent**. No existing mapping is overwritten.
- After: exact ESPN ID → exact local player ID, `resolved`,
  `reviewed_provider_evidence`, locked, provider display name and dated evidence.
- The local player row is identical before/after. Old local team labels are not
  silently corrected during identity work.
- `created_at` / `updated_at` use database insert defaults and are captured in
  the post-write receipt. They are intentionally not guessed in the manifest.

Coverage would change from **367/530 (69.2%) to 465/530 (87.7%)**, conditional on
all guards still passing. The 64 players absent from the native current-season
response and Bobby Portis's suffix discrepancy remain unresolved. None is
deactivated, deleted, relabeled, or assigned a guessed ESPN ID.

### Mapping guards, backups, idempotency, rollback

The apply transaction requires two operator session settings: the exact
`apply:<manifestSha256>` approval token and the reviewed snapshot backup hash.
These interlocks prevent accidental execution; they do not replace explicit
human approval. The manifest contains both values. Store the immutable JSON
snapshot and export the live identity/player tables to CSV before applying.

The transaction takes short identity/player locks, verifies all baseline rows
and the entire reviewed player catalog, rejects ID collisions, checks the
expected trigger/function source, and permits only **0 or all 98** matching
target rows before insertion. A partial 1–97 state requires investigation, not
automatic completion. Postconditions require exactly 465 identities and no
changes to the original 367, local player values, or unresolved cohort.

Rerunning the identical apply file after success inserts zero rows. Any drift
in business fields, baseline identities, local IDs, or unexpected triggers
aborts the complete transaction. Lock wait is capped at three seconds.

After commit, the postflight exports `nba-identities-after.csv`. Rollback compares
every target column, including actual database timestamps, to that receipt.
It deletes only those exact, unchanged inserted rows and verifies the original
367-row baseline. It refuses any observation, projection-cache, or Player Center
cache dependency. It never disables immutable-history triggers or cascades
deletions. If ingestion has occurred, preserve mappings/evidence and approve a
corrective identity/invalidation plan instead. Replaying a completed safe
mapping rollback is a no-op.

## Existing automation is an explicit production consideration

`.github/workflows/nba-projection-shadow-refresh.yml` runs daily at **10:23 UTC**.
Its script selects every active resolved mapping, defaults to calendar year
2026, fetches current/prior seasons, and generates projection caches. Thus adding
98 mappings expands that worker's eligible population even without changing its
code. The generic ingestion route also writes in 200-record chunks and can
generate projections; its request-level season value does not itself validate
every supplied observation's season.

**Do not use those routes/workers for this rollout.** Separately approve holding
the shadow workflow during rollout, and do not resume it blindly afterward.
Decide whether it should remain on its reviewed existing cohort or intentionally
expand under a separate projection task. Correcting that worker's season to
2027 is also a separate behavior/configuration change, not part of Player Center
data population. No workflow, configuration, projection cache, draft, saved
lineup, slate result, or scoring formula was changed by this work.

## Minimal NBA 2026–27 ingestion

Reuse `nba_player_game_observation_versions` for complete, final, positive-minute
regular-season appearances. Its existing trigger maintains
`nba_player_game_current_observations`. Do not write that current table directly.
Keep preseason/postseason separate; stage only ESPN ending-year **2027**, with
event dates in the corresponding season interval and never beyond the batch
cutoff. Historical retrieval uses `known_at=null`, preserving its retrospective
nature rather than claiming those facts were recorded before tipoff.

The prepared canary is local player **6**, native **2544**, ESPN **1966**: exactly
**two** verified regular-season appearances and one complete cache snapshot,
with independent provider GP=2. Its manifest records the actual acquisition
timestamps and hashes. It has not been inserted anywhere except a disposable
local test database.

For a full acquisition, the tool takes at most **25 reviewed athletes / 50 GETs /
1,000 observations per batch**, one request every 2.1 seconds, with a 10-second
timeout and a 3 MB response cap. No automatic retries or unbounded concurrency
exist. At 465 identities the one-time upper request budget is **930 GETs across
19 batches**, roughly 33 minutes of pacing. Exact observation counts are measured
and approved from each manifest, not guessed. Reduce the athlete batch size when
late-season logs would exceed 1,000 records. Prior seasons are not fetched by this
tool; any prior-season backfill is separately scoped.

This is a one-time, controlled bootstrap budget, not a proposal to fetch all
465 logs every draft load or refresh all prior seasons nightly. For four people,
start with an explicit pre-draft eligible cohort and manual/bounded refreshes.
Optimize a recurring job only if usage warrants it. All draft page loads remain
database-only.

### Atomic writes, duplicate protection, corrections

Acquire and validate all responses locally before writing any SQL bundle. A
provider request failure aborts preparation rather than publishing a partial
successful check. Missing fields in an otherwise recognized payload are retained
as missing, with an incomplete snapshot.

Each apply file runs one transaction covering the complete staged batch:
identity/native checks → backups → append observations → trigger checks → publish
raw cache → exact postconditions → commit. Failed validation or trigger/count
assertions roll back every insert in that batch. Other previously completed
batches remain committed; a cohort is not advertised complete until all its
members pass the separate publication gate.

The existing observation hash includes fetch timestamps. Therefore the new SQL
also compares **factual fields against the current observation**, excluding
volatile fetch/knowledge times. Identical re-acquisition updates the cache check
time without creating timestamp-only observation versions. Exact staged replay
is a no-op. A changed fact appends a new version; earlier versions are retained.
A newer, conflicting current observation causes an old artifact to abort.

Expected cache before images are pinned. A changed/missing before row aborts;
an exact already-applied after row is accepted for idempotent replay. For a new
acquisition overlapping the canary or an earlier batch, export current target
cache rows and pass `--before-cache-json`. Do not treat an existing cache as absent.

Delayed provider corrections require re-acquiring the relevant player-season
and publishing a newly reviewed batch. The table's unchanged-fact timestamps
are not a last-successful-poll indicator; the new cache's `checked_at` is.
No correction changes historical slate totals, picks, saved results, or rules.

### DNP, missing data, partial seasons, and comparison gates

The existing observation tables intentionally cannot hold DNP/live/missing-stat
rows. Keep them out of that factual played-game store. The raw cache preserves
explicit DNP/status/nullable stats, so omitted appearances are not converted to
zeros or claimed to be DNP. A filters-only empty log plus missing season GP is
**unknown coverage**, not verified GP=0. A published incomplete snapshot is useful
for explanation but cannot enable statistical ranking.

Reliable sorting requires **100% verified coverage of the explicitly identified
comparison cohort**, not a 90% threshold or silent removal of the 65 unresolved
players. Reuse the existing selected-slate availability/eligibility boundary;
do not change who is draftable. A deliberately selected “verified players” subset
must be clearly labeled and must not masquerade as the full available pool.

For each cohort/metric:

1. One professional season/phase, explicit common cutoff, and reviewed identities.
2. Independent provider GP equals observed completed appearances; no quarantined
   or unknown events affecting the window; exact relevant statistics present.
3. Last 1/3/5 use exactly 1/3/5 appearances. Known GP=0 or known fewer-than-N
   samples stay unranked/missing-last, with sample labels; do not fabricate an
   N-game average. Unknown GP/data is a coverage failure, not an insufficient sample.
4. Propose a 24-hour current-season check limit, and always display the cutoff;
   suppress ranking if a new completed game is known beyond that cutoff. Previous
   seasons may use a seven-day correction-check policy. Expired data remains
   labeled stale, not freshly verified because the database was just read.
5. Acquire outside live NBA games; verify the scoreboard before and after the
   cycle. Use the same `--as-of` for every batch. If completions occur mid-cycle,
   invalidate/re-acquire rather than combine incomparable windows. `as_of` is
   an event-window cutoff, not a claim that retrospective corrections were known then.

The existing local comparison implementation is stricter about known short
windows and currently reads the old stores/GP tables. **Data rollout alone does
not switch it to the proposed cache or enable sorting.** A local repository
adapter and explicit short-sample/cohort handling must be implemented and tested
before enabling the new UI. No gate was relaxed in this planning task.

## One proposed additive table; no research-schema rewrite

`player_center_season_cache` stores one replaceable, validated **raw** snapshot
per sport/provider/player/season/regular phase, with actual games, independent GP,
sample counts, source check/cutoff times, completeness, issues, content hash, and
batch identity. NBA and NFL local IDs have separate nullable foreign keys and a
sport consistency check. No Group identity, rules, fantasy points, predictions,
or saved draft data is stored. RLS is enabled; public/anon/authenticated have no
access; the service role gets SELECT only. Initial guarded writes use the reviewed
database owner, not broader API grants or a new RPC.

This single small cache supplies both missing coverage metadata and NFL's richer
raw stats without modifying immutable research constraints. It is **not required
for mapping insertion or NBA played-game storage**; it is recommended for reliable
persistent comparisons and K/DST/signed-yardage support across cold starts. Raw
games are capped per season and per-row payload size. No warehouse, per-Group copy,
per-stat table, or new paid dependency is proposed.

| NFL need | Required now / deferrable |
| --- | --- |
| Signed yardage and off-position stats | Required before complete NFL fantasy comparisons; preserve in raw cache, keep existing research tables/normalizers unchanged |
| Coverage/GP/check times | Required before ranking can be called complete/fresh |
| Verified K field goals/PATs/distance buckets | Supported by the adapter; cache when K draft sorting is enabled; profile-only provider reads can ship first |
| K fantasy formula | Deferred; remain null. FG value/distance/miss rules, PAT make/miss values, bonuses and frozen snapshot behavior need a separate scoring decision |
| D/ST team schedule, explicit bye, summary stats | Already representable by the read-only adapter; cache if D/ST historical comparisons are enabled |
| Backfilling every NFL athlete/prior season | Deferred; start with eligible roster/slate cohorts and exact seasons |

The October 26 local integration adds bounded NFL acquisition/cache-only SQL preparation; see the readiness section below. Actual production acquisition/population remains separately reviewed. The later NFL investigation recovered event `401872945` LOST=0 from exact final-team evidence; no guessed zero was introduced. Fresh acquisitions must use that reviewed normalization, not the old incomplete capture. Existing fantasy
formulas, D/ST interpretation, scoring defaults, and frozen snapshots stay intact.

## Execution order — only after separate approvals

1. Review all CSV/JSON targets and both bundles' `SHA256SUMS`. If execution is
   later than this review, repeat read-only roster/database verification into
   a new bundle. Any baseline drift requires a new scope/approval, not bypassing
   the 367/530 assertions.
2. Approve the shadow-workflow hold and its eventual resume/cohort policy.
   Record the operator and execution window. No job change has been made here.
3. Run preflight in a new private receipt directory, inspect actual triggers,
   function bodies, PostgreSQL version and owner privileges, and verify readable
   backups. The sync trigger is SECURITY INVOKER in the reviewed migration;
   the owner-run transaction needs rights on both version and current tables.
4. Approve/apply exactly the 98 identity inserts; export the exact after receipt.
5. Separately approve/apply the cache DDL. This creates one table and grants no
   application write capability. Test the canary owner/role privileges explicitly.
6. Approve/apply the staged two-game canary; verify current/version linkage,
   cache GP/counts, raw stat values, and no projection/draft/result changes.
7. Acquire the remaining approved cohort in bounded, common-cutoff batches.
   Review each new manifest and exact row counts before approving its apply.
   Export a before-cache JSON for any target that already has a cache row.
8. Verify the complete comparison cohort, then implement/test the local cache
   reader and UI gate integration. Deployment/worker automation is another
   explicit approval. Do not resume the old projection job as an implicit final step.

### Exact command pattern for a future approved write

The prepared scripts are **psql files**, not Supabase SQL Editor snippets: they
use `\ir` and client-side `\copy`. Run from a new empty receipt directory; do not
reuse a directory whose backups could be overwritten. Use an owner DSN supplied
by the operator, never the application HTTP URL or a printed credential.

```bash
# TEMPLATE ONLY — DO NOT EXECUTE UNTIL THE NAMED OPERATION IS APPROVED.
# PC_REVIEW_ROOT is the absolute path to 20261023-review.
# PC_MAPPING_SHA and PC_BACKUP_SHA are manifestSha256 / snapshotSha256 from its JSON.
psql "$PC_PROD_DSN" -X -v ON_ERROR_STOP=1 \
  -f "$PC_REVIEW_ROOT/01-preflight-and-backup.sql"
# Verify/export checksums of the CSVs before continuing.
psql "$PC_PROD_DSN" -X -v ON_ERROR_STOP=1 \
  -c "SET sports111.rollout_approval='apply:${PC_MAPPING_SHA}'; SET sports111.backup_receipt='${PC_BACKUP_SHA}';" \
  -f "$PC_REVIEW_ROOT/02-apply-mappings.sql"
psql "$PC_PROD_DSN" -X -v ON_ERROR_STOP=1 \
  -f "$PC_REVIEW_ROOT/03-postflight-and-receipt.sql"
```

The schema token is `schema:player-center-season-cache-v1`. Each batch requires
its own `ingest:<batchSha256>` and the same reviewed backup receipt. Mapping
rollback uses `rollback-mappings:<manifestSha256>` and requires the after CSV.
Cache withdrawal uses `rollback-cache:<batchSha256>`. Empty-schema removal uses
`rollback-schema:player-center-season-cache-v1`. No token grants blanket permission
for a different operation or artifact.

Local acquisition commands, which cannot write production:

```bash
node scripts/prepare-player-center-rollout.cjs --read-only-refresh --out NEW_REVIEW_DIRECTORY
node scripts/stage-player-center-nba.cjs --manifest MAPPING_MANIFEST --batch 1 --list-targets
# Export target before-cache rows with export-before-cache.sql and provider_ids_json.
node scripts/stage-player-center-nba.cjs --manifest MAPPING_MANIFEST --batch 1 \
  --as-of COMMON_VERIFIED_UTC_CUTOFF --before-cache-json BEFORE_CACHE_JSON --out NEW_BATCH_DIRECTORY
```

Use `psql -X -qAt -v provider_ids_json='["reviewed-id",...]' -f export-before-cache.sql`
to produce the JSON before image. Use an actual JSON array of reviewed numeric
ESPN ID strings from `--list-targets`, not the explanatory placeholder above.
When the table is newly created and a batch has no prior targets, omit the
before-cache flag; any unexpected existing publication causes apply to abort.

## Recovery boundaries and expected impact

- A failed transaction rolls back all its permanent writes. Discard its local
  uncommitted receipts and investigate; do not automatically proceed to the next batch.
- Before ingestion, exact mapping rollback can remove just the owned 98 rows.
  After dependencies exist it refuses deletion. Preserve evidence and re-review.
- Cache withdrawal removes only the exact publication owned by that batch and
  becomes a no-op once absent. It does **not** republish an older “complete” cache
  over newer facts. Backups remain available for separately validated restoration.
- NBA version history is append-only. Never delete versions, disable triggers,
  truncate history, or rewrite old slate results to make a rollback pass. Correct
  bad facts with an explicitly approved new version and invalidate affected caches.
- Empty-cache schema rollback refuses a populated table and uses `DROP RESTRICT`.
- Expected impact is 98 identity inserts, one additive cache table, and **G newly
  measured factual NBA versions plus at most 465 cache rows**. G is determined
  by reviewed acquisitions and factual comparisons; it is not guaranteed from
  identity coverage. The exact prepared canary is 2 versions / 1 cache row.
- A full 530-player sort is still blocked by 65 unresolved identities and any
  missing GP/stat evidence. A fully verified, explicitly scoped eligible cohort
  can pass independently. Nothing is silently substituted or ranked as zero.

## Local UI work and remaining limitations

**Yes, the UI can safely be built locally before production changes**, using the
existing real fixtures and injected repositories. It must keep production sorting
disabled when coverage is unknown, label stale/short windows, retain Group/slate
authorization and frozen scoring, and show K stats without invented FP. Build
the repository/cache adapter locally before making the new table a runtime
dependency. UI development is not authorized/executed by this planning task.

The cache reader, full NBA acquisition, NFL cache population, recurring refresh,
and deployment are still pending. SQL was tested against isolated PostgreSQL 15,
not the production engine/version/privileges; actual preflight must confirm them.
The 98 candidates are corroborated by current rosters, not proof of permanent
team membership. Provider coverage can change between acquisition and approval;
time/cutoff/freshness gates remain necessary.

The Bracket Challenge stash, both ShotCast worktrees, main branch HEAD, existing
application code, projections, Groups, drafts, and historical results remain
untouched. No production SQL, ingestion, migration, backfill, workflow change,
commit, push, or deployment was performed.

## Validation completed

- **95 tests passed, 0 failed, 0 skipped.** This includes the 82 existing foundation
  and scoring/draft regression tests, plus 13 rollout-specific tests. SQL was
  actually executed only in a fresh temporary PostgreSQL 15 cluster, with a Unix
  socket, no network listener, and no production credentials/client.
- The rollout tests exercise 98-row atomic insertion, exact replay and rollback,
  claimed provider IDs, native-ID drift, changed mapping receipts, dependent
  projection caches, schema/RLS/grants, canary replay, timestamp-only rechecks,
  appended corrections, stale cache withdrawal, and disabled-trigger failures.
- TypeScript, scoped ESLint, the production build, bundle checksums, and
  tracked/new-file whitespace checks passed.
- The fresh review used database SELECTs and 32 public roster GETs. The staged
  canary used two public GETs. Neither preparation wrote production data.

To rerun the SQL suite, supply a local PostgreSQL binary directory only:

```bash
PLAYER_CENTER_PG_BIN=/path/to/local/postgresql/bin node --test tests/player-center-rollout.test.cjs
```

The test creates/removes its own temporary cluster; it does not load `.env.local`
or connect to Supabase. Without that variable, PostgreSQL cases are explicitly
skipped rather than reported as executed.

## Local integration and rollout readiness — October 26

This section supersedes earlier “reader pending” / “UI pending” statements. Earlier audits and frozen bundles remain dated evidence, not fresh production certification. No production operation has occurred.

**Code integration is locally ready for review.** NBA/NFL `PlayerPool`, normal draft modal/roster actions, fixed-slot and speed-entry research, read-only lineup profiles, and Player History use the approved shared components through real authenticated `/api/player-center` endpoints. Golf and the live football Game Center retain their separate workflows. The fixture loader remains confined to the development preview and tests; it is never a runtime fallback.

**Production activation is closed by default.** `lib/player-center/feature.ts` requires `NEXT_PUBLIC_PLAYER_CENTER_ENABLED=true` for a production build. Without it, the original UI entry points stay active and the new APIs return 404 before data reads. Development enables the integrated UI unless explicitly set false. Public environment values are frozen at build time in installed Next 16.2.4: activation and UI rollback require a separately approved rebuild/deployment. There is no implicit deployment approval or runtime-only activation switch.

### Durable readers and safe degradation

- `lib/player-center/durableCache.ts`, `repository.server.ts`, `service.ts` validate and read the proposed **existing 17-column v1 schema** for both sports. No additional DDL is required for this adapter. Checks include exact local/provider IDs, sport/year/regular phase, season date bounds, duplicate events, status/participation, finite nullable stats, counts, independent GP consistency, source times, bounded payloads and publication metadata. Scored/projection fields are rejected. The artifact hash is retained as provenance; JSONB key ordering means the reader does not pretend to reconstruct the original acquisition-file hash. Bundle SHA checks and SQL exact-row postflight remain the integrity receipt.
- A valid fresh cache snapshot supplies a profile with **zero ESPN reads**. Fresh partial snapshots stay partial. An absent/invalid snapshot uses the existing bounded provider profile path. A stale snapshot can fall back to a fresh provider read; if that read fails, the stale factual snapshot remains labeled stale. No GET writes or refreshes the durable cache.
- Draft comparisons remain **database-only**. Legacy factual stores can still supply qualified research when durable data is absent, but cannot certify rankings. Missing tables, failed pages and invalid/conflicting rows keep gates closed. Later page failure discards the entire partial cache read. Cache rows are paged in 25-row requests, with a hard 3,000-row limit. Catalog and comparison read caches remain bounded at one/five minutes respectively; source age is rechecked on every response, including process-cache hits.
- Current cache checks/cutoffs expire after **24 hours**; prior seasons use **seven days since checked_at** for corrections. A known event after the cutoff that has started, or an unresolved past schedule/live event, requires refresh. No later unknown completion is inferred away. Operators must still verify scoreboards around acquisition: athlete logs alone cannot prove that no new event occurred after a cutoff.
- Every relevant durable comparison must share one exact UTC cutoff. Mixed cutoffs block ranking. The UI labels that cutoff. A known shorter-than-N sample can stay unranked/missing-last alongside complete peers only with fresh, complete, independently verified durable coverage and all observed metric values known. Unknown identity/GP/fields still fail the pool. An entirely short/zero-game pool is not advertised as statistically ranked. Header/Game Log strict averages stay gated; Fantasy's qualified observed trend averages retain their approved behavior.
- The comparison universe is still the **entire active catalog for the requested sport/position/metric**. Search, on-slate and roster filters do not silently create a smaller certified universe. No new eligibility policy or API-selected-ID cohort was introduced. Even a complete 465-player NBA backfill cannot rank all 530 active rows. Resolving the remaining 65, or approving a clearly defined eligible cohort in a later change, remains necessary for those full-pool rankings.

### NFL cache-only acquisition prepared locally

New files: `scripts/stage-player-center-nfl.cjs`, `scripts/lib/playerCenterNflBatch.cjs`, `supabase/manual/player-center/{nfl-targets.example.json,export-nfl-before-cache.sql,verify-cache-coverage.sql}`. The existing NBA canary, mapping, schema and rollback bundles are unchanged, including their checksums.

The NFL tool accepts **1–5 exact reviewed catalog targets**, explicit starting year and common `--as-of`, optional pinned before-cache JSON and a **new** output directory. It makes at most **40 ESPN GETs total**, paced at 2.1 seconds, using the existing five-second/3 MB bounded provider reader. Up to three bounded passes per athlete reuse raw caches to fill distinct older summary gaps. The UI's eight-read/18-second profile budget is unchanged. Long prior seasons may need one-player batches. Exhausting the global request cap or failing the log aborts preparation; genuine missing fields produce a clearly incomplete snapshot. It never guesses zero or publishes fantasy scores.

Only proposed `player_center_season_cache` rows are written by the generated owner-run SQL, **after separate approval**. Existing NFL research observations, projections, drafts and results are untouched. Verified signed/off-position stats, K kicking fields and D/ST schedule/summary facts are retained. Optional D/ST `byeWeeks` metadata is additive within the existing season_stats JSON; when no provider season table exists, its categories remain empty and explicitly unavailable. K fantasy scoring remains deferred.

Each output includes `batch-manifest.json`, raw normalization evidence, `SHA256SUMS`, and `00-cache-inputs.sql`, `01-preflight-backup.sql`, `02-apply-cache.sql`, `03-postflight.sql`, `04-rollback-cache.sql`. Apply requires `ingest-cache:<batchSha256>` and its exact `backupReceiptSha256`; it locks/checks current native NFL IDs, positions and active flags, pins before rows, rejects unexpected triggers/targets and verifies exact after rows. Exact replay is idempotent. Withdrawal requires `rollback-cache:<batchSha256>` and refuses a newer publication. It never restores an old complete row over newer facts. The example target file is **not a fresh approval or identity receipt**; re-check all three catalog IDs before use.

Preparation-only command pattern (no SQL is executed):

```bash
node scripts/stage-player-center-nfl.cjs --targets REVIEWED_NFL_TARGETS.json \
  --season 2026 --as-of COMMON_VERIFIED_UTC_CUTOFF \
  --before-cache-json BEFORE_NFL_CACHE.json --out NEW_NFL_REVIEW_DIRECTORY
```

Omit the before-cache argument only when the target rows are known absent. Generated SQL refuses unexpected existing rows. `export-nfl-before-cache.sql` provides exact season/target before JSON after approved DDL. `verify-cache-coverage.sql` is a SELECT-only full-pool/current-season report (sport + season variables); it does not bypass the metric/window API checks or certify stale prior seasons.

### Safest launch sequence and approval checkpoints

1. **Local review first:** use the integrated routes and hermetic draft tests described in `player-center-ui.md`. Keep production activation false/unset. Code approval is distinct from data readiness and deployment approval.
2. **Fresh evidence and automation decision — approval required before any job change:** recheck all 98 candidates/65 unresolved cases against current SELECT/roster snapshots in a new bundle, including all baseline drift. Inventory actual workflow runs/external callers. The NBA worker selects all active resolved identities, so mapping inserts otherwise expand projection processing. Approve and verify a workflow hold plus an explicit eventual cohort/resume policy **before** applying mappings. Do not “temporarily” resume the expanded worker after rollout. No worker was altered here.
3. **Backups/preflight:** in new private receipt directories, export/checksum identity and player before images, exact touched observation/cache before rows, deployed revision, workflow configuration and relevant projection/draft/result row-count/hash sentinels. Confirm production engine/version, reviewed triggers and owner privileges. Check backups are readable. Existing psql interlocks supplement human approval.
4. **Mapping approval:** approve/apply the exact freshly reviewed 98 inserts, then exact postflight/after receipt. Conditional coverage remains **367 → 465 / 530**; the protected 65 remain unresolved. Stop on any drift; do not weaken assertions.
5. **Schema approval:** approve/apply only `season-cache-v1.sql` with `schema:player-center-season-cache-v1`. Confirm RLS and service-role SELECT-only grants. No automatic migration or application write grant is introduced.
6. **Canary approval:** re-acquire the NBA player-6/native-2544/ESPN-1966 canary into a new directory with a current common cutoff. The October 23 two-game/one-row canary is a reviewed example, **not current freshness evidence**. Review its exact counts before owner-run apply and postflight. Separately review a small NFL QB/K/DST cache-only canary and its SQL/backup receipt. Verify raw values, LOST evidence, canonical Group/frozen scoring and unchanged draft/result/projection sentinels.
7. **Reviewed population approval:** acquire remaining approved NBA batches (existing max 25 athletes/50 GETs/1,000 observations) and small NFL batches with a shared, scoreboard-verified sport/season cutoff. Review/apply each manifest separately. Re-acquire affected players for corrections; do not rewrite saved results. No recurring job is added by this task.
8. **Coverage acceptance:** run the SELECT report and authenticated comparisons for Last game/3/5/Season, both directions and relevant positions. Verify 100% of the relevant runtime pool, missing-last short samples, GP, cutoffs, freshness, K exclusion from FP and no unresolved IDs slipping through. Accept honest unavailable rankings where coverage remains incomplete; a canary or mapped-only subset cannot unlock the full pool. Wait for five-minute read-cache expiry or use the newly approved deployment before final certification.
9. **Deployment and activation — separate explicit approval:** deploy an approved revision with the feature disabled first if desired; then build/deploy with `NEXT_PUBLIC_PLAYER_CENTER_ENABLED=true` only after the agreed readiness acceptance. Do not set `NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL` as a production write-control mechanism; it intentionally only works in Dev. Perform authorized Group/slate-scoped smoke checks. Projection retirement stays separate.
10. **Rollback:** first rebuild/deploy with the feature false (or restore the previous deployment), preserving raw history and saved outcomes. Withdraw only owned unchanged cache publications using their guarded receipts. Mapping rollback is only safe before dependencies exist; afterward retain mappings and approve corrective evidence/invalidation. Empty-table schema rollback remains guarded and uses DROP RESTRICT. No immutable versions, draft picks or results are deleted to make rollback pass. Restoring any held job requires its own approved original cohort/season policy.

**Readiness distinction:** code and reviewed preparation tooling are local and testable; production cache creation/population, renewed mapping evidence, full-pool coverage, operational refresh policy, projection-job hold/resume, deployment and activation remain unapproved/unexecuted. Prior-season durable NBA batches and automatic recurring refresh are not prepared here; on-demand bounded historical profiles remain available, and prior-season durable imports need their own scoped plan.

### Integration validation receipt

102 focused application/data/safety/draft tests, 16 isolated PostgreSQL/offline rollout tests and seven Chromium cases passed. Browser scope and its isolation limits are recorded in `player-center-ui.md`. TypeScript, scoped clean/new-code lint, no-new-legacy-diagnostics comparison, production build, bundle SHA checks and tracked/untracked whitespace checks passed. A local production-mode check confirmed that the API and fixture preview stay closed with activation false; the temporary process was stopped. These results establish local code/preparation readiness, not production coverage or deployment approval.
