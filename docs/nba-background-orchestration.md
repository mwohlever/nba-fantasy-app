# NBA background audit, decision and rollout

Audited clean `main` at `c29ad24` before any edits. Implementation branch: `feature/nba-background-orchestration`. No other worktree/install was created. The completed Bracket, NFL, Golf, NCAAF results and NCAAF reminders implementations, migrations and cron endpoints are unchanged. Only the Skins part of the shared app-heartbeat route changed.

## Decision: A — one NBA orchestrator, independently leased consumers

One `GET /api/cron/refresh-nba` invocation shares a typed provider instance and runs separate Fantasy and Skins lanes. Each lane has its own discovery error handling, work allocation, claims, retries and result records. There is one external job to configure after review/deployment.

**There is no common scoring payload between the two games today.** Fantasy scores NBA.com player box scores; Skins scores ESPN regular-season standings and uses ESPN BPI for projected values. Sharing individual games/box scores *between these games* would replace Skins' season-record authority and require new game history, regular-season filters and ESPN/NBA identity mappings. That is unnecessary and is not implemented.

Architecture A supports the actual overlap: one NBA.com schedule/game payload across Fantasy slates/Groups, and one ESPN standings/BPI payload per starting season across Skins Groups in the same invocation. B would add a persisted provider handoff with no current cross-game consumer benefit; C would require separate scheduling without reducing provider requests. This selection does not claim that a common NBA box score can currently score both games.

Inputs are explicit typed, frozen objects/arrays, including nested player stat objects. They carry provider identity, NBA game ID/code, teams, raw status text, period/clock, ESPN ending-year identity and BPI source. Consumers only read them. Promises (including rejected promises) are memoized by exact payload identity within an invocation; nothing refetches a failed payload for another Group in that invocation. No persistent provider cache or replacement game storage is added.

## Before: NBA Fantasy

- `/api/slates` discovers a Group/league's slates, snapshots canonical rules, saves slate-specific participants and normally pins selected games from NBA.com's full season schedule in `slate_nba_games`. Older discovery/attach/admin/player-sync paths also use the NBA.com today scoreboard. Pinned game lists are the refresh authority.
- `/api/refresh-stats` authorizes the target slate (including the existing internal `GOLF_CRON_SECRET` path), rejects locked slates, loads that slate's lineups and local `players.nba_player_id`, and reads frozen snapshot scoring with canonical defaults for legacy snapshots. It fetches each pinned box score independently for every request/slate. Without pins it requests the same *today* scoreboard once per slate date; that feed does not supply arbitrary historical dates.
- Player points/rebounds/assists/steals/blocks/turnovers are aggregated into `player_slate_stats`; lineup totals and ordinal finish positions go into `team_slate_results`. Standings count locked slates from the active league; Home/Scores/profile/history read saved results. Availability comes from the selected slate's saved team codes and player catalog, not a separate result feed.
- Before this work, pinned/single-day totals were rebuilt. Unpinned multi-day totals started with saved aggregates, then added the currently returned games again: repeated requests could double count. A missing box score prevented finalization but did not prevent partial stats/totals being saved. A failed single-day scoreboard could result in zero totals being saved.
- Finalization required a nonempty discovered game list, every game final (`gameStatus=3`), and the slate end day passed. The original server-local `T23:59:59` gate is retained; its explicit timestamp is passed by the trusted server to SQL, avoiding a different database time-zone interpretation. A multi-day slate cannot lock after just its first day's games.
- There is no separate accepted NBA event/revision ledger. Locking freezes provider refresh. Commissioner stat/lineup correction and backfill/recompute routes remain separate and unchanged; they can maintain historical locked results. There was no automatic post-lock correction window, and none is added.
- Player-finished and slate-complete notifications use unchanged `player_finished:<slate>:<player>` and `slate_complete:<slate>:<team>` event keys. Recipients/settings are league/Group aware. `sendLoggedNotification` inserts the unique history event before push; duplicate-key results skip delivery. Existing failed/pending event keys are not a guaranteed push-redelivery system.
- Home pull/button refresh calls the POST route; Home also has a next-slate tip-time timer. Scores/lineup refresh calls the same route, with an optional visible-page 30-second poll and per-tab in-flight guard. The global heartbeat does not refresh Fantasy. Separate NBA Live Scores UI polls ESPN scoreboard every 30 seconds and game-detail summary every 15 seconds during live action; these display feeds do not write Fantasy scores.
- No dedicated NBA scoring cron, durable worker lease/history/retry or cross-request provider memoization existed. Two users or a browser/cron request could fetch and write concurrently; ordinary upsert uniqueness did not fence stale writes.

