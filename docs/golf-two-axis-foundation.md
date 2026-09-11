# Golf configuration foundation and NFL lifecycle correction

## Parked checkpoint — September 11, 2026

The existing foundation is coherent and validated **as inactive application logic and unapplied SQL design**, not production-ready database behavior. This checkpoint does not start another Golf feature.

Done: three independent rules axes and frozen/default snapshot resolution; pure Standard delegation and accepted-hole Best Ball scorecards; explicit eligible rosters; conservative roster-period evaluation; retained fact/identity/revision/audit design; opt-in initialization, writer and shared transaction contracts.

Not activated: production selectors/acquisition, runtime enrollment, true Golf Snake, Salary Cap, provider-normalized weekend evidence/deadline policy, production writer dispatch/legacy-writer guard, Best Ball materialization, Standard split scoring, Golf Live/navigation redesign, and automated salaries/111 Value. Playoff scoring and unverified multi-course comparisons remain outside the scorer's supported input contract. SQL still needs separately authorized disposable-Postgres testing before deployment consideration.

Only checkpoint fixes: stored completion now reports a retained-completion reason and clears a stale completed current-period pointer; the SQL reviewed-confirmation clock is sampled after serialization locks, rejects infinite timestamps, and aggregate result aliases avoid collision with the PL/pgSQL period record. Focused regression checks cover those corrections. No acceptance policy, production route, rules default or scoring formula changed.

Validation: all five focused Golf foundation suites plus existing reconciliation, correctness and Groups batch 4 passed (eight test files). TypeScript passed; tracked diff and new/untracked Golf-file whitespace checks passed. Both migrations were reviewed statically only and remain unapplied. Unrelated NBA analytics/projection files are preserved byte-for-byte against the checkpoint's initial hash inventory. No build, provider research, SQL execution, database write, commit or push.

Recommended next Golf step, when separately requested: disposable-Postgres transaction/RLS/rollback/concurrency validation of the unapplied migrations. No such work is started here.


Inspection date: September 10, 2026. Work remains uncommitted on `main`.

## Scope and completed foundation

The continuation resumed exactly two dirty paths: `lib/rules/leagueRules.ts` and the new `tests/golf-rules.test.cjs`. Both were preserved. The original tree was clean before this session began.

The canonical rules module now exports `GolfGameType`, `GolfDraftType`, `GolfRosterPeriodType`, `GolfRules`, and the opt-in `resolveGolfRules`. The filename is retained to preserve existing links. Example resolved snapshot:

```json
{
  "schemaVersion": 1,
  "sport": "golf",
  "gameType": "best_ball",
  "rosterPeriods": { "type": "split_after_round_2" },
  "roster": { "slots": [{ "position": "GOLFER", "slotCount": 4 }] },
  "draft": { "type": "salary_cap", "salaryCap": 100 },
  "scoring": {}
}
```

Use `gameType` for scoring, `draft.type` for acquisition, and `rosterPeriods.type` for roster lifecycle. Keep `roster.slots` as the single roster-size representation; do not add a competing `rosterSize` default. `draft.salaryCap` exists only for Salary Cap. The default is 100; an explicit positive finite numeric value is accepted. No floor, ceiling, or odds formula has been added to rules.

| Game Type | Draft Type | Resolved cap |
| --- | --- | --- |
| Standard | Snake | Absent |
| Standard | Salary Cap | 100 unless configured |
| Best Ball | Snake | Absent |
| Best Ball | Salary Cap | 100 unless configured |

Each row independently supports both `full_tournament` and `split_after_round_2`: all eight combinations resolve and round-trip. Missing or invalid `rosterPeriods` resolves to Full Tournament, including old two-axis snapshots. Changing only period type preserves the cap, roster and scoring settings. There is no Best Ball condition in the period resolver. The third dimension needs no schema/backfill and is not exposed in production UI.

Missing/invalid game types default to Standard. Missing/invalid Golf draft types default to snake conventions. `linear` is not a supported new Golf draft type; the existing general resolver still preserves its previous linear behavior. Sport-tagged NBA/NFL settings are discarded by the new Golf resolver. Untagged settings must still be obtained through the correct authorized Golf league; a pure resolver cannot authenticate their origin.

Resolve either current authorized Group league settings for a new slate, or the existing slate snapshot for an existing competition. Never merge the current Group settings into a historical snapshot. JSON round trips preserve all three axes and custom roster/cap values. No migration, default/backfill SQL, or historical rewrite is needed for these fields.

**This is a configuration contract, not runtime activation.** Existing `resolveLeagueRules`, slate creation, reconciliation, and lineup mutations do not call the new resolver. They continue their prior behavior. Production selectors are intentionally absent. New configurations must not be persisted through the old general resolver: it does not preserve the new axes. A later guarded integration must update both producer and consumer paths together.

## Existing Golf architecture

`lib/rules/leagueRules.ts` currently supplies schema version 1, sport `golf`, GOLFER slots (four by default), `draft.type: snake`, and empty numeric `scoring`. `app/api/slates/route.ts` resolves the active league's `settings`, optionally applies requested roster slots, and persists `rules_snapshot` and `rules_version`. The latter derives from the league settings version. Golf cut settings (`has_cut`, `cut_penalty_per_round`) are separate slate columns, not fields in that JSON scoring object.

Group context resolves the enabled league through Group identity, sport, and existing `game_mode: standard`. Do not repurpose the league's `game_mode` as one of four combined modes or create four league records. The new axes belong inside rules. Existing Group administration has NBA/NFL roster/scoring controls and NBA Skins draft controls; inspection found no comparable two-axis Golf editor. Golf slate creation already supports roster slots. A later Golf commissioner settings action needs scoped authorization and versioned settings updates; the resolver alone is not an authorization layer. Current slate POST uses `requireAdminApi` and active-league lookup; do not assume all commissioner roles can already create slates through that route.

### Acquisition today

`app/api/lineups/route.ts` accepts a desired array of golfer IDs, checks active Group/slate/team scope and own-team versus proxy permission, validates active Golf players and membership in `golf_event_players` for the tournament, rejects duplicate IDs within a roster, checks configured slots and maximum count, and rejects a locked slate. Partial rosters are allowed. The lock is the explicit slate flag; this Golf save path does not independently enforce first-tee timestamps or future period locks.

Golf creates a lineup if needed and then removes/adds lineup-player rows in separate requests. It does not call `mutate_fantasy_draft`, enforce one pick, check next participant, freeze order, or record an authoritative pick cursor. The inspected route has no cross-roster uniqueness check for Golf and no POST participation check equivalent to the authoritative NBA/NFL mutation. This is a code finding, not an assertion about undocumented production database constraints.

The UI tracks owners and, when assigning an already-owned golfer to another team, attempts to remove the old ownership before saving the new one. Those writes are not atomic. Server authorization still applies to each team mutation. Commissioners/Group admins and the existing legacy admin role can proxy through `canProxyDraftForGroup`; ordinary members can edit their own team. Golf's legacy transfer behavior is preserved in this pass.

`slate_teams.draft_order` orders participant presentation, provides a Traditional scoring tiebreak, and drives `lib/draftNotifications.ts`. For Golf, notifications infer the next snake participant from the total count of current lineup entries and alternate direction each round. This is advisory and can diverge after roster edits. NBA/NFL notifications instead use authoritative history. Therefore **Standard + Snake is the conceptual historical default, not evidence of previously enforced sequential Golf drafts**.

### Standard scoring and accepted state

`reconcileGolf` reads the accepted revision, `golf_event_players` with nested `golf_rounds(*, golf_holes(*))`, lineups, slate teams, existing results, and slate cut settings. `reconcileGolfState` clones the accepted events, applies acceptance rules, and recomputes accepted totals and progress. It calls `calculateGolfPenaltyStrokes` from `lib/scoring/golf.ts` and then `calculateGolfTeamResults` from `lib/golf/teamResults.ts`. One `commit_golf_reconciliation` RPC persists the accepted golfer/round/hole/team changes with an expected revision; a conflict triggers fresh reads and recalculation.

Traditional scoring sums golfer `fantasy_score` (accepted score plus existing missing-round penalties). Lower wins. Tiebreaks are lowest completed team round, lowest completed individual round, most birdies or better, fewest bogeys or worse, draft order, and finally team ID. Four tournament rounds remain independent of roster size. This implementation and the acceptance/penalty functions were not modified.

