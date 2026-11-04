# NBA/NFL factual pipeline audit — November 3, 2026

Read-only audit for reliable, full-player-pool Player Center statistics. Measurements were taken approximately **18:30–18:41 UTC (13:30–13:41 EST)**. Provider roster corroboration completed at 18:37:42 UTC. This report supersedes dated coverage estimates, not the existing database repairs or operational approval requirements.

The accompanying [evidence JSON](./nba-nfl-factual-pipeline-audit-20261103.json) preserves counts, field coverage, identity classifications, missing event IDs, provider response hashes, request receipts, integrity receipts, job state, and inspected remote source. It contains no credentials or raw private user/session records. Raw sports responses and working audit scripts were kept outside the repository in a temporary audit directory.

## Decision

**Neither sport is ready for certified full-pool Player Center statistics in production.** The installed NBA integrity repair is healthy. The principal problems are catalog/identity drift, absent current events, almost entirely unpublished caches, and differences between the research observation contract and the facts needed by Player Center. There are also confirmed NFL signed-yard and NBA historical-phase defects.

The prior Curry publication remains valid evidence of a successful five-game canary: its default-rule FP/game recomputes to **41.16**. It is now stale, and ESPN has a sixth game. A successful canary does not establish cohort coverage or recurring operation.

### Scope and preservation

- Worked in `/home/markwohlever/nba-fantasy-app` on the existing `main` checkout, HEAD `d572341fcfa55408dfde13160b0709ffb55b9d6e`; it was already six commits behind the local `origin/main` reference. No checkout, fetch, pull, branch/worktree creation, commit, push, merge, or deployment was performed.
- Preserved all pre-existing tracked/untracked work, the Bracket stash, both ShotCast worktrees, and the existing Player Center/review worktrees. The only intended repository additions are this report and its evidence JSON. Existing-file hashes, HEAD, stash, and worktree registrations were compared at completion.
- Database access used GET/HEAD requests only. The only invoked RPC was the reviewed, read-only **light** `player_center_nba_refresh_health(false)`, via GET. No ingestion, refresh, mapping, publication, migration, repair, cleanup, or application sync command was run. Public sports-source GETs were used solely for audit validation; no observations or caches were published.
- Tables were explicitly paginated, with at most 1,000 rows per request, stable ordering, row caps, 10–12-second request timeouts, and finite request/response budgets. NBA integrity used the existing E3A verifier, including its unchanged 75-second/250,000-history-row/100,000-current-row/500-page/256-MiB limits.
- This was not a transaction spanning all reads. NBA full verification anchored counts/watermark and compared two complete current scans. Closing counts/watermark agreed with the earlier reads; existing scoring/Skins jobs continued independently.
- No application build, browser session, migration test harness, or write-based idempotence test was run. Pure parsers, cache decoding, scoring, and integrity checks were exercised against copied facts in memory. Previous Chrome acceptance was not repeated or invalidated by an application change.

## A. Architecture and job inventory

### The four separate layers

| Layer | NBA | NFL | Important boundary |
| --- | --- | --- | --- |
| Catalog and identity | `players` uses native NBA IDs; `nba_player_provider_identities` maps ESPN IDs to local IDs | `players_nfl.nfl_player_id` is the ESPN athlete ID; K uses ESPN PK/Core identities; D/ST is `100000000 + ESPN team ID` | A valid native NBA ID is not an ESPN ID. An NFL synthetic D/ST ID is not an athlete ID. |
| Source acquisition | ESPN athlete logs and season statistics; NBA.com supplies catalog/live fantasy sources | ESPN athlete logs, season statistics, regular-week scoreboards, event summaries; team schedules for D/ST | Source responses are evidence, not proof that database coverage or caches are complete. |
| Factual storage | Immutable `nba_player_game_observation_versions`; trigger-maintained `nba_player_game_current_observations`; legacy latest-version view `nba_player_game_observations` | Immutable `nfl_player_game_observation_versions`; latest-version view `nfl_player_game_observations` | These are global provider facts, not Group/slate results. NFL does not have the analogous materialized current table. |
| Publication and reads | `player_center_season_cache` plus `player_center_nba_refresh_status`, written atomically by the NBA publisher | Same raw season cache, currently owner-reviewed cache-only SQL; no automatic full-cohort publisher | Player Center comparison certification requires identity, coverage, completeness, freshness, and a common cutoff. Observation presence alone is insufficient. |

Player Center caches store raw statistics and provider season tables, **not Group-specific fantasy scores or projections**. Group/slate rules are applied when reading. This allows reuse of the same public facts across Groups without leaking or conflating Group identity.

### Sources and consumers

| Source/component | Acquisition/storage/consumer | Observed status and suitability |
| --- | --- | --- |
| NBA.com `stats/commonallplayers` | `app/api/sync-players/route.ts`; native catalog evidence in identity-review tooling | Fresh GET succeeded: 523 rostered native players. Catalog sync is a separate write operation; it was not invoked. |
| NBA.com CDN schedule, today's scoreboard, per-game box scores; legacy `scoreboardv3` | `lib/nba/provider.ts`, slate creation/pinning, refresh/backfill/admin routes | Independent live fantasy pipeline. Uses native IDs and pinned slate games; not a complete ESPN player-history ingester. |
| ESPN NBA athlete `gamelog?season=ENDING_YEAR` | `espnNbaGameLog.ts`, existing NBA research/persistence code, new factual runner, Player Center profiles | Fresh 2027 samples succeeded. The historical phase classifier incorrectly includes `Play In Regular Season` in regular season. |
| ESPN NBA athlete `stats?...&seasontype=2` | Independent GP and exact season tables for Player Center | Fresh samples succeeded; needed for GP reconciliation and statistics absent from the narrow observation table, including shooting tables. |
| ESPN NBA team list/30 rosters | Identity evidence only | All 30 rosters read successfully: 521 athletes, no duplicate ESPN IDs. No mapping was applied. |
| ESPN NBA scoreboards/live details | `lib/providers/nbaLiveScores.ts`, live-scores APIs; audit schedule validation | Display/status sources. Fifteen bounded daily reads found 107 distinct completed current-season events. |
| ESPN NBA standings/BPI | `nbaSkinsRecords.mjs`, NBA background worker, Skins records/projections | Separate team-level Skins pipeline. Do not disable it or use BPI projections as player facts. |
| ESPN NFL team rosters, scoreboard, Core team-athlete collection | `lib/providers/nfl.ts`, `app/api/sync-players-nfl/route.ts` | Catalog, current-week flags, K PK→K normalization, deterministic D/ST rows. Sync is mutating, including its GET alias; it was not called. |
| ESPN NFL athlete logs | `espnNflGameLog.ts`, factual worker, Player Center parser | Research parser covers QB/RB/WR/TE only; Player Center also has a K path. Research normalization rejects legitimate negative yards. |
| ESPN NFL weekly regular-season scoreboards | `espnNflScoreboard.ts`, worker | Enumerates weeks 1–18, not only calendar year. Essential independent final-status evidence because athlete logs commonly omit status. |
| ESPN NFL event summaries | `espnNflEventFumbles.ts`, `normalizeCenterNflSummary`, live scoring | Fumbles evidence, category reconciliation, final status, off-position scoring facts and D/ST inputs. Research and Player Center evidence rules differ. |
| ESPN NFL team schedules | `normalizeCenterNflSchedule`, `defenseTeamId` | D/ST games/byes and event universe. D/ST is excluded from the research athlete observation tables. |
| ESPN NFL Core season statistics | `scripts/import-nfl-season-stats.mjs` | Legacy aggregate import into `player_nfl_season_stats`; currently only 2025 populated. Not a current complete-game cache. |
| NBA CSV season-average import | `scripts/import-nba-season-averages.js` → `player_nba_season_averages` | Legacy 2025–26 averages; every live GP is null. Its fixed-default FP import must not replace canonical Group/slate scoring. |
| Offline NBA tournament/NFL research scripts and `data/analytics` artifacts | `fetch-nba-tournament`, `prepare/fetch-nfl-research-*`, model/backtest scripts | Historical research/cohort artifacts; not current whole-pool certification or a production schedule. Some can fetch or write artifacts; none was run. |
| `player_slate_stats`, `player_nfl_slate_stats`, `team_slate_results` | Live fantasy scoring, league player history, standings | Saved Group/slate outcomes, often only relevant/drafted players. Never use them to fill a global factual pool or overwrite historical scoring. |
| Legacy player projection caches | `nba_projection_stat_cache`, `nfl_projection_stat_cache_versions` and latest view | Still populated, but forecasts are not factual statistics. Local candidate retires consumers/producers; remote code still contains them. |

