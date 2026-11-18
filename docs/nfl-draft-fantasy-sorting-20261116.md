# Release preparation — November 18, 2026

NFL Draft opens with **On slate** actively filtering the pool through the existing scoped `/api/slate-availability` result. Unknown availability shows no default rows; a stale response from another scope cannot supply eligibility. **All players** remains available. Parent-owned filter choices survive search, position changes and pool remounts; NBA defaults remain unchanged.

Offensive Draft sorting defaults to season **FP/game descending**, including partial pools. Numeric unknowns remain null/last in either direction, alternative positive sorts remain available, and meaningful explicit sort choices survive position/season interactions. K uses factual FGM when available, otherwise stable existing order; K/DST unsupported fantasy options remain explicit. No rules, eligibility, scoring inputs, draft mutations, history, Player Center windows or data schemas changed.

Live usage evidence: [successful drafted-player coverage audit](diagnostics/nfl-drafted-fantasy-coverage-live-20261118.md) and its bounded JSON snapshot: **59/59 unique offensive players**, **234/234 correction-adjusted selections**, **nine completed drafts**, all six corrections reconciled; active Week 11 excluded. This supersedes the earlier network-blocked investigation conclusions below. Wider catalog coverage remains partial.

Application changes include `LineupBuilder.tsx` and `PlayerPool.tsx` for initial slate filtering, scoped readiness and removal of the NFL mount-time All Players reset, alongside the existing season-facts/cache/sorting changes described below.

---

# NFL Draft season fantasy sorting — November 16, 2026

Branch: `feature/nfl-fantasy-default-sorts`, from production `996f2da`.

## Source and interpretation

The published `site.web.api.espn.com/apis/common/v3/sports/football/nfl/statistics/byathlete` response supplies GP and eight offensive scoring inputs, but not total fumbles lost. Rushing/receiving fumble losses cannot replace total losses: Burrow and Allen each have total losses 1 versus rushing losses 0.

A complementary public endpoint supplies actual season totals:
`https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/2026/segments/0/leaguedefaults/3?view=kona_player_info`.
The request uses `x-fantasy-filter`, with bounded limit/offset, ownership sorting and actual season identifier `002026`. Actual records must have matching seasonId, source 0, split 0, scoringPeriodId 0, externalId and record ID. Stat 72 matches total fumbles lost; stat 210 supplies GP.

**User-authorized interpretation:** within a reconciled actual season record, an omitted stat 72 means zero. This sparse-zero convention is likely, not an independently guaranteed ESPN contract. Missing players/records, absent GP, projections, other years, duplicate IDs, and mismatched GP or any of the other eight scoring inputs remain unknown. The interpretation does not change game logs, profiles, stored facts, ingestion, or canonical scoring.

Live verification matched all nine inputs to individual Core totals for Burrow, Allen, Chase, Gibbs, Taylor, Robinson and Bowers. The original Burrow seven-game fixture still reconciles to 169.60 / 24.23; current nine-game totals reconcile to 232.30 / 25.81.

## Coverage and sorting

The live join resolved 552 of 2,000 published provider rows (many rows are defensive players). A narrow read-only active-catalog check found 1,031 eligible rows, including 961 offensive players; 498 offensive players had reconciled fantasy inputs. Missing players do not become zero. These are current snapshot counts, not a permanent completeness guarantee; slate eligibility can narrow the pool.

Both season fantasy total and fantasy points/game are offered when verified scores exist. Partial pools are explicitly labeled; unknowns sort last in either direction. FP/game is the automatic descending default for All/QB/RB/WR/TE/FLEX/SF, including partial pools. Available verified values rank numerically and unknown values stay null and last. The selected metric remains FP/game during loading or provider failure, with unavailable values explicitly indicated. K uses FGM when available and otherwise existing order; D/ST retains existing order. Explicit meaningful choices survive filter/season changes. K/DST fantasy limitations remain.

Scores use the existing canonical scorer with authorized Group/slate settings. NFL client sorting reads all metrics from one catalog response; sort/direction changes do not fetch again. NBA behavior is unchanged.

## Request bounds and fallback

The existing published bulk cache remains separate from the new raw complementary cache. Both deduplicate concurrent reads, retain valid stale results, back off failures for 30 seconds, cache current seasons for 15 minutes and historical seasons for 24 hours. No Group scores are cached. Complementary refreshes use at most two 2,000-player pages, 12 MB/page, a shared 15-second deadline and five-second request timeout. Duplicate pagination or unresolved pagination limits fail closed.

The observed cold refresh used 20 existing published pages plus **one** complementary request (1,061 players). No per-player requests occur for Draft sorting. A cold complementary failure preserves published positive stats and disables unsupported fantasy sorting; stale complementary data cannot certify a complete ranking. No new infrastructure or database writes.

## Changed files and validation