## Before: NBA Skins

- Independent `nba_skins_seasons`, frozen `participant_count`/`nba_teams_per_participant`, draft order, picks, NBA-team metadata and season-specific team records. Seasons belong to a league; teams belong to a Group. Annual picks assign each participant an NBA team and `wins` or `losses`. Historical participant references remain intact; pre-2026 draft position is not newly inferred.
- **No individual-game schedule/score/result ingestion exists in the Skins refresh.** `fetchNbaSkinsSeasonRecords(startingYear)` fetches all 30 ESPN regular-season team win/loss totals using ESPN year `startingYear+1`. The legacy handler fetched BPI once too, upserted records/projections for every completely drafted non-final season in the globally newest qualifying year, updated NBA-team identity metadata, and set each pick's `final_points` to that team's wins or losses. All these writes were separate REST operations.
- BPI failure already allowed actual records/points to update and retained old projections. The handler treated the provider's missing-30-teams error as an expected preseason skip. Other failures returned 500. No durable retry state/history, lease, transactional batch or work bound existed.
- `/api/nba-skins/standings` scopes reads to the active league/season; current points are absolute totals, not increments. Home calculates accuracy as points/team-games played, games left against season capacity, pace from current accuracy, projected points from BPI, and possible points as current points + games left. **Existing Home math still hardcodes seven selections/574 team-games in some calculations despite configurable drafts.** That is a pre-existing display gap and is left unchanged.
- The cron never set `status=final`, `finalized_at` or a champion. `scripts/refresh-nba-skins-records.mjs --finalize=true` is the existing explicit finalization path, requiring all 30 teams to have 82 regular-season games. Its historical `.eq('season', ...).single()` lookup predates multiple same-year leagues; do not run it for multi-Group finalization without reviewing that ambiguity. No new automatic season finalization is introduced.
- The protected legacy `GET /api/cron/refresh-nba-skins` used **`GOLF_CRON_SECRET`**. `AppHeartbeat` called it on mount, visibility return and every five visible-browser minutes. The Skins page itself only loads stored standings. A callable cron route did not prove external scheduling existed: no tracked NBA schedule installation was found, and actual production `cron.job`/external dashboards were not queried.
- No Skins draft/game notification workflow exists, and none is added. Draft locking and season finality remain distinct. No player/slate fantasy identity is reused for Skins.

## Exact providers and overlap

| Purpose | Existing provider/endpoint | Consumer and reuse |
| --- | --- | --- |
| NBA full schedule | `https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json` | Fantasy slate creation; worker discovery/tip metadata, once per invocation |
| NBA today scoreboard | `https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json` | Legacy Fantasy fallback/admin/player sync. New provider can memoize it; the worker uses the full schedule instead of treating today as historical coverage |
| NBA scoring box | `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_<NBA game ID>.json` | Fantasy scorer, once per game per invocation across slates |
| ESPN NBA scoreboard | `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=YYYYMMDD&limit=100` | NBA Live Scores presentation only; not Fantasy/Skins scoring |
| ESPN NBA summary | `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=<ESPN event ID>` | NBA Game Center presentation only; ESPN IDs are not NBA CDN IDs |
| ESPN NBA standings | `https://site.api.espn.com/apis/v2/sports/basketball/nba/standings?season=<starting year+1>&seasontype=2` | `fetchNbaSkinsSeasonRecords`; once per year per invocation across Skins Groups |
| ESPN BPI | `https://www.espn.com/nba/bpi/_/view/projections/season/<starting year+1>` | `fetchNbaSkinsSeasonProjections`; once per due year per invocation |
| NBA player catalog | `https://stats.nba.com/stats/commonallplayers` | Separate administrative player synchronization, unchanged |
| ESPN athlete game logs | `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/<ID>/gamelog?season=<year>` | Separate projection observation ingestion/cache, unchanged; not accepted Fantasy scoring |

There were zero exact schedule/score/box-score endpoint overlaps between the two scoring paths. Duplicate traffic existed between Fantasy refreshes/slates and between browser heartbeat invocations. Skins already fetched standings/BPI once for its chosen year then fanned out to multiple Groups in that request. There is no existing shared game/box-score storage consumed by both games. Reused storage is `slate_nba_games`, the player catalog and existing Fantasy/Skins result tables. Global analytics observations/stat-line caches are historical projection inputs, not replacements for accepted live scoring. Projection ingestion's `NBA_PROJECTION_INGEST_SECRET` remains unrelated.

