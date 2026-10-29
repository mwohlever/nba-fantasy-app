# NBA / NFL Player Center data foundation

Local implementation, October 23, 2026, on `main`. The full starting audit is
[`player-center-audit.md`](./player-center-audit.md). No UI was redesigned or
connected to the new endpoints. No production data, schema, jobs, or mappings
were changed. No SQL/migration was authored or executed.

## NBA identity investigation

| Measure | Before | After this local work |
| --- | --- | --- |
| Active local NBA players | 530 | 530 |
| Production reviewed mappings | 367 (69.2%) | **367 (unchanged)** |
| Additional corroborated candidates | — | **98**, awaiting approval/application |
| Achievable reviewed coverage from this evidence | 367 | **465 / 530 (87.7%)**, after approval |
| Still unresolved beyond those candidates | 163 | **65** |

The original September review explains all 163 gaps: 102 had an exact name
candidate with a team mismatch, and 61 were absent from ESPN's roster snapshot.
This was not evidence that ESPN lacked history for all 163.

The new read-only audit fetched the NBA current-season roster by **native NBA
player ID**, and all 30 current ESPN rosters. It used 32 bounded provider GETs,
at most three concurrent roster requests, and SELECTs only. It corroborated 98
additional identities using a unique matching name **and matching current teams
in both independent provider rosters**, bound to the local native NBA ID. Local
team labels were retained as evidence, never silently updated.

The other 65 cases are explicitly unresolved:

- **64 are absent from the native 2026–27 season response.** This alone does not
  prove retirement, inactivity, a bad local ID, or lack of historical ESPN data.
  Do not deactivate them or delete historical records. Resolve with historical
  roster/biographical evidence in a separate bounded review.
- **Bobby Portis**, local ID 422 / native ID 1626171: NBA publishes “Bobby Portis
  Jr.”; the local catalog and ESPN candidate use “Bobby Portis.” The suffix is
  plausible but was deliberately not erased by fuzzy matching. Native biography
  retrieval timed out during supplemental investigation; additional independent
  evidence is still needed for this review path.

Every candidate and unresolved case, including source URLs and IDs, is in
[`nba-identity-audit.json`](../data/player-center/nba-identity-audit.json). These
are review artifacts, **not runtime mappings**. The runtime reads only existing
reviewed database identities and rejects conflicting native/provider IDs.

Reproduce the review without changing the old analytics review artifacts:

```bash
node scripts/audit-player-center-nba-identities.cjs 2026-27
```

The script never generates or executes mapping SQL. A transient failed provider
attempt preceded the successful audit; only the successful 32-request snapshot
is represented in the artifact.

## Implemented locally

`lib/player-center/` now contains shared types, provider normalization, scoring
and comparison functions, bounded caching, a SELECT-only Supabase repository,
and orchestration. Existing projections, scoring modules, ingestion workers,
draft logic, and player views are unchanged.

Two authenticated, read-only endpoints are available locally:

```text
GET /api/player-center?sport=nba&season=2027&playerId={LOCAL_ID}
GET /api/player-center?sport=nfl&season=2026&playerId={LOCAL_ID}
GET /api/player-center/comparisons?sport=nfl&season=2026&position=QB&window=last5&metric=passing_yards&direction=desc
```

Profile requests accept explicit `phase=regular|preseason|postseason`; comparisons
are regular-season only. Years are professional years: NBA 2027 = 2026–27; NFL
2026 includes January 2027. There is no automatic previous-season substitution.
Choose the prior year explicitly. Profile season statistics retain separate
provider categories/team rows and select the requested season, rather than
guessing at multi-team aggregates.

Every request checks login and enabled active-Group sport access before loading
player/provider data. Optional `slateId` additionally checks active Group/league
ownership and uses its immutable `rules_snapshot`. Legacy slates use canonical
defaults explicitly; they do not inherit subsequently changed league settings.
Without a slate, current active-league rules are labeled `league_settings`.
Responses are private and `no-store`.

