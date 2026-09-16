# NBA Projection V2: historical inputs and evaluation foundation

Status: selected for an opt-in shadow pipeline. The production projection API,
Draft, Home, Player History, ranking/sorting, and pick-time snapshots remain
unchanged. The shadow-only persistence migration is
`20260925000100_nba_projection_observation_foundation.sql`; it is manually
applied through Supabase SQL Editor, never by application code.

## Current paths and reuse

- `lib/playerProjections.ts`: active players plus imported season FP and drafted
  slate FP; 50/30/20 anchor/season/recent blend, fantasy-team finish boost and
  hot/cold offsets. No minutes, event-final filter, Group/sport boundary, or as-of.
- `scripts/import-nba-season-averages.js`: CSV import into
  `player_nba_season_averages`; NBA ID, GP, six stats and default FP, no minutes.
  A final CSV season average is NOT an earlier-season forecast input.
- `app/api/refresh-stats/route.ts`: NBA CDN game/player IDs, today scoreboard and
  `boxscore_{gameId}.json`, `slate_nba_games`, drafted players, slate-level raw
  scoring totals/lifecycle in `player_slate_stats`. Aggregates multiple real games;
  does not retain full event-level minutes history. Reuse identity evidence and raw
  provider facts, not slate totals as one-game observations.
- `app/api/sync-players/route.ts`: `stats.nba.com/stats/commonallplayers`, NBA
  PERSON_ID -> `players.nba_player_id`. Existing fallback matches normalized names.
  This is not an ESPN crosswalk and is not copied into analytics.
- `app/api/slates/route.ts`: NBA schedule handling includes ESPN scoreboard fallback;
  NBA Skins uses ESPN team records. Neither supplies a verified athlete crosswalk.
- `app/api/player-projections/route.ts`: unchanged production output.
- `app/api/lineups/route.ts` and `lib/lineups/draftHistory.server.ts`: pick-time
  saved projections on `lineup_players`; unchanged. These are fantasy references,
  not real-sport history or reliably reproducible pregame training inputs.
- `app/api/home-summary/route.ts`: duplicate fallback blend and live clock-based
  extrapolation; unchanged. Do not reproduce fantasy-team finish in clean baselines.
- `lib/analytics/nba/projectionGeneration.server.ts`: frozen shadow model
  `nba-v2-robust50i25-recent15-v1`; it stores only rule-neutral projected stats.
- `app/api/internal/nba/projection-ingest/route.ts`: authenticated internal
  worker endpoint. It reads reviewed identities and appends valid observations;
  the GitHub worker defers shadow-cache generation until its evidence batches finish.
- `app/api/admin/nba/projection-shadow/route.ts`: commissioner-scoped read-only
  comparison surface. A supplied slate is authorized through the active Group and
  enabled-league boundary before its frozen rules snapshot is used for scoring.
- `lib/rules/leagueRules.ts`: reuse resolver and NBA coefficient types as-is.
- `lib/corrections/correctionPolicy.ts`: reuse its exported pure scorer. The
  refresh-route scorer is private and importing that route would pull in server
  database/notification infrastructure. No scorer was extracted or duplicated.

## Identity

`nba_player_provider_identities` explicitly connects a reviewed ESPN NBA athlete
ID to `public.players.id`, with evidence and a locked flag. Routine ingestion has
read-only access to this table: it cannot create, update, promote, or fuzzy-match
identities. Resolution returns unresolved on missing or conflicting mappings.
The ESPN payload inspected contains no athlete identity field: its athlete identity
comes from the explicitly requested URL. A payload athlete ID, when present, must
match. Saved inputs retain trustworthy request provenance.

Before shadow rollout, a reviewed Tier 1 seed established 367 locked ESPN-to-player
mappings. Future matching may propose candidates using official IDs or corroborated
name/DOB/profile evidence, but must not activate ambiguous/fuzzy-name matches.
Tier 2 cleanup is intentionally separate from normal ingestion. Provider-only
unresolved history can be retained within its namespace; it cannot silently attach
to an app player. Cross-provider event reconciliation is deferred. One backtest
scope uses one provider namespace, preventing duplicate NBA/ESPN representations
from being combined.

## Canonical representation

See `lib/analytics/nba/types.ts` for the exact `NbaObservation` shape:

- NBA sport, namespaced provider/player/event, explicit resolved/unresolved local ID.
- Season END year; phase (`regular`, `postseason`, `preseason`, `unknown`).
- Timezone-bearing game start and nullable completion timestamp; historical team,
  opponent, home/away; do not substitute today's team after a trade.
- Final/live/scheduled/unknown status and explicit-versus-result final evidence.
- Played/DNP/unknown, nullable minutes and starter flag.
- Six nullable scoring stats, optional nullable shooting counts.
- Source URL, fetched timestamp, nullable revision `knownAt`, missing-field list.

