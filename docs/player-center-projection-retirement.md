# Player Center: projection dependency review and retirement plan

October 29 local implementation update: [NBA factual refresh](./nba-player-center-factual-refresh.md) supersedes the historical worker/resume and recurring-writer guidance below. Production SQL, deployment, mapping application, activation and scheduling remain pending separate approval. Frozen review bundles remain dated evidence.

Reviewed locally on 2026-10-23. This is a proposal, not authorization or execution. No projection worker, schedule, ingestion endpoint, scoring formula, historical projection snapshot, or cache schema was changed in the UI task. Repository configuration establishes the schedules below; deployment settings or manually configured external jobs have not been independently inventoried.

## Producers and acquisition dependencies

| Entry point | Verified behavior | Retirement decision |
| --- | --- | --- |
| `.github/workflows/nba-projection-shadow-refresh.yml` | Daily 10:23 UTC and manual; invokes `scripts/run-nba-projection-shadow-refresh.cjs`. Secret-authenticated POSTs to `/api/internal/nba/projection-ingest`: `eligible`, `observations` with `generate:false`, then `generate`. Fetches each resolved player's prior/current year logs sequentially. | **Do not disable the whole job.** It also acquires the factual observations the Player Center needs. First approve a replacement acquisition/coverage process and verify freshness over several runs. |
| NBA worker season selection | Uses `NBA_PROJECTION_SEASON` or UTC calendar year. Workflow does not override it. In October 2026 the default is 2026, whereas the professional NBA ending year is 2027. | Correct explicit season selection as a separately approved worker/rollout change. UI uses professional ending years and never borrows 2026 observations for 2027. |
| NBA internal ingest route | `observations` persists facts then optionally generates; `generate` directly generates; default refresh path can acquire/persist/generate together through `projectionRefresh.server.ts`. | Eventually separate factual acquisition from generation in **all** callable paths; removing only the final worker POST is insufficient. Keep authentication and bounded batching. |
| `.github/workflows/nfl-projection-observation-refresh.yml` | Tue 14:15 UTC / Wed 18:15 UTC and manual; invokes `scripts/run-nfl-projection-observation-refresh.cjs`. Scheduled season explicitly 2026. Acquires regular-season offense observations/fumble evidence and posts to `/api/internal/nfl/projection-ingest`. Supports manual dry run. | **Keep factual acquisition.** Rename later if useful, but the word “projection” in its name does not make the raw data disposable. It does not provide complete kicker/D/ST coverage. |
| `.github/workflows/nfl-projection-shadow-generate.yml` | Manual-only; invokes `scripts/run-nfl-projection-generation.cjs`, POST `action:generate`. Workflow says cache migration / first-run audit approval is required before activation. | Candidate to retire after NFL projection consumers and audit requirements are resolved. No schedule to disable today. Do not run it to test the new UI. |
| NFL internal ingest route | `eligible`, `audit`, observation persistence and independent `generate` using `generateNflProjectionStatCache`. | Keep acquisition/audit paths. Generation is a later, separately reviewable retirement candidate. |

There is no projection-named scheduled route under `app/api/cron` or checked-in Vercel cron configuration. This does not establish that no externally configured invocation exists. Before retiring anything, inventory GitHub workflow runs, deployment cron settings, secrets, and external callers without invoking write endpoints.

## Tables and models

| Data | Consumers / reason to preserve |
| --- | --- |
| `nba_player_provider_identities` | Reviewed exact player mappings. Needed by both provider acquisition and the Player Center. Keep mappings, conflicts and evidence. |
| `nba_player_game_observation_versions`, `nba_player_game_current_observations` | Immutable version history and current fact view, used by `projectionRepository.server.ts` and `lib/player-center/repository.server.ts`. **Keep.** The proposed rollout reuses these tables. |
| `nfl_player_game_observation_versions`, `nfl_player_game_observations` | Versions/current offense facts, used by `observationRepository.server.ts` and Player Center stored comparisons. **Keep** provenance and corrections. |
| `nba_projection_stat_cache` | Generated raw NBA predictions, read by Draft V2 and admin shadow audit. Could eventually stop refreshing after consumers migrate. Do not drop in the UI rollout. |
| `nfl_projection_stat_cache_versions`, `nfl_projection_stat_cache` | Append-only generated versions/current cache view. Generator appends to versions; Draft V2 and admin audits read current cache. Preserve for rollback/audits even if generation is later retired. |
| `player_nba_season_averages`, `player_nfl_season_stats` where present | Historical factual totals/GP inputs; not disposable projections. The audit found 541 NFL summary rows for 2025 and no 2026 rows. Player Center does not claim it exists or manufacture GP. |
| `lineup_players.projected_fantasy_points`, `projection_confidence`, `projection_source`, `projected_at` | Saved historical draft snapshots. Keep existing records permanently; no recalculation/backfill/deletion as part of retirement. |
| `player_slate_stats`, `team_slate_results`, lineups/slates | Actual fantasy outcomes, frozen rules and historical league data. Unrelated to forecast cache retirement; never delete or rewrite. |

## Remaining consumers and exact blockers

