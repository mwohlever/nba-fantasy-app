This audit found a practical path to automated projections across all three sports. **NBA needs correction of its historical inputs before more sophisticated modeling. NFL can support an explainable opportunity-based V1. Golf already has more usable season and hole data than the proposed odds-based approach requires.**

The shared architecture should handle ingestion, validation, identity, statistical utilities, snapshots, and confidence. Each sport should retain its own model.

This was read-only: no implementation, SQL, database writes, commits, or pushes. I treated this as an independent audit in the supplied session; I cannot create a separate client session. The checkout was on `main`, and I left it there.

**Evidence boundary:** “Persisted” below identifies tables and write/read paths confirmed in code. I did not query Supabase to verify row counts, coverage, or freshness. Eight successful read-only ESPN probes established specific provider capabilities; they do not establish complete historical coverage or an uptime guarantee.

---

**1. NBA current state**

The primary implementation is [lib/playerProjections.ts](/home/markwohlever/nba-fantasy-app/lib/playerProjections.ts:63).

Its inputs are:

| Input | Actual meaning |
|---|---|
| `player_nba_season_averages` | Imported NBA season averages, joined by NBA player ID |
| `player_slate_stats.fantasy_points` | Fantasy points recorded for app slates |
| `lineups` and `lineup_players` | Determine which player/slate observations enter the model |
| `team_slate_results.finish_position` | Fantasy-team finishing position, attributed to drafted players |
| `slates.start_date` | Calendar-year filtering and recency ordering |

The season-average importer reads a repository CSV, currently `data/nba-season-averages/2025-26.csv`. It computes:

```text
NBA anchor =
PTS + 1.2×REB + 1.5×AST + 2×STL + 2×BLK − TOV
```

This is an imported default-scoring average, not an automatically refreshed provider projection. See [the importer](/home/markwohlever/nba-fantasy-app/scripts/import-nba-season-averages.js).

The exact projection formula is:

```text
N = imported NBA season fantasy average
S = mean of qualifying drafted-slate scores
R = mean of the last 3 qualifying drafted-slate scores
F = mean fantasy-team finishing position

finishBoost = clamp((2.5 − F) × 1.25, −3, +3)

When at least 2 qualifying scores exist:
  anchor = N if available, otherwise S
  projection = round1(0.50×anchor + 0.30×S + 0.20×R + finishBoost)

  if R >= anchor + 2.5: add 1.5
  if R <= anchor − 2.5: subtract 1.5
  round again to 1 decimal

Otherwise:
  use N, if available
  otherwise return null
```

Confidence is based solely on qualifying score count:

- Four or more: `high`.
- Two or three: `medium`.
- NBA-anchor-only or no projection: `low`.

The “trophy” badge reflects average fantasy-team finish ≤2. It does not add another adjustment beyond `finishBoost`.

**Which games enter?**

These are **drafted slate observations**, not all NBA appearances:

- Only observations connected through lineup selections enter.
- Only finite fantasy scores **greater than zero** enter.
- Missing, zero, and negative scores are excluded.
- There is no completed-game requirement.
- There is no target-slate or prediction-time cutoff.
- Recency means the last three qualifying observations ordered by slate date.
- Multiple NBA games aggregated into one slate are not divided into individual games.
- The query does not filter slates or lineup selections by sport or Group.

The NBA anchor uses basketball season `year−1/year`, while app history uses January–December of the requested year.

**Minutes, role, injury, and context**

The model does not consume:

- Minutes played or expected minutes.
- Starts versus bench appearances.
- Opponent or pace.
- Home/away, rest, or back-to-backs.
- Injury status, restrictions, or early-exit indicators.
- Participation-based outlier treatment.

The NBA refresh path obtains NBA live box scores but persists scoring aggregates and game lifecycle fields rather than a complete player/game/minutes history. See [the refresh route](/home/markwohlever/nba-fantasy-app/app/api/refresh-stats/route.ts:368).

**Storage and consumers**

The base model executes database reads and calculations when called; there is no explicit model-result cache or scheduled projection snapshot in this function.

Consumers include:

- `/api/player-projections`.
- Draft/player-pool and lineup interfaces.
- Player-history/player-modal interfaces.
- Home summary.
- Draft-time projection capture.