An early exit remains a played appearance. Numeric zero remains zero. Missing
columns/cells remain null. A short stat array is rejected as usable numeric evidence
instead of risking shifted columns. DNP is explicit only; absent logs are NOT DNP.
Rounded zero minutes without evidence of participation remain unknown. Contradictory
DNP plus production is flagged and excluded from modeling evidence. Final games
can still have incomplete stats. Unknown starter/cause is not guessed.

## ESPN adapter and evidence

`lib/analytics/providers/espnNbaGameLog.ts` reads only:

`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{id}/gamelog?season={endYear}`

One additional live probe in this batch used athlete 1966, season 2025. It returned
`names`, `events`, `seasonTypes`, `filters`, labels and glossary; no athlete object
and no completion timestamps. Stat columns are selected by `names`, not positional
constants. Season groups contain event categories AND aggregate totals: totals are
never observations. The response includes preseason, regular season and postseason.
Selected season and NBA league must be confirmed by filters, preventing silently
accepting an endpoint that ignores a season parameter.

Game metadata uses `events[eventId].gameDate`, historical team/opponent IDs,
home/away team IDs and `gameResult`. With no explicit status, W/L is accepted as
result-based final evidence, clearly labeled; an explicit nonfinal/unknown status
overrides that inference. All-star team flags yield unknown phase. Phase inclusion
is always explicit in the history policy.

The fixture `tests/fixtures/espn-nba-gamelog-1966-2025.json` preserves six actual
event records (two per phase), selected metadata and the original name columns.
Links were removed and monthly/phase totals retained where present to test that
they cannot enter history. It is not a complete player season or coverage claim.
The audit's season selector advertised back to 2003-04 for this player; this batch
only verified 2024-25 retrieval, not every advertised year/player.

Identical duplicates collapse; conflicting same-response rows quarantine the
player/event with an issue instead of order-dependent last-row wins. Rows missing
an event ID are reported; missing timestamps/stats remain visible in observations.
Output is deterministic for identical inputs including explicit timestamps.

`fetchEspnNbaGameLog` is a separately invoked GET with timeout and injectable fetch
and clock for tests. It records the actual fetch time as revision knowledge. It has
no storage, retries, provider polling, Supabase, application routes, or scheduling.
Historical retrospective replay uses `normalizeEspnNbaGameLog` with `knownAt:null`
explicitly. Do not strip known timestamps from real archived revisions.

## As-of safety and its limits

`observationsAsOf(history, asOf, scope, policy)`:

1. Restricts sport, provider and player; excludes target event IDs explicitly.
2. Filters revision knowledge strictly before cutoff; invalid provenance fails closed.
3. Resolves the newest eligible revision, quarantining equal-time conflicts.
4. Requires game start strictly before cutoff and final status; enforces phase/season.
5. Requires any supplied completion time before cutoff and not before game start.
6. Returns cloned observations sorted chronologically with exclusion diagnostics.

Two explicit policies:

- **recorded**: requires knownAt before cutoff. A final result observed then is
  evidence of completion even if the provider does not supply its exact end time.
  A correction first recorded later never overrides the earlier available revision.
- **retrospective**: accepts unknown original revision timing, labels the output as
  approximate, and still obeys known revision times when provided. If completion
  time is also absent, caller must explicitly request a quarantine of at least
  24 hours from tipoff. Without that option such rows are excluded. This conservative
  heuristic is NOT proof of completion timing: postponed/suspended games and later
  stat corrections cannot be reconstructed exactly from today's historical log.

Same-day historical results with no completion or original knowledge timestamp are
excluded by the quarantine. Known completion/knowledge allows genuinely earlier
same-day final games. Date-only, timezone-free, invalid, future and equal-cutoff
timestamps cannot become valid history.

Newest incomplete revisions stay incomplete; older complete stats are not revived.
Exact information-time backtests require archived revisions. A retrospective result
must not be described as a fully point-in-time verified forecast. Neither mode
consumes season-total provider fields.

## Evidence and statistics

`modelingEvidence` checks final played status, positive minutes and complete raw
scoring data; it never drops a game merely because FP is zero or negative.
`describeParticipation` uses already filtered prior history to report typical
minutes, participation ratio, sample count and an optional low-workload flag.
Caller chooses the ratio threshold. Fewer than three reference games -> no anomaly
flag. Cause always remains unknown; five minutes is normal for a five-minute bench
role. These descriptors do not assign final V2 model weights or diagnose injuries.

