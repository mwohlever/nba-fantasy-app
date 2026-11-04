# NBA observation application deployment preparation

## Confirmed state and scope

Prepared on 2026-10-27. The user manually audited production PostgreSQL 17.6
and confirmed 1,502,003 versions for 34,386 player-games: every game's facts,
source and normalizer were unchanged across its 43–44 acquisitions. All current
rows matched their referenced/latest versions. The user then manually installed
`20261027000100_nba_observation_semantic_append.sql` and confirmed its definition,
owner (`postgres`), security, grants and both enabled triggers.

These are user-confirmed production SQL results. Codex has executed no production
SQL. All future production SQL, including verification and cache administration,
must also be executed manually by the user. Migration files must never be treated
as evidence that a production migration ran.

Application changes are not committed, pushed or deployed. Historical cleanup
remains a separately approved Phase 4. This release performs no cleanup.

The current branch is `fix/nba-observation-version-churn`, based on
`d572341fcfa55408dfde13160b0709ffb55b9d6e`. Read-only GitHub inspection confirmed
the remote default branch is `main`, its current tip matches that baseline, and
that commit has a successful Vercel status for project `111-sports`. A successful
status does not establish the project's production-branch/domain configuration;
verify that association before promotion.

## Exact proposed release

| Path | Included change |
| --- | --- |
| `lib/analytics/nba/projectionRepository.server.ts` | Replace direct version-table upsert with `rpc('append_nba_projection_observations', { observations: group })`; retain 200-row batches, void return and error propagation |
| `lib/analytics/nba/projectionInfrastructure.ts` | Explain why acquisition hashes stay unchanged and equality is handled by the RPC; no runtime normalization change |
| `.github/workflows/nba-projection-shadow-refresh.yml` | Add only the concurrency group with `cancel-in-progress: false`; retain the committed workflow name, daily schedule, worker and existing generation behavior |
| `supabase/migrations/20261027000100_nba_observation_semantic_append.sql` | Record the exact manually installed migration; do not execute it again |
| `tests/nba-observation-versioning.test.cjs` | Regression and local PostgreSQL integration tests |
| `supabase/manual/nba-observation-history/audit.sql` | Existing read-only audit used by tests and manual inspection |
| `supabase/manual/nba-observation-history/redundant-candidates.sql` | Read-only selector used by regression tests; no removal approval or execution |
| `supabase/manual/nba-observation-history/post-deployment.sql` | Four manual, read-only monitoring blocks A–D |
| `docs/nba-observation-application-deployment.md` | This scope, evidence, deployment and verification plan |

The working tree contains unrelated Player Center, projection-retirement, NFL,
UI and other changes. Preserve them locally and exclude them from this release.
In particular, do not stage the current ingestion route, worker script, refresh
module, generator, Supabase client, modified existing projection tests or the
workflow-name change. Stage the workflow concurrency hunk selectively. The
release retains the committed route's `generate:false` handling and the worker's
existing final generation request. No projection feature is retired here.

## Compatibility findings

The installed RPC takes a JSONB array named `observations`, accepts at most 200
rows and returns the inserted count. The application writer sends exactly that
argument and batch size. Its existing callers expect `Promise<void>`; retaining
that interface preserves their response contracts. `accepted` and
`observationsUpserted` still count eligible inputs, not newly inserted versions.

Both ingestion entry paths use the shared writer. Final-game/regular-season
validation, reviewed provider identity binding, unresolved identity retention,
current/prior season fetching and acquisition hashes are unchanged. A failed RPC
surfaces an ingestion error; there is no unsafe direct-insert fallback. Each RPC
batch is atomic; a whole multi-batch HTTP request can partially succeed before a
later batch fails, as before. Retrying is idempotent.

Current-observation readers and current-table sync triggers remain unchanged.
Changed stats, minutes, identity, teams, timing or availability still append
versions. Tests verify A -> B -> A reversals and recorded-as-of scoring across
their revision boundaries. Current-only history readers still cannot reconstruct
superseded versions; that is pre-existing behavior, not changed by this release.

NBA Fantasy scoring remains on the independent NBA.com box-score pipeline and
frozen slate rules. NBA Skins remains on its standings/season-record pipeline.
Their Supabase background schedule is not the factual observation workflow and
must remain running. Player Center readers and feature gates are not changed or
activated by this release.

## Local validation

Local tests use mocked services or newly created socket-only PostgreSQL 15.19
clusters. They do not read Supabase credentials or execute production SQL.
The broader workspace suite passed 143 tests with no skips, including observation
versioning, analytics, Player Center, correction scoping and NBA background-worker
SQL. TypeScript, focused ESLint and `git diff --check` passed.

To check the proposed release rather than just the dirty working tree, an
in-memory file overlay loaded the committed baseline for 48 unrelated changed
files while retaining the two observation library changes and workflow
concurrency addition. All 10 committed generation/worker/repository/shadow-route
tests passed, as did all 17 final observation/monitoring tests with no skips. The same scoped source overlay
passed TypeScript checking across 523 root files. No user files, index entries,
branches or worktrees were changed to perform that check.

`npm run build` passed for the full working tree using dummy Supabase keys and
`http://127.0.0.1:9` as its database URL. That verifies local compilation without
querying production. Its `.next` output must not be uploaded to production: the
approved Git/Vercel deployment must rebuild the exact release commit with the
normal Vercel environment. The scoped overlay checks are not a full isolated
Next.js build of a committed release; the Git/Vercel preview build remains a gate.

