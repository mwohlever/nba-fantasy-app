# NBA / NFL Player Center: audit and implementation decision

Audit date: October 23, 2026. Branch: `main`.

## Outcome

Historical player data is available through existing ESPN integrations, but the
stored data is not a complete, current Player Center data source. Implementation
is paused at the requested data/architecture checkpoint. No application code,
schema, provider mappings, production records, or operational jobs were changed.

The important distinction is between fetching one player's profile and sorting
the entire draft pool by current actual performance. The former can use bounded,
cached provider requests. The latter needs a consistently populated season-wide
data source; opening the draft board must not fan out to hundreds of athlete
requests. Quietly using the old season summaries would misrepresent freshness.

## Verified production data (read-only queries)

These are point-in-time findings, not a promise of continuing coverage. All
database operations in this audit were SELECTs. No refresh, sync, ingest, RPC,
backfill, or notification endpoint was invoked.

| Source | Verified contents | Limitations |
| --- | --- | --- |
| `players` | 595 identities; 530 active; native `nba_player_id`, team, position group, cached headshot | No ESPN athlete-ID column |
| `nba_player_provider_identities` | 367 reviewed, resolved ESPN-to-local mappings | 163 active NBA players have no reviewed mapping, including established players; this is not just rookies |
| `nba_player_game_current_observations` | 15,593 observations for end-year 2025; 18,793 for end-year 2026; zero for end-year 2027 | Minutes and six scoring categories only; no shooting columns, DNPs, scheduled/live games, or full absence evidence |
| NBA current observations, freshness | Latest provider fetch found: October 22, 2026, for season 2026 | A recent fetch timestamp does not mean current 2026–27 season coverage |
| `player_nba_season_averages` | 582 rows, all `2025-26`; latest update May 2, 2026 | All 582 `games_played` values are null; cannot reconstruct accurate totals or sample sizes from these averages |
| `players_nfl` | 1,031 player/team identities; active position counts: QB 124, RB 211, WR 411, TE 215, K 38, D/ST 32 | Must page large queries; the default PostgREST row cap can truncate the pool |
| `nfl_player_game_observations` | 6,443 observations for 2025 and 2,393 for 2026; latest game October 20, 2026; latest game-log fetch October 20, 2026 | QB/RB/WR/TE regular-season observations only; no K/D/ST, bye/DNP/live records |
| `player_nfl_season_stats` | 541 rows, all season 2025; latest update August 10, 2026 | No 2026 season-summary rows; draft baseline fallback is intentional but is not current-season performance |
| `player_slate_stats` | 1,430 NBA slate-result rows | League/slate totals, sometimes multiple real games; not a complete player/event game log |

NBA historical versions are immutable and have a maintained current-observation
table. NFL observations are exposed through a latest-version view. These are
service-role data sources; they must stay behind server access checks.

The NBA persisted schema requires regular-season, positive-minute appearances
with complete scoring stats. The NFL persisted schema explicitly restricts
positions to QB/RB/WR/TE. Extending those schemas is a separate migration decision;
it is not necessary just to render a provider-backed profile.

One exploratory count against the older NBA observation view timed out. The
maintained current table returned the scoped counts above. New reads should use
the maintained table and bounded, paginated queries rather than that older view.

## Provider checks

Actual GET requests to the existing provider URLs returned HTTP 200 and JSON for:

- NBA ESPN athlete `1966`, game logs for end-years 2025 and 2027. The former
  contained regular season, preseason, and postseason categories. The latter
  contained two regular-season games and separate preseason games. Minutes,
  six fantasy scoring stats, and made/attempted field goals, threes, and free
  throws were present.
- NFL ESPN QB `3139477`, game logs for seasons 2025 and 2026; QB `3918298`,
  season 2026. Passing and rushing fields were present; fumbles lost was absent
  from the QB game-log stat names.
- NFL ESPN kicker `3055899`, season 2026 game log. Distance-bucket field goals,
  total field goals, extra points, and kicking points were present. The existing
  research normalizer does not support this shape.