Implemented shared pure statistics only: weighted mean, weighted median, weighted
ratio of totals, recency half-life weight and effective sample size. Empty/zero
support returns null (ESS returns zero); invalid/negative weights throw. Weighted
median returns the adjacent midpoint at an exact halfway boundary. Ages and
half-lives must use the same caller-specified unit. No trimming, winsorization,
shrinkage tuning or large analytics framework was added.

Example: three 35-minute, 45-FP games plus one 5-minute, 4-FP game:

- Truth: all four appearances remain in history.
- Raw appearance average: 34.75 FP.
- Ratio of totals: (135+4)/(105+5) = 1.263636 FP/min.
- Short game's opportunity share: 5/110 = 4.55%, versus 25% in a per-game mean.
- Median workload: 35 minutes. Multiplying the pooled rate by 35 would give 44.2273
  FP as an illustration only; this batch does not implement that as a V2 model.
- Low-workload ratio: 5/35. A repeated five-minute role does not receive this flag.

## Target scoring

`targetNbaScoring` accepts the target frozen snapshot and uses `resolveLeagueRules`.
Null snapshots require explicit legacy fallback; another sport is rejected. It
never reads current Group settings. `scoreNbaStats` validates all six stats before
calling `calculateCorrectionFantasyPoints`, preventing that existing calculator's
missing-to-zero convenience from losing information. Raw/projected stats are
scored without intermediate rounding; 45 points with all other stats zero scores
45 under defaults and 90 with target `points:2`. Turnovers can produce negative FP.

## Harness, baseline and next-model contract

`backtestNba` takes history, explicit prediction targets, a separate actual-truth set,
an availability/season policy, and a candidate callback. Targets specify event,
season/phase, pre-tipoff asOf and frozen rules. No target box score, final season
totals or arbitrary object extras are forwarded. Candidate input is cloned and
deep-frozen at runtime. Actual truth is inspected after the callback; duplicate or
incomplete actuals are reported as skips, not silently zeroed. Duplicate targets
and post-tipoff cutoffs throw. Individual games are evaluation units; multi-game
slate assembly is explicitly deferred.

Metrics: evaluated prediction count, MAE, RMSE, bias (prediction minus actual),
per-confidence metrics, prediction rows/history counts and skip reasons. Empty
metrics return null, never perfect zero error. DNP/incomplete truth is skipped:
this is conditional-on-play evaluation, not an availability forecast evaluation.
Always inspect coverage/skip counts alongside errors. The callback contract is
not a sandbox: trusted candidate code must not close over external future data.

Baselines: same-phase season-to-date average, recent-N average, optionally
half-life-weighted by appearance age. They use only filtered complete raw stat
observations rescored under target rules, retain early exits, and abstain with no
history. Confidence stays low with an explicit untuned-benchmark reason. The
offline CLI's N=5 and N=10/half-life=5 are benchmarks, not recommended tuned values.
Legacy comparison is deliberately omitted: historical imported anchors and
draft-time inputs are not safely reconstructible from these real-game logs.

Future `ProjectionOutput` supports expectedMinutes, statRatesPerMinute,
projectedStats, projectedFantasyPoints, confidence, fallbackReason, components,
modelVersion and asOf. Harness verifies projected stat lines agree with target FP.
Next batch should implement minutes estimates separately from six production-rate
estimates, explicit small-sample priors/fallbacks, and confidence. Backtest minute
windows, recency half-lives, relative workload thresholds, shrinkage strength and
role-change responsiveness using chronological training/validation splits. Test
stable starters, bench roles, tiny samples and verified injury returns separately.
Do not activate based on this tiny fixture's error scores.

## Running offline

```sh
node --test tests/nba-analytics.test.cjs
node scripts/backtest-nba-analytics.cjs /tmp/nba-backtest-input.json
```

CLI input contains `history: NbaObservation[]`, `actuals: NbaObservation[]`,
`targets: PredictionTarget[]`, and `policy: HistoryPolicy`. Output is JSON on stdout
for all three baselines. It does not fetch or write data. Use the normalizer from
an offline TypeScript consumer to prepare observations from saved provider payloads.
The fetch helper is never invoked by the CLI. No package/dependency change needed.

## Storage decision

No schema or migration for this batch. Small offline JSON caches are enough to test
adapter/harness behavior. Future persistent player/game revisions materially improve
performance, coverage, corrections, and trustworthy information-time evaluation.

Separate eventual responsibilities:

1. Provider payload/observation revisions keyed by sport/provider/player/event,
   payload hash, first-observed time, fetch time, final status and completeness.
   Exact repeats should not shift first-observed time. Append corrected revisions
   rather than overwriting history; maintain a derived latest view.
2. Reviewed player and event crosswalks with evidence and conflicts/unresolved states.
3. Group/slate-specific projection snapshots referencing frozen rules, model version,
   asOf/input revision set, components, confidence and fallback reason.