## Recommended implementation seams

### Authoritative Snake

Reuse the pure `getDraftTurn` chronology from `lib/lineups/draftHistory.ts` and the existing immutable pick/correction concepts. It already accepts participant IDs, roster size, last pick, and roster counts without sport dependencies. Preserve chronology when correcting assignments.

Keep a Golf-specific validation/mutation surface initially, backed by the shared snake calculation and equivalent transactional guarantees. The existing server wrapper and SQL explicitly restrict sports to NBA/NFL, query their player tables, validate positional assignments, and enforce uniqueness by slate. Adding Golf to a TypeScript union is insufficient.

Future Golf mutations should lock the competition/period draft, validate Group/league/active participant/proxy authority, freeze participant order, compare expected roster/history versions, validate the tournament field and period, enforce one pick by the authoritative participant, prohibit duplicate ownership within that period draft, and commit pick plus assignment together. Reuse/generalize the history tables only in a reviewed migration with period-aware uniqueness and Golf field validation. Do not reinterpret old roster rows as a trustworthy pick sequence or silently initialize ongoing historical drafts.

### Salary Cap

Use a separate atomic roster submission mutation; do not invoke snake turn/history enforcement or next-drafter notifications. Check Group, league, slate, active participant, roster period, actual lock/deadline, golfer eligibility, duplicate IDs within that roster, exact roster count at submission, and total frozen salary under the cap. Allow the same golfer on different teams. If partial drafts are supported, distinguish saving a draft from final submission.

The server loads the immutable price-set reference and rules from the competition/period. Never accept client prices, caps, eligibility, or lock flags as authoritative. Use expected roster revision to reject concurrent stale edits. Scoring receives the resulting roster regardless of how it was acquired.

### Best Ball

The exact input is the post-acceptance `events` array inside `reconcileGolfState`:

- Event: `id`, `player_id`, `status`, accepted totals, `golf_rounds`.
- Round: `id`, `event_player_id`, `round_number`, `holes_completed`, `score_to_par`, `strokes`, `accepted_revision`, `golf_holes`.
- Hole: `round_id`, `hole_number`, `strokes`, `relative_to_par`, `score_display`, reconciliation provenance. `AcceptedHole` in `holeAcceptance.ts` defines the usable score fields. Retracted/unplayed holes have null scores.

Insert a scoring dispatch at the existing team-results calculation, after acceptance and before transactional commit. Standard delegates unchanged to `calculateGolfTeamResults`. Best Ball should receive eligible period rosters and these accepted holes; select the lowest accepted `strokes` for each comparable actual course hole and preserve reliable par/relative-to-par, with null if nobody has an accepted result. Never manufacture par for a missing hole, derive Best Ball from golfer totals, or ingest provider payloads there. Keep provisional progress distinct from finality when some rostered golfers have not completed that hole. The current simplified `competitors` adapter drops hole numbers; use the full accepted graph for Best Ball.

The scorer must depend on `gameType`, not `draft.type`. Recalculate when roster-period inputs change as well as when accepted scoring changes; the current `scoringChanged` optimization alone is insufficient for a new roster. Include roster revisions in concurrency protection. Persist any future Best Ball materialization in the same reconciliation transaction, not a follow-up write.

Current course metadata describes one host course per slate; hole records do not identify per-golfer multi-course rotation. Start the pure seam with explicit round/hole identity on a common course. Do not silently combine unlike courses or assume course-hole equality in multi-course events. Resolve that support before enabling such tournaments.

### Independent roster periods

Prefer one tournament slate with normalized roster-period rows: one R1–R4 period for Full Tournament, or opening (R1–R2) and weekend (R3–R4) for Split After Round 2, each with eligibility/lock state and roster revisions. This applies equally to Standard and Best Ball. Team-period rosters reference that period. Snake history and exclusive ownership are scoped to the period; Salary Cap roster submissions also reference it. A golfer can appear in both periods, and ownership can change completely for the weekend. Maintain one competition result summing the period contributions, rather than two unrelated tournament results.

Period transitions must use confirmed tournament round completion and cut resolution when applicable, not a Saturday/calendar check. A no-cut event still splits after R2; it does not wait for a nonexistent cut. Weather-delayed R2 must leave the weekend closed. Unknown/incomplete evidence keeps it closed, with an audited commissioner transition only after validating the state. Lock weekend acquisition before the first R3 play. A tournament with overlapping R2/R3 or no usable acquisition window needs an explicit handling rule before split-mode activation.

Standard + Split cannot simply sum each period roster's full-tournament `fantasy_score`: that would charge rounds belonging to a different roster. Introduce round-scoped Standard contributions and explicitly define missing-round penalties/tiebreaks for split competition, while leaving Full Tournament Standard byte-for-byte equivalent in behavior. Both scorers should receive eligible rosters by round; neither should decide period lifecycle or acquisition.

Legacy lineups retain their current meaning; do not duplicate or backfill them merely for the axes. Periods, transactional acquisition, and salary storage will eventually require reviewed schema/RPC work, but no migration has been prepared or run in this pass. Weekend eligibility should use accepted cut/status state, with a controlled opening after the cut is settled. Best Ball tiebreaks and withdrawal/partial-hole finality need explicit rules before product activation. Salary Cap Standard also needs a deterministic non-turn-order substitute for the existing draft-position tiebreak; do not create a turn requirement to satisfy it.

## Odds and salaries

Read-only provider inspection:

| Source | Observed result |
| --- | --- |
| [ESPN 2026 scoreboard](https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026) | Complete 25,512,368-byte payload; 49 events, including completed events with golfer scorecards and upcoming events. Recursive search found no odds/probability/moneyline/price keys. |
| [Upcoming event leaderboard](https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard?event=401850914) | Valid JSON for Biltmore Championship Asheville, status Scheduled/pre; no competitors or odds fields. |
| Scoreboard with `dates=2026&event=401850914` | Download timed out with incomplete JSON; excluded from conclusions. |

Completed TOUR Championship entries expose golfer identity at `events[].competitions[].competitors[].id` (e.g. 9478), with athlete names and scorecards. Existing `golf_players.espn_player_id` can map those IDs. No verified golfer outright-odds field, odds format, or odds-to-ID association was found in the inspected feeds. This does not prove ESPN never exposes odds elsewhere or nearer tee time. It does mean current infrastructure is not demonstrated reliable enough for automatic v1 odds pricing. Pre-start odds availability and post-start disappearance/change cannot be inferred from this sample. There is no justified production odds endpoint or formula to implement yet.

Current Golf provider code handles scoreboards/course data; `golfRankings.ts` supplies ranking data. Football spread/total odds helpers are not golfer outright odds. No paid service was added.

Recommended salary storage: immutable price-set header with slate/league scope, provider event ID, captured/frozen timestamps, source/market metadata, input hash, and pricing formula version when a formula exists; entries keyed by price-set ID and stable Golf player ID, with integer salary units and optional raw source odds. Roster periods reference the frozen set. Freeze the tournament set before competition starts; do not silently use live odds for weekend prices. Validate complete eligible-field coverage and at least one legal roster before publishing. Current league rules can hold a cap, but per-golfer tournament salaries should not live on global golfer records or mutable Group defaults.

Candidate pricing experiments, not chosen production math: let floor F be 10–15, ceiling C approximately 42, and q be field strength percentile from 0 to 1.

| Candidate | Sketch | Tradeoff |
| --- | --- | --- |
| Implied-probability curve | Convert American odds to p, normalize across the complete outright market, then `F + (C-F)*(p/p_max)^a` | Preserves favorite strength; exponent controls how quickly prices approach the floor. Requires complete, same-market odds. |
| Field percentile | `F + (C-F)*q^b` from odds rank or frozen rankings | Works without odds magnitudes; cannot distinguish an overwhelming favorite from a narrow favorite. |
| Log probability | Scale `log(p)` between field minimum and maximum into F…C | Spreads middle prices; sensitive to extreme longshots, so evaluate robust bounds. |
| Blend | Weighted probability-curve score and percentile score, then map into F…C | Balances favorite separation and usable mid-field pricing, with more calibration. |

For positive American odds A, raw p is `100/(A+100)`; for negative odds it is `abs(A)/(abs(A)+100)`. These are transformations for experiments, not a claim that the provider returned American odds. No actual golfer odds were fetched, so there are no honest provider-derived salary examples to show.