A single NBA draft pick through the draft-history path saves projection, source, confidence, and timestamp on `lineup_players`. Other insertion paths inspected initialize those fields to null. These are **pick-time snapshots**, not a uniform slate-wide pregame forecast. See [lineup handling](/home/markwohlever/nba-fantasy-app/app/api/lineups/route.ts:875).

Home also contains a duplicate fallback implementation of the same blend. See [Home’s fallback](/home/markwohlever/nba-fantasy-app/app/api/home-summary/route.ts:645).

There is an additional live calculation in Home and LineupBuilder:

```text
live estimate = current fantasy points
              + baseline projection × game-clock minutes remaining / 48
```

Those are game-clock minutes, not expected player minutes. Saved pregame totals and changing live estimates therefore have different meanings.

**Confirmed weaknesses and bugs**

1. **Early-exit distortion is confirmed.** A positive five-minute appearance enters the raw score averages normally and can also trigger the −1.5 “cold” adjustment.

   For illustration, holding the NBA anchor at 45 and finish boost at zero: nine 45-point observations plus one recent 4-point observation produce `S=40.9`, `R≈31.3`, and a projection of **39.5**. Previously it would have been 45.

2. **The input population is selected by fantasy drafting.** Undrafted real games supply no recent-form evidence.

3. **Group and sport boundaries are missing.** The function globally reads slates and lineup selections. Overlapping numeric player IDs across sport-specific player tables create a possible cross-sport join collision when slate IDs and lineup selections align. The missing boundaries are confirmed; affected production rows were not checked.

4. **Historical fantasy points can mix scoring systems.** They are blended with a default-scoring NBA anchor without rescoring raw statistics under the target slate’s frozen rules.

5. **Fantasy-team finish is not player ability.** It depends on teammates, opponents, league size, and league format. The fixed 2.5 reference also assumes a particular competitive environment.

6. **Zero and negative results disappear, but small positive injury games remain.** This produces inconsistent treatment rather than robust handling.

7. **Live results can contaminate the baseline.** No final-status filter excludes an in-progress slate.

8. **Historical recalculation can use future information.** There is no `asOf` cutoff. Saved pick-time values avoid later recomputation, but a fresh request for an old season is not a valid historical pregame forecast.

9. **Confidence can overstate evidence.** Four drafted observations do not establish stable minutes, representative games, or independent samples.

10. **Multi-game slate totals and per-game anchors have incompatible units.** This is a latent issue wherever a slate aggregates multiple appearances.

11. Fixed large `.range()` requests are not pagination; completeness depends on database response limits.

---

**2. NBA recommended V1 improvement**

Use **expected minutes × production per minute**, calculated from complete, final player/game observations.

For configurable scoring, preferably estimate the individual stat rates first:

```text
projected stat = expected minutes × estimated stat per minute

projected fantasy points =
  target slate's frozen scoring applied to projected stats
```

This makes the same basketball data reusable across Groups without mixing their scoring rules.

**Ability estimate**

Use a recency-weighted ratio of totals:

```text
rate = Σ(weight × stat production) / Σ(weight × minutes)
```

A five-minute game then contributes five minutes of evidence, rather than the same weight as a 35-minute appearance. Avoid averaging individual game FP/min equally: a two-minute burst could otherwise dominate.

Starting candidates for backtesting:

- Recent 15–20 appearances.
- Recency half-life around 8–10 appearances.
- Shrink sparse recent rates toward season or prior-season rates.
- Stronger shrinkage for volatile steals, blocks, and turnovers.

These are starting parameters, not validated optimal settings.

**Expected minutes**

Use a robust recent-minute estimate, such as a weighted median over approximately 5–8 appearances, blended with a longer baseline.

- One unusually short appearance should not reset normal minutes.
- Repeated lower minutes should change the estimate.
- A verified role change should shorten the effective history.
- A verified restriction should affect expected minutes directly.

A candidate anomaly flag is minutes far below the player’s usual workload, rather than a universal “under 15 minutes” exclusion. The latter would erase legitimate bench roles.

**Abnormal games**

Keep actual results intact. Separately decide their modeling weight:

- Confirmed early injury/ejection: substantially reduce influence on normal minutes.
- Tiny appearance with unknown cause: flag uncertainty; do not invent an injury.
- Ordinary poor shooting in normal minutes: keep it.
- Repeated low-minute appearances: treat as potential role evidence.
- DNP: distinguish absence from zero production while playing.

I would not start with global trimmed fantasy-score averages or automatic winsorization. They can remove genuine poor games and breakout games while failing to explain opportunity.

**Fallback hierarchy**

1. Representative recent minutes and production.
2. Current-season production with longer-term minutes.
3. Prior-season rates, adjusted for known current role.
4. Position/role baseline.
5. Unavailable estimate if both identity and opportunity are unresolved.

An unavailable estimate should not become a fabricated confident zero.

**Provider feasibility**

A successful [ESPN NBA historical-log probe](https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/1966/gamelog?season=2025) returned minutes, points, rebounds, assists, blocks, steals, turnovers, dates, teams, and opponents.

The season selector advertised 2003–04 onward for that player; I verified the requested 2024–25 response, not every advertised season.

Confidence in obtaining minutes and basic production is **high**. Confidence in automatically identifying the reason for an early exit or a specific future restriction is **low to medium**. NBA IDs and ESPN IDs require an explicit crosswalk.

---

**3. NFL data availability**

The existing architecture supports NFL scoring, season statistics, provider game logs, rosters, schedules, and live box scores. It does not have a dedicated NFL prediction model.

| Input | Persisted by inspected code | Existing-provider availability |
|---|---|---|
| Passing yards, TD, INT | Slate and season stats | Confirmed |
| Completions and attempts | Not in inspected slate/season write payloads | Confirmed in historical QB log and summary |
| Carries | Not in inspected slate/season write payloads | Confirmed in summary/log |
| Rushing yards and TD | Slate and season stats | Confirmed |
| Targets | Season totals and per-game averages; not slate payload | Confirmed `TGTS` in summary |
| Receptions, receiving yards/TD | Slate and season stats | Confirmed |
| Fumbles lost | Slate and season stats | Confirmed summary support |
| Snaps and routes | Not found | Not established in inspected ESPN feeds |
| D/ST component statistics | Calculated during refresh; inspected persistence saves final FP, not components | Existing aggregation supports required inputs |
| Opponent and home/away | Schedule/live-context paths | Confirmed provider structure |
| Team plays, yards, turnovers | Not a dedicated historical feature store | Confirmed summary |
| Depth chart | Not consumed by projection logic | Endpoint successfully returned positions/athletes |
| Injury information | No normalized historical availability model found | Summary exposes injuries; completeness not established |
| Weather | No modeling integration found | Not present in sampled indoor-game response |
| Bye weeks | Schedule-derived context | Feasible; distinguish confirmed bye from failed schedule retrieval |

The season importer writes `player_nfl_season_stats`, including targets and scoring categories. The slate refresh writes only drafted players’ scoring results. That is not sufficient as a league-wide training history.

Current D/ST scoring is already configurable in the checked-out code, despite the repository instructions describing it as planned. Its calculator includes sacks, interceptions, recoveries, safeties, touchdowns, points-allowed tiers, and yards-allowed tiers. See [NFL scoring](/home/markwohlever/nba-fantasy-app/lib/scoring/nfl.ts).

Exact provider paths:

```text
https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={eventId}

https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/{id}/gamelog?season={year}

https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/{year}/types/2/athletes/{id}/statistics

https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{teamId}/roster

https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/{teamId}/depthcharts

https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates={start}-{end}
```

The [2024 QB log probe](https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3139477/gamelog?season=2024) returned separate regular-season and postseason samples, including passing attempts and rushing attempts. Its selector advertised seasons back to 2017.

The [sample NFL summary](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401772719) confirmed carries, targets, offensive plays, team yardage, sacks allowed, turnovers, and defensive/special-teams TD fields.

---

**4. NFL recommended V1 model**

Start with **opportunity × stabilized production rates**, using a weighted fantasy-points baseline as a benchmark and fallback.

Avoid adding several correlated adjustments to raw fantasy points: recent fantasy production, usage trend, and team offense can otherwise count the same improvement repeatedly.