A repository search found no active NBA/NFL factual integration using BallDontLie, BBS, nflverse, Sleeper, SportsDataIO, or Sportradar. Environment variable presence does not establish a working source. No paid-source calls were made.

### Actual job state versus local candidate

GitHub state was checked live. The relevant [workflow runs](https://github.com/mwohlever/nba-fantasy-app/actions) and remote `main` files differ materially from this uncommitted checkout.

| Job/path | Live or remote-main evidence | Local candidate | Audit conclusion |
| --- | --- | --- | --- |
| `.github/workflows/nba-projection-shadow-refresh.yml` | **`disabled_manually`** since October 28, 23:44 UTC. Remote YAML still contains daily `23 10 * * *`; last manual run [40789028481](https://github.com/mwohlever/nba-fantasy-app/actions/runs/40789028481) succeeded October 28 | Replaced in working tree with manual-only NBA Player Center factual workflow, `execute=false` default, 45-minute job and checkpoint artifacts | Legacy acquisition intentionally stopped. Disabled state must remain intact; checked-in cron text is not evidence of an enabled job. Replacement is not deployed/activated merely because its file exists locally. |
| `scripts/run-nba-projection-shadow-refresh.cjs`; old NBA ingest route | Remote main retains old observations/generation paths | Local script is an inert retirement entry; local route permits eligibility only and returns 410 for legacy writers | Do not re-enable the old workflow to populate Player Center. Review/deploy the factual replacement separately. |
| `.github/workflows/nfl-projection-observation-refresh.yml` | **Active**, Tuesday 14:15 UTC and Wednesday 18:15 UTC. Latest recorded run [40780479929](https://github.com/mwohlever/nba-fantasy-app/actions/runs/40780479929) failed October 28 | Same schedule; local acquisition code reports unknown QB fumbles and can retain other validated facts while exiting non-green | Enabled does not mean healthy. Latest failure is confirmed in job logs: `ESPN summary missing fumbles statistics group`, exit 1. October 27 run succeeded. No new run was triggered. |
| `.github/workflows/nfl-projection-shadow-generate.yml` | **Active at GitHub**, manual-only; last recorded run September 17. Remote YAML still invokes the real generator | Local YAML skips its retired job; local generator/API return retirement errors | Obsolete, still manually invocable remotely. Separate retirement/disable authorization is a release prerequisite; it is not already retired in production based on local files. |
| `scripts/run-nba-player-center-refresh.cjs`, new internal refresh API | No live scheduled factual replacement was established | Bounded source reader, semantic append/cache publication, health, cohort, receipt actions, checkpoint/resume, common cutoff, outcome arrays | Reuse after review and deployment. There is no active full-pool NBA cache schedule. |
| NFL E3A canary/cache staging | No NFL Player Center cache rows exist | Bounded prepare/preflight, raw-source enrichment, owner-reviewed guarded cache SQL | Useful bootstrap tools, not an unattended publisher/scheduler. |
| NBA background Fantasy/Skins | 11,149 `nba_sync_runs` at auxiliary read; latest recurring background runs succeeded about every five minutes, using `espn_standings`; one current state row is Skins | Claims/leases, discovery, bounded provider reads, atomic apply, notification acknowledgements, run pruning | Active independent work. No current NBA Fantasy state row was present; that alone does not prove a failed worker. Do not repurpose this job as player-history coverage. |
| NFL background slate scoring | 11,540 `nfl_sync_runs`; latest recurring runs succeeded with zero eligible slates. Seven state rows; latest slate success November 3, 05:02 UTC | `claim_nfl_sync`, `finish_nfl_sync`, retry/backoff and lease handling | Saved fantasy results are updating independently of the failing factual observation workflow. A successful zero-work run does not establish Player Center freshness. |
| Vercel / Supabase schedules | No remote `vercel.json`; local untracked file contains only a deployment exclusion, **no crons**. Repeated live sync receipts prove an existing recurring caller | `/api/cron/refresh-nba`, `/api/cron/refresh-nfl`, heartbeat and manual paths exist. Migrations explicitly say cron registration is separate | Existing runtime mechanisms can host/trigger bounded work. Exact `cron.job` registrations, job-run failures, Vercel settings and deployed environment/commit were not accessible through the available read path. Do not claim their registration from repository code. |

GitHub's connector supported remote source and failure-log reads but rejected workflow-status endpoints. Public GitHub REST GETs supplied workflow state. No service configuration was changed.

### RPCs, tables, and writer boundaries

- NBA: `append_nba_projection_observations(jsonb)` performs chronological semantic append; the insert trigger `sync_nba_current_observation()` maintains current rows. `reject_nba_projection_observation_version_mutation()` protects history. The legacy latest-version view remains present.
- NBA Player Center: `player_center_nba_refresh_health(boolean)` and `publish_player_center_nba_refresh(uuid,integer,timestamptz,jsonb)` are exposed in the live schema. Cache/status receipt rows corroborate the prior publication. Only the health RPC was called during this audit.
- NFL: direct append-only version insert/upsert, uniqueness by provider/player/event/content hash; `nfl_player_game_observations` selects latest by `known_at`, log fetch time, then ID. Migration defines an immutable-history trigger. There is no live exposed NFL factual publication RPC equivalent to NBA's.
- Independent NBA scoring RPCs: `discover_nba_work`, `claim_nba_sync`, `load_nba_fantasy_context`, `apply_nba_fantasy`, `apply_nba_skins`, `finish_nba_sync`, `ack_nba_notifications`, `prune_nba_sync_runs`. NFL equivalents include `claim_nfl_sync`, `finish_nfl_sync`, `nfl_sync_lease_owned`, `prune_nfl_sync_runs`; application refresh code writes slate statistics/results. None was invoked.
- Existing manual cache/mapping SQL, legacy backfills/imports, `standardize-player-names`, `merge-duplicate-players`, season imports, and observation-cleanup proposals are operational artifacts, not safe audit entry points. No such command was run.

### Player Center APIs and other UI reads

- `GET /api/player-center`: authenticated profile read; authorizes active Group/sport, local player and professional season. Prefers a valid fresh durable cache; otherwise bounded provider profile reads may occur. A provider outage may leave a disclosed stale snapshot.
- `GET /api/player-center/comparisons`: authenticated, **stored-only**, with zero provider requests. Reads catalogs, durable caches and observation fallback. Certification uses complete metric windows, independent appearance count, freshness and a common cache cutoff. Unknown rows remain in the comparison universe; they cannot be silently excluded to unlock sorting.
- `lib/player-center/http.server.ts` validates Group/league scope, authorizes an optional slate against that scope, and reads its frozen `rules_snapshot`. A legacy null snapshot falls back to canonical defaults, not today's changed league settings.
- `service.ts` caches catalogs for 60 seconds and stored histories for five minutes per process; cached histories are rebound against the latest authorized identity. `CenterEspnReader` has 128 entries, up to three concurrent misses/40 misses per minute per process; profile reads have an eight-request/18-second budget, five-second individual fetch timeout and 3-MB response cap. Current provider TTL is 15 minutes, historical TTL one day. These are process-local, not fleet-wide controls.
- The normal repository bounds catalogs/statuses to 3,000 rows; raw fallback scans to 30,000 season rows; caches are read in pages of 25. Large full-season cohorts will need latency/transfer testing under actual Vercel limits, not just tests with a one-row cache. Regular repository queries do not uniformly install the explicit abort signals used by integrity checks.
- `/api/player-history`, `/api/player-history-detail`, `/api/player-league-profile`, `/api/player-stats`, and `/api/player-season-stats` primarily consume saved league/slate facts or old aggregate season tables. They do not certify the complete professional player pool. The local legacy projection endpoints return 410; they are not factual fallbacks.
- Local feature behavior: development enables Player Center unless explicitly disabled; production requires `NEXT_PUBLIC_PLAYER_CENTER_ENABLED=true`. The local read-only transport flag blocks writes/RPCs in the application. These local flags were not changed and are not evidence of deployed production settings.

## B. Fresh coverage metrics

All following catalog counts describe database rows, not a newly certified professional roster.

### Catalog and identities

| Metric | NBA | NFL |
| --- | ---: | ---: |
| Catalog rows | 595 | 1,031 |
| Active catalog rows | 530 | 1,031 |
| Inactive catalog rows | 65 | 0 |
| Structurally resolved active identities | 367 / 530 (69.2%) | 1,031 / 1,031 numeric direct/synthetic identities |
| Unresolved active identities | **163** | 0 structurally unresolved |
| Duplicate native IDs across catalog | 0 | 0 |
| Observation rows with catalog/provider binding mismatch | 0 | 0 |
| Stored mapping rows | 367, all resolved, locked, and evidenced | No separate crosswalk required for athlete IDs |

NBA position groups: 113 G, 417 F/C. NFL positions: 124 QB, 211 RB, 411 WR, 215 TE, 38 K, 32 D/ST. All NFL IDs being numeric does **not** independently certify every name, position, current roster status, or synthetic team binding. The entire NFL roster was not re-fetched in this audit.

Fresh NBA.com/ESPN roster corroboration changes the interpretation of the historical mapping plans:

| Current source comparison | Count |
| --- | ---: |
| NBA.com current rostered rows | 523 |
| ESPN athletes across all 30 current rosters | 521 |
| Catalog-active players matching NBA.com roster by native ID | 441 |
| Catalog-active players absent from NBA.com current roster | **89** |
| NBA.com rostered players absent from active catalog | **82**: 76 have no catalog row; six have an inactive row |
| Stored catalog team differs from current native team among matching active IDs | **112** |
| Existing ESPN mappings corroborated by current native/ESPN name and team | 338 |
| Existing mappings needing current evidence review | **29**: 28 lack a current native roster entry; Nae'Qwan Tomlin has native evidence but no matching current ESPN roster row |
| Unmapped players with fresh, unique name/team corroboration | **101** review candidates; none applied |
| Other unresolved players | 61 absent from current native roster; one suffix discrepancy, Bobby Portis / Bobby Portis Jr. |

There were no duplicate ESPN IDs in the roster responses. These classifications establish review needs, not permission to deactivate/delete players or change mappings. Absence from a current roster does not invalidate a historical identity. The prior 98/110-candidate manifests are dated artifacts, not current apply targets.

### Current season: NBA 2027 = 2026–27; NFL 2026

| Metric | NBA 2027 | NFL 2026 |
| --- | ---: | ---: |
| Current observation rows | **895** | **2,745** |
| Distinct observed players | **283 / 530 (53.4%)** | **552 / 1,031 (53.5%)** |
| Relevant offensive NFL denominator | — | 552 / 961 QB/RB/WR/TE (57.4%) |
| Active catalog players without observations | 247: 163 unresolved + 84 mapped | 479: 409 offensive + 38 K + 32 D/ST |
| Distinct events represented | 58 | 107 |
| Fresh provider completed-event universe checked | 107, October 20–November 3 | 121, regular weeks 1–8 |
| Completed events with **no** stored player observations | **49** | **14**, all Week 8 |
| Latest stored game start | October 31, 02:00 UTC | October 27, 00:15 UTC |
| Latest retained source acquisition | October 31, 21:21 UTC | October 27, 19:25 UTC |
| Duplicate current event/player keys | 0 | 0 |
| Null local-player IDs | 0 | 0 |
| Rows containing every strict canonical scoring field | 895 / 895 | **0 / 2,745** |

The event comparison measures an event having any observations, not every appearance being present in that event. Missing player-games can also exist in the 58/107 represented events. The full missing-appearance count remains unknown without individual GP/log reconciliation for the complete reconciled pool. No player without observations was assumed to have GP=0 or to have missed a game.

Daily NBA scoreboards and weekly NFL scoreboards returned unique event IDs with no pagination/cap truncation. Broad date-range scoreboard requests returned HTTP 400 and were not used to establish coverage; the audit switched to supported bounded daily/weekly reads. NFL log statuses were not promoted from unknown to final without independent event evidence.

NFL position coverage:

| Position | Active | Players with 2026 observations | Rows | Missing LOST rows |
| --- | ---: | ---: | ---: | ---: |
| QB | 124 | 65 | 282 | 0 |
| RB | 211 | 127 | 625 | 4 |
| WR | 411 | 228 | 1,110 | 9 |
| TE | 215 | 132 | 728 | 8 |
| K | 38 | 0 | 0 | Not supported by research store |
| D/ST | 32 | 0 | 0 | Not supported by research store |

### Missing fields and fantasy completeness

NBA stored current-season points, rebounds, assists, steals, blocks, turnovers and minutes are present in every stored row. This does not certify missing games, current rosters, historical phase, shooting details, or independent GP.

NFL 2026 null counts:

| Scoring input | Null rows | Interpretation |
| --- | ---: | --- |
| Passing yards / passing TD / interceptions | 2,463 each | Research parser intentionally leaves all RB/WR/TE passing fields null, even when Player Center needs affirmative off-position zero/positive evidence. |
| Rushing yards | 64 | Includes 21 wholly unknown lines and other values; at least one is a confirmed rejected negative-yard value. Do not assume all remaining nulls have one cause. |
| Rushing TD | 21 | Same wholly unknown scoring lines. |
| Receiving yards | 336 | All 282 QB rows are intentionally null; remaining nulls require source-specific checks. |
| Receiving TD / receptions | 303 each | 282 QB off-position nulls plus 21 wholly unknown lines. |
| Fumbles lost | **21** | RB 4, WR 9, TE 8; all 21 also lack every other canonical scoring field. |

All 282 stored QB rows have numeric LOST and summary URL provenance; 31 have positive LOST. Provenance presence is not proof that every historical zero was independently established: remote code still contains the older unconditional absence→zero rule. A complete revalidation of all QB summary evidence was not performed.

The strict Player Center scorer requires all nine offensive inputs before invoking the legacy zero-defaulting scorer. Thus **none of the raw NFL research rows alone qualifies as a fully scoreable Player Center line**. That is a contract mismatch, not evidence that NFL recorded no real statistics. Summary-enriched caches can establish the missing facts with actual source evidence.

### Caches and historical availability

Only **one** `player_center_season_cache` row exists across both sports and all seasons; one NBA refresh-status row exists. There are **zero NFL durable Player Center caches and zero historical Player Center caches**.

The cache is Stephen Curry, local 4 / native 201939 / ESPN 3975, NBA 2027. It has five observed/expected games, `complete=true`, no issues, real season tables, cutoff October 31 21:21:20.716 UTC, checked October 31 21:21:22.891 UTC. Its verified-data status has matching identity/run/cutoff and records **two appended versions**. Cache decoding succeeds, but it is approximately **69.2 hours old** and therefore stale under the current 24-hour rule. Fresh eligible/rankable durable-cache coverage is **0 for each sport** at audit time.

| Stored observation season | Current rows | Observed players | Versions | Coverage caveat |
| --- | ---: | ---: | ---: | --- |
| NBA 2025 (2024–25) | 15,593 | 291 | 31,186 | Appearance subset; historical phase classifier requires review |
| NBA 2026 (2025–26) | 18,793 | 362 | 37,586 | Confirmed play-in contamination of regular phase |
| NBA 2027 (2026–27) | 895 | 283 | 895 | Stale/incomplete current-event acquisition |
| NFL 2025 | 6,443 | 571 | 6,443 | Four null LOST rows; off-position/negative-yard limitations; no complete season cache |
| NFL 2026 | 2,745 | 552 | 2,750 | Current gaps and five retained corrections |
| NFL 2024 | 0 | 0 | 0 | Fresh Mahomes source has 16 regular games and GP=16: acquisition/storage gap, not universal provider absence |

There are no other seasons in these observation tables. NBA old aggregate table: 582 rows, **only 2025–26**, all `games_played=null`, updated May 2. NFL old aggregate table: 541 rows, **only 2025**, numeric GP, updated August 10. Neither supplies independent current-season GP. Old aggregate availability cannot certify the current caches.

Legacy forecasts still occupy 366 NBA projection-cache rows and 1,600 NFL projection-cache versions/view rows. Latest sampled NBA generation is October 28; NFL September 17. They must remain separate from actual statistics.

## C. Source/scoring validation and root causes

### Representative source checks

| Player | Stored current games | Fresh source log / independent GP | Result |
| --- | ---: | ---: | --- |
| Stephen Curry, NBA local 4 / ESPN 3975 | 5 | 6 / 6 | Missing event `401909919`, November 3 03:00 UTC. Existing five-game FP/game 41.16; fresh six-game default-rule FP/game **42.75**. No values were published. |
| LeBron James, NBA local 6 / ESPN 1966 | 3 | 6 / 6 | Three missing events. Current native/ESPN rosters both identify PHI, while stored catalog says LAL: stale team metadata, not proof of a wrong athlete mapping. |
| Cooper Flagg, NBA local 165 / ESPN 5041939 | 3 | 6 / 6 | Three missing events; exact existing ID/source context retained. |
| Patrick Mahomes, NFL local 435 / ESPN 3139477 | 6 | 7 / 7 | Missing Week 8 event `401873033`. Raw QB log omits LOST and receiving inputs; status is unknown until independent summary/scoreboard validation. |
| Tyler Allgeier, NFL local 1 / ESPN 4373626 | 7 | 8 / 8 | Missing Week 8 event `401873024`; raw log explicitly retains LOST=0. Historical September 27 rushing `-1` is null in the research store. |
| Montorie Foster Jr., NFL local 794 / ESPN 4600597 | 1 | 2 / 2 | Week 1 row has an entirely unknown line and participation; current log retains unknown participation for that row. Summary zero evidence does not itself prove a played offensive appearance. Keep FP unavailable. |
| Jake Elliott, NFL local 2401 / ESPN 3050478 | 0 | 8 / 8 | Real kicker log/stat data exists. Absence from research observations is scope, not provider absence. K fantasy scoring remains explicitly unsupported. |

Exact source URLs/hashes, missing IDs and values are in the evidence JSON. These samples validate mechanisms and specific gaps; they do not certify every player's game count or every source value.

### Canonical fantasy scoring verified

`lib/rules/leagueRules.ts` is the resolver. NBA default scoring is PTS 1, REB 1.2, AST 1.5, STL 2, BLK 2, TO −1. NFL offensive defaults are pass yards .04, pass TD 4, INT −2, rush yards .1, rush TD 6, receive yards .1, receive TD 6, reception 1, LOST −2. Player Center calls the canonical correction scorer after rejecting missing/nonfinite inputs; D/ST uses the existing canonical D/ST scorer. K returns unavailable.

The five Curry lines produce 28.9, 32.4, 33.1, 64.6, 46.8 FP: total 205.8 / 5 = **41.16**. The fresh sixth line produces 50.7. No projection or missing-to-zero fill was used.

Fresh final-event summary validation also reproduces:

- Mahomes event `401872945`: exact KC team LOST=0 establishes individual zero, receiving zero comes from reconciled category evidence, and the complete default-rule line scores **28.98**.
- Allgeier event `401872991`: the explicit athlete-log LOST=0 survives missing summary athlete evidence; reconciled passing absence supplies the other needed facts. The complete default-rule line scores **3.6**.
- The same Mahomes summary supplies finite KC D/ST inputs: sacks 0, INT 1, FR 0, safety 0, TD 0, PA 30, YA 329. This illustrates the separate team-summary path, not full D/ST pool certification.

Existing slate snapshots remain the scoring authority for existing slates. Current league settings apply in the no-slate Group context; the intentional legacy default fallback remains intact. No Group settings, snapshots, scoring coefficients or saved results were changed.

### Confirmed root causes

1. **NBA catalog drift precedes mapping coverage.** The active catalog is neither the current native roster nor a verified historical universe. There are 76 entirely missing current native players and six currently rostered inactive entries, alongside 89 catalog-active absences and 112 outdated teams. Merely applying the old 163-player identity plan cannot establish a full current pool.
2. **NBA current acquisition is stopped; publication is only a canary.** Legacy workflow disablement is intentional. There is no activated replacement. The old run supplies 893 of the current-season observations; the October 31 Curry publication adds two. Forty-nine completed events now have no observations.
3. **NBA historical phase parsing is incorrect.** `phase()` accepts any display name containing `Regular Season`. ESPN labels Curry's two 2026 play-in games `2025-26 Play In Regular Season`; they are stored as regular. His parsed/stored regular count is 45 against independent regular GP=43. Events `401866756` and `401866759` are confirmed examples. Do not claim all historical regular rows are season-complete. The full event contamination count was not established; no assumption about other competition types was made.
4. **NFL whole-run failure on an omitted summary group.** Remote `normalizeEspnNflEventFumbles` throws when no fumbles group exists. The scheduled worker acquires all inputs before persistence; this failure can prevent every new observation from being posted. The actual October 28 run failed here. All 14 completed Week 8 events are absent today.
5. **NFL zero-evidence behavior differs by code path.** Remote acquisition makes an absent QB zero after accepting any structurally valid fumble response, without team-total reconciliation. Local E3A research code is safer: omitted groups are unknown, and absence zero requires reconciled team category totals; unknown QBs are withheld and reported non-green. It still does not use all independent team-zero evidence supported by the Player Center parser. In fresh `401872945`, research normalization has no zero-eligible teams while Player Center verifies team LOST=0. A deployment of E3A alone does not make both contracts equivalent.
6. **NFL research normalization loses legitimate negative yards.** The research log parser accepts only nonnegative numbers; foundation validation and SQL checks likewise require every stat ≥0. Allgeier event `401872958` explicitly has rushing yards `-1`, two carries. Stored version/current row 7563 has null rushing yards. Player Center's separate signed-yard parser preserves `-1`. A worker retry cannot repair this contract; changing only the parser would encounter the remaining validator/schema restrictions.
7. **NFL role-specific research fields are insufficient for full FP.** QB receiving and skill-position passing are intentionally null. Player Center needs evidence for the complete canonical offensive line, including unusual cross-position plays. Off-position nulls must not be converted to zeros by position assumptions.
8. **Some NFL nulls are genuinely unknown evidence.** The 21 current missing-LOST rows are wholly missing scoring lines, not isolated fumbles-column failures. The Foster example remains participation-unknown despite a final team's verified LOST=0. GP, category absence and actual participation need distinct handling; a bye/DNP cannot be invented to close a gap.
9. **K/DST and historical NFL coverage require their own paths.** The research store excludes both positions. K source facts and D/ST source facts exist, but there are no durable caches. NFL 2024 is available for a sampled player at ESPN but not populated locally.
10. **Observation timestamps are not refresh-success timestamps.** NBA semantic dedup intentionally retains first availability when facts are unchanged; NFL hashes likewise ignore acquisition times. Old per-game fetch dates alone cannot prove an unhealthy poll or a fresh poll. Explicit cohort/player verification receipts are needed.

## D. Integrity and storage findings

### NBA installed repair verified without mutation

| Check | Result |
| --- | --- |
| Installed normalized append fingerprint | **`9308a04b52fecc6993b7730490cf686a`**, exact expected match |
| Light schema health | **true** before and after |
| Immutable versions | **69,667** |
| Current rows / unique player-event keys | **35,281** |
| History watermark | **1,503,098**; this is an ID, not row count |
| Full E3A paginated integrity | **passed**, 142 pages |
| Current/reference/payload errors | **0** |
| Two complete current scans | Identical checksum |
| Closing catalog/history/current/cache counts and NBA watermark | Unchanged |

Current checksum: `paged-v1:sha256:86b4d7206991ddc7c4ff0c9af98cd700f7f1d965d13b37c260fe264d1c8904a9`.

Integrity receipt: `0d5bd9b8eb2b998dee5c6438188cf1746d9998358bcd6abfabfcd8ed719f28e1`.

The verifier read every immutable version, selected latest per provider/player/event by fetch instant then ID, compared all current columns and exact numeric text, checked missing/duplicate keys, then repeated current scanning and count/watermark anchoring. It did not sample. The legacy full SQL health branch was not invoked.

Light health confirms the expected append function's fingerprint/security-definer state, the two expected enabled history triggers, valid/ready indexes, validated constraints, RLS on history/current and the restrictive current→version FK. Together with complete data comparison this verifies the installed repair/current integrity at audit time. It does not prove correctness of every acquired sports fact or classification.

No UPDATE/DELETE attempt was made against immutable tables. The exact installed rejection-trigger bodies, all grants, NFL trigger state, publication function body, and scheduler catalogs could not be independently extracted using the available REST access. The checked-in SQL defines the expected contracts; live light health covers the NBA structural subset above. REST OpenAPI listing DML verbs is not proof that those privileges are granted. Owner-level catalog verification remains an evidence gap, not a reason to try a write.

### Retained history and growth

NBA currently has exactly **895 single-version keys and 34,386 two-version keys**. Across all retained versions, adjacent game-fact comparisons found 34,386 identical-fact transitions and zero changed-fact transitions; this compares stored identity/context/minutes/six scoring statistics, not all provenance/availability evidence.

The historical duplicate fact values are retained boundary evidence after prior repairs. There are **no keys with more than two retained versions**, hence no interior repeats under the documented preserve-first-and-last-of-run cleanup strategy. They are not a newly authorized cleanup target.

| Version creation date | NBA rows | NFL rows |
| --- | ---: | ---: |
| September 16 | 34,386 | 0 |
| September 17 | 0 | 6,845 |
| September 22 / 23 | 0 | 421 / 3 |
| September 29 / 30 | 0 | 423 / 2 |
| October 6 / 13 / 20 | 0 | 414 / 379 / 354 |
| October 27 | 34,386 | 352 |
| October 28 | 893 | 0 |
| October 31 | **2** | 0 |

The October 31 history count matches the Curry status receipt's two appends. No history rows have creation dates November 1–3, and no NBA/NFL version growth occurred during the measured audit interval. This supports bounded current behavior; it is not a two-cycle unchanged-poll execution test. Such a write test was prohibited.

NFL has **9,193 versions / 9,188 current keys**. Local comparison of every version/current row found no latest-payload mismatch. The five additional versions are real receiving-target corrections for Dallas Goedert, D'Andre Swift, Brian Thomas Jr., Chris Bell and Brock Bowers. Exact correction receipts are in the evidence JSON. No current duplicate keys or catalog binding errors were found.

### Measured capacity

| Quantity | Bytes | Interpretation |
| --- | ---: | --- |
| Initial database size | 254,389,395 | About 254.39 MB decimal / 242.60 MiB |
| Closing database size | **254,413,971** | +24,576 bytes while independent background activity continued; observation counts stayed fixed |
| NBA history total relation size | **42,467,328** | 40.5 MiB, including relation/index allocation |
| Combined Player Center cache/status allocation | **65,536** | One cache and one status row |
| WAL directory size | **134,218,198** | Separate from database size; not a measured WAL generation rate |
| Available `/data` disk | **1,477,849,088** | About 1,409 MiB at the fresh storage receipt |

Fresh privileged metrics agreed with SQL health on database/WAL size; the existing zero-payload storage guard passed. Existing guard thresholds are 400 MB database warning, 450 MB stop, 64 MiB combined cache/status, 256 MiB free reserve plus WAL allowance. Closing headroom to the 450 MB stop is about **195.59 MB**, before publication budgets and unrelated application growth.

NFL relation/index size, current-table size, table bloat/dead tuples, individual index allocation and a longitudinal WAL rate were not exposed by the installed read-only health API. This audit does not invent those values or extrapolate a whole-database daily trend from a few minutes.

### Remaining integrity/storage risks

- **NFL A→B→A correction reversal:** the fact-only hash and lifetime unique key avoid timestamp churn, but an old A hash already exists. The existing-hash lookup/upsert suppresses its return, leaving B as latest. This is a code-path risk; the five observed corrections did not demonstrate a reversal. A chronological semantic append design is needed before trusting this store for arbitrary correction history. The reliable direct-source cache path can be evaluated separately.
- **NBA direct INSERT paths:** service-role insert capability is defined by the original foundation; direct manual imports do not participate in RPC advisory locking/semantic comparison. Old guarded manual batches and external writers need inventory before any approved import. The normal local shared writer uses the repaired RPC; no unsafe fallback should be introduced.
- **Out-of-order NBA backfills:** the repaired RPC conservatively retains earlier acquisitions. Full archived replays can add availability evidence and do not have the semantics of an ordinary current poll. Handle them separately; preserve the installed fingerprint.
- **Old remote generation/ingest paths:** disabled NBA schedule does not remove old remote machine endpoints or the active manual NFL generator. Retirement needs an explicit coordinated release.
- **Cache rewrites:** NBA publication reuses unchanged game JSON/TOAST when only verification metadata changes. Current NFL cache SQL rewrites the complete game payload; repeating it at scale could cause avoidable TOAST/dead-tuple/WAL churn. It is not an unattended refresh design.
- **Growth in validation work:** full NBA integrity is bounded today but reads the whole history and two current copies. More seasons/corrections increase transfer, runtime and cap pressure. Do not bypass failed caps or certify a subset.
- **Misleading freshness:** advancing success merely because a worker started, counting accepted inputs as appended rows, or stamping caches without independently verified coverage would be incorrect. Preserve old evidence timestamps; use explicit verified receipts.

## E. Components to reuse

1. **The installed NBA repair and verifier.** Keep the exact repaired append body, fingerprint, immutable triggers and current synchronization. Reuse `nbaIntegrity.ts`, `nbaRefreshRepository.server.ts` and `refreshStorage.ts`; never reinstall historical repair/cleanup scripts as part of Player Center enablement.
2. **NBA factual classifier/runner.** `buildNbaRefreshPublication` distinguishes verified data, verified zero appearances, incomplete coverage, failed acquisition and blocked identity. `run-nba-player-center-refresh.cjs` already has paced GETs, a 25% retry allowance, bounded payloads, common cutoff, circuit breaker, five-player batches, checkpoints, exact resume/replay and receipt reconciliation.
3. **NBA atomic publication.** The reviewed SQL locks catalog/mappings, serializes publication, checks stale/conflicting runs and changed replay payloads, binds facts/cache/status, appends through the semantic RPC, and records receipts transactionally. Reuse the installed mechanism after rechecking its exact live definition/privileges; no publication was tested during this audit.
4. **E3A canary transport.** `player-center-canary.cjs` and `playerCenterCanaryTransport.cjs` pin the Supabase origin, separate GET/HEAD preparation/preflight from explicit NBA publication, bind exact identities/before images/tool hashes/approval tokens, enforce bundle expiry and storage budgets, and refuse report overwrite. One–three-player limits are useful for controlled validation, not full-pool scale.
5. **NFL raw-source enrichment and batch builder.** Reuse `normalizeCenterLog`, `normalizeCenterNflSummary`, `enrichNflGame`, `normalizeCenterNflSchedule`, `buildNflBatch`, durable-cache validation and existing owner-reviewed SQL guards. Preserve explicit log values, reject conflicts, and use only evidence-backed absence zeros. The small canary's three bounded reader passes and shared summaries are useful patterns; they are not a durable whole-cohort job.
6. **Identity-review helpers.** Reuse exact native IDs, locked/evidenced ESPN crosswalks, unique name/team corroboration and manual review categories. Refresh evidence and manifests; do not apply the old dated 98/110 targets.
7. **Read/scoring contracts.** Keep `durableCache.ts`, canonical `resolveLeagueRules`, missing-input rejection, frozen-snapshot authorization, per-metric samples, missing-last ordering and the whole-relevant-pool comparison gate.
8. **Independent scoring-worker patterns.** Reuse the design lessons of leases, backoff, budget stopping and structured run receipts from NBA/NFL live scoring without changing their Group/slate scope or notification behavior.
9. **Existing tests/fixtures.** Relevant suites already cover semantic versioning, correction reversals, identity checks, publication atomicity, numeric integrity, fumbles evidence, canary guards, cache decoding, and Group/slate context. Add focused signed-yard/phase/whole-cohort resume tests in an implementation phase; no production test writes or new tests were needed for this report.

## F. Prioritized, independently verifiable implementation plan

These are proposals only. No phase below was implemented or activated.

| Phase | Small deliverable | Independent acceptance evidence |
| --- | --- | --- |
| **0. Freeze scope and operational baseline** | Select the coordinated release candidate; reconcile remote/local deltas and deployed definitions; preserve existing database repair; explicitly retire the old NFL generator and keep old NBA disabled | Exact source/commit manifest; read-only function/grant/trigger/scheduler receipts; no unexpected writers; same append fingerprint and full integrity success |
| **1A. NBA catalog reconciliation** | Review 82 missing current-roster entries, 89 catalog-active absences and 112 stale teams without deleting history or silently changing the comparison universe | Before/after manifest with stable local/native IDs; no orphaned historical references; approved active-pool definition; Group/draft behavior verified |
| **1B. NBA identities** | Review current 101 corroborated unmapped candidates, suffix case, other absences and 29 existing evidence gaps in small exact batches | Fresh two-source evidence per mapping; no duplicate/overwritten claims; exact independently measured resolved denominator; rollback/invalidation plan |
| **2A. NBA historical phase** | Distinguish play-in/other competition labels from regular season in source normalization and cache coverage | Curry 2026 regular GP/log both 43; play-in events excluded from regular windows; no mutation/deletion of immutable history; focused phase fixtures |
| **2B. NFL acquisition evidence** | Review/deploy omission-tolerant acquisition and align evidence-backed team-zero behavior across intended paths | Missing group stays unknown, no whole-cohort abort for merely absent evidence; positive/zero/conflicting LOST cases; explicit non-green incomplete outcomes; Mahomes/Allgeier real cases pass |
| **2C. NFL signed yards and correction identity** | Choose whether the research store will become a complete factual source. If so, separately review signed-yard parser/validator/SQL changes and chronological correction handling | `-1` survives every approved storage layer; identical poll adds zero; A→B→A appends two transitions; old versions retained; current/latest integrity passes |
| **3A. NBA accepted current cohort** | Use repaired runner/publisher for bounded current-season cohorts after catalog/identity fixes; define a stable final-game cutoff | Per-player independent GP, exact event set, six scoring inputs and metadata; all outcomes classified; current/full integrity before/after; actual append delta equals receipts |
| **3B. NFL publication capability** | Build/review a bounded checkpointed full-cohort raw-cache orchestrator and narrowly scoped publisher, or explicitly limit rollout to manually reviewed cohorts | Resume without reacquisition or stale overwrite; common cutoff; persistent before/after receipts; summary sharing; storage guards; no service-role unrestricted cache DML |
| **4. NFL accepted current cohort** | Populate offensive, K raw facts and D/ST paths under the approved product scope; distinguish DNP/bye/zero/unknown | Every relevant player's GP/logs and per-metric inputs reconciled; signed yards retained; no invented zeros; canonical FP finite only where supported; unsupported K FP explicitly unavailable |
| **5. Historical defaults** | Populate/reconcile NBA 2026/2025 and NFL 2025/2024 only after current-season and phase acceptance | Each offered season has its own measured identity, GP, metric and cache coverage; no silent fallback to another professional season; seven-day verification freshness |
| **6. Automation and load acceptance** | Add incremental processing, serialized writes, retry/failure receipts and monitoring; run bounded acceptance cycles before activating schedules | Two accepted cycles with stable no-change version counts; corrected/new-event tests; pause/resume/ambiguous-ack tests; forecast paths inert; API latency/transfer/runtime budgets measured at full cohort |
| **7. Coordinated enabled production release** | Seed accepted facts through reviewed installed/operator tooling, complete real authenticated Group/slate/mobile acceptance, then publish the enabled feature | Sport-specific gates below pass; approved release SHA/settings; Group switch and frozen snapshot tests; freshness/coverage display correct; explicit release authorization |

Phases 1A/1B need product/owner review; there is no authority in this audit to shrink eligibility to make `canSort` pass. NFL research-schema work in 2C is required if that store is relied on for complete signed-yard/correction history. A separately validated raw-source/cache-only approach could avoid making it a prerequisite for initial profile reads, but must not advertise the research fallback as complete.

### Automation readiness and proposed cadence

- **Acquisition outside request-time Vercel functions:** GitHub Actions is suitable for cohort acquisition and checkpoints. Vercel can authorize bounded publication/health/receipt requests, as the NBA design already separates them. Exact host plan/function limits and matching job secrets must be verified for the selected release; no settings were changed.
- **NBA:** target a current-season verification opportunity every six hours, plus post-final catch-up. At today's 530-player catalog this is at least 1,060 source GETs per full log+GP sweep. Start with an accepted stable cycle; then use completed-event/correction windows and dirty-player queues to avoid unnecessary full histories. Keep periodic full reconciliation.
- **NFL:** replace the Tuesday/Wednesday-only freshness assumption with post-final game processing, including Thursday and Sunday/Monday, and an off-peak daily reconciliation. A six-hour freshness check/retry opportunity is reasonable; it should not blindly re-fetch all 961 offensive histories four times daily. Fetch each changed final event once, fan facts out by exact athlete/team ID, and periodically verify the complete roster/GP baseline.
- **Live games/common cutoff:** the current classifiers reject unverified/live or after-cutoff evidence. A schedule must explicitly handle this. Defer certification/publication while applicable live games prevent a stable complete cohort, or design/review a final-game cutoff policy. Do not repeatedly replace a usable final snapshot with incomplete live data and then call the run successful.
- **Incremental correctness:** establish a certified baseline, enumerate newly final events, retain a correction lookback, revalidate identities and any roster changes, update affected histories, then certify a common cutoff for the relevant pool. Unchanged players may advance only with genuine schedule/coverage evidence; a changed timestamp is not verification.
- **Retries:** bound concurrency, response bytes and total requests/time; back off on 429/5xx/timeouts, honor provider retry hints, use a circuit breaker and persist failures by player/event. NBA currently retries once with fixed backoff; NFL's old worker has no comparable durable retry/checkpoint protocol. A malformed/conflicting fact must be quarantined, not retried into zero.
- **Ambiguous acknowledgement:** reconcile exact committed receipts. Retry only the identical approved UUID/payload where allowed. Do not reacquire/change a publication after a lost response or replay over a newer run. Store the original acquisition/cutoff/tool hash and before images outside database history.
- **Freshness monitoring:** keep the existing current-cache 24-hour and historical-cache seven-day expiry until intentionally changed. Alert before expiry, e.g. 18 hours/five days, plus immediately on integrity failure, identity drift, unclassified omissions, non-clean acquisition and storage warning. Include denominator, verified count, missing events/fields, outcome arrays and last complete success; a green zero-work scoring job is not a factual success receipt.
- **Historical refresh:** after phase and population acceptance, twice-weekly reconciliation stays inside seven-day freshness; daily during a defined post-season correction window. Older unsupported deep links may remain clearly unavailable.
- **Supabase:** existing health/publisher functions, state tables and leases provide reusable mechanisms. Any new publisher/state schema, grant, `pg_cron` registration or `pg_net` caller needs reviewed installation/authorization. Existing five-minute Fantasy/Skins work must remain separate; no NCAA/Skins draft or game notifications are introduced.

## Release readiness gates

### NBA

Hard blockers for the requested full-pool claim:

1. Approve/reconcile the actual professional pool against catalog membership, including the 82 current native players absent from active catalog. Resolve or explicitly account for every relevant identity; current 367/530 resolution is insufficient, and 29 existing mappings need current evidence review.
2. Populate complete current raw caches for **100% of the approved relevant pool**, including independently verified GP=0 where applicable. Reconcile every observed event, canonical stat and independent GP at one common cutoff. No unresolved player may disappear from the denominator.
3. Zero missing eligible completed events/appearances at that cutoff, zero identity conflicts, zero unexplained null scoring fields, and zero integrity/reference errors. Known short samples stay visible and are handled explicitly.
4. Current verification/cutoff age ≤24 hours, with an accepted recurring path and tested failure detection before activation. Today the only cache is stale and no player has fresh durable certification.
5. Fix/certify historical phase before offering historical seasons as complete. Curry's regular 45 versus GP43 is a reproducible failing gate.
6. Preserve the installed fingerprint and immutability, pass full bounded integrity, compare real append deltas to receipts, and satisfy storage/runtime budgets without bypasses.

Acceptable partial behavior, **only with an explicit product decision**, includes clearly labeled profile facts, individual unavailable players, unknown GP/metrics, stale snapshots and unsupported seasons. It must not be presented as certified full-pool rankings. The existing comparison gate should remain closed for incomplete relevant pools.

### NFL

Hard blockers for the requested full-pool claim:

1. Define/review the real eligible catalog, including roster/position lifecycle; 1,031 active numeric IDs are not independent proof of the professional pool. Certify all selected direct IDs and all 32 synthetic defenses. Do not silently exclude the 409 unobserved offensive players.
2. Recover current final-event coverage, including all 14 missing Week 8 events, and stop an omitted fumbles group from killing the entire acquisition run. Prove every LOST zero/positive value with valid evidence; URL presence alone is insufficient.
3. Preserve signed yards and obtain affirmative off-position evidence. For each supported offensive appearance, all nine canonical FP inputs must be known; all seven D/ST inputs must be known. Unknown values remain null/FP unavailable.
4. Provide a reviewed full-cohort cache publisher/orchestrator and fresh complete cache coverage for **100% of the approved metric-relevant pool** at one cutoff. Today NFL has zero cache rows. Accepted complete cycles must resume safely and not inflate unchanged history.
5. Make an explicit K product decision: raw kicker statistics can be supported, but K fantasy scoring is currently unavailable. K must never be assigned invented FP or silently described as FP-complete. Existing `fantasy_points` relevance excludes K; disclose that scope while requiring full K raw-stat coverage for a full-statistics claim.
6. Reconcile DNP/bye/unknown participation and independent GP; the 21 entirely unknown lines cannot be certified with team-zero LOST alone. Validate cross-category plays and negative yards in real examples.
7. If relying on research version history, fix/test correction reversal semantics and signed-yard storage. If using direct-source caches instead, certify their values independently and explicitly retain the observation fallback's limitations.
8. Current age ≤24 hours and historical verification ≤seven days; accepted correction/retry/failure cycles and live-game cutoff policy; no revival of the old forecast generator.

Shared release gates: authenticated multi-Group context, sport enablement, frozen-slate scoring, Group switching, draft context, real desktop/mobile flows, bounded full-pool endpoint latency, freshness disclosure, monitored operations, and reviewed release/rollback receipts. Prior local Chrome UI success is valuable but does not satisfy these factual/production gates.

## G. Operations requiring separate authorization

This report is not authorization for any of the following:

1. **Catalog or mapping writes:** roster sync (including the mutating NFL GET alias), player activation/deactivation/insertion, team/position/native-ID changes, application of new identity manifests, or correction/invalidation of existing claims.
2. **Database changes:** NFL signed-yard constraints, any NFL append/publication RPC or state/lease schema, new grants, trigger/view/function replacement, migrations or changes to the NBA repaired function. Do not rerun installed repair/cache installers from old documents.
3. **Factual write operations:** ingestion/refresh workers, observation backfills, current or historical cache population, NBA bundle publication, NFL cache SQL apply, or retry/replay of a prior publication. Scope, targets, cutoff, exact bundle/token and storage receipts must be reviewed first.
4. **Automation/service changes:** activating the replacement NBA workflow, changing NFL schedules, disabling/retiring the old NFL generator, modifying GitHub/Vercel secrets, registering Supabase cron/net jobs, or configuring notifications/monitoring destinations. The old NBA workflow remains disabled throughout this audit.
5. **Production release:** commit/push, PR merge, branch synchronization, Vercel deployment/promotion, feature-flag changes or public Player Center activation. This audit did none of them.
6. **Rollback or cleanup:** cache withdrawal, mapping rollback, deleting historical versions or any other data, disabling immutable triggers, VACUUM FULL/reindex/storage maintenance, or restoration of an old writer. Preservation/backup and exact target receipts require their own review. No cleanup is recommended for the retained two-boundary NBA histories based on this audit.

Additional owner-level **read-only** catalog/scheduler inspection would close the noted evidence gaps; it is not a repair or mutation. It was unavailable through the connected read path. No permission request is needed to finish this report, and no subsequent operation is being started.

## H. Growth, API usage, and capacity estimates

### Measured evidence

- NBA history uses about **610 allocated bytes per retained version** (42,467,328 / 69,667). This is a relation-wide ratio, not a guaranteed marginal insertion cost; allocation, index utilization and prior maintenance affect it.
- Curry's raw cache JSON is **5,306 bytes**, including five games. Games average approximately **668 bytes each**, with 1,968 bytes of non-game metadata/season tables in that sample.
- Full NBA integrity alone transferred **146,980,995 decoded bytes** across 142 pages, with about **40.4 seconds summed request time**, plus local processing/anchor work. The broader catalog/NFL/NBA data read used 177 requests and about 168.8 MB decoded. Running full pre/post checks at current size costs roughly 294 MB of integrity transfer per factual cycle before acquisition/cache reads.
- Eighty bounded provider GETs were made for source validation, roster evidence, historical samples, schedule checks and four exploratory requests. Three exploratory broad date-range scoreboard reads failed with HTTP 400; they supplied no coverage claims. No full-pool acquisition worker was executed. The principal recorded provider ledgers total about 9.14 MB, excluding the four historical responses and two exploratory probe response bodies.
- No factual history growth occurred across the audit. NFL previous weekly new-version increments were 414, 379, 354 and 352 for October 6/13/20/27; this is historical observed workload, not a reliable forecast for new normalized coverage.

### Transparent planning scenarios

| Scenario | Estimated source requests / storage | Limits of estimate |
| --- | --- | --- |
| NBA one current-season log+GP sweep, mapped cohort | 367 × 2 = **734 GETs**; current runner cap **918** including 25% retry allowance | 163 blocked identities remain. No complete-pool claim. |
| NBA one current-season sweep, present 530-player catalog | **1,060 GETs**, cap **1,325** | At 1.5-second pacing, minimum start spacing about 26.5 minutes, or 33.1 minutes at cap, before slow/retry/publication overhead; must prove fit within 40-minute runner/45-minute job. Reconciled catalog size may differ. |
| NBA naive six-hour full sweeps | **4,240 base GETs/day**, up to 5,300 at retry cap | Motivation for incremental final-event/dirty-player work, not a recommended unmeasured production load. |
| NBA current + two historical sweeps of that same catalog | **3,180 base GETs** | Separate bounded jobs; not one current job. Historical phase must be corrected first. |
| Existing NFL research worker today | 961 offensive logs + 18 weekly scoreboards + up to 121 final-event QB summaries = about **1,100 GETs/run** | All logs re-fetched; summary requests shared by event. Full regular season could reach **1,251** (272 summaries). Failures/retries not included. |
| NFL offensive current-cache acquisition with season GP | 961 × 2 + 121 shared summaries + optional 18 scoreboards = **2,043–2,061 GETs** | Assumes effective cross-player event-summary sharing. No full-cohort implementation/performance guarantee. |
| NFL including K/DST current facts | 999 athlete log+stats pairs + 32 team schedules + 121 summaries, plus optional 18 scoreboards = **2,151–2,169 GETs** | K fantasy remains unavailable; D/ST no extra athlete-stat call. Provider omissions/conflicts may require retries or remain unknown. |
| Naive NFL six-hour full-cache sweeps | About **8,604–8,676 base GETs/day** | Avoid this as the initial default. Event-first acquisition plus bounded reconciliation should be measured instead. |
| NBA full season raw cache, extrapolating Curry's current shape | 530 × (82 × 667.6 + 1,968) ≈ **30.06 MB JSON**; three such seasons ≈ **90.17 MB** | Scenario where each player has 82 games; actual appearances vary. Physical JSONB/TOAST/index size differs; richer season tables or issues may grow metadata. The 64-MiB combined cache/status cap needs a real full-season measurement. |
| NBA new appearance-version storage | A rough 25,000–43,460 new appearances × 610 ≈ **15.2–26.5 MB/season** in the version relation | Lower figure is illustrative workload; upper figure is 530 × 82. Add current-table storage, caches, indexes, corrections and other application growth; not a total-database estimate. |

An unchanged chronological NBA acquisition should append **zero** versions. New appearances, real fact/identity changes, and changed availability evidence can legitimately append. A cache's `checked_at` may advance without advancing retained observation timestamps. NFL unchanged fact hashes likewise avoid normal timestamp churn, but reversal and negative-yard defects must be addressed before relying on that history contract.

No defensible physical NFL bytes-per-row, WAL-per-cycle, fleet-wide provider quota, paid API cost, database retention forecast, or Vercel billing/runtime guarantee is available from these reads. Those require production receipts from separately authorized bounded cycles. ESPN endpoints have no SLA/quota contract established by this repository audit; enforce request budgets and verify operating behavior rather than assuming unlimited access.

## Remaining evidence gaps and stop condition

Not certified: full NFL current roster accuracy; all individual player-game gaps; all historical NBA phase errors; every QB fumble-zero proof; all installed privilege/trigger/function definitions beyond the NBA health subset; exact Supabase/Vercel schedule registration and deployed release/feature settings; full-pool API performance and future marginal storage/WAL usage. These gaps are explicit acceptance work, not inferred successful checks.

**Audit complete. Stop here. No repairs, mappings, acquisitions through workers, data publication, automation changes, or release operations were performed.**