## Deployment sequence after explicit approval

1. Recheck remote/default-branch HEAD and the working diff. Stop for renewed
   review if the release baseline or intended changes have materially changed.
2. Stage exactly the nine paths/hunks above, verify the staged diff excludes all
   unrelated changes, and commit on `fix/nba-observation-version-churn`. Preserve
   the rest of the working tree. Push that feature branch only when approved.
3. Open a PR against `main`. Verify its complete diff and Vercel preview build
   correspond to this scope. Do not trigger production ingestion from a preview
   deployment, and do not substitute the full local working tree for the commit.
4. Verify Vercel's production branch/domain settings, existing ingestion secret
   and service-role environment configuration without exposing values. Confirm
   the target database is the one whose RPC the user installed. No new secret,
   environment variable, dependency or SQL migration is needed.
5. With explicit authorization to merge `main` and deploy, merge the reviewed PR
   through GitHub and wait for the Vercel production deployment to be Ready.
   Confirm `www.111sports.app` serves that commit. Verify the default-branch
   workflow contains its concurrency group; keep its `23 10 * * *` schedule.
6. Let any pre-deployment factual ingestion finish. Before the first complete
   post-deployment run, the user runs block A in `post-deployment.sql` and saves
   its actual watermark/checksum. Do not use the old audit count as a watermark.
7. Run one supervised normal GitHub observation refresh, if included in the
   deployment approval. Verify all observation batches and the existing generation
   step complete. Application/Supabase API logs should show successful requests
   to `/rest/v1/rpc/append_nba_projection_observations`, with no version-table
   POSTs from this writer. Codex must not call Supabase SQL/RPC directly to test it.
8. The user runs blocks A, B and C after that run. If the historical inputs are
   unchanged, version count, watermark and current checksum should be unchanged.
   Block B requires replacing `NULL::bigint` with A's original watermark and must
   report `baseline_supplied=true`. New real facts/availability may legitimately
   create versions; review their classifications. All C error counts must be zero.
9. Smoke-check the existing NBA player-history/analytics surfaces, enabled Player
   Center profiles and a representative locked historical slate. Compare known
   stats/scores under their existing Groups and frozen rules. Do not activate new
   Player Center code or alter a real stat to manufacture a production correction.

GitHub scheduled workflows run on the default branch, so a feature-branch preview
alone does not install the concurrency update for daily scheduled runs. Vercel's
configured production branch determines production Git deployments. References:
[GitHub schedule behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule),
[Vercel Git deployment](https://vercel.com/docs/git#production-branch).

## Two scheduled-run monitoring window

Observe the next two complete default-branch scheduled runs after cutover at
10:23 UTC daily (06:23 EDT before the DST change; 05:23 EST afterward). GitHub may
delay scheduled starts; identify the actual run ID/start/completion rather than
assuming an exact wall-clock execution time. If deployment completes before the
next scheduled tick, the first two would ordinarily be October 28 and 29, 2026;
use the actual deployment date/time to choose the runs.

For each run, record Git SHA, event, timestamps, eligible/input count, batch count,
accepted/skipped/unresolved counts, failed provider fetches, HTTP/RPC errors and
generation result. A green job with missing provider history is not sufficient:
the worker can collect fetch failures and still finish successfully. Compare
coverage to the established 34,386 historical appearances, accounting for reviewed
identity/eligibility changes. Do not accept zero database growth as proof that a
failed or empty job worked.

After each completed run, the user executes A–D using the original baseline for
B. Expected: no metadata-only new versions, zero current-integrity errors, and
no daily 34,386-row historical increase. If genuine corrections/new events occur,
review them rather than requiring zero inserts. Retained acquisition timestamps
are no longer poll heartbeats; monitor job completion for refresh health.

No reduction in allocated storage is expected from this application deployment.
Observe growth; defer row removal and physical reclamation to Phase 4.

## Remaining risks and response

- Production PostgREST visibility and actual RPC latency remain unverified. SQL
  function installation alone does not prove HTTP schema-cache visibility. If
  ingestion reports a missing RPC or permission error, stop factual ingestion
  and investigate; any Supabase cache reload SQL must be supplied to the user.
- Advisory locks protect cooperating RPC callers. Direct manual imports/external
  writers bypass them. Do not run archived imports during this monitoring window.
- This is chronological compression. Older conflicting archived acquisitions
  require a separately reviewed reconciliation/import, since suppressed poll
  instants cannot reconstruct every out-of-order historical transition.
- The existing calendar-year season default still requests ESPN 2025/2026 during
  October 2026. Selecting the 2027 season is separate work; this fix does not
  expand coverage or silently alter that window.
- Current-observation acquisition/freshness fields no longer advance on identical
  polls. Actual stats and first-known evidence remain, but consumers may display
  older freshness timestamps.
- If an application rollback is needed, restore the prior Vercel deployment;
  leave the additive RPC and all historical data intact. The old writer resumes
  churn, so pause only the factual observation workflow if needed while resolving
  it. Leave the independent NBA Fantasy/Skins background job running.

Approval checkpoint: no commit, push, PR creation, merge, production ingestion or
deployment is authorized by preparation alone. Explicitly approve the desired
next Git/deployment actions before proceeding. All production SQL remains manual.