Raw professional data can be shared between Groups, but rules, fantasy scores,
and Group response context are never stored in that public-data cache. NBA and
NFL fantasy points call the existing canonical rule resolver and scorers. Missing
scoring fields are rejected before the existing zero-defaulting scorer is called.

## Provider data and limits

NBA uses the existing ESPN game-log parser/URL, retaining minutes, six scoring
stats, made/attempted shooting, event/team/opponent IDs, phase, status, explicit
DNP evidence, and timestamps. Filters-only empty seasons are accepted as empty
responses, not fabricated zeros.

NFL uses the existing ESPN athlete game-log and event-summary integrations. A
display adapter preserves signed yardage, unlike the frozen research parser.
Final status comes from explicit summary/status evidence. Summary enrichment
also captures off-position offensive stats and QB fumbles. An athlete absent
from a summary category becomes zero only when the category is complete and
its additive values reconcile; otherwise the statistic remains unknown.

D/ST synthetic IDs are decoded to their ESPN **team** IDs. The team schedule
provides actual events, opponents, status, January continuity, and explicit bye
week metadata. Shared event summaries supply defense stats. The production D/ST
interpretation is reused after checking every input that its legacy helper would
otherwise default to zero. Identical repeated provider team-stat cells are
accepted; conflicting duplicates remain unknown. No synthetic ID is sent to an
athlete endpoint.

Kicker logs preserve verified distance buckets, made/attempted field goals and
PATs, longest field goal, and real kicking points. **Kicker fantasy points always
remain null.** The deferred product decision is the FG formula (flat, distance
buckets, or distance-based), missed FG penalties, PAT make/miss values, and any
bonuses. No such weights exist in canonical rules today. Selecting a formula,
including its snapshot behavior, needs a separate rules task. Real kicking
points must not be relabeled as fantasy points.

Appearance logs do not establish why an athlete has no row. Missing/DNP/inactive
and bye are not inferred from absence. `byeWeeks: null` means no verified bye
metadata; it does not mean the team has no bye. Full multi-team season aggregate
selection remains deliberately unverified: separate rows are retained and the
comparison coverage gate stays closed rather than guessing a combined total.

## Lightweight caching and request policy

No new dependency, paid API, scraping, persistent cache, or warehouse was added.

| Read path | Policy |
| --- | --- |
| Single profile, current season | Validated public provider results cached for 15 minutes |
| Single profile, previous seasons | 24-hour provider cache |
| Provider cache | 128 entries per server process, concurrent promise deduplication, at most 3 concurrent misses and 40 misses/minute |
| Cold profile request | At most 8 provider requests, 18-second acquisition budget, 5-second timeout per fetch, 3 MB response cap |
| NFL cold profile | Log + season stats + up to 6 summaries; later explicit reads reuse cached results and can fill older gaps within the same cap |
| D/ST cold profile | One team schedule + up to 7 shared summaries |
| Provider failures | 30-second retry suppression; retain a successful result for at most another day, explicitly marked stale |
| Catalog | 60-second cache, strict identity revalidation before reusing raw facts |
| Draft comparison data | 5-minute cache of SELECT results; **zero ESPN calls** |
| Database reads | 1,000-row pages; fail explicitly at catalog/observation caps rather than truncate a pool |

These limits are process-local. Cold starts or multiple server instances do not
share cache state or rate counters. This is suitable for bounded local validation
and a small app's individual profiles; it is not a persistent whole-pool refresh
strategy. A fresh database read never pretends that old provider facts were just
verified. Stored timestamps can represent the last changed factual revision,
not the last successful poll, so the system does not infer a complete refresh
from those timestamps alone.

## Comparable draft statistics

`last1`, `last3`, `last5`, and `season` use actual completed appearances only,
within one explicit season and phase. DNP and live rows do not count in the
denominator. An unknown recent event occupies its proper window: the layer does
not slide past it to find an older convenient game. Last 3/5 require all 3/5
observations. Season summaries expose actual observed counts and totals.