Read-only public ESPN probes confirmed response `season.year` and conference `standings.season/seasonType` identity (requested 2026/2027 returned their own year, regular-season type 2). The Skins parser now validates these identities, duplicates and missing stat values. NBA.com read-only probes returned HTTP errors in this environment; current live payload validation is a rollout dependency, not a claimed production proof.

## Implementation and safeguards

- `nba_sync_state` has explicit Fantasy slate or Skins season identity and league ownership, independent `(task,target_id)` keys, atomic claims, UUID fencing, five-minute recoverable leases, attempt/success/due times, consecutive failures, last error/summary and optional committed Fantasy notification input. RLS and grants restrict access/RPC execution to service role.
- Mutation RPCs lock the task state and target resource, recheck token/expiry, and write a complete batch transactionally. Fantasy rechecks the complete read set (rules, pinned IDs, roster/player metadata and previous stats) and Group/team identity before any writes. Skins rechecks frozen draft completion/current season and derives pick points inside the transaction from current picks; it rejects cross-Group participants and game-count regressions. Either transaction rolls back fully on failure.
- Fantasy reconstructs the full slate every time. Pinned lists remain authoritative, including historical pinned IDs absent from the current season schedule. A schedule failure can fall back to valid pins, but every required active/past pinned box still has to validate; provider failure counts remain observable. Unpinned slates need a full valid season schedule; unavailable historical coverage requires reviewed pinning rather than additive saved-total fallback.
- Required boxes validate game/team identity, numeric complete stats, unique players, both team rosters and final status. Missing/invalid required data does not save zeros, partial totals or a final slate. Drafted NBA identities must be present/unambiguous. Unpinned slates may score a validated full schedule, but automatic finalization requires saved pins so an omitted schedule game cannot silently freeze history; `finalizationNeedsPins` records that review dependency. Scheduled future games use saved/validated schedule metadata and no box request. Accepted completed/in-progress contributions cannot silently disappear. Scores, frozen rules, rounding, ordinal Fantasy ties and normal absent-athlete/DNP handling are retained.
- Fantasy saves player stats, team totals, optional slate lock and immutable notification-dispatch input together. A later worker can drain that input even for a locked slate. Acknowledgment is token-fenced. Original helper event keys, recipient logic and unique history semantics remain unchanged; already-reserved push events still skip, including the existing failed/pending-key limitation.
- Skins fetches actual standings before writes. BPI failures are recorded in its summary and never block actual standings/points. Only complete valid BPI sets update projections. Complete 82-game standings persist current/final points and reduce polling; season status/champion remain unchanged pending explicit review.
- Two simultaneous manual users, or browser + cron, contend for the same Fantasy claim. An active lease returns a safe 200 skip for existing clients, which reload accepted results; no second scoring/provider path starts. Manual refresh bypasses cadence/backoff, preserves optional 30-second polling and never bypasses a live lease or historical lock. Skins heartbeat honors due times and shares the same Skins claims as cron.
- Each lane can start at most three work items; discovery returns at most 30 due candidates ordered by oldest attempt. Lanes run concurrently and catch discovery/consumer failures independently. Each invocation caps retrieval at 80 requests (72 reserved for NBA.com/Fantasy, eight for ESPN/Skins), five seconds per request and a 45-second provider deadline; no new work starts after 20 seconds. Fantasy slates over 40 games fail visibly rather than process an incomplete subset. Skins begins its own acquisition concurrently, so Fantasy's work allocation cannot consume its lane. Watch budget deferrals when Groups grow.
- Every cron/manual/heartbeat invocation has durable source/status/item details, provider request/failure counts, duration and budget-stop state, including idle and discovery-failed invocations. Runs left `running` by process death remain inspectable; expired item leases recover. Each invocation prunes at most 100 run rows older than 60 days; task state and accepted results are retained. Known errors are bounded/redacted.

## Polling and scheduler recommendation