- `lib/playerProjections.ts` produces legacy NBA estimates from season averages plus drafted slate results/recency. It is calculated on demand, independently of the shadow generation worker. Stopping the worker does **not** remove these estimates.
- `/api/player-projections` exposes that legacy calculation, defaulting to app season `2026`. Legacy modal/pool/history components retain their existing code for compatibility/Golf. NBA/NFL default entry points now render Player Center instead of those projection views; the legacy NBA/NFL **league draft history** remains available. The old statistical history mode is only offered for Golf.
- `lib/lineups/draftProjections.server.ts` reads NBA/NFL raw cache stats and scores them with slate context through `draftProjections.ts`; NBA can fall back to `getPlayerProjectionsForSeason`. `/api/draft-projections` authorizes slate/Group access before using it.
- `LineupBuilder.tsx` still fetches `/api/draft-projections`. The new player research table does not consume its projections or parent legacy-average order. However, `getLiveProjectedTeamTotal`, `getPregameProjectedTeamTotal`, win-probability calculations and `ScoresDashboard.tsx` still depend on projection state. Do not remove the fetch/map while those score views exist.
- `/api/lineups` still calls the legacy NBA calculator for a new single-player pick and writes its existing immutable draft snapshot fields. This is an established pick workflow, deliberately unchanged. Replacing/removing future snapshot creation is a separate product/API decision; preserve old values either way.
- `app/lineups/scores/page.tsx` loads saved projection snapshots. `ScoresDashboard.tsx` displays projected final / saved pregame totals and comparison with actual results. Keep those columns and semantics until their presentation is separately decided.
- `/api/home-summary` uses `getPlayerProjectionMapForSeason` and local fallback estimates for NBA live projected totals. It must be changed before retiring the legacy calculator.
- `/api/admin/nba/projection-shadow` compares generated NBA caches to legacy production estimates; `/api/admin/nfl/projection-shadow` reads/scorers raw NFL caches. Existing admin audit controls remain intact. Decide whether to preserve as historical audit surfaces before removing models/routes.
- Forecast research scripts (`run-nba-finalists`, `assemble-nba-finalist-results`, research/backtest modules and tests) are offline tools, not scheduled production jobs. They can remain inert without recurring provider/database costs.

## Safe execution order (separate approvals required)

1. Review/approve the existing production rollout document separately. Apply identity/observation/coverage changes only through its guarded process. The production coverage-cache reader is now implemented and validated locally; approved DDL/population and production verification are still required before activation. Never claim the full draft pool is rankable just because the example profiles work.
2. Launch the Player Center only after both-sport exact-ID, Group/slate snapshot, missing-data, draft regression and mobile checks pass. Approve deployment independently. Keep all projection producers/consumers available during this stage.
3. Decide the desired future behavior for **live projected standings/win probabilities**, **future draft projection snapshots**, and **admin shadow audits**. Those are the blockers to retiring the underlying predictions. Historical actual averages do not predict a remaining game; do not relabel them as forecasts.
4. Approve and verify a factual NBA acquisition replacement with explicit professional seasons, independent GP/coverage, bounded retries, correction refresh and failure reporting. Keep the NFL factual refresh, adding only separately approved coverage/kicking/D/ST support as needed. Observe source age/coverage over multiple successful runs before removing any old acquisition.
5. Migrate the remaining projection consumers in small changes with existing workflow tests. Remove projection-only network requests only after confirming they have no score/pick/admin consumer. Require a clean scan of the identifiers above plus a production read-only request/job inventory.
6. After a stable observation period, separately approve disabling **generation only** (NBA generate calls/default generation paths; NFL manual generation workflow/action). Leave raw observations/mappings and historical snapshots intact. Preserve model version/cache rows and scripts for rollback. Retaining small inactive cache tables is cheaper and safer than schema cleanup for four people.
7. Consider deleting forecast-only code or archiving generated caches much later, as a distinct decision. There is no need for a destructive cache/table migration to launch Player Center.

## Rollback

Before any approved retirement, record deployed revision, workflow revisions/schedules, model versions, last successful factual refresh, season arguments and cache timestamps; take approved backups through the rollout process. If coverage/freshness falls or a consumer breaks, restore the previous UI/consumer/workflow revision and acquisition configuration, using the original explicit season. Re-enable generation only after its own approval and avoid unbounded historical reruns. Existing cache and saved snapshot rows allow read rollback without rewriting picks or scores. Reverting UI or forecast generation must never roll back corrected factual history, Group permissions, frozen slate rules or fantasy results.

## October 26 integration checkpoint

No projection acquisition/generation code, schedule or consumer was changed. The new durable reader uses raw facts and re-scores only in the authorized research context; it does not replace saved projection snapshots, live score/win-probability consumers or admin audits. `LineupBuilder` intentionally retains projection fetching for those consumers even while its Player Center research table ignores projections.

The NBA daily worker still obtains `eligible` from every active resolved provider identity (`listEligibleNbaProjectionPlayers`), then fetches logs/persists observations/generates. Applying the 98 mappings therefore changes its processing population without a code change. Before mapping approval, approve an operational hold and a deliberate existing-cohort/expanded-cohort resume policy; do not resume it implicitly after Player Center activation. This remains a production checkpoint, not an implemented worker modification. The feature gate and local read-only review transport do not stop externally scheduled workers. The [updated rollout](./player-center-production-rollout.md#local-integration-and-rollout-readiness--october-26) keeps data preparation, deployment/activation, and retirement as distinct approvals.