Each metric includes its own valid/missing sample counts and
`metricComparable` flag. Window coverage and metric coverage are separate: five
known appearances do not guarantee five verified fantasy scores. Independent
provider GP (or the D/ST schedule) is used to check the appearance universe.
Missing stats remain null in both totals and averages; they are never zero.
Position-specific field lists and `metricRelevant` distinguish irrelevant stats.

The batch API reads the maintained NBA current-observation table and the NFL
latest-version view, plus exact-season GP where available. It never fetches a
log per player. If the relevant pool lacks verified identity, freshness,
appearance counts, exact windows, or the requested statistic, `coverage.canSort`
is false and the API retains alphabetical order. `observedAverage` is still
available for clearly qualified research; `rankableAverage` is null for an
unverified metric. Missing-last sorting is implemented for both directions when
the pool passes its coverage gate.

## Live coverage verified

The read-only verifier exercises real database SELECTs and bounded ESPN GETs:

```bash
node scripts/verify-player-center.cjs --live
```

It writes only
[`coverage-verification.json`](../data/player-center/coverage-verification.json).
The report records exact verification time, request counts, sample sizes,
missing fields, and comparison gates. The original October 23 probe established:

- NBA native 2544 / ESPN 1966: 2 current-season games and 60 prior-season games,
  with provider GP agreement and actual fantasy scores for all those games.
- NFL ESPN 3139477: 5 current-season appearances; one game lacks complete scoring
  evidence, so that game's FP and affected five-game/season FP averages are null.
  Other verified position stats and recent supported windows remain available.
  Specifically, event `401872945` does not establish fumbles lost under the
  initial strict summary-completeness checks. The October 26 follow-up recovered
  it from explicit final-team LOST=0 evidence; see the investigation linked below.
  Unavailable kicking fields on this QB are irrelevant to his FP.
- NFL kicker 3055899: 5 real games and kicking statistics; zero invented fantasy
  scores.
- NFL team 12 D/ST: 17 scheduled season games, 5 completed games, explicit week 5
  bye, and verified existing-rule fantasy scores for the 5 completed games.
- Stored current NBA comparison pool: 530 players / 367 mapped / **0 with current
  games**. The ranking gate stays closed.
- Stored current NFL comparison pool: 1,031 identities / 536 with game rows /
  **0 rankable for full last-five FP comparison**. The gate stays closed.

These samples do not certify every player's coverage. The new tests also verify
proper refusal when provider evidence is incomplete, season/identity mismatches
occur, or budgets are exhausted.

## Approval-dependent work to unlock the UI

1. **Mapping application:** review the 98 candidate identities, then separately
   authorize a targeted, conflict-checking insert into the existing identity
   table. Production coverage is still 367 until that happens. Investigate the
   remaining 65 without changing historical or membership records.
2. **Current-season population:** separately authorize a bounded refresh of
   factual NBA 2027 observations and exact-season GP. The existing NBA offline
   worker defaults to the calendar year and fetches both current/prior years;
   that does not automatically mean NBA ending-year 2027 in October 2026.
   Any scheduled-job/configuration change and production ingestion remains
   unexecuted. Previous-season imports should be one-time work, rather than
   refetched for every draft load.
3. **Verified comparison checkpoints:** choose how a completed refresh records
   independent GP, successful check time, and completeness. Prefer existing
   observation/season tables and a small coverage checkpoint if needed; do not
   add a warehouse. Approve the exact schema/worker proposal separately before
   writing migrations or running backfills. A process cache alone cannot make
   the currently empty/incomplete whole-pool data reliable.
4. **NFL persistence compatibility:** the existing immutable research schema
   restricts positions to offense and constrains passing/rushing/receiving yards
   to nonnegative values. It also stores null off-position fields. Do not alter
   that frozen research contract casually. Decide whether a thin Player Center
   factual cache should hold signed/full-position stats, K and D/ST, or whether
   to version/extend the existing storage. The new read-only adapters already
   represent those facts; no migration or analytics rewrite was made.
