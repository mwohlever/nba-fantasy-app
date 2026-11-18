# Live NFL drafted-player season fantasy coverage

Audited 2026-11-18T19:02:05.275Z; ESPN facts fetched 2026-11-18T18:59:41.015Z. Season 2026, regular season. This successful live audit supersedes the earlier network-blocked diagnostic conclusions.

**Result: all 59 unique offensive players selected across nine completed NFL drafts have verified season FP/game. Coverage is 100% unique-player and 100% draft-frequency weighted (234/234 selections).**

| Position | Verified / unique | Coverage | Verified / selections | Frequency-weighted coverage |
| --- | ---: | ---: | ---: | ---: |
| QB | 13/13 | 100% | 34/34 | 100% |
| RB | 17/17 | 100% | 83/83 | 100% |
| WR | 18/18 | 100% | 83/83 | 100% |
| TE | 11/11 | 100% | 34/34 | 100% |
| **Overall offense** | 59/59 | 100% | 234/234 | 100% |
| K | 0/0 | N/A | 0/0 | N/A |
| D/ST | 0/0 | N/A | 0/0 | N/A |

K/DST had no selections in the completed drafts; this audit does not resolve their known fantasy-scoring limitations.

## Scope and checks

- Live-confirmed the existing 111 Sports NFL league/Group scope from the retained verified league IDs. Queried `fantasy_drafts`, `draft_picks`, `draft_corrections` with GET-only scoped reads.
- Completed drafts: 2026 Weeks 1, 3, 4, 5, 6, 7, 8, 9 and 10. Week 11 is active and excluded. No unconfigured slate was silently counted as a completed historical draft.
- Completion was determined using the existing `getDraftTurn` helper against atomic `read_fantasy_draft` reads; history identity/status snapshots were cross-checked against the separate table reads.
- Replayed six correction records involving three reversed picks, and matched final player-ID sets exactly to current saved rosters. Allen’s corrected frequency is 8 instead of 9; Purdy’s is 5 instead of 4. Nico Collins and Trey McBride removals/re-additions do not change distinct-draft frequency.
- Original-selection cross-check, including reversed selections: the same 59 unique players and 234 selections, all covered.
- Mapped local player IDs through the full current `players_nfl` catalog to unique ESPN IDs; no names-only joins. Used the unmodified `PlayerCenterService.seasonCatalog` with frozen rules for each slate, fresh published/complementary ESPN facts, all nine scoring inputs and provider GP.
- 18 read-only database GETs and 22 bulk provider requests; **zero individual-player requests**. Provider pagination covered 2002 published rows. No credentials or full raw provider payloads are stored here.

## Missing players and frequent selections

**Missing drafted offensive players: none.** No drafted player failed because of identity conflict, absent activity, missing scoring fields, or unavailable provider data. This does not classify the entire eligible catalog.

Most frequent correction-adjusted selections:

| Player | Position | Draft frequency | Verified |
| --- | --- | ---: | --- |
| Bijan Robinson | RB | 9 | Yes |
| CeeDee Lamb | WR | 9 | Yes |
| Jaxon Smith-Njigba | WR | 9 | Yes |
| Trey McBride | TE | 9 | Yes |
| Amon-Ra St. Brown | WR | 8 | Yes |
| Brock Bowers | TE | 8 | Yes |
| Christian McCaffrey | RB | 8 | Yes |
| Jahmyr Gibbs | RB | 8 | Yes |
| Josh Allen | QB | 8 | Yes |
| Chris Olave | WR | 7 | Yes |
| Derrick Henry | RB | 7 | Yes |
| Ja'Marr Chase | WR | 7 | Yes |
| James Cook III | RB | 7 | Yes |
| Jonathan Taylor | RB | 7 | Yes |
| Kenneth Walker III | RB | 7 | Yes |

## Recommendation

**Yes: actual completed-draft usage supports season FP/game descending as the default for offensive Draft browsing.** Keep partial-coverage disclosure for the wider eligible pool, unknown values last in both directions, existing scoring contexts, and K/DST limitations. This confirms observed drafted-player coverage, not comprehensive coverage of every eligible player or a guarantee for future provider refreshes.

No implementation/default changes, database writes, migrations, scoring changes, commits, pushes, merges or deployments were performed. Existing feature work and WIP stash were preserved.

The adjacent JSON preserves every drafted player’s stable IDs, corrected draft frequency, season scoring inputs, GP, score range across frozen slate rules, per-draft completion/coverage checks and scoring settings.
