# Draft season sorting and Josh Allen game-log correction

Branch: `fix/draft-season-sorting-allen-log`, from production `ccd3ebc`.

## Draft

The Draft catalog now always requests `view=catalog&window=season`. Its dedicated service reads the local eligible identity catalog and ESPN's cached bulk published season facts; it does not read game observations, use previously opened profile samples, or fan out into individual ESPN athlete requests. Full-pool numeric sorting uses the same published totals / GP for both displayed and compared values. Missing values sort last in both directions; names break numeric ties only. Existing On Slate / All Players, search, season selection and position filters remain, including canonical NBA UTIL and NFL flexible-slot eligibility.

The recent-window selector, three-player missing-stats button and obsolete stored-data source selector are absent from the active Draft catalog. Player Center retains all four windows. NBA fantasy averages require all six canonical inputs and use the authorized Group/slate scoring settings. NFL defaults to useful factual season statistics; its fantasy sort is disabled with an explicit explanation. A focused live check confirmed NFL bulk still omits total `general.fumblesLost`, including when requesting a fumbles-lost sort. Rushing/receiving-only losses are not valid substitutes, so no per-athlete pool scan or invented zero was added.

Coverage shows the count of displayed players with season values, incomplete coverage, and stale data where relevant. Unmapped, duplicated or absent ESPN identities cannot borrow facts from names/native NBA IDs, and unknown eligible IDs cannot certify a complete ranking. Catalog requests do not fall back to observed-game averages when bulk facts are missing. Existing stored-season behavior remains available only through the existing feature-off fallback; no ingestion/scoring changes are included.

## Josh Allen

The raw 2026 ESPN athlete log for 3918298 has passing/rushing statistics but lacks receptions, receiving yards, receiving touchdowns, fumbles lost and explicit completed status. Weeks 1 and 2 are outside the initial five recent-summary requests.

The original five-summary initial read remains bounded. Player Center then requests the displayed older incomplete games in batches of at most five, with the existing eight-request/deadline budget and three-request concurrency bound per server request. Displaying the full history opts into additional visible rows. Requested events must belong to the exact player's season/phase log; fresh previously fetched summaries are reused without additional network requests. The existing summary normalizer and fumble-evidence reconciler establish finality and factual zero values. Provider failures retain known facts and visibly incomplete rows.

Captured ESPN evidence reconciles to existing default scoring:

- Week 1, event 401872660: 334 pass yards, 2 pass TD, 0 pass INT, 23 rush yards, 2 rush TD; receiving production and lost fumbles verified zero: **35.66 FP**.
- Week 2, event 401872932: 248 pass yards, 3 pass TD, 0 pass INT, 69 rush yards, 2 rush TD; receiving production and lost fumbles verified zero: **40.82 FP**.

Regression fixtures document the source responses. No zero is inferred merely because a field or athlete row is absent.

## Validation

- 182 focused/regression tests pass: numeric ordering, explicit zeros/missing values, IDs/seasons, inactive eligible rows, provider collisions, frozen scoring, catalog API bounds, Allen's affected games, failure fallback, cache reuse and preserved profile windows.
- Chromium checks pass at 360/390px for the actual Draft workspace (both directions, On Slate / All Players, position and season changes, missing-last, disabled NFL fantasy sorting) and Allen's actual captured Week 1–2 rows. Existing NBA/NFL Draft actions/profile navigation pass at 360/390/1280px with the feature enabled and disabled.
- Existing Burrow/Castle checks pass against local Next.js Dev with writes blocked and APIs intercepted.
- TypeScript, production build and `git diff --check` pass.
- Changed/new isolated files pass lint. The two larger touched Draft files retain their baseline 26 errors / 16 warnings with no new diagnostics; no unrelated lint cleanup was performed.

No production database writes, migrations, observation/ingestion redesign, canonical scoring-rule edits, draft picks, commits, pushes, merges or deployments. Existing WIP stash and branches are preserved.
