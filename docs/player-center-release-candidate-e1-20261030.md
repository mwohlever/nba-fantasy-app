# Player Center Phase E1 local review candidate — October 30, 2026

Review only. This is an uncommitted, unstaged candidate; no remote PR update,
production operation, deployment or activation is authorized by this document.

## Exact source and workspace

- Source: PR #4 `1046149b807b3ae0ce4659cd1f8513619586dbf0`, including
  `d246f2711b81db8f92bfaa0b75886e1ad07bb85a` installer fingerprint normalization.
- Production comparison baseline: `cf462aa865fb1dfa85ca1bd67f0ea878652f7169`.
- Local branch: `review/player-center-recovery-e1` (HEAD remains the source commit).
- PR #4 was rechecked read-only during E1: open, draft, unmerged, head/base match
  the above SHAs. Its remote description remains unchanged and contains historical
  installation-pending wording; reconcile it only in an authorized later PR update.
- New worktree: `/home/markwohlever/nba-fantasy-app-player-center-e1`.
- Recovery source: the 29 SHA-256-verified entries in
  `/tmp/111sports-phase-d-ziv9bnz8/recovery-inventory.json` and earliest A/B/C backups.
- Local validation receipts and reproducible recovery patch: `/tmp/111sports-phase-e1-4ytmq39q`.
- Dependencies reuse the maintenance checkout's installed `node_modules` through an
  ignored symlink; no npm install, environment-file copy or duplicate setup occurred.

## Included recovery paths

The following 29 paths are the reviewed A/B/C delta against the source commit.
The four new helpers/components and three new regression files are included.

```text
app/api/home-summary/route.ts
app/api/internal/nba/projection-ingest/route.ts
app/api/lineups/route.ts
app/api/player-league-profile/route.ts
app/player-history/page.tsx
components/lineups/DraftPlayerModal.tsx
components/lineups/LineupBuilder.tsx
components/lineups/PlayerModal.tsx
components/lineups/PlayerPool.tsx
components/lineups/PlayerResearchModal.tsx
components/lineups/ReadOnlyPlayerModal.tsx
components/lineups/SlotDraftModal.tsx
components/player-center/DraftPlayerCenter.tsx
components/player-center/PlayerCenterModal.tsx
components/player-center/PlayerHistoryCenter.tsx
components/player-center/PlayerLeagueHistory.tsx
components/player-center/PlayerModalAdapter.tsx
components/player-center/PlayerProfileContent.tsx
components/player-center/ResearchBrowser.tsx
docs/player-center-projection-retirement.md
lib/client/playerModalLifecycle.ts
lib/live-scores/game-detail.ts
lib/player-center/modalContext.ts
tests/draft-workspace.test.cjs
tests/player-center-draft-browser.test.cjs
tests/player-modal-recovery.test.cjs
tests/player-pool-recovery.test.cjs
tests/projection-retirement-compatibility.test.cjs
tests/projection-retirement.test.cjs
```

Additional E1 documentation only (no feature or visual changes):

```text
docs/player-center-production-rollout.md
docs/player-center-release-review-20261029.md
docs/player-center-ui.md
docs/nba-player-center-factual-refresh.md
docs/player-center-release-candidate-e1-20261030.md
```

The retirement document's current gates were reconciled in E1. Historical identity
review bundles and dated rollout receipts remain unedited.

## Hunk reconciliation and exclusions

Recovery patches were generated between preserved pre-phase backups and the reviewed
working files, then checked and applied to the clean PR commit. Twenty existing
baselines matched PR #4 exactly. Two baseline-only differences were deliberately
excluded: the unused `draftGroupId` binding in `LineupBuilder.tsx` and unused
`lineupPlayer` destructure in `player-league-profile/route.ts`. No conflict occurred.
The seven files absent from PR #4 were added from their verified reviewed sources.

These 17 differing maintenance paths were excluded entirely; the PR versions, when
present, remain untouched (notably the newer installer and its CRLF regression test):

```text
docs/nba-observation-history-growth.md
supabase/manual/nba-observation-history/cleanup-proposal.sql
supabase/manual/nba-observation-history/recovery/.gitignore
supabase/manual/nba-observation-history/recovery/RUNNER-COMPACTION.md
supabase/manual/nba-observation-history/recovery/RUNNER.md
supabase/manual/nba-observation-history/recovery/cleanup_runner.py
supabase/manual/nba-observation-history/recovery/run-runner.sh
supabase/manual/nba-observation-history/recovery/runner-postcheck.sql
supabase/manual/nba-observation-history/recovery/runner-requirements.txt
supabase/manual/nba-observation-history/recovery/runner-setup.sql
supabase/manual/nba-observation-history/recovery/runner-validate.sql
supabase/manual/nba-observation-history/recovery/test_runner.py
supabase/manual/player-center/factual-refresh-v1.sql
tests/nba-factual-refresh-postgres.test.cjs
supabase/manual/nba-observation-history/recovery/CHROMEBOOK.md
supabase/manual/nba-observation-history/recovery/configure-archive.py
tests/nfl-projection-v2.test.cjs
```

