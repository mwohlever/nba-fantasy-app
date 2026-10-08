# ShotCast retirement and ESPN-only golf scoring

111 Sports is a private, noncommercial project for Mark, Jon, Josh and Andy. The public landing page is a compact clubhouse. ShotCast 2D maps, trajectories, hole replays, video embeds and public course media are retired. The separate 3D worktree and branches are untouched; this patch does not deploy that project.

## Final scoring-source decision

**ESPN is the sole source of new golf scoring observations.** The user explicitly accepts that ESPN can lag PGA TOUR's shot-level feed. Live hole scores, round/tournament scores, fantasy totals, rankings and Best Ball finalization advance when sufficient ESPN data arrives. Missing holes remain absent/pending; a currently known Best Ball contribution stays provisional until the other eligible golfers have accepted hole scores.

ESPN's existing PGA scoreboard supplies competitor → round → hole `linescores`. Positive hole `value`, `period` and `scoreType.displayValue` provide strokes, hole number and relative-to-par. Existing round/tournament aggregates, terminal-status reconciliation, compact browser payloads and the Vercel Edge proxy remain. No provider or new ESPN integration is introduced.

This is an acquisition change. Standard and Best Ball formulas, four regulation rounds, cut penalties, tie-breaks, roster periods, salary-cap/snake rules, frozen slate snapshots and standings calculations remain intact. An aggregate is not used to invent a missing player's hole score or a Best Ball winner.

## Acquisition and access removed

- `/api/golf/hole-replay` GET, `/api/golf/shotcast-manifest` GET, and `/api/admin/golf/shotcast` GET/POST return `410 Gone` with `Cache-Control: no-store`. They acquire no data, perform no reconciliation and access no database records.
- `lib/providers/pgaTourShots.ts` is deleted, including the `ShotDetailsCompressedV3` request, compression parsing, shot-only schedule/player lookups and scorecard supplement export.
- `lib/golf/refreshSlate.server.ts` no longer imports that provider or appends reconstructed PGA holes. Manual and cron scoring share the existing refresh/lease/reconciliation workflow and now supply ESPN observations only.
- The unused `shotcastObservation` reconstruction adapter is removed. Historical acceptance/provenance safeguards remain.
- `scripts/compare-live-golf-latency.mjs`, which directly acquired the same compressed shot data, is deleted. The course-media importer and its npm task are also removed.
- `shotcastFailures` is removed from new refresh responses and background-run summaries. Historical JSON summaries and database records are untouched.
- No active application, background job, script or public asset path acquires PGA ShotCast/TOURCAST data after this change. The operation name remains only in retirement documentation and negative regression assertions.

## Golf behavior retained

Manual `/api/refresh-stats-golf` and cron `/api/cron/refresh-golf` still use the Group/slate-specific lease and accepted-revision workflow. `reconcileGolf` persists accepted scoring atomically, recomputes results through the existing competition engine and retains lifecycle authority. Roster queries in refresh remain necessary for round-finished notification recipients; they are not removed with the shot supplement.

ESPN is authoritative for new scoring evidence, while existing accepted history is preserved:

- Missing/null/zero/incomplete observations never imply a deletion or an invented even-par hole. Final-hole acceptance requires valid strokes and relative-to-par.
- Stale observation times cannot replace newer accepted evidence. Newer but incomplete cards cannot erase known holes, regress historical coverage or demote a terminal golfer.
- Differing official hole scores still require coherent round aggregates and sufficient coverage. Explicit validated official corrections remain supported by the existing workflow; source retirement does not initiate a correction or historical backfill.
- Stored `source: "shotcast"` evidence remains readable and protected until a sufficiently complete, newer ESPN card confirms or legitimately corrects it. The source union and historical compatibility guards in `acceptGolfHole` are intentionally retained; no active adapter creates new shot-derived observations.
- Final/locked-final authorization and payload validation remain unchanged. No historical result is deleted, cleared or rewritten merely because its original source was retired.
- Standard scoring uses accepted player/round totals. Best Ball chooses from accepted per-hole contributions, marks missing contributions unscored/provisional and converges as ESPN updates arrive. Season standings continue to consume finalized stored team results.