| Position | Opportunity estimate | Production estimate |
|---|---|---|
| QB | Pass attempts and rushing attempts | Yards/attempt, TD/attempt, INT/attempt, rushing rates |
| RB | Carries and targets | Yards/carry, catch rate, receiving yards, regressed TD rates |
| WR/TE | Targets, optionally share of team attempts | Catch rate, yards/target or reception, regressed TD rates |
| D/ST | Opponent plays/pass volume and team defensive history | Sacks, turnovers, rare-event rates, allowed-score distributions |
| K, where enabled | Attempts and team scoring opportunity | Make rates; inspect current kicker scoring support before modeling |

Use perhaps 6–10 games for the initial recent window, with previous-season priors early in the season. Touchdown efficiency should generally use more history and stronger shrinkage than opportunity.

A 70-yard touchdown remains real evidence. Stabilizing yards and TD rates prevents it from dominating without arbitrarily deleting it.

**Matchup**

Keep the first adjustment small and neutral when data is thin:

- QB: opponent pass defense and sack generation.
- RB: rush defense and team rushing opportunity.
- WR/TE: broad passing context before detailed positional splits.
- D/ST: opponent sacks allowed, turnovers, and scoring strength.

A bounded adjustment around ±5% is a reasonable experiment, not a promised improvement. It should ship only if chronological testing beats the simpler model.

**New starters and partial games**

Fallback order:

1. Player history in a comparable role.
2. Player efficiency plus current role/team opportunity.
3. Team/position opportunity with positional efficiency priors.
4. Broad positional baseline with low confidence.

Do not inherit a departing starter’s entire fantasy average.

Without snaps, two touches cannot reliably distinguish an early injury from a normal reserve role. Low opportunity alone should not trigger automatic exclusion. Use repeated usage, depth-chart changes, and verified availability evidence; lower confidence when the cause is unresolved.

For D/ST, do not simply apply tiered scoring to expected points allowed. Because scoring is nonlinear:

```text
expected tier score = Σ(probability of tier × that tier's score)
```

A simple historical, shrunk tier distribution is sufficient for V1. Rare defensive TDs and safeties need strong regression.

---

**5. Golf data availability**

**FedExCup points are directly feasible.**

The existing importer already maps:

```text
splits.categories[].stats[name="cupPoints"].value
→ player_golf_season_stats.fedex_cup_points
```

Successful probes for the same golfer returned:

- 2025: `cupPoints = 7456`.
- 2026: `cupPoints = 4986`.