4. Separate immutable draft/reference snapshots, preserving existing semantics.

Incremental ingestion should backfill bounded season/player batches, checkpoint,
retry politely, refresh recent finished games for corrections, and retain valid
cached observations on provider failure. Fetch new revisions, not years on every
page load. Do not let a partial fresh response erase older truth; missing current
evidence should remain an explicit state. Source completeness needs independent
season/schedule coverage checks. New storage would need reviewed, unapplied SQL in
a later authorized batch before any deployment. No production ingestion is started.

## Roadmap implications

The largest remaining foundations are verified ESPN/local crosswalk coverage and
prospective revision capture. Accurate minutes parsing alone cannot recover past
injury restrictions, historical provider corrections or a game's exact end time.
Keep model ranking/score error improvements separate from evidence that the dataset
is complete. The current production model and every projection surface remain active
and unchanged until a later explicit activation decision.

## Validation record for this batch

- 26 focused tests exercise normalization, null/zero, DNP, minutes, optional fields,
  phase/season validation, explicit identity/collisions, duplicates, revision timing,
  same-day cutoffs, target exclusions, statistics, rules and backtest isolation.
- Existing corrections-scoping, draft-history, create-slate-sport and Golf rules
  suites pass; the latter checks the existing shared resolver without changing it.
- Repository TypeScript (`tsc --noEmit --incremental false`) passes with all new
  analytics sources installed. Focused and regression suites were rerun successfully
  in the repository after applying the batch.
- No production build or mutating route was needed for these pure/offline modules.

The complete single-player provider response was also normalized locally: 78
observations (3 preseason, 70 regular season, 5 postseason), zero adapter issues.
Offline CLI smoke test on the 70 regular-season games, using default target scoring,
explicit retrospective mode and a 24-hour unknown-completion quarantine:

| Benchmark | Evaluated | MAE | RMSE | Bias |
|---|---:|---:|---:|---:|
| Season-to-date | 69 | 9.0538 | 11.2137 | -0.9900 |
| Recent 5 | 69 | 9.0003 | 11.5141 | -0.1487 |
| Recent 10, half-life 5 | 69 | 9.2153 | 11.4952 | -0.1773 |

All three abstained on the first game. These validate the executable path, not a
winner or readiness to activate any model. One retrospectively downloaded player
season cannot establish league-wide quality, data completeness, or historical
correction timing. The full provider response and smoke-test input/output stay in
`/tmp`; only the six-event reduced fixture belongs to this batch's source files.

## Files and checkout safety

Applied on `main` with explicit user permission. No existing tracked source file was
edited by this batch. These 12 files are new and remain untracked pending review:

```text
docs/nba-projection-v2-foundation.md
lib/analytics/statistics.ts
lib/analytics/nba/types.ts
lib/analytics/nba/identity.ts
lib/analytics/nba/history.ts
lib/analytics/nba/participation.ts
lib/analytics/nba/scoring.ts
lib/analytics/nba/backtest.ts
lib/analytics/providers/espnNbaGameLog.ts
scripts/backtest-nba-analytics.cjs
tests/nba-analytics.test.cjs
tests/fixtures/espn-nba-gamelog-1966-2025.json
```

The 16 pre-existing modified/untracked files were fingerprinted before this batch;
their content hashes remain unchanged. This includes all Golf work and the earlier
audit Markdown file. The only tracked diff remains the pre-existing 47 additions
in `lib/rules/leagueRules.ts`. New analytics imports are confined to this foundation,
its test and the offline script. No commit, push, SQL, migration, database write,
scheduled job or production projection activation occurred.

Final `git status --short`:

```text
 M lib/rules/leagueRules.ts
?? 111-sports-cross-sport-projections-feasibility-audit.md
?? docs/golf-two-axis-foundation.md
?? docs/nba-projection-v2-foundation.md
?? lib/analytics/
?? lib/golf/bestBall.ts
?? lib/golf/eligibleRoster.ts
?? lib/golf/lifecycleAuthority.ts
?? lib/golf/periodPersistence.ts
?? lib/golf/rosterPeriodState.ts
?? lib/golf/scoring.ts
?? scripts/backtest-nba-analytics.cjs
?? supabase/migrations/20260914000100_golf_roster_period_foundation.sql
?? supabase/migrations/20260915000100_golf_lifecycle_writer.sql
?? tests/fixtures/espn-nba-gamelog-1966-2025.json
?? tests/golf-best-ball.test.cjs
?? tests/golf-lifecycle-authority.test.cjs
?? tests/golf-period-persistence.test.cjs
?? tests/golf-roster-period-state.test.cjs
?? tests/golf-rules.test.cjs
?? tests/nba-analytics.test.cjs
```