Ordinary PGA course metadata, field import, tee times, player identities, rankings and analytics are preserved. `lib/providers/pgaTourCourse.ts` contains the existing course-par/yardage importer separated from the retired media module. Its `LeaderboardHoleByHole`/`HoleDetails` queries select ordinary metadata, not replay imagery or player shot payloads. `upsertGolfCourseHoles` remains. ESPN/NBA.com feeds and other sports/games are unchanged.

## UI and public assets

- Player/league scorecards retain all 18 hole values, par values, colors, totals and round expand/collapse controls. Individual hole-click controls and detail panels are gone. Best Ball contributor links still open the relevant scorecard round.
- Commissioner ShotCast asset controls and all replay components are removed.
- `public/shotcast/R2026013/manifest.json` and its 18 hole JPEGs are deleted. Their former URLs return 404.
- The old promotional showcase and obsolete landing-page backup are deleted, including PGA course imagery and NBA CDN portraits.
- Compact Group game labels wrap in an adaptive grid. Sport icons, game links, Group activation and sign-in/account navigation remain.
- Historical manifest tables/migrations and historical documentation remain; no schema changes or data cleanup are required.

## Regression coverage

`tests/golf-scoring-source-dependency.test.cjs` now verifies ESPN-only behavior through the real parser, canonical rule snapshots, reconciliation and Standard/Best Ball reducers:

1. Delayed ESPN leaves the missing hole absent and the current totals/ranking unchanged until the new hole arrives; subsequent complete ESPN updates converge and repeat idempotently.
2. Best Ball retains a currently known contribution provisionally, without inventing the missing golfer's score. Fully unknown holes stay unscored/null.
3. Aggregate-only or incomplete hole evidence cannot manufacture final Best Ball values.
4. Partial/stale ESPN preserves accepted legacy scores; a coherent later card can confirm provenance without changing totals or rewriting team results.
5. Incomplete ESPN cannot regress fully completed, four-round historical fixtures or their accepted scoring revision.

`tests/golf-background-refresh.test.cjs` exercises real live ESPN ingestion for two scoped slates with participating golfers, without a PGA shot-provider mock/import. It verifies that only the reported ESPN holes reach reconciliation. Worker lease, cadence, finalization, authorization and notification coverage remains.

Retirement tests verify inert legacy APIs, deleted providers/scripts/assets, retained independent reconciliation and metadata-only course imports. Existing golf reconciliation/production scoring/Best Ball/rules/roster tests remain. The clubhouse and Golf Live browser tests cover mobile/desktop UI, Group switching and ordinary scorecards.

## Verification and review state

- Focused golf/source/refresh/retirement suite: **109 passed**, no failures or skips. The strengthened raw-ESPN missing-relative-to-par fixture also passed in the final eight-test source suite.
- Broader Golf/Groups/retirement/UI regression suite: **380 passed, three optional browser tests skipped, one unchanged failure** (384 total). The failure is `tests/golf-product-ui.test.cjs:28`, which evaluates an unchanged TypeScript navigation expression as JavaScript and raises `Unexpected token '!'`.
- `npx tsc --noEmit` and `npm run build`: passed, including production TypeScript validation and static-page generation.
- Scoped ESLint over all three changed runtime modules and five changed test modules: passed. Comparing those files against their prior staged versions found zero findings before and after.
- Working-tree and staged whitespace checks: passed. The previously corrected course-provider EOF remains intact.
- Source audit: no shot-detail requests, compressed-shot parsers, replay media requests or manual acquisition scripts remain in application/components/libraries/scripts/workflows/public assets. Retired endpoint messages and historical compatibility guards remain intentionally.
- Scoring formulas, canonical rules, reconciliation reducers/RPC boundaries, Best Ball/standings calculations, ESPN normalization/compaction, ordinary PGA providers and Supabase schema were verified unchanged. The acceptance-guard runtime is identical; only its unused reconstruction adapter was removed.
- Original staged work was preserved outside the explicitly changed scoring-source/docs/tests paths. **57 files are staged, with no unstaged or untracked changes**. The original staged retirement and clubhouse changes are preserved; additional source changes remove the scoring exception described in the earlier investigation. No commit, push, deployment, schema mutation, historical-record cleanup or 3D-worktree change is authorized or performed in this review.