For all candidates test that a four-golfer roster can fit, that four elite golfers generally cannot, and that a 42 favorite still leaves feasible choices under 100. Evaluate multiple field strengths and field sizes; do not guarantee those properties merely by selecting a floor and ceiling.

Updated v1 recommendation after the follow-up source investigation: prioritize commissioner-reviewed **odds** paste/import, then salary generation/review and frozen publication. Odds remain the preferred input; ranking tiers are an explicit alternative only if chosen, not an automatic replacement. If odds are absent, require reviewed salaries or mark golfers unavailable; never silently price missing golfers at the floor or mix live and pre-tournament sources. Keep the formula replaceable behind the price-set contract. Detailed source findings and the revised roadmap follow below.

## History, UI, and next batch

`lib/profile/golfTeamProfile.ts` loads league-scoped slates/results/awards and computes wins, win rates, and other Golf milestones without selecting `rules_snapshot` for mode segmentation. Before enabling alternate scoring, history must resolve snapshots and label `Standard · Snake`, `Best Ball · Salary Cap`, etc. Do not pool Standard score totals, winning margins, or Best Ball scores into misleading aggregates. Keep acquisition metadata even when scoring aggregates intentionally group by game type.

Future compact creation UI: three independent selectors labeled **Game Type** (Standard / Best Ball), **Draft Type** (Snake / Salary Cap), and **Roster Periods** (Full Tournament / Split After Round 2), with conditional controls. Preserve unrelated roster/settings state when switching selectors. No rendered UI changed for Golf, so its defaults and mobile layout remain familiar; alternate-mode UI and server submission behavior are not claimed tested or enabled.

**Exact next build batch: Golf accepted-state scoring strategy boundary and pure Best Ball hole reducer.** Extract a narrow accepted-state scoring input, delegate Standard unchanged, and unit-test a pure Best Ball reducer using explicit eligible roster-period inputs, round/hole identity, null holes, and accepted corrections. Keep it out of production selection/materialization until period storage and transactional integration are ready. Do not modify acquisition or enable UI in that batch. This can proceed without a final salary formula or database migration. Follow with a reviewed period/schema design and authoritative Golf acquisition work.

Reuse canonical roster/rule helpers, `getDraftTurn`, scoped authorization, provider ID mappings, accepted reconciliation, penalty/ranking functions, and existing draft/history and Golf tests. Keep GroupProvider, Group switching, provider acceptance semantics, Traditional history, NBA/NFL draft mutations, and scoring formulas untouched.

## Separate NFL Scores correction

Root cause: `ScoresDashboard` calculated the team partition from the matched slate game through `nflRosterStatusCounts`, and the action used that same game through `nflGameActionLabel`. Its expanded row instead called the NBA-style `getPlayerGameStatus(raw)`, reading an independently refreshed stored player stat. A stale numeric live status therefore rendered Live while schedule state post rendered View Final and incremented the final count. This reproduces the reported contradiction without requiring a JSN-specific condition or a scoring change.

`nflRosterPlayerStatus` now resolves both NFL row labels and team counts: matched slate game first, numeric stored status only when no game is mapped. Stale text never invents a final. No-stat offensive players and D/ST follow their team game. Unknown mapped states remain left; absent mappings preserve the previous numeric-stat fallback and otherwise remain Upcoming/left, with no fabricated game action. NBA's display helper remains unchanged.

Pre/in/post produce Upcoming/View Game, Live/View Live Game, Final/View Final respectively. The provider normalizer preserves canceled/postponed/suspended states instead of treating a provider `post` state as completed. Those games stay mapped, count as left, show their exceptional label, and omit the misleading game action. No fantasy-point calculation changed.

NFL files changed: `components/lineups/ScoresDashboard.tsx`, `lib/lineups/nflRosterStatus.ts`, `lib/live-scores/nflFantasyGames.ts`, `lib/providers/nflLiveScores.ts`, and `tests/nfl-roster-status.test.cjs`.

## Validation

Focused Golf rules tests: 9 passed. Focused NFL roster-status tests: 8 passed, including rendered expanded rows/actions and the existing partition checks. All 15 files passed in the combined validation: Golf rules/correctness/reconciliation, Groups batch 3b/4/5/security, NBA/NFL draft history, slate sport switching, NFL roster status/fantasy games/live integration, live scores, and Scores mobile/stat-headshot tests. `npx tsc --noEmit --pretty false` and `git diff --check` passed.

Rendered tests use the existing React hook harness; no authenticated production browser or Supabase data was changed. No production build, SQL, migration execution, commit, or push was performed.

## Follow-up: odds sources, identity, Golf Live, and dependency order

This targeted follow-up changes only the opt-in Golf resolver, its tests, and this report. The five NFL fix files remain as previously validated. No production mode, period persistence, provider adapter, or navigation change is made.

### BetMGM: documented contract versus usable access