- NBA athlete `1966` and NFL athlete `3139477`, season-stat URLs. Responses
  included current and previous season records. NBA included averages, totals,
  shooting percentages, and games played. NFL included position-specific totals.

Existing URL templates:

```text
https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{espnId}/gamelog?season={endYear}
https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{espnId}/gamelog?season={startYear}
https://site.web.api.espn.com/apis/common/v3/sports/{basketball|football}/{nba|nfl}/athletes/{espnId}/stats?season={year}
https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={eventId}
```

The stats endpoint returns multiple season rows despite the `season` query.
Select the exact row year, competition phase, and appropriate team/combined-team
record explicitly. Do not take the last category row or restrict all historical
games to the player's current team. Multi-team season aggregation still needs
focused fixture verification.

These probes establish sampled availability, not complete provider coverage for
every athlete/year. Neither appearance logs nor the stored observations establish
why an absent player missed a game. Bye, DNP, inactive, missing box score, and
upcoming must be established from schedule/participation evidence, not inferred
from a missing appearance. NFL final-state evidence must be joined from the
scoreboard/summary; the existing NFL log parser alone does not establish finality.

The existing NBA.com integration uses the current league schedule and per-game
CDN box scores with native NBA IDs. This is a possible alternative to expanding
the ESPN crosswalk, but it is not an existing historical athlete-log service.
The raw schedule probe returned an HTML response instead of JSON from this
environment. That probe did not reproduce the app provider's full headers, so it
does not establish a production outage; native-ID historical fallback coverage
has not been verified. The current normalized NBA.com box object also retains
only the six scoring stats, omitting minutes, shooting, and participation.

## Existing UI and route inventory

| Entry point | Current path | What must be preserved |
| --- | --- | --- |
| `/lineups/draft?sport=nba|nfl&slateId=...` | `LineupBuilder` → `PlayerPool`, `SlotDraftModal`, `DraftPlayerModal` | Active Group/slate, current turn, available/drafted filters, slot eligibility, commissioner proxy actions, corrections, selection and slot restoration |
| `/lineups` and `/lineups/scores` | `LineupBuilder` → `ReadOnlyPlayerModal` → `PlayerModal` | Read-only inspection and close behavior; Golf retains its separate scorecard |
| Draft season/league research cards | `PlayerPool` → `PlayerResearchModal` | Research action hands the player back to established drafting logic; it must not bypass authorization or roster validation |
| Draft speed-entry Info | `LineupBuilder` → `PlayerResearchModal` | Research stays separate from the authoritative pick action |
| `/player-history`, NBA and NFL via sport selection | One shared 8,128-line page with season/league views, filters, sorting, comparison, and `PlayerResearchModal` | Existing list/navigation context and Group-scoped league-history mode |
| NFL live game-center player dialog | `FootballGameCenter` → `/api/live-scores/nfl/player-detail` → `createFootballPlayerDetailHandler` | Existing live-game context and team validation; do not silently change this separate workflow |

`PlayerModal` currently calls `/api/player-league-profile`, defaults to app season
2026, and prominently displays projections and league draft results. Its recent
rows represent drafts/slates, not necessarily individual NBA/NFL games.

`PlayerResearchModal` has Season Stats and League History modes and loads the
entire sport season-summary response to find one player. It contains useful
header/headshot/action patterns, but does not provide the proposed historical
game-log/fantasy experience.

`PlayerPool` already offers season-stat sorting. NBA supports points, rebounds,
assists, steals, blocks, turnovers, and FP, but lacks minutes/recent windows and
a general direction control; missing values use numeric sentinels. NFL already
has position-aware categories, direction control, and missing-last comparison.
Both default to projection mode. The current player pool is card-based; any
denser table must preserve its authoritative selection callbacks.

`/api/player-history-detail` is NBA-only and Group-scoped; it reads slate results.
It is not the shared historical provider API its name might suggest.

## Identity, scoring, season, and Group boundaries