Application changes: `components/player-center/ResearchBrowser.tsx`, `components/player-center/data.ts`, `lib/player-center/seasonFacts.ts`, `lib/player-center/service.ts`; new `lib/player-center/draftSort.ts` and `lib/player-center/nflFantasyBulk.ts`.

Tests: new `tests/nfl-draft-defaults.test.cjs`, `tests/nfl-fantasy-bulk.test.cjs`, `tests/nfl-draft-defaults-browser.test.cjs`, captured trimmed source fixtures, and updated expectations in `tests/draft-season-allen-browser.test.cjs`.

Validation passed: 200 focused tests; new source/default tests rerun after fixture trimming; NBA/NFL actual Draft regression checks at 360/390/1280px; NFL default/fantasy/season/failure checks and Allen game-log checks at 360/390px; changed-file ESLint; TypeScript; final production build; `git diff --check`. Screenshots were inspected at 360 and 390px. No commit, push, merge, deployment, migration or database write. Original WIP stash and production main preserved.

## November 18 follow-up: sparse-fumbles verification

The 498/961 result above **already includes** sparse-zero interpretation; it is not a pre-sparse baseline. Reapplying that interpretation cannot establish another coverage gain.

The retained November 16 source responses pair two explicit positive losses (Burrow and Allen, both 1) with one omission (Chase, individual Core total explicitly 0). Recomputing this captured sample gives QB 2 → 2 and WR 0 → 1 when comparing explicit-loss-only records with the narrow sparse interpretation. Burrow's rushing losses remain 0 while total losses remain 1. This supports the convention for fantasy endpoint stat 72; it does not establish an unconditional provider guarantee. The original published `byathlete` schema omits the total-loss field even for nonzero losses, so omissions there must remain unknown.

Additional safeguards retain the actual record's season through normalization and refuse cross-season joins. A payload containing GP alone, with no offensive scoring fields or explicit losses, cannot establish an intact sparse record even if the published inputs are all zero. No interpretation was added for another missing scoring input; the other eight published inputs still must exist and reconcile.

Last measured full active-pool snapshot (November 16, already sparse-enabled):

| Position | Eligible | Verified fantasy inputs |
| --- | ---: | ---: |
| QB | 124 | 51 |
| RB | 211 | 126 |
| WR | 411 | 211 |
| TE | 215 | 110 |
| Offensive total | 961 | 498 |

These counts were recorded in the original investigation. The full raw bulk/catalog snapshots were temporary and are no longer available in this environment. Fresh ESPN retrieval fails DNS resolution (`EAI_AGAIN`); the web fallback also cannot retrieve these endpoints. Therefore a new full-pool before/after recalculation, broader individual-player cross-checks, and a fresh coverage improvement are **not verified**. Unknown players, record mismatches, incomplete payloads and failed cold requests continue to stay unknown.

Follow-up validation: 42 focused tests pass, TypeScript and changed-file ESLint pass, and `git diff --check` passes. The attempted production build fails because restricted network access prevents fetching Geist/Geist Mono from Google Fonts. The attempted Chromium run fails because libnspr4/libnss3/libnssutil3/libasound are absent; the prior temporary browser dependency installation is unavailable. Build and mobile success from November 16 must not be presented as fresh validation of this follow-up. No release actions or database writes were performed; the existing branch work and stash are preserved.

## Final release validation — November 18

- 202 focused Player Center/season-facts/NFL catalog/scoring/cache/default tests pass.
- 125 additional isolated Draft/history/permission/pull-refresh checks: 121 pass; four pre-existing legacy assertions fail identically when the affected app source is loaded from unchanged production baseline `996f2da`. Three obsolete `draft-browser-simplification` expectations require removed Draft windows/old season presentation; one `draft-v2-projection-integration` assertion requires the previously removed projection tab. These tests were not modified in this change.
- Production build and TypeScript pass. Changed-file ESLint is clean outside the two legacy large components. `LineupBuilder` retains its baseline 22 errors/16 warnings and `PlayerPool` its baseline four errors/zero warnings; no new lint findings were introduced.
- Actual NBA/NFL Draft browser regressions pass at 360/390/1280px with the feature enabled and disabled. NFL focused checks pass at 360/390px: default On Slate active filtering, pending/failed availability hides off-slate rows, All Players reveals the catalog, filter state survives pool remounts/search, FP/game default, both directions/missing-last, position/season changes and historical frozen slate scoring. Allen Weeks 1/2 and all Player Center windows remain verified.
- The reviewed commit includes only application files, focused tests/provider fixtures, this release document, and the successful live drafted-player audit MD/JSON. Earlier blocked investigation snapshots remain unstaged. The existing WIP stash and unrelated branches are preserved.
- No production writes, migrations, canonical scoring changes, ingestion changes, draft-history changes, pushes, merges or deployments.