The [Sports API documentation](https://sportsapi.wv.betmgm.com/restapi/swagger.html) describes `GET /offer/api/{country}/sports`, `/offer/api/{sportId}/{country}/competitions`, and `/offer/api/{sportId}/{country}/fixtures`. Fixtures expose markets/options, translated names, participant IDs, and `price.odds` / `price.usOdds` (decimal/American representations). Competition enumeration can include participants. Fixtures can be filtered to pre-match and specific competition IDs. The default `onlyMainMarkets=true` means a future authorized test must check whether outright markets require broader market selection. These are documented capabilities, not observed Golf responses.

The [authorization documentation](https://sportsapi.nj.betmgm.com/restapi/tokenrenewal.html) says Access ID and Access ID Token are required and issued to affiliate partners. Accordingly, investigation stopped at documentation; no credentialless sports/fixture enumeration, copied frontend credentials, or state hopping was attempted. Public documentation is technically accessible. Current PGA competitions, upcoming outright markets, full-field coverage, participant-ID stability across events, and Ohio API availability remain **unverified**. Public NJ/PA/WV/IN documentation hosts do not establish an Ohio feed or identical state content. Store any eventual participant ID together with source and feed/jurisdiction, not as a globally interchangeable ESPN ID.

The [API terms](https://sportsapi.in.betmgm.com/restapi/termsofuse.html) refer to an affiliate agreement, require caching/restrictive queries, and reserve data availability controls. Thus permitted use for this personal app is not established, and reliability cannot be evaluated without authorized coverage tests. No price for such access was established. A documented API could be maintainable with permission, but it is not a free unauthenticated feed recommendation.

### PGA TOUR / Golfbet

[Golfbet's public presentation](https://www.pgatour.com/fantasy-betting) includes DraftKings odds content. The [2026 Betcast announcement](https://www.pgatour.com/article/news/betting-dfs/2026/02/02/pga-tour-partners-with-espn-draftkings-to-expand-pga-tour-live-betcast-coverage-in-2026) identifies DraftKings as a betting-content partner. This establishes sportsbook-related editorial coverage, not a full-field feed. Search-indexed articles contain selected golfers and odds; they do not prove continuous pre-tournament coverage or a stable player-ID/price contract.

[PGA TOUR terms, section 7(C)](https://www.pgatour.com/company/terms-of-use) prohibit automated monitoring/copying/downloading of data. Per the user's restriction, no frontend GraphQL odds query, browser-token extraction, or data-page scraper was attempted. Existing local provider code demonstrates PGA player IDs and GraphQL use for other Golf functions, but was neither executed nor expanded. Whether the current odds frontend receives complete structured outrights, which exact query/fields it uses, and full-field availability remain unverified. Structured JSON would reduce HTML-layout coupling only with a permitted access contract; it would not resolve this access limitation. Do not add a Golfbet data dependency without permission.

### Aggregator comparison

Evidence below distinguishes documentation from actual authenticated dataset validation. No account, trial subscription, or purchase was created.

| Candidate | Weekly PGA outright coverage | Cost/access | Assessment |
| --- | --- | --- | --- |
| The Odds API | Its Golf documentation explicitly lists only the four majors | Free 500 credits/month; API key required. Paid entry $30/month; history paid | Reject as the weekly PGA source. Supports American/decimal odds and multiple books, but coverage fails the requirement. |
| stat-api | PGA docs claim regular tour stops and `tournament_odds`; a permitted trial returned actual numeric outright rows | Public demo is restricted to allowlisted sample URLs. Homepage advertises 25-row previews and promotional Starter $49/month (regular $99), 5M records/month | Technically promising but over budget; sample is not proof of timely weekly full-field coverage. No production license/retention entitlement verified. |
| BALLDONTLIE | PGA `futures` docs include non-major FedEx St. Jude example, golfer IDs, `vendor: draftkings`, and `american_odds` | Futures require GOAT: $39.99/month per sport, 600 requests/minute. Free/basic and $9.99 All-Star do not include futures. Authorization API key | Credible structured candidate if budget changes; per-event market availability varies. No full-field/history/reuse guarantee validated. |
| Odds-API.io | Golf page claims PGA/DP World/LIV, tournament-winner outrights, and several books | Advertised free tier: 100/hour, 500/day, two recreational books. Current homepage says new free keys paused indefinitely. Paid Solo £49/month | Not presently a verified affordable option. Golf page's sample is generic Team A/Team B moneyline data, not proof of full golfer outrights. |
| SportsDataIO / Discovery Lab | Golf workflow documents pre-tournament winner markets, opening/movement/closing timestamps | Free trial data scrambled. Discovery free is last season only; real next-day delayed Odds plan $99/month or $599/year; 100–1,000 calls/day by tier; API key | Reject at this budget. Personal-use Discovery has no SLA and no commercial redistribution license; current full-field access not tested. |

Sources: [The Odds API coverage](https://the-odds-api.com/sports/golf-odds.html) and [pricing](https://the-odds-api.com/); [stat-api pricing](https://stat-api.com/) and [PGA schema](https://stat-api.com/docs/graphql/reference/pga/); [BALLDONTLIE PGA documentation](https://pga.balldontlie.io/) and [pricing](https://www.balldontlie.io/); [Odds-API.io Golf](https://odds-api.io/sports/golf), [current pricing/paused keys](https://odds-api.io/), and [free-tier use limitations](https://odds-api.io/pricing/free); [SportsDataIO product tiers](https://sportsdata.io/developers) and [Golf workflow](https://sportsdata.io/developers/workflow-guide/golf).

Do not infer that a provider's general sportsbook list guarantees all listed books for every Golf event. American values are directly documented for The Odds API and BALLDONTLIE; stat-api's schema has numeric `outright_odds`, `sportsbook`, `player_id`, and `tournament_id`. Odds-API.io offers decimal-looking sample prices, but that generic sample does not establish a Golf-outcome schema. Each provider needs a persistent source-ID crosswalk or reviewed name mapping. Odds timestamps/history and retention rights must be verified for the subscribed product, rather than inferred from a general historical-data claim. Rate ceilings not listed here were not verified.

Actual stat-api probe: the older rendered-doc default `tournament_id=1` returned HTTP 401 `trial_key_invalid_url`. The response explicitly directed callers to the public defaults document. Reading `https://api.stat-api.com/api/openapi/defaults.json` supplied the allowed `/api/v1/pga/tournament_odds?tournament_id=524`. Using the published `trial_demo` token at that exact URL returned HTTP 200: **10 rows**, one sportsbook (`betonlineag`), source golfer IDs, and `outright_odds` from +12500 to +50000. No attempt was made to page around the trial restriction. Files are under `/tmp/golf-stat-api-*`, not in git. This demonstrates accessible structured sample odds, not a current complete tournament market. The documentation/default mismatch is itself a maintenance concern.

Best automated-source recommendation **within the stated budget: none verified**. Confidence is high that The Odds API fails weekly coverage and that the inspected paid tiers exceed the rejected $30/month level. Confidence is moderate in the broader negative conclusion: a negotiated hobby tier or newly available free feed could change it. BALLDONTLIE is worth an authorized sample test if the budget changes, but is not cheaper than the excluded Data Golf option. Keep the importer source-neutral and odds-first; do not replace odds with rankings by default.

### Direct sportsbook scraping

No sportsbook odds pages were programmatically scraped or reverse engineered. [DraftKings general website terms](https://myaccount.draftkings.com/documents/us-terms-of-use), [FanDuel general terms](https://www.fanduel.com/terms), and [Caesars website terms](https://www.caesars.com/corporate/terms-of-service) contain restrictions on automated access/collection. These reviewed general/DFS/corporate documents are not a claim to have audited every state's sportsbook contract. They provide no permission for this task; direct scraping is not recommended. BetMGM has a partner API route but no verified permission for anonymous HTML harvesting. Its attempted general terms URL did not yield usable content, so no specific US HTML-scraping clause is asserted.

For all four, server-rendered full-field availability and exact login/geolocation/session/browser/challenge requirements were not tested after the permission limitation. Do not claim those controls are absent merely because public odds are visible to a human. An undocumented frontend dependency is brittle even if a single request works. Reject direct scraping as the app's dependency; do not buy a bypass/scraping service as a substitute for permission.

### Identity and manual odds fallback

Existing `golf_players` has stable internal `id`, `espn_player_id`, `display_name`, `short_name`, country and player URL. Current import code also consumes `owgr_player_id`, ranking fields and headshots. Notably, `app/api/admin/golf/import-field/route.ts` creates temporary `espn_player_id: pga:<id>`, puts a PGA ID in `owgr_player_id` for newly imported players, and builds a PGA player URL. Refresh later reconciles those placeholder ESPN identifiers. Do not treat every `owgr_player_id` as a verified PGA ID, and do not replace placeholder/provider IDs or create duplicate golfers for salary import. The inspected schema has no generic verified provider-ID crosswalk or stored canonical normalized-name field.

Matching order: verified `(source, source_player_id)` mapping → unique normalized exact name within this tournament field → reviewed alias mapping → commissioner resolution. Keep candidate matching separate from accepting a mapping. Accent/case/whitespace normalization is useful; avoid blindly stripping suffixes because that can collapse distinct names. Existing field import rejects ambiguous normalized names; reuse that behavior, not fuzzy acceptance. Record original source names and manual resolution provenance. Known PGA mappings may seed proposals after verification but must not be inferred solely from a loosely matched replay name.

Smallest input: pasted lines with a name followed by a signed American-odds token, parsed from the right (`Scottie Scheffler +450`). Also accept two-column CSV/TSV (`name,american_odds`) for spreadsheet users. Capture source, tournament, market=outright-winner and observation time once per import. Preview rows with matched/unmatched/ambiguous/duplicate/invalid status, reject incomplete odds tokens or mixed markets, and require explicit review before generating/publishing salaries. Reject zero and malformed American odds; define support for EVEN explicitly rather than guessing. Never silently select between conflicting prices for the same player. Missing golfer rows require reviewed pricing or explicit unavailability, never a cheap default.

This manual **odds** primary v1 workflow preserves tournament-specific market expectations and is the recommended first ingestion path. It should use user-supplied data they are permitted to import; it is not an instruction to harvest a prohibited site.

### Immutable pricing and split-period recommendation

Eventually add verified provider-ID/alias records, price-set headers/entries, review audit, roster periods and period assignments. These are future schema proposals; this pass adds no SQL. Header: league/slate/tournament scope, source event/market/book, source observation and retrieval times, formula/version/parameters, reviewed/frozen timestamps and actor, status, and immutable content hash. Entry: internal golfer ID, source ID/name, raw odds and format, derived probability if used, generated salary, final integer salary, availability, override actor/time/reason. Separate raw observations from the immutable published set. Freeze **before acquisition opens**, not merely before tee-off, so early entrants and later entrants use identical prices. Subsequent odds changes never mutate an opened set or a historical roster reference.

Recommend **the same pre-tournament price set for both split periods in v1**, with weekend eligibility independently excluding cut/withdrawn/ineligible golfers. It is simpler, fair across entrants, requires no Friday data source, and offers a second chance to select survivors at familiar prices. A disadvantage is that cheap golfers performing well become popular weekend choices, especially with shared Salary Cap ownership. That is transparent and can be evaluated after playtesting.

A separately frozen weekend set offers fresh scarcity and variety, but current outright-win odds heavily reflect the existing leaderboard, while the weekend roster scores only R3–R4. Repricing from those odds could charge for strokes that the roster will never receive. Weekend-only performance markets would be more aligned but harder to source. Do not add a fourth configurable pricing-policy dimension in v1; keep the period-to-price-set reference capable of supporting a future deliberate change.

### Pricing experiment limits and next calibration

The stat-api sample contains only ten longshot rows, without golfer names, confirmed event date or the complete market. It cannot establish the tournament favorite, second/third tier, or ranks 10/25/50. It is **not a usable full-field calibration dataset**. Its observed +12500 and +50000 correspond to raw implied probabilities of about 0.794% and 0.200%; renormalizing only these sample rows would greatly overstate their chances. No fabricated representative golfer salaries or field ranks are reported.

Retain the four candidate experiments above: implied-probability power curve; field percentile; log probability; probability/percentile blend. Use same-book, same-market, same-time complete odds, deterministic tie handling and rounding. Compare the favorite, #2/#3, #10, #25, #50 and deepest longshot, then enumerate representative rosters and test feasible counts. With incomplete data, defer empirical calibration rather than treating the largest available longshot probability as the favorite.

Illustrative design checks only, not fitted salaries: `42+26+18+14=100` should be feasible if those tiers exist; `42+36+32+29=139` should exclude an all-elite roster; `28+26+24+22=100` should offer a balanced alternative. A blend is a candidate worth testing, not the selected production formula. Include a cap/roster-size feasibility check when publishing each actual price set.

### Golf Live roadmap

Current locations:

- `components/home/SportHomePage.tsx` has its own fantasy/tournament tab and embedded Tournament Leaderboard (top 50, separate mobile/desktop rendering).
- `components/lineups/GolfScoresDashboard.tsx` switches among fantasy, league, and tournament views; the tournament branch renders `GolfTournamentView`. `GolfLeagueView` is a fantasy league view, not another full PGA leaderboard.
- `components/home/FunFactCarousel.tsx` labels its Golf ticker Tournament Leaderboard. Review its usage/text during cleanup; it should not become another full tournament destination.
- `components/AppNav.tsx` adds Live only for NFL. `app/live-scores/page.tsx` currently authorizes and renders NFL unconditionally, so adding `sport=golf` to a link alone would be incorrect.

Recommended route: extend the existing `/live-scores?sport=golf` destination with a sport-specific server access check and a dedicated compact Golf client view, preserving NFL. Retain active Group/league/slate context and a tournament selector. Key loaded state and requests by Group + league + slate, reject stale responses, and show no ownership from other Groups. Do not change GroupProvider or expand provider ingestion for this UI work.

Reuse `buildGolfLeaderboardRanks`, cut/status helpers, `ReadOnlyPlayerModal` → `GolfPlayerModal`, scorecards, `GolfInlineHoleReplayModal`, and `GolfHoleReplayPanel`. Existing `/api/player-stats?slateId=…` supplies accepted golfer/round/hole state, team results and accepted revisions. Player-pool/lineup loading already supplies identities and rosters. A new provider endpoint is unnecessary for the initial slate-backed Live view. A small scoped aggregate read endpoint is optional if combining existing reads proves unwieldy; it must read the same accepted state. Showing arbitrary tournaments without a Group slate is a separate scope, not included in this batch.

Use one dense table/list: position, golfer name, tournament score, today, thru/tee time/status. Put owner indication inline, not a card per golfer; keep search and Mine/Drafted filters compact. Avoid fixed desktop widths or forced horizontal scrolling on mobile. Rows open the existing golfer detail/replay path. Preserve revision-guarded refresh and correction behavior; display official tournament score, not fantasy penalties.

Replace `GolfTournamentView`'s current `Map<playerId, OrderedTeam>` (which overwrites multiple owners) with a period-aware `Map<playerId, Owner[]>`. Highlight own ownership first with a clear marker and accessible text; show other ownership subtly as a team badge or count. For shared Salary Cap ownership, display `You + 2 teams` or a count opening a short owner list; do not imply exclusive ownership or duplicate leaderboard rows. Deduplicate a team's golfer across relevant roster records. Opening and weekend ownership must be selectable/labeled, with completed-period history retained.

Exact future UI batch: create the Golf Live branch and compact accepted-state leaderboard with multi-owner presentation and modal/replay access; add Golf Live to bottom navigation; replace Home's tournament tab and Scores' tournament branch with context-preserving links to Live. Keep Home fantasy summary, Scores fantasy/league scoring, Draft acquisition, and More secondary tools. Test mobile/desktop density, Group/slate switching, own/other/multiple owners, historical periods, null scores and revisions. Do not implement it in this foundation pass.

### Updated dependency order

1. **Completed pure batch:** accepted-state scoring strategy boundary, explicit roster-period eligibility by round, and Best Ball hole reducer. Production still calls the existing Standard scorer directly.
2. **Pure contract completed below; future integration:** Define/review period persistence and transition/locking contracts, including Standard split round accounting, no-cut/delayed events, penalties, and tiebreaks. Prepare schema only when tasked; user applies SQL separately.
3. Build period-aware authoritative Golf Snake with immutable chronology, proxy/correction support, concurrency and ownership enforcement, reusing shared snake primitives without changing NBA/NFL behavior.
4. Build source-neutral odds paste/import, verified identity resolution, and offline salary preview/calibration. This can proceed independently of Snake once input contracts are settled.
5. Add reviewed immutable price-set persistence/publication, then Salary Cap atomic roster submission against the frozen set and period lock.
6. Integrate Standard/Best Ball results transactionally with roster revisions and period data; distinguish all three dimensions in history/profile results before activation.
7. Golf Live UI can ship independently for current Standard/Full Tournament now that the pure scoring-boundary batch is complete; it need not wait for an automated odds provider. Add split-period ownership when period reads exist.
8. Wire capability-gated commissioner settings and production selectors only for combinations with complete server paths. Complete all-eight-combination integration, authorization/concurrency, legacy-history and mobile QA.

No product decision blocks the next pure transition-contract batch; model unavailable/uncertain transitions explicitly rather than choosing an automatic fallback. Before split production activation, settle Standard period penalty/tiebreak behavior, Best Ball finality/tiebreaks, and what to do when there is no usable R2-to-R3 acquisition window. Same frozen weekend prices is the recommended default, not an implemented rule. Paid-provider authorization is needed only if pursuing a paid source; manual odds import keeps that off the critical path.

Follow-up validation: 15 focused Golf rule tests passed; all 8 selected Golf/Groups/slate test files passed; TypeScript passed. Diff check and final dirty-tree review are included in the final response. No build, SQL, Supabase write, commit or push.

## First Best Ball pure scoring build batch

New modules: `lib/golf/eligibleRoster.ts`, `lib/golf/scoring.ts`, `lib/golf/bestBall.ts`; regression suite: `tests/golf-best-ball.test.cjs`. Existing rules, NFL changes, provider adapters, acceptance policy, reconciliation, Traditional scoring, routes and UI remain untouched in this batch.

`scoreGolfCompetition` dispatches on game type only. It accepts a competition because Traditional ranking/tiebreaks require all participating teams together. Standard reconstructs the same accepted-state competitor adapter used in reconciliation and delegates to `calculateGolfTeamResults`, preserving accepted `fantasy_score`, including penalties, progress and complete ranking. It does not recalculate or reinterpret penalties. Best Ball returns per-team scorecards without assigning rankings, penalties or tiebreaks. Recommended eventual primary competition score is cumulative fantasy score-to-par, lower better; partial totals must always be displayed with holes scored and provisional status.

Normalized input: `{teamId, periods: [{period, playerIds}]}`. Period is `full_tournament`, `opening` or `weekend`. `eligibleGolfPlayerIds` maps rules to regulation rounds: full roster for R1–R4, opening for R1–R2, weekend for R3–R4. Missing period records are errors, while an explicitly empty roster yields unscored holes. Duplicate assignments and golfer IDs are rejected. Eligibility uses no dates, tee sequence, acquisition history or draft type. Shared ownership across teams is valid at this layer.

Accepted input is `events[].player_id → golf_rounds[].round_number → golf_holes[]` with canonical `hole_number`, `strokes`, `relative_to_par`; it is the graph returned by reconciliation or read back after its transaction. Legacy accepted holes without provenance remain usable. Types/documentation do not constitute a security gate: future production integration must pass only that graph, never a provider batch. No production caller has been added.

Best Ball emits team ID and sorted regulation rounds, each labeled with its roster period and containing all 18 actual course holes. Each hole retains raw strokes, reliable inferred par, relative-to-par, all sorted tied contributing IDs, deterministic lowest-ID primary contributor, unresolved eligible IDs, and `unscored | provisional | final`. Selection uses numeric lowest strokes, never display strings. Ties provide no scoring advantage. Per-round and team `strokes`, `toPar`, and `holesScored` cover scored holes only; empty totals are null, and a scored hole with unknown/inconsistent par makes to-par aggregate null instead of falsely even.

Finality is deliberately conservative. A scored hole is final only when every eligible golfer has an accepted score for that hole. Missing contributions keep it provisional even if the golfer/round is marked finished, cut, WD, DQ or DNS: those flags alone cannot distinguish a truly unplayed hole from delayed missing accepted feed data. The unresolved ID list exposes this uncertainty. All-missing holes are unscored, never zero or manufactured par. “Final” means contribution-complete in this accepted snapshot, not immune to later official correction. Future explicit round closure/availability evidence can resolve terminal missing contributions without changing acceptance policy.

Every call recomputes from its supplied graph. A later better contribution improves the hole; a worse one cannot displace a better remaining contribution. Accepted correction can improve or worsen the result; retraction falls back to the next accepted score or unscored. Cut/WD/DQ contribute only actual accepted holes; DNS with no holes contributes nothing. Status never invents missing strokes or penalties. Weekend eligibility comes exclusively from the explicit weekend roster, which can differ entirely from opening.

Split tees use actual hole numbers: Hole 10 never becomes Hole 1 because it was played first. Current accepted hole representation lacks per-player/per-round course identity, so callers must establish comparable course holes before using the reducer for multi-course events. Existing slate course metadata alone does not prove that mapping. This is a runtime activation prerequisite, not a new ingestion scheme. Contradictory inferred pars suppress to-par output. The current provider parser retains positive round numbers but rejects hole numbers outside 1–18; acceptance also rejects holes outside 1–18. There is no explicit playoff identity in this graph. The new reducer accepts an explicit unique list of regulation rounds 1–4 (allowing a shortened tournament), ignores nonregulation holes and rejects requested round 5. Do not feed a playoff represented with reused regulation identifiers; dedicated playoff mapping/scoring remains out of scope.

Standard receives the same normalized period-aware roster contract, but this adapter only calculates Full Tournament. It explicitly throws for Standard split periods because accepted golfer `fantasy_score` spans the whole event and includes full-event cut/WD/DQ penalties. Merely changing roster IDs per round would double-count or apply the wrong penalties. Future Standard split integration must supply eligible round-scoped totals and decide period penalties, team/individual-round tiebreak scope and progress semantics before delegating ranking. This limitation does not couple split periods to Best Ball: eligibility itself is scoring-independent, and rules still represent all eight combinations.

No schema, result materialization, RPC, reconciliation dispatch, runtime capability, GroupProvider change or production selector was introduced. Pure tests cover selection/ties, attribution, evolving provisional holes, correction/retraction, split tees, disjoint/full rosters, terminal golfers, delayed dates, regulation limits, aggregation, invalid/ambiguous inputs, stale rejected evidence through real reconciliation, acquisition independence and exact Standard adapter equivalence. Existing reconciliation/correctness tests remain the authority for unchanged acceptance and penalty behavior.

### Preferred v1 odds input (product direction)

Commissioner finds a reputable tournament outright-odds list, copies golfer + signed American odds lines, pastes into the app, reviews tournament-field matches and ambiguities, generates suggested salaries, reviews permitted overrides, then freezes the complete price set. The user supplied CBS Sports publishing FanDuel Tour Championship odds as a practical example; this batch does not independently verify that article or automate access. Store sportsbook and publisher separately: `sourceProvider = FanDuel`, `sourcePublisher = CBS Sports`, optional commissioner-provided `sourceUrl`, `capturedAt`, and entry `rawAmericanOdds`. Keep source metadata independent of parsing, matching and formula choice. No CBS scraper or automated odds API is needed before Salary Cap can proceed. Missing odds still require reviewed pricing or explicit unavailability, never a cheap default. Import UI, formula calibration and persistence remain future work.

### Prior next batch (now completed below)

Build pure roster-period transition/readiness and eligibility contracts with tests for delayed R2, unfinished cut/field determination, no-cut events, R3 already underway, missing provider evidence and shortened events. Return explicit pending/ready/unavailable states; never open weekend acquisition by calendar day. Document the eventual period/roster revision and lock contract for later manual SQL approval. Keep Standard split accounting and unresolved transition policy explicitly unsupported until settled. No selectors or persistence in that batch. Golf Live remains a separately shippable UI batch with Home | Draft | Scores | Live | More, a compact accepted-state tournament leaderboard, multi-owner highlighting and existing modal/scorecard/replay reuse.

## Pure roster-period readiness and locking batch

Implemented `lib/golf/rosterPeriodState.ts` and `tests/golf-roster-period-state.test.cjs`. No production callers, schema, persistence, provider policy, scoring changes or UI activation. On resumption, `HEAD` was `91ff42e` (NFL lifecycle fix already committed outside this batch); only the Golf rules file was modified and the six Golf foundation paths were untracked. This batch preserves that state and makes no commit.

### Inspected evidence and its limits

- `reconcileState` preserves accepted `golf_holes` and round aggregates (`holes_completed`, `strokes`, `status`), with accepted revisions and observation timestamps. Any accepted regulation R3/R4 hole or positive round completion count is sufficient positive evidence to close weekend acquisition. Omitted data is preserved; official retractions can remove scores, so irreversible start history must eventually be retained separately.
- Accepted event `status`, `current_round`, `rounds_completed` and progress describe golfers, not exhaustive tournament transition readiness. `round_complete` is not whole-field R2 completion. Provider `golf.ts` can infer cut from two completed rounds and missing R3 activity/tee time; this is not a confirmed cut announcement. Terminal cut/WD/DQ/DNS states conservatively exclude golfers, but cannot establish the remaining field by elimination.
- Tee metadata is accepted separately from score coverage. Refresh includes date-based presentation logic and future tee records. Neither tee publication, current-round hint nor a calendar day proves start or transition readiness. No tee-time deadline calculation was added.
- `slates.has_cut` exists and controls Traditional penalty handling. A reviewed, correct no-cut configuration can inform normalization; absence of a cut line cannot. No exhaustive accepted cut-finalization/eligible-field contract or confirmed shortened-round-count contract exists in the current reconciliation graph.
- Provider tournament status is available during refresh but is not a sufficient accepted lifecycle record: provider code explicitly accounts for premature final/incomplete round feeds. `/api/player-stats` exposes the accepted golfer graph and revisions, not the missing tournament confirmations. Do not infer tournament final solely from all returned players being finished; the returned field might be incomplete.

Consequently this pure evaluator takes explicit future server-normalized confirmations, alongside canonical accepted events. It does not fabricate a production adapter for facts the current tables cannot prove. `null` is unknown for regulation round count, tournament finality, R2 completion and pre-R3 confirmation. `round3NotStarted=true` must be positive confirmation, not the absence of completed R3 holes; false establishes R3 began. `startedRounds` retains historical start evidence. `fieldComplete` means the player list is exhaustive for this competition. These are trusted server inputs, never client permission flags.

### Model and precedence

Input contains only `rosterPeriodType` and evidence. Game Type and Draft Type are absent. Output has `currentPeriod` (null after tournament completion) and normalized periods with regulation rounds, `unavailable | upcoming | open | locked | completed | uncertain`, typed reason, build permission, lock flag and eligible/unresolved/ineligible ID lists. Locked means acquisition closed; playing periods use locked rather than a separate active acquisition state. Unknown/unavailable also deny building even when no irreversible lock has yet been established. Initial membership eligibility is left to existing slate acquisition validation; the weekend ID classification is not reused as a full-tournament roster filter.

Full Tournament uses the normalized existing acquisition state (`open/upcoming/locked/unknown`) and explicit tournament completion. It has no cut transition. Existing lineup mutation checks `slates.is_locked`; this pass does not silently strengthen that production path. The normalized caller must preserve its semantics.

Split maps R1/R2 to opening and R3/R4 to weekend, clipped to the confirmed regulation count. Opening closes on accepted play and completes on confirmed R2 completion or later-round play. Weekend opens only with all of: confirmed R2 completion, confirmed not-final event, positive pre-R3 confirmation, confirmed 3/4 regulation rounds, confirmed cut or explicit no-cut, exhaustive nonempty field and no unresolved eligibility. An explicit acquisition/deadline lock still wins. A no-cut event needs positively classified continuing golfers, not merely a missing cut line.

Any accepted R3/R4 play, explicit R3-start confirmation, retained start watermark or acquisition lock prevents reopening. Late cut confirmation, stale higher-level flags, missing tee times and retracted hole cards cannot reopen while start evidence is retained. A pure stateless function cannot remember a start if its caller discards every trace of it; future persistence must retain monotonic start/lock evidence across revisions. Retractions alter scores, not the historical fact that competition started.

Saturday, weather delays, darkness and suspension have no special branch or clock input. Unfinished R2 stays unavailable; completed R2 with pending cut stays uncertain. Missing evidence stays uncertain. Confirmed 54 holes yields weekend R3 only; 36/18 holes yields unavailable weekend with no rounds. Updated confirmed shortened count replaces the prior availability, never inventing R4. Tournament final closes existing periods; a nonexistent weekend stays unavailable. Contradictory start/shortening evidence still denies acquisition because start locks take priority.

Eligibility categories are `made_cut`, `continuing`, `missed_cut`, `withdrawn`, `disqualified`, `did_not_start`, `unknown`. The first two can be eligible; explicit exclusions and accepted terminal state override them. Unknown golfers stay unresolved and prevent the window opening. IDs are sorted deterministically, disjoint and duplicates rejected. These are eligibility classifications only, not score deletions: existing accepted opening holes remain available to scoring.

### Future persistence and Standard split decisions

Eventually store Group/slate-scoped period identity, confirmed regulation-round availability, evidence provenance/revision, exhaustive eligibility snapshot and immutable start/lock markers, plus period roster revisions. Mutations must atomically check the same lifecycle/eligibility revision used for acquisition and fail/re-read when it changes. Keep deadline locks separate from provider-derived readiness and retain history. No migration or RPC is prepared here.

Standard split still requires product decisions before activation: whether opening owns only R1/R2 actual scores and weekend only R3/R4 (recommended); whether an opening golfer's missed-cut penalty persists after replacement or is removed/redefined; how WD/DQ penalties apply within each eligible period; best-team/best-individual-round, birdie/bogey and draft-order tiebreak scope across two rosters; and whether progress counts roster slots per period or distinct golfers across the tournament. Existing whole-event `fantasy_score` cannot be partitioned safely without those choices. The pure lifecycle does not depend on resolving them.

### Next batch and preserved roadmap

Next safe implementation: **source-neutral pure commissioner odds-text parser and tournament-field matching preview**, with signed American odds validation, unique normalized exact-name matching, explicit ambiguous/unmatched/duplicate rows, and source-provider/publisher metadata. No UI, price formula, ingestion, persistence or scraping yet. This advances the agreed Salary Cap prerequisite without choosing Standard split scoring or pretending the missing accepted tournament confirmations exist.

Before lifecycle runtime integration, a separate evidence-adapter/persistence design must specify how authoritative R2 completion, pre-R3 status, field finalization, no-cut and shortened-event confirmations are obtained and reviewed. Then period storage/locking can be implemented only after separately authorized schema work. Preserve the existing dependency roadmap for authoritative Snake, frozen prices, Salary Cap submissions, transactional results, capability-gated selectors and final QA. Commissioner-pasted odds remain preferred v1; no automated API is required. Golf Live remains Home | Draft | Scores | Live | More with compact tournament leaderboard, multi-owner highlighting and existing modal/scorecard/replay.

Lifecycle batch validation: 33 focused lifecycle tests passed; all six selected lifecycle/Best Ball/rules/reconciliation/correctness/NFL test files passed. TypeScript and diff checks passed. Shared rules were not modified in this batch, so Groups tests were not rerun. No production build, SQL, Supabase write, commit or push.

## Roster-period persistence and authoritative locking foundation

This batch adds `periodPersistence.ts`, its focused tests, and **unapplied** migration `20260914000100_golf_roster_period_foundation.sql`. Existing production behavior is unchanged. No database connection or write was used.

Current production Golf has one slate, slate-scoped lineups/lineup_players and team_slate_results, not period rosters. Slate rules_snapshot freezes configuration; lineups currently check slate.is_locked. ESPN refresh and replay share reconcileGolf → reconcileGolfState → commit_golf_reconciliation, whose accepted-version row provides optimistic concurrency. The NBA/NFL draft-history migration instead serializes on the slate, retains immutable chronology and restricts write surfaces. Reuse its serialization/access-control approach, not NBA/NFL-exclusive ownership or sport-specific draft rows.

### Storage model

One `golf_roster_periods` row per `(slate_id, period_key)`, with a stable generated ID, explicit Group/league scope validated against slate→league, restrictive foreign keys, frozen original rules_snapshot, period revision, accepted scoring revision and retained facts. `golf_roster_period_audit` captures each revision's full record. Service-role reads only; RLS with no client policies; no direct runtime writes or callable mutation RPC. Database-owner/manual SQL retains administrative power, as with other schema protections; no claim is made to prevent deliberate owner changes.

At future opt-in slate initialization, create the entire period set atomically under a slate lock: full_tournament alone, or opening plus weekend. Do not wait for the cut to create weekend identity. Use frozen slate rules/defaults, never current Group settings. No blanket backfill is necessary and none is included. Existing slates without rows continue their current Full Tournament compatibility behavior; pure reads may describe virtual identities but `persisted=false` is NOT permission for period-aware mutation. Historical enrollment, if ever needed, requires explicit initialization and reviewed lock/history facts; do not invent opening timestamps or authoritative historical picks.

A later-confirmed 36-hole event keeps its weekend identity but maps it to no playable rounds. A 54-hole event maps weekend to R3. Do not delete identities referenced by history because the event shortened. Rules select the period structure; confirmed event evidence selects which regulation rounds exist. Acquisition and scoring strategy are not columns in the period identity.

Derived on read: current period, readiness, canBuildRoster, current eligible/unresolved IDs, reason, and regulation-round membership. These are not permanent lifecycle labels. Retained: started regulation rounds, first opening timestamp, lock timestamp/reason, completion timestamp, immutable identity/configuration, revisions and evidence provenance. First recorded fact timestamps cannot be replaced or cleared by normal updates. Started-round sets can only grow. `evidence_snapshot` is reserved for the server-normalized lifecycle confirmation inputs and reviewed eligibility snapshot (not duplicate hole/provider truth); `evidence_reference` identifies the evidence/audit operation. The audit captures these inputs for historical reconstruction. Its normalization/versioned format and authorization must be finalized with the writer RPC before use; an empty initial object never establishes readiness.

The TypeScript merge helper is CAS planning, not database concurrency enforcement. It rejects a wrong period revision or older accepted revision, unions start evidence and preserves timestamps. Stored evaluation overlays retained locks/start history on new evidence. A previously opened period may become uncertain when fresh readiness is unavailable, but a retained lock cannot reopen. Completion remains completed. Scoped lookup cannot borrow another Group/league/slate's row. No repository fetch is wired because no migration is applied and no production consumer exists.

### Atomic enforcement still required before activation

Future writer RPCs must lock in one order: **slate → accepted-version row → period rows sorted by ID**, then recheck Group/league/team membership, frozen rules, expected accepted revision, expected period revision, normalized eligibility and all acquisition locks. They must require persisted periods and increment/audit facts in the same transaction. Snake picks and Salary Cap submissions will reference the period ID and share this gate; their ownership rules stay separate. Future roster assignments should key team+period and reference internal golfers; never add global `(period, golfer)` uniqueness to shared roster storage, because Salary Cap permits multiple owners. Snake's own history/active-pick constraint can enforce exclusivity within its draft. Scoring then maps period roster records to existing `{teamId, periods:[{period,playerIds}]}` without reading acquisition chronology.

The existing reconciliation RPC currently locks only the accepted-version row. It must join this shared lock order before acquisition activation. Insert retained start facts from the **post-acceptance** graph into the same commit as accepted holes/rounds/events and team results, including legacy aggregate start evidence; never open a window from raw rejected provider observations. Do not implement a second refresh transaction afterward: it would leave a race in which scoring says R3 began but acquisition remains open. Both ESPN and replay automatically benefit when the shared RPC is extended. Lifecycle-only confirmation updates require the same locks/revisions. Lock triggers in this foundation do not retrofit the existing RPC or legacy lineup path.

If an acquisition transaction commits before trustworthy start evidence is accepted, the database cannot retroactively know that an on-course stroke occurred. Runtime design must therefore include a reviewed authoritative acquisition deadline/pre-R3 confirmation freshness rule in addition to positive accepted play locks. This is an evidence/integration requirement, not permission to infer Saturday. Commissioner correction/reopening remains unavailable; a future explicit audited correction design is required rather than weakening monotonic guards.

The additive migration performs no backfill and modifies no existing rows, triggers, reconciliation function or draft RPC. It is a review artifact, not deploy-ready activation. SQL was not executed against Postgres; focused static checks are not a substitute for transaction/RLS/rollback/concurrency tests against a separately authorized disposable database.

### Product boundaries and next batch

Standard split remains disabled. Decide opening R1/R2 score ownership, replacement/cut/WD/DQ penalties, cross-period tiebreaks and progress accounting before its scoring activation. These do not block period identity storage. Odds paste/import and Golf Live roadmaps remain unchanged and outside this batch.

Recommended next batch: **design and implement the opt-in lifecycle initialization/fact-writer RPC plus an accepted-reconciliation transaction extension as unapplied SQL**, with server authorization/evidence contracts and disposable-database concurrency tests only after separately authorized access. Set the concrete pre-R3 confirmation freshness/deadline policy before enabling roster writes. Do not implement picks, Salary Cap, selectors or apply SQL as part of that batch without explicit instruction.

## Lifecycle initialization and authoritative writer batch

Added `lib/golf/lifecycleAuthority.ts`, `tests/golf-lifecycle-authority.test.cjs` and **unapplied** `20260915000100_golf_lifecycle_writer.sql`. The prior foundation migration is unchanged in this batch. Apply neither file automatically. These are additive opt-in functions with no production call sites; existing reconcileGolf still invokes the original RPC.

### Explicit initialization and writers

`initialize_golf_lifecycle` is an explicit server-only enrollment RPC requiring an active Group commissioner or active super-admin actor. The server must obtain that actor from its authenticated session, never accept a client-chosen actor ID. It validates enabled Golf league/Group/slate scope, locks the slate and accepted version, and creates the complete frozen-rule period set atomically. Unique keys plus ON CONFLICT DO NOTHING make repeat initialization idempotent. It then seeds current accepted play/slate locks via the fact writer. It does not invent historical open times, backfill every slate or initialize on a read/refresh. Missing period rows remain legacy compatibility until deliberate enrollment. Repeat calls fail rather than reinterpret changed frozen configuration or scope.

`lock_golf_lifecycle` is internal-only (no service-role execute grant). It locks slate → accepted version → period rows ordered by ID, validates scope and exact snapshot agreement, and returns the accepted version. Public-facing service RPCs invoke it under security definer. Clients have no function grants or direct table writes. Service-role caller identity is a trusted server boundary; authorization remains required in any future HTTP handler.

`write_golf_lifecycle_facts` checks expected accepted revision and the complete map of period revisions under those locks. It reads canonical accepted rounds/holes directly from database tables, unions their positive regulation start evidence with every period's retained history, and updates all periods consistently. Weekend locks on R3/R4; opening locks on any regulation play; slate.is_locked is a global stop. Explicit restrictive deadline/commissioner locks are also accepted only on the trusted server surface. Existing timestamps and original lock reason are preserved, and no-op calls do not churn revisions. Audit triggers record changes. This function cannot claim that missing play means pre-R3, or infer R2 completion/cut/finality from partial golfer data.

`confirm_golf_period_history` is a separate server-only reviewed-evidence path, requiring a Group commissioner/super-admin actor, exact revisions, source reference and observation timestamp. It records first opening or completion facts; it never resets/unlocks. Opening checks current/retained play, global/period locks and an explicit future acquisition deadline. Weekend opening additionally requires confirmed R2, positive pre-R3 assertion, 3/4 regulation rounds, cut/no-cut confirmation and a duplicate-free classified field matching accepted event-player membership. Completion needs explicit tournament completion or opening-period R2 completion. Audit records reviewer and supplied normalized evidence. This is a future manual-review capability, not a claim that existing ESPN data can provide these confirmations automatically. No admin UI or route activates it.

Opened history is not authorization: later uncertainty, deadline expiry, accepted revision changes or locks still deny acquisition. Completed history closes the period permanently under ordinary writes. Derived readiness, eligible lists and round membership remain evaluator output. Reviewed evidence snapshots contain lifecycle confirmations/metadata, not competing hole scores. A future correction mechanism would need an explicit audited policy and different privileges; no reset or unlock exists here.

### Exact accepted-state transaction boundary

`commit_golf_reconciliation_with_lifecycle` is an opt-in wrapper. It takes scope, expected accepted revision, every expected period revision and the existing accepted patch arguments. Under the shared lock order it:

1. Retains already-accepted start evidence before a correction/retraction can remove the last visible score.
2. Calls the existing `commit_golf_reconciliation` unchanged, in the same SQL transaction.
3. Reads the resulting canonical database state and retains new starts/locks with the resulting accepted revision.
4. Returns accepted revision and authoritative period rows together.

Any revision error or fact-write failure raises and rolls back the nested accepted commit, retained facts and audit writes together. No exception is caught and converted into partial success. A conflicting caller must fresh-read accepted state AND period revisions and recompute its patch; future reconcileGolf retry handling must recognize these errors. The exact future TypeScript call site is the current supabaseAdmin.rpc call in `lib/golf/reconcileGolf.ts`, selected only for explicitly enrolled slates. ESPN refresh and replay both flow through it. No route-level after-commit fact write is appropriate.

Before any period-aware roster mutation is enabled, all writers for enrolled slates must use this boundary, including refreshed/replayed accepted corrections. Leaving a legacy accepted writer available for enrolled slates would bypass atomic lock retention. This batch intentionally does not revoke/replace that live function or modify its production callers. A future activation guard/dispatcher must enforce the enrolled-slate distinction and be tested before writes open. The lock protocol cannot determine when an unobserved on-course stroke happened; positive pre-R3 evidence and a conservative explicit acquisition deadline remain necessary.

### Shared acquisition gate and evidence contract

`assertGolfLifecycleAcquisition` is a pure server contract for execution using transaction-locked inputs. It validates authorized participant context, complete persisted period set, scope, expected/current accepted and period revisions, current evaluator permission, duplicate-free selected IDs and tournament field membership. Weekend adds classified eligibility and a reviewed lease: source reference, observedAt, acquisitionDeadline and matching accepted/period revisions. Expired, future-observed, missing or stale leases deny access. Dates only expire an explicit authorization deadline; they never infer roster transition readiness.

No automatic TTL, ESPN current-round/tee-time conversion or missing-hole inference creates this lease. Provider normalization is still unavailable without a verified authoritative source. A future server may use the reviewed confirmation path; source validity/deadline selection must be deliberately reviewed. TypeScript booleans for actor authorization/membership and tournament ID lists must come from scoped server reads; they are not trustworthy client inputs.

This pure gate is not a standalone database authorization token: invoking it before a network write is insufficient. Future Snake/Salary Cap RPCs must perform equivalent checks while holding the same locks, including Group team membership/proxy permissions, global slate lock, exact stored evidence/revisions, live golfer status and tournament field membership. Keep those checks in the transaction that inserts the pick/roster. Snake turn/exclusivity and Salary Cap price/count constraints follow the shared gate and remain separate. No acquisition RPC is implemented or granted in this batch.

Full Tournament remains one period and retains existing acquisition semantics. Split remains opening/weekend; confirmation/evaluator rounds allow 72/54/36-hole structures without deleting identity. Standard split score ownership, penalties after replacements, tiebreak and progress semantics remain unresolved and unactivated.

### Validation and next batch

Focused tests exercise idempotent initialization planning, scope isolation, accepted start extraction, missing-score uncertainty, fresh/stale authorization, retained-lock dominance, participant/field/eligibility checks, deadline expiry, regulation structures and scoring/acquisition independence. SQL checks verify structure/permissions/transaction ordering only: they are NOT executed Postgres tests or proof of RPC behavior. No disposable or production database was connected.

Next batch: review and test both unapplied migrations in a **separately authorized disposable Postgres environment**, covering initialization/auth/RLS, concurrent accepted and period revisions, rollback/audit, retraction-start retention, and denial of old accepted writers for enrolled slates. Then implement an opt-in enrolled-slate dispatcher/guard and reviewed evidence adapter, still without enabling acquisition. The confirmation source/deadline policy must be settled before production weekend access; missing evidence remains uncertain. No Standard split scoring decision blocks that validation work.