| State | Policy |
| --- | --- |
| Future Fantasy slate | Discover within seven days; successful scheduled/no-op work stores an hourly due time or the nearer 30-minute tip window |
| Near tip / live / halftime | Eligible every external five-minute tick (240-second internal due time); halftime stays live |
| Scheduled future game | No box request before its known start; missing tip metadata uses cautious discovery and cannot prove finality |
| Between dates in multi-day slate | Future games remain in the full list; completed earlier games still ingest/correct hourly between tips; no premature slate lock |
| Recently final games | Refresh final boxes/totals; if slate day has not ended, poll every 15 minutes; otherwise lock the complete slate |
| Locked Fantasy slate | No provider correction polling; pending notification recovery only, or explicit existing commissioner correction tools |
| No drafted Fantasy players / no nearby slate | No provider requests; stale/unresolved slates ending over seven days ago require manual review/pinning rather than endless automatic polling |
| Skins incomplete/far-future draft | No work until frozen-format draft complete; do not discover starting seasons more than 30 days before October 1 |
| Active Skins results window | Five-minute standings polling, noon–4am Eastern, October–June; hourly 4am–noon, six-hour offseason/preseason polling |
| Complete 82-game Skins records | Daily before explicit season finalization, allowing same-game-count win/loss corrections; final seasons are excluded |
| BPI | Daily acquisition per season/Group's durable due marker; failure retries after six hours while actual points continue |
| Failure | Exponential 120-second initial retry, capped at six hours; next external tick must also occur |

Skins' season-total provider has no live-game clock; exact no-game-day suppression would require introducing another schedule dependency. Its conservative result-publication window intentionally uses a single standings request per due season rather than making NBA.com availability gate Skins. BPI is not polled every five minutes. Fantasy schedules with no eligible games perform no box work. Invocation-local sharing does not deduplicate *separate* manual invocations in different Groups; adding a distributed provider cache is deferred until measured traffic justifies it.

Recommend **one** Vault-backed `pg_cron` job calling `GET /api/cron/refresh-nba`, bearer **`CRON_SECRET`**, on **`4-59/5 * * * *`** (`:04, :09, :14, ...`), sharing the Golf offset. NBA's main evening workload and Golf's usual daytime workload make this a reasonable initial choice; measure actual duration/budget deferral. Existing five offsets and all existing jobs remain unchanged. No unique sixth modulo-five slot or second-level schedule is required. Supabase extensions are already installed externally; this work installs none and creates no job.

Vercel also needs the existing `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. No NBA/ESPN provider key is required. Retain `GOLF_CRON_SECRET` for existing authorized callers/heartbeat gating and completed systems; the new NBA cron accepts only `CRON_SECRET`.

## Exact manual production rollout order

1. Review this branch/diff and migration. Confirm production schema has league-owned NBA slates/Skins seasons, Group teams, existing result uniqueness, `slate_nba_games`, NBA player IDs and notification history event uniqueness. Check date column types and retain the existing server runtime time-zone convention. Local SQL tests use fixture tables, not a queried production schema.
2. Inventory NBA-only triggers in Supabase `cron.job`, EasyCron and other external dashboards. **Disable every old `/api/cron/refresh-nba-skins` trigger and any independently installed NBA scoring automation/script.** Actual production scheduler configuration was not inspected. Do not change the five completed jobs. Drain old unleased requests and old deployment invocations during cutover.
3. Manually apply **only** `supabase/migrations/20261003000100_nba_background_orchestration.sql` to the intended database before activating code. It adds worker infrastructure/RPCs and no backfill/scheduler. Do not run bulk migration replay. Refresh the PostgREST schema if needed. Verify service-role-only permissions and existing column types. Keep old accepted/historical rows.
4. Verify existing Vercel `CRON_SECRET`, Supabase URL/service key and Vault entries. Reuse the existing Vault URL and matching cron-secret names; do not rotate shared secrets or expose decrypted values. Retain `GOLF_CRON_SECRET` for existing systems.
5. Deploy the reviewed branch only when separately authorized, with old NBA invocations drained. The old Skins endpoint now returns 410 even with its old correct bearer; it cannot run its previous write path. New authenticated manual refresh and heartbeat require the migration. An old app rollback requires keeping new scheduling disabled until its unleased code is drained.
6. Verify missing/wrong bearer gives 401 at `/api/cron/refresh-nba`. Invoke it once with the correct bearer. Inspect source-specific task/run outcomes, provider validation and latency, including actual NBA.com live and final boxes. Compare an existing Fantasy slate's totals/rules and a Skins season's standings/points/BPI. An idle response is valid outside eligibility; it is not proof of live scoring.
7. After those checks, manually create **one** Vault-backed `pg_cron` GET job named, for example, `nba-background-refresh` with `4-59/5 * * * *`. Use the existing `net.http_get`/Vault pattern and a 65,000ms HTTP timeout. The URL suffix is `/api/cron/refresh-nba`, and the Authorization value uses the Vault entry matching Vercel `CRON_SECRET`. Do not install pg_cron or retain a second legacy NBA/Skins job.
8. Observe both games with all browsers closed during relevant live NBA games, their finals and a slate end-day transition. Verify durable background runs and saved outcomes using the read-only queries below. Verify independently failing tasks recover without blocking the healthy game and that lease/budget/retry metrics stay reasonable. This production proof remains for rollout; it was not performed here.

## Read-only production verification SQL (not executed)

```sql
-- NBA scheduler inventory; avoid selecting commands/secrets into output.
select jobid, jobname, schedule, active from cron.job
where command like '%/api/cron/refresh-nba%';