These are numeric points, separate from the accompanying rank. See the [2025 response](https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2025/types/1/athletes/9478/statistics) and [2026 response](https://sports.core.api.espn.com/v2/sports/golf/leagues/pga/seasons/2026/types/1/athletes/9478/statistics).

The existing [Golf season importer](/home/markwohlever/nba-fantasy-app/scripts/import-golf-season-stats.mjs:780) also handles tournaments, rounds, holes, cuts, finishes, scoring averages, birdies, eagles, bogeys, and other statistics.

| Data | Current architecture | Feasibility |
|---|---|---|
| FedExCup points | Existing import field | High for covered PGA records |
| Season finishes/cuts | Existing season-stat fields | High, with denominator checks |
| Individual event results | Event-player/scoring architecture | High for available events |
| Recent-form history | No dedicated model history | Requires automated historical ingestion |
| Round strokes | `golf_rounds` and provider parsing | High for covered events |
| Hole strokes/par-relative scores | `golf_holes` and provider parsing | Confirmed in sampled event |
| Course/hole identity | Existing course metadata | Usable locally; longitudinal mapping needs work |
| Field strength | No established rating model found | Derivable later |
| OWGR | Existing ESPN HTML scraper and PGA field metadata | More brittle than structured scoring data |

The [sample 2026 scoreboard response](https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard?dates=2026&event=401811964) contained round strokes and nested hole scores, including `scoreType.displayValue` relative to par.

An important endpoint detail: the request included a specific event but returned **49 events**. Consumers must select the requested event explicitly and account for response size.

**Coverage limitations**

The importer explicitly documents partial PGA records: finish data can exist while rounds and holes are zero. Its `has_detailed_stats` handling recognizes that unavailable detail is not zero ability.

Golfers represented only as `pga:{id}` are excluded from the ESPN season import until a real ESPN ID is mapped. Tour coverage and identity gaps therefore need explicit fallbacks.

Verified here:

- Golf season statistics for 2025 and 2026.
- Detailed scoring for one 2026 event.

Not established here:

- Complete multi-season hole coverage.
- Complete non-PGA/LIV/DP World Tour coverage.
- Stable course identity across all event years.

**111 Scoring Differential**

Use completed rounds compared against golfers playing the **same course and round**:

```text
differential = golfer strokes − comparable field mean strokes
```

Negative means better.

Relative-to-par can help normalize representation, but it does not remove differences in course difficulty. Multi-course events still need course-specific comparison.

Keep missed-cut rounds: they contain valid scoring evidence. Do not compare four-round totals with two-round totals.

**Event/course history**

A tournament’s event ID identifies an edition, not necessarily a permanent event family or course. Sponsor names and venues can change. Existing ESPN/PGA mappings help, but repeated-event and course histories need explicit identity normalization.

**Field strength**

Feasible after establishing stable pre-event player ratings: summarize those ratings for each historical field and cautiously adjust results. Use ratings available before the event to avoid circularity and future-data leakage.

---

**6. Golf recommended 111 Value V1**

Use a quality rating with modest tournament context. Do not describe it as a predicted finishing position or probability.

Candidate starting composition:

| Component | Initial weight | Confidence |
|---|---:|---|
| Season strength | 35% | Medium: points are concrete, but coverage and participation differ |
| Recent form | 30% | Medium–high with sufficient complete event history |
| Scoring differential | 30% | Medium; high after course/round validation |
| Course/event history | 5% | Low–medium; sparse and easy to overfit |

Reasonable tuning ranges are roughly 25–40% for each major component and 0–10% for history, normalized to total 100%.

**Season strength**

Preserve point distances. Do not replace points with rank. A square-root or logarithmic transform can temper extreme gaps while retaining more information than rank, but choose it through testing.

FedExCup points are not pure ability: participation, event mix, and season timing matter. Blend prior-season evidence early in a season. Missing points for a golfer outside PGA coverage must not mean “worst golfer.”

**Recent form**

Use approximately 8–12 starts with time decay:

- Field-size-aware finish percentile.
- Tie-aware finish handling.
- Missed cuts treated explicitly.
- No-cut events identified.
- WD/DQ separated from ordinary poor finishes.
- Wins/top finishes explain the component rather than automatically receiving additional duplicative bonuses.

**Missing components**

No course history should produce a neutral adjustment or redistribution of that component’s weight. Missing detailed scoring should trigger a documented fallback and lower reliability, not zero scoring quality.

If historical ingestion is not yet ready, a season-stat baseline is feasible, but it should not be presented as a complete tournament-specific model.

Display the eventual 0–100 scale against a stable reference population. Renormalizing every field’s best player to 100 would hide differences between strong and weak fields.

---

**7. Best Ball value adjustment**

A modest adjustment is feasible without exhaustive hole ingestion.

Already imported or directly derivable:

```text
birdie rate = birdies / holes played
better-than-par rate ≈ (birdies + eagles) / holes played
eagle rate = eagles / holes played
birdies per round = birdies / rounds played
```

The sampled ESPN definition of eagles includes two-or-more under par; preserve that provider meaning in normalization.

Historical holes additionally support:

- Better-than-par rates by par category.
- Hole-score distribution.
- Round volatility.
- Birdie streaks.
- Course-adjusted upside.

Start with shrunk better-than-par production, with a small allowance for eagle severity. Do not reward volatility by itself: extra bogeys can increase volatility without producing useful upside.

A candidate experiment is a centered adjustment capped around **−2 to +2 on a 100-point value scale**, with no more than a few salary-percent effect. Missing data should mean neutral adjustment.

To avoid counting overall quality twice, compare upside with golfers of similar base quality.

The actual benefit depends on Best Ball rules, roster size, cut exposure, and how golfers’ hole outcomes combine. Test against the eventual scoring rules after the active Golf work stabilizes.

Keep the separation:

```text
base quality
→ tournament context
→ modest game-type adjustment
→ field-relative salary
```

Snake versus Salary Cap has no role in the quality model.

---

**8. Cross-sport shared utilities**

Share these:

- Recency weights.
- Weighted means and medians.
- Ratio-of-totals rate estimators.
- Shrinkage toward an explicit prior.
- Optional trimming/winsorization.
- Effective sample size.
- Missing-versus-zero handling.
- Data freshness and completeness checks.
- Provider/event deduplication.
- Model provenance and component reporting.

Useful effective sample size:

```text
effective N = (Σ weights)² / Σ(weights²)
```

Keep these sport-specific:

| Sport | Representative participation |
|---|---|
| NBA | Minutes and role |
| NFL | Attempts, carries, targets, snaps where available, role |
| Golf | Completed holes/rounds, cut and WD/DQ status |

A shared function should receive the sport adapter’s eligibility and participation weights. It should not decide universally that a low score is an outlier.

Confidence should accompany estimates:

- **High:** sufficient representative history, stable role, fresh inputs.
- **Medium:** moderate history or some context uncertainty.
- **Low:** new role, injury return, sparse history, stale/incomplete provider data.

Do not multiply scores by a confidence discount. Shrink uncertain rates toward justified priors; treat confirmed reduced participation separately.

---

**9. Storage and refresh recommendation**

Persistent metrics and projection snapshots are appropriate. Current slate-result tables are insufficient as the sole history source because they are tied to fantasy participation and scoring.

Without prescribing a schema, retain:

- Provider and canonical player/event identity.
- Observation date and ingestion timestamp.
- Normalized raw statistics and participation.
- Completeness/status flags.
- Model version and prediction cutoff.
- Component estimates and fallback reasons.
- Confidence and sample size.
- Final estimate.
- Applicable rules snapshot/version.

Separate three concepts:

1. Shared real-sport history and metrics.
2. Group/slate-specific scored forecasts.
3. Immutable acquisition or pregame reference values.

**Refresh cadence**

| Sport | Recommended calculation |
|---|---|
| NBA | After final games; upcoming-slate batch; targeted status refreshes |
| NFL | Weekly after completed games; status/role refreshes before each game |
| Golf | After completed events; calculate tournament values once field is available |
| Golf salaries | Generate and freeze before acquisition opens |

Maintain changing forecasts separately from frozen draft/reference values. A late injury can update availability without silently rewriting historical prediction comparisons or already-open salary economics.

Use bounded ingestion jobs, incremental checkpoints, retries, stale-data fallbacks, and monitoring. Read-only page routes should serve cached results.

I found season import scripts, but did not establish deployed automatic scheduling for them. Zero commissioner maintenance still requires developer-owned monitoring and provider-failure handling.

---

**10. Explainability**

The recommended models can support useful components without inventing precision.

| Sport | Explainable output |
|---|---|
| NBA | Expected minutes, production/minute, recent sample, role/status reason, projected FP |
| NFL | Expected carries/targets/attempts, usage direction, efficiency baseline, small matchup effect |
| Golf | Season strength, recent form, scoring differential, history adjustment, coverage |
| Best Ball | Better-than-par rate and bounded upside adjustment |

Show component timestamps and fallback reasons internally.

Distinguish:

- Raw metrics: “34 expected minutes.”
- Model components: “Recent form: 90.”
- Final forecasts: “43.8 projected FP.”
- Confidence: reliability of the estimate.

A normalized “Scoring: 94” is not 94 strokes or a 94% probability.

---

**11. Provider risks and identity**

| Source | Main risk |
|---|---|
| ESPN structured endpoints | Undocumented consumer interfaces; optional fields and response shapes can change |
| NBA CDN | Good current box-score source; complete historical discovery is a separate concern |
| NBA CSV anchor | Refresh depends on import workflow; not inherently automated |
| ESPN Golf rankings scraper | HTML parsing and heuristic points extraction are brittle |
| PGA website/internal APIs | Embedded page structures and consumer API dependencies |
| Licensed providers | Subscription, coverage, and application-use terms |

The existing Golf rankings scraper’s generic `points` field should **not** be treated as FedExCup points. Use the explicit structured `cupPoints` statistic.

Identity recommendations:

- NBA’s `nba_player_id` belongs to the NBA namespace; ESPN requires a crosswalk.
- NFL’s ordinary `nfl_player_id` is used as an ESPN athlete ID.
- NFL D/ST uses `100,000,000 + ESPN team ID`; preserve it.
- Golf uses local IDs, ESPN athlete IDs, and PGA IDs/synthetic placeholders.
- Provider ID plus sport/provider namespace should be the key.
- Name matching should be a controlled reconciliation fallback.
- Preserve the team associated with each historical event, not just the player’s current team.

The same Golf ESPN ID worked across the two probed seasons. NBA/NFL logs also expose multi-season identity. That supports continuity but is not proof of universal cross-season coverage.

**New-provider needs**

No new provider is necessary for initial minutes/box-score NBA modeling, basic NFL opportunity modeling, or covered-PGA Golf values.

Reliable snap/route history, richer injury participation evidence, and broad cross-tour Golf coverage may justify another source.

SportsDataIO documents snap counts and NFL projection feeds, making it a candidate for a later coverage evaluation. [Provider workflow documentation](https://sportsdata.io/developers/workflow-guide/nfl).

Data Golf documents cross-tour round history, connected player IDs, event results, points, and forecasts. API access is subscription-based; archive access depends on plan. Its published terms distinguish personal use, so an ordinary subscription should not be assumed to authorize app redistribution. [API documentation](https://datagolf.com/api-access), [subscription details](https://datagolf.com/subscribe), [usage terms](https://datagolf.com/terms-and-conditions).

---

**12. Recommended implementation order**

1. **NBA input correctness and evaluation.** Establish complete event-level history, prediction-time cutoffs, identity boundaries, and snapshot-based rescoring. Remove fantasy-team finish from the candidate model.
2. **NBA minutes-aware V1.** Run alongside the current model before replacing displayed projections.
3. **NFL basic projections.** Build opportunity/efficiency estimates and fallback hierarchy. Introduce matchup only after measuring benefit.
4. **Golf 111 Value.** Wait for the active lifecycle work to settle; automate season refresh and historical event ingestion without coupling to those writers.
5. **Best Ball adjustment.** Validate incremental benefit beyond base quality.
6. **Golf Salary Cap pricing.** Calibrate field-relative prices and freeze them before acquisition.

Salary testing should examine affordable roster distributions, not merely whether individual prices look plausible. Retain the proposed four-golfer/$100 examples as acceptance scenarios; no pricing curve is finalized here.

---

**13. Additional high-value ideas**

- **Chronological backtesting is essential.** Reconstruct what was knowable before each event. Present-day season totals cannot be used to validate old forecasts.
- **Compare against simple baselines.** NBA season average, NFL weighted FP/game, and Golf season/form blends provide useful benchmarks.
- **Evaluate ranking and calibration separately.** Absolute score error and identifying better draft choices are different objectives.
- **Measure by cohort.** Stable starters, reserves, rookies, injury returns, and incomplete Golf records can have very different error patterns.
- **Keep availability separate from ability.** “45 FP if playing normally” and “questionable with uncertain workload” convey different information.
- **Add roster-relative value later.** NBA/NFL drafting value can eventually include replacement level under the slate’s frozen roster rules without altering the underlying score forecast.
- **Log provider corrections.** Revised results should update historical facts without erasing what an earlier projection actually knew.

---

**14. Final git status**

The final `git status --short` matched the initial output:

```text
 M lib/rules/leagueRules.ts
?? docs/golf-two-axis-foundation.md
?? lib/golf/bestBall.ts
?? lib/golf/eligibleRoster.ts
?? lib/golf/lifecycleAuthority.ts
?? lib/golf/periodPersistence.ts
?? lib/golf/rosterPeriodState.ts
?? lib/golf/scoring.ts
?? supabase/migrations/20260914000100_golf_roster_period_foundation.sql
?? supabase/migrations/20260915000100_golf_lifecycle_writer.sql
?? tests/golf-best-ball.test.cjs
?? tests/golf-lifecycle-authority.test.cjs
?? tests/golf-period-persistence.test.cjs
?? tests/golf-roster-period-state.test.cjs
?? tests/golf-rules.test.cjs
```

Branch: `main`. The tracked diff reported the pre-existing 47 insertions in `lib/rules/leagueRules.ts`. `git diff --check` passed.

I made no filesystem changes and ran no imports, application refresh routes, builds, migrations, or database writes.