- NBA native IDs and ESPN IDs are different namespaces. Reuse
  `resolveStoredNbaProviderIdentity` and the reviewed identity table. Do not add
  name matching, assume equal numbers, or substitute a similarly named athlete.
- NFL `nfl_player_id` stores the ESPN athlete ID for real players. K is normalized
  from ESPN PK. D/ST uses `100_000_000 + ESPN team ID`; it must use team/event
  history, never the athlete game-log URL with that synthetic ID.
- NBA provider seasons use ending years: 2027 means 2026–27. NFL uses starting
  years: 2026 means the 2026 regular season, including January 2027 games.
- Existing `/api/player-season-stats` converts app season 2026 to NFL 2025 by
  default. Draft passes `nflBaseline=auto`, which tries the actual NFL slate year
  then falls back to the previous season. History uses the default conversion.
  A shared center must use explicit professional seasons and label them; it
  cannot assume every existing `season=2026` request means the same thing.
- Use `resolveLeagueRules` from `lib/rules/leagueRules.ts`. NBA scoring is already
  available through `scoreNbaStats`/the correction scorer. NFL offense and D/ST
  scoring are in `lib/scoring/nfl.ts`.
- Existing NFL canonical scoring has offense and D/ST formulas, but no kicker
  formula. Real kicking points can be displayed as a box-score stat; they must
  not be relabeled as fantasy points or assigned invented fantasy weights.
- For draft/slate context, authorize the slate with `authorizeSlateResource` and
  score against its frozen `rules_snapshot`, with the intentional legacy
  fallback. For general research, identify any current-league/default scoring
  basis explicitly. Re-scored historical box scores must not be presented as
  the saved result of an old slate with different rules.
- `/api/player-history` and `/api/player-league-profile` restrict league history
  through `getCurrentUser` / `getActiveLeagueForSport` and league IDs. The new
  profile API should enforce authentication and enabled active-Group sport
  access even though raw professional stats can be cached independently of Group.
- `/api/player-season-stats` currently reads global professional season summaries
  without those user/Group checks. Do not extend that route to expose private
  draft context. Group-specific fantasy scores must never enter a global cache.
- Scoring, drafting order, picks, teams, corrections, historical slate results,
  and existing notification behavior are outside the overhaul's mutation scope.

## Projection dependencies

Keep underlying projection fields/functions for now. They are consumed by
`/api/lineups` (including saved lineup projection snapshots), `/api/home-summary`,
the scores page, draft projections, league-profile projection comparisons, and
NBA admin shadow evaluation.

The legacy NBA estimate blends a professional-season anchor, league slate
average, recent drafted-slate average, finish boost, and hot/cold adjustments.
Those are not recent professional game statistics. The newer draft path reads
global V2 raw-stat caches and applies the target slate's frozen scoring, with a
legacy NBA fallback. These calculations must not be renamed as actual averages.

UI projection prominence can be removed without deleting these dependencies.

## Reusable implementation plan, after the data decision

1. Define a shared `PlayerCenter` contract and pure adapters: explicit sport,
   local/provider identity, professional season, phase, per-event provenance,
   status/participation, nullable stats, scoring basis, and coverage timestamps.
   Add real provider fixtures, including multi-team seasons, negative NFL
   yardage, absent QB fumbles, empty seasons, DNP, and incomplete rows. The
   current research NFL numeric parser only accepts nonnegative values; it must
   not become the unexamined parser for all display stats.
2. Add authenticated, read-only profile and batched draft-summary access. Reuse
   the existing factual stores, ESPN URLs, scoreboard/summary validation, and
   canonical scorers. Cache validated raw responses by provider, athlete/event,
   season, and phase; deduplicate concurrent fetches, bound timeouts/concurrency,
   and expose timestamps/failures. Resolve Group/slate scoring outside that
   global cache. No provider requests during render and no pool-wide athlete
   fanout from a browser request.