5. **UI work:** once the comparison gates can open on verified data, reuse the
   contract in the modal, full history detail, and draft views. Keep existing
   projection consumers and authoritative pick callbacks. Kicker profile stats
   need not wait for a kicker fantasy scoring decision.

The recommended next approval is the mapping insert plus a concrete, bounded
current-season refresh/checkpoint proposal, not an open-ended data warehouse or
automatic full-pool ESPN work on user requests.

## Validation and preview

Focused tests cover real reduced ESPN fixtures; missing, DNP, live, duplicate,
negative-yard and season cases; summary reconciliation; budget/cache behavior;
read-only paging and identity joins; unauthorized/cross-Group access; frozen
rules; and separation of public cache facts from Group-specific scoring.

The installed Next.js 16.2.4 route-handler and fetch/caching docs were read before
adding routes. The existing Dev server returned **401** with private/no-store
headers for an unauthenticated profile request.

Final verification:

- **82 tests passed, 0 failed, 0 skipped:** the two new Player Center suites plus
  the existing NBA analytics, NFL observation foundation/acquisition, NFL draft
  board, and Draft V2 integration suites.
- **TypeScript passed:** `NODE_OPTIONS=--max-old-space-size=4096 npx tsc --noEmit`.
  An initial default-heap attempt failed while inferring a large Supabase select
  union. Widening the dynamic select string removed the inference failure; the
  explicit check and the build's TypeScript phase both passed afterward.
- **Scoped ESLint passed** for `lib/player-center`, the new API routes, both new
  scripts, and both new test files.
- **Production build passed:** `NODE_OPTIONS=--max-old-space-size=4096 npm run build`.
- **Diff/whitespace checks passed**, including all newly added untracked files.
- The final live verifier used **14 provider cache misses** across the five
  sampled profiles; both draft comparison reads used **zero** provider requests.

Start with `npm run dev` if a Dev server is not already running, sign in to a
Group, then inspect the JSON endpoints above from the same browser session.
`playerId` is the local catalog ID, not an ESPN ID. The old player screens remain
unchanged. This phase does not claim mobile/UI validation of a new Player Center.

The Bracket Challenge stash and ShotCast worktrees remain untouched. No commit,
push, deployment, production write, migration, backfill, or ingest job was run.

## October 26 read-only follow-up

The Player Center now preserves explicit athlete-log facts when summary sections
are empty and can establish individual LOST=0 from a verified final, exact-team
zero total. This resolves the captured Allgeier October 11 and Mahomes September
20 examples, plus Bourne in the same ARI game, without changing scoring or
production records. Missing or contradictory evidence still withholds scoring.
The detailed evidence, provider/SELECT findings, limits and offline fixture replay
are in [the NFL scoring investigation](./player-center-nfl-scoring-investigation.md).
Earlier coverage numbers above describe the original probe, not a new pool audit.

## October 26 application readiness follow-up

The real NBA/NFL UI integration and durable **readers** are now implemented locally. `durableCache.ts` validates the existing proposed v1 raw cache; repository/service readers keep missing, stale, mixed-cutoff and incomplete data gated. Profile scoring stays outside the public cache and consumes authorized Group/frozen rules. Legacy observations without durable coverage are qualified research only. The NBA acquisition/canary plan remains unchanged; new bounded NFL cache-only preparation is available without changing research schemas or kicker rules. No schema or data was applied.

Production activation is default-off through `NEXT_PUBLIC_PLAYER_CENTER_ENABLED`; Dev supports explicit read-only review transport through `NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL`. See [UI testing instructions](./player-center-ui.md#real-app-integration-and-safe-local-testing--october-26) and [production checkpoints](./player-center-production-rollout.md#local-integration-and-rollout-readiness--october-26). The 367/530 production mapping count and 98/65 review split remain historical verified evidence, not a newly executed production audit. Deployment, fresh mapping evidence, worker-cohort protection, DDL, acquisition/population and coverage acceptance all remain separate approvals.