-- Schema preflight: these columns must exist; DATE/TEXT date differences should be reviewed before applying SQL.
select table_name, column_name, data_type from information_schema.columns
where table_schema='public' and table_name in
  ('slates','slate_nba_games','nba_skins_seasons','player_slate_stats','team_slate_results')
order by table_name, ordinal_position;

select started_at,finished_at,source,status,processed,succeeded,failed,
       duration_ms,budget_stopped,provider_counts,provider_failures,details
from public.nba_sync_runs order by started_at desc limit 30;

select n.task,n.target_id,n.slate_id,n.season_id,n.league_id,l.group_id,
       n.status,n.last_attempt_at,n.last_success_at,n.next_attempt_at,
       n.consecutive_failures,n.last_error,n.last_summary,n.lease_expires_at,
       n.pending_notifications is not null as notification_pending
from public.nba_sync_state n join public.leagues l on l.id=n.league_id
order by n.updated_at desc limit 50;

-- Stale/abandoned invocations are durable rather than hidden.
select id,source,started_at,status from public.nba_sync_runs
where status='running' and started_at<now()-interval '5 minutes';
select task,target_id,lease_expires_at from public.nba_sync_state
where lease_token is not null and lease_expires_at<now();

-- Correlate successful background runs with the intended slate and its persisted totals.
select s.id,s.league_id,s.start_date,s.end_date,s.is_locked,s.rules_snapshot,
       r.team_id,r.fantasy_points,r.finish_position,r.games_completed,r.games_in_progress,r.games_remaining
from public.slates s join public.team_slate_results r on r.slate_id=s.id
where s.sport='nba' and s.id=:fantasy_slate_id order by r.finish_position;
select player_id,fantasy_points,games_completed,games_in_progress,games_remaining,game_status
from public.player_slate_stats where slate_id=:fantasy_slate_id order by player_id;

select s.id,s.league_id,s.season,s.status,p.team_id,p.nba_team_abbreviation,p.pick_type,
       p.final_points,r.wins,r.losses,r.games_played,r.projected_wins,r.projected_losses,r.source_updated_at
from public.nba_skins_seasons s join public.nba_skins_picks p on p.season_id=s.id
left join public.nba_skins_team_records r on r.season_id=s.id and r.nba_team_abbreviation=p.nba_team_abbreviation
where s.id=:skins_season_id order by p.team_id,p.overall_pick;

select event_key,count(*) from public.notification_history
where slate_id=:fantasy_slate_id
  and (event_key like 'player_finished:%' or event_key like 'slate_complete:%')
group by event_key having count(*)>1;