All other non-inventory application, NFL/Groups, workflow, acquisition, cache,
identity, schema, data and rollback paths are retained from `1046149` unchanged.
Some NFL catalog/availability and Groups changes already exist in PR #4; E1 adds
no further hunks to those paths and does not remove baseline functionality.
No temporary test harnesses, logs, credentials or build artifacts are included.

## Current operational status

- The operator reports completed Supabase storage repair, approximately 228 MiB,
  semantic observation deduplication, and installer preflight/postflight success.
  E1 performs no live database verification or installation. The available private
  user preflight summary records 239,283,347 database bytes and normalized append MD5
  `9308a04b52fecc6993b7730490cf686a`. An older installer-preparation receipt says
  installation was not executed at its capture time; it is not the later postflight
  receipt and does not override the operator's completion report. Preserve the full
  operator receipts for the separately approved production acceptance review.
- The exact PR installer, including all three CRLF-normalized append-fingerprint
  checks, and installer regression test are retained byte-for-byte. No SQL, schema,
  observation, mapping, repair script or historical snapshot changes are included.
- NBA/NFL projection-only generators, compatibility workers and endpoints remain
  code-retired/inert. Mixed factual APIs keep nullable compatibility fields. Saved
  facts/results and historical snapshots are preserved; no historical data deletion.
- The legacy NBA workflow is reported disabled. Its checked-in replacement is
  manual-only, `execute:false`, without cron; this does not change the deployed
  workflow setting. NFL projection generation remains an always-false job. Existing
  NFL factual observation acquisition is retained; no workflow file changes in E1.
  External scheduler configuration and old deployed revisions are not certified by
  inspecting this local candidate.
- The new factual refresh is not activated. Player Center defaults off in production
  unless its existing build-time flag is explicitly true. No flag is changed here.

## Exact-candidate validation

- **252 tests passed, zero failed/skipped** on the exact candidate: 193 A/B/C
  regressions, 54 additional Phase D cases and five composition cases. The temporary
  composition harness was explicitly retargeted to this worktree. Unit/component
  callbacks, API/provider fixtures, mocked DOM and draft-action interception cover
  NBA/NFL comparison, factual sorting/windows, both flag paths, modal context and
  actions, league history/ownership, missing data, frozen scoring and retirement.
  No production picks or factual observations were written.
- Standalone TypeScript passed (`tsc --noEmit --incremental false`).
- Scoped ESLint compared all 28 recovery code/test paths with **exact `1046149`**:
  **zero introduced diagnostics**; 90 existing errors and 40 existing warnings
  remain. This is a regression comparison, not a clean-lint claim.
- `git diff --check` passed. Scope checks cover all 34 changed paths, including new
  files; source-code contents match the reviewed recovery except the two excluded
  unused bindings. Protected profile/chart/style and installer/test hashes match
  PR #4 exactly. No dependency expansion or application fix was required.
- **One production build passed** (`npm run build -- --webpack`) using process-only
  dummy Supabase credentials and the existing installed dependencies. No production
  environment/configuration was copied or changed. Next.js emitted its existing
  edge-runtime/static-generation advisory. No build was repeated.
- Browser/mobile verification remains **unverified**: Chromium was not launched
  because libnspr4/libnss3 are missing. No library installation or infrastructure
  troubleshooting occurred. Live RLS/concurrency, actual provider freshness, current
  production coverage and data acceptance were not exercised.
- Original maintenance/review/ShotCast worktrees, dirty-file hashes, HEADs and Bracket
  stash were checked against the E1 starting snapshot and remain unchanged. The new
  branch/worktree is the only workspace addition. No commit, push, PR update, merge,
  deployment, workflow dispatch or production operation occurred.

## Remaining release gates and recommended next step

1. Approve this exact local manifest/diff, then perform browser/mobile acceptance on
   the candidate in a supported environment. Check responsive overflow, sticky
   elements, action-footer clearance, pointer/keyboard focus and modal handoff in
   both enabled and disabled paths. Mocked DOM tests are not visual sign-off.
2. Assemble a separately approved publication step from this candidate only; if
   commit/push/PR update is authorized later, stage the explicit manifest paths.
   Recheck the PR head/base for drift. Keep PR #4 draft until remaining gates pass.
3. Separately reconcile complete install/postflight receipts and obtain fresh
   read-only database/privilege/storage/mapping evidence. No repeat repair/install
   is implied. Live authenticated authorization/RLS/concurrency and current factual
   freshness/coverage still need production-data acceptance.
4. Deployment requires separate approval, with Player Center activation held and
   the factual workflow disabled/manual. Do not dispatch jobs as part of deployment.
5. Any exact identity application, write-free provider dry run, bounded publication
   canary, full factual run and cadence/flag activation require their own approvals.
   The full worker has no canary CLI option. Missing/unknown data and K/DST coverage
   remain explicit; partial-profile acceptance does not certify full-pool rankings.
6. Confirm no external projection caller or old deployed generator can restart.
   Never restore retired forecasts or resume the legacy NBA worker as rollback.

Release blockers: visual/mobile acceptance; exact scope approval and authorized
publication/deployment; production-data and activation gates when those actions are
requested. Existing lint debt is non-blocking for E1 if comparison finds no newly
introduced diagnostics. No application regression or patch conflict was found in
assembly; unverified real browser and production behavior remains a limitation.