3. Build one responsive profile body with Game Log (default), Season Stats, and
   Fantasy. Share it between compact modal wrappers and an expanded Player
   History detail view. Preserve existing close/back, draft-action, loading, and
   error callbacks. Use sticky first columns and horizontally scrolling tables.
   Keep league draft history as clearly labeled context rather than game logs.
4. Use the same factual summary contract for draft stat sorting. Offer explicit
   Last game / Last 3 / Last 5 / Season scopes, sport/position-appropriate stats,
   direction, active sort, and sample counts. Missing/insufficient values sort
   last in both directions. Keep existing filters and draft mechanics intact.
5. De-emphasize projections only in requested views, preserving underlying
   fields and other consumers. Validate in Dev first, then run focused tests,
   TypeScript, scoped ESLint, build, and diff checks. Include 360px, 390px, and
   desktop browser verification and unauthorized/cross-Group tests.

Read the installed Next.js 16.2.4 route-handler and caching docs before choosing
or implementing framework cache APIs.

## Decision options

**A — Complete the data foundation first (recommended for the requested scope).**
Design consistent current-season acquisition and batch summary coverage, a
verified NBA identity expansion or verified native-ID fallback, and K/D/ST
historical adapters. Keep existing scoring unchanged: unsupported kicker fantasy
points remain explicitly unavailable. Prepare any required schema/operational
changes for separate approval; do not run production ingestion or identity
updates. Provider-backed detail fetches can supply shooting and previous-season
records without requiring those fields to be persisted immediately. Full draft
pool sorting must wait for validated coverage rather than silently showing an
old season. This is broader than replacing UI components, and any production
write remains separately gated by the user's instructions.

**B — Explicitly accept a limited, zero-database-write first release.**
Implement cached ESPN detail profiles for reviewed NBA identities and NFL
offensive players, use existing stored observations for batched sorting, and
label source season and coverage everywhere. Unmapped NBA players and absent
current-season summaries remain unavailable; K/DST need clearly limited
experiences. This could improve research now, but it would not satisfy the full
requested coverage. It is not being implemented without an explicit scope
decision.

No schema migration is inherently required to display fetched profiles. The
checkpoint is the combination of missing identity/current-season/batch coverage
and unsupported historical positions, not a claim that all read-only improvements
require production writes.

## Validation performed

- Read-only schema/coverage/identity/freshness queries and live provider GET
  probes described above.
- `node --test tests/nba-analytics.test.cjs tests/nfl-observation-foundation.test.cjs tests/nfl-observation-acquisition.test.cjs tests/nfl-draft-board.test.cjs tests/draft-v2-projection-integration.test.cjs`
  — **52 passed, 0 failed, 0 skipped**.
- These are baseline parser, scoring, observation-acquisition, and draft-contract
  tests. They do not validate a new UI or promise end-to-end provider coverage.
- No interactive Dev, mobile/browser validation, TypeScript, scoped lint, or
  production build was run for an implementation: no implementation was made.
  The only local change is this audit document.

## Existing local preview

Run `npm run dev` from the repository, sign in, select a Group, and inspect
`/lineups/draft?sport=nba` or `?sport=nfl`, `/lineups`, and `/player-history`
with the appropriate sport selected. There is no new Player Center preview yet.
Do not invoke refresh/sync/ingestion controls as part of a read-only preview.

The Bracket Challenge stash and both ShotCast worktrees were inspected only via
Git metadata and remain untouched. No commit, push, deployment, or database
mutation was performed.

## October 26 status reconciliation

This document preserves the initial read-only audit. Subsequent local foundation, guarded rollout preparation and approved shared UI are implemented; the latest real-app integration adds durable cache readers and a default-off production launch gate. The latest NFL investigation resolves the sampled missing LOST fields with provider evidence. None of that applies production mappings/schema/backfills or certifies current full-pool coverage. Use the current [UI instructions](./player-center-ui.md) and [rollout checkpoints](./player-center-production-rollout.md#local-integration-and-rollout-readiness--october-26) for readiness, rather than treating the earlier “paused/no UI” audit outcome as current implementation status.
