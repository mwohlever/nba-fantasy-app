# NFL incomplete-score investigation — October 26, 2026

Local, read-only investigation. Two database SELECTs and six bounded ESPN GETs; no production writes, migrations, backfills, ingest routes, worker changes or scoring changes. Exact local, ESPN athlete, event, team, season and phase IDs were checked. No name matching or substitute identities were used.

## Findings

| Player / game | Only missing canonical field in the old preview | Cause | Verified recovery / default-rule FP |
| --- | --- | --- | --- |
| Tyler Allgeier, local 1 / ESPN 4373626; W5 October 11, ARI–DET, event 401872991 | `fumbles_lost` | **Merge omission:** the athlete log explicitly contains `fumblesLost: "0"`. The summary has an empty athlete fumble table and no category totals. `enrichNflGame` replaced the known log zero with null. | Preserve the explicit athlete-log fact when summary evidence is unavailable. **3.6 FP**: 7 rush yards × .1 + 9 receiving yards × .1 + 2 receptions. |
| Patrick Mahomes, local 435 / ESPN 3139477; W2 September 20, KC–IND, event 401872945 | `fumbles_lost` | **An omitted evidence path:** QB game logs have no fumble column, and the summary's athlete fumble section is empty. However, the final summary explicitly reports the exact KC team's `fumblesLost` as numeric 0 / display `"0"`. The normalizer did not use that team box-score evidence. | A verified final team total of zero establishes zero individual losses. **28.98 FP**: 382 pass yards × .04 + 3 pass TD × 4 + 17 rush yards × .1. |

Mahomes' UTC game timestamp is September 21 at 00:20Z; the existing America/New_York display correctly shows **September 20**. Allgeier's game is October 11 at 20:25Z. All other canonical scoring fields were already populated. Null kicking fields on these offensive players are irrelevant to their fantasy scores.

The same ARI team-zero evidence also resolves captured Kendrick Bourne (local 4 / ESPN 3045523) in event 401872991: his exact athlete ID appears in that game's receiving box score, with 5 receptions / 70 yards. His recovered default-rule score is **12 FP**. This uses the already fetched summary; no extra provider request.

## Evidence

The existing ESPN integrations expose both athlete logs and the summary's athlete/team box scores:

- [Allgeier log](https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/4373626/gamelog?season=2026), [ARI–DET summary](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872991).
- [Mahomes log](https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3139477/gamelog?season=2026), [KC–IND summary](https://site.web.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=401872945).

For both summaries, `boxscore.players[exact team].statistics[name=fumbles]` has `athletes: []` and `totals: []`. That absence is **not** the zero evidence. The independent field in the same event response is `boxscore.teams[exact team].statistics[name=fumblesLost]`, with `value: 0` and `displayValue: "0"`. The equivalent `site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=...` endpoint was also read for both events and agreed on event, season, finality, team IDs and zero losses. Existing scoring-summary wrappers use this same summary data; a scoreboard alone supplies no individual LOST evidence. No HTML scraping, new provider, extra runtime endpoint, or season-total-to-game inference was introduced.

Reduced real payloads are preserved in `tests/fixtures/player-center/nfl-{log-4373626-401872991,log-3139477-401872945,summary-401872991,summary-401872945}.json`, including source/fetch metadata. The detailed findings and SELECT receipts are in [`nfl-scoring-investigation.json`](../data/player-center/nfl-scoring-investigation.json).

Existing `nfl_player_game_observations` rows **8412** (Allgeier) and **7218** (Mahomes) already contain LOST=0. Allgeier's stored provenance points to the athlete log; Mahomes also has older summary provenance. Those rows were inspected, not updated or blindly used as a fallback. The research store retains null off-position fields (RB passing; QB receiving) under its separate frozen contract, so those rows alone do not establish complete Player Center fantasy/whole-pool coverage.

## Local normalization changes

1. Keep verified numeric athlete-log fields if the summary does not establish that field. A summary's omission no longer erases an explicit fact. If both sources give different explicit values, withhold the field and attach `conflicting_log_summary_stat:<field>`; never silently pick a value.
2. Support zero LOST from a **final**, exact-team aggregate only when its explicit cells agree on zero and the athlete/category cells contain no contradictory or malformed LOST value. A missing, positive, conflicting, malformed or wrong-context team total cannot establish an absent player's zero. Existing reconciled athlete-category evidence remains supported. Missing in both sources stays null.
3. Do not report `summary_coverage_budget_limited` merely because the final available summary used request eight. Report it only if eligible games remain unprocessed. All six captured Allgeier games already had summary reads; the old warning was a counting false positive, not the cause of his October 11 missing score.

The eight-read / 18-second profile budget, caching, provider-rate limits and stored-only draft comparisons are unchanged. No canonical coefficient, Group rule, frozen snapshot or historical slate score was modified. Research ingestion workers and immutable observation contracts are untouched.

## Preview replay and remaining limits

`node scripts/replay-player-center-preview-corrections.cjs` replays the preserved evidence **offline**, with no credentials, network or database client. It checks exact identities/context and rejects changes to any other captured box-score value. The local preview now includes the three verified LOST corrections and their evidence ledger; its banner discloses the later verification date. It retains the **October 23 season sample and cutoff**, not a newly refreshed whole season. The original read-only coverage audit remains a historical artifact.

Neither requested game remains unresolved in the preview. Genuinely missing/contradictory data, unknown final status, incomplete season coverage and request-budget-limited older games still withhold totals/averages. No production observation refresh or sorting-coverage certification was performed. Stored comparison coverage remains subject to the existing gates and separate rollout approval. Kicker fantasy scoring remains unavailable.

Focused regressions cover explicit-log preservation, both real recoveries, missing/nonzero/malformed/contradictory aggregate evidence, live status, source conflicts, exact ID/season checks, and the six-versus-more-than-six summary budget boundary. Browser QA also injects genuinely unknown fumbles for both players to confirm that compact rows retain **Incomplete** and Fantasy totals remain unavailable.