-- HTTP responses are transient; successful cron SQL alone does not prove HTTP success.
select id,status_code,timed_out,error_msg,created from net._http_response
order by created desc limit 30;
select j.jobname,d.status,d.start_time,d.end_time,d.return_message
from cron.job_run_details d join cron.job j on j.jobid=d.jobid
where j.jobname='nba-background-refresh' order by d.start_time desc limit 30;
```

Replace the `:fantasy_slate_id` and `:skins_season_id` placeholders with the reviewed IDs before running in the SQL editor. Do not print Vault decrypted secrets.

Closed-browser proof: record current player/team totals and Skins records before live play, close all app tabs/devices, let at least two scheduled ticks run, then query the database directly. `source='background'` runs must show successful Fantasy and Skins task identities; Fantasy stats should change during action, and Skins standings/points should change after ESPN publishes final game results. Compare the provider's scores/records and frozen scoring. After all pinned slate games are final and its end day has passed, confirm a background-created slate lock and stable completion-event keys. Skins final game counts/points should settle; season status stays unchanged until explicit reviewed finalization. Do not reopen the app as the first verification step, because that would invoke the heartbeat/manual paths.

## Changed/new file inventory

| File | Change |
| --- | --- |
| `app/api/cron/refresh-nba/route.ts` | New protected joint cron endpoint |
| `app/api/cron/refresh-nba-skins/route.ts` | Retired legacy handler, protected 410 |
| `app/api/refresh-stats/route.ts` | Existing authorized manual route delegates to authoritative worker |
| `app/api/app-heartbeat/route.ts` | Skins-only delegation to leased worker; NCAA paths unchanged |
| `lib/nba/types.ts` | Explicit provider/context/result identities |
| `lib/nba/provider.ts` | Immutable invocation sharing, validation and retrieval bounds |
| `lib/nba/backgroundPolicy.ts` | Fantasy state/tip policy and Skins/BPI cadence |
| `lib/nba/backgroundSafety.ts` | Bounded secret-safe errors |
| `lib/nba/fantasyScoring.ts` | Whole-slate canonical scoring, totals and ranks |
| `lib/nba/refreshFantasy.server.ts` | Validated acquisition, atomic scoring and notification dispatch |
| `lib/nba/refreshSkins.server.ts` | Standings/BPI acquisition and season-specific atomic apply |
| `lib/nba/backgroundWorker.server.ts` | Independent lanes, claims, run history and pruning |
| `lib/providers/nbaSkinsRecords.mjs` | Injected bounded fetch, season/duplicate/missing-stat validation |
| `lib/providers/nbaSkinsRecords.d.ts` | Optional injected fetch signatures |
| `supabase/migrations/20261003000100_nba_background_orchestration.sql` | Service-only worker state/history and fenced RPCs |
| `tests/nba-background-worker.test.cjs` | Provider/scoring/lifecycle/isolation/manual/concurrency tests |
| `tests/nba-background-worker-postgres.test.cjs` | Real isolated PostgreSQL transaction/security/lease/retention tests |
| `tests/nba-skins-groups.test.cjs` | Update legacy-handler assertion for new season-scoped implementation |
| `docs/nba-background-orchestration.md` | Audit, decision, inventory, rollout and verification |

## Validation and remaining limits

Final validation: **316 tests passed, zero failed, zero skipped**, including existing NBA Fantasy/Skins, Group/security, notification, correction and refresh regressions; 20 new provider/worker tests; and 12 real PostgreSQL transaction/security/lease/retention tests. `npx tsc --noEmit`, focused ESLint, `git diff --check` and `npm run build` passed. ESLint reported only the two existing unused-function warnings (`findProjectionTable`, `parseEmbeddedJsonScripts`) in `nbaSkinsRecords.mjs`; those unrelated helpers were left unchanged. The build used explicit dummy Supabase URL/keys, preventing production database access.

Local Dev HTTP checks verified the new cron rejects missing authorization (401), the retired Skins route rejects execution even with its old correct bearer (410), invalid manual slate input is rejected (400), and unauthenticated heartbeat is rejected (401). Full authenticated live-game UI verification remains a rollout step. PostgreSQL tests create a fresh Unix-socket-only local cluster, load fixture schema/migration there and destroy it; they never accept a production database URL. Optional invocation: `NBA_TEST_PG_BIN=/path/to/postgresql/15/bin node --test tests/nba-background-worker-postgres.test.cjs`. Migration was not applied to any Supabase/production environment.

Remaining limits: actual NBA.com live/final payloads and provider publication latency need deployment-environment verification; full authenticated UI/live-data testing was not performed against production. Required provider validation intentionally fails closed if an unfamiliar payload shape is encountered. Existing unpinned historical slates without current schedule coverage require explicit game pinning; any unpinned slate requires reviewed saved game IDs before automatic finalization. Existing locked Fantasy correction workflows remain manual. Skins season finalization and configurable-selection Home math retain the historical gaps described above. No persistent cross-invocation provider cache or new projection-ingestion scheduler is added. Observe the initial six-task/80-request/45-second bounds before increasing capacity.

Nothing was committed, pushed, merged, deployed, externally scheduled, or executed against production. Git work remains uncommitted on the new feature branch; `main` is unchanged.
