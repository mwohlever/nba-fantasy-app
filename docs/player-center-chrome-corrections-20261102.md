# Player Center manual Chrome corrections — November 2, 2026

These changes are local to the normal checkout on `main`. No production data,
certification, mapping, cache, job, workflow, flag or GitHub state was changed.

## Why the pool stayed alphabetical

The draft browser calls `/api/player-center/comparisons`. The authenticated route
retains Group/slate authorization and frozen scoring. `PlayerCenterService.comparisons`
uses stored observations/caches only; it does not fan out to ESPN for the full pool.

`SupabaseCenterRepository.histories` marks uncached observations as research only
(`comparisonEligible=false`). Complete-sample certification also requires resolved
identity, fresh sources, independent appearance counts, complete metric inputs and a
sufficient window. `compareHistories.coverage.canSort` remains the full-pool gate.
Previously ResearchBrowser used that gate to prevent *all* numerical sorting, and
`observedAverage` was null even for valid short-window values. The result was names
remaining alphabetical while factual box scores existed.

GET-only service checks at approximately 20:02 UTC found:

| NBA professional season | Active source players | Resolved mappings | Players with observed FP values | Certified Last 5 samples |
| --- | ---: | ---: | ---: | ---: |
| 2025–26 (2026) | 530 | 367 | 362 | 0 |
| 2026–27 (2027) | 530 | 367 | 283 | 0 |

The 2026 pool lacks durable cache certification despite fresh historical observations.
The 2027 pool has 163 unresolved identities, 84 additional mapped players without
observations and 283 stale histories. Only Curry has a durable cache, whose October 31
check has exceeded the 24-hour current-season freshness rule. Thus zero certification
is a real coverage limitation, compounded by the historical slate selecting the wrong
professional season. It does not mean zero players have factual statistics.

## Corrections and retained safeguards

- Separate observed means from complete-window averages. Finite actual values can
  sort in either direction, including short/incomplete samples. Missing values remain
  null and sort last; ties use player name and then identity. No zero imputation.
- Label partial views **Observed-data sorting**, show observed coverage first and
  explain complete-sample counts separately. Even a short sample excluded from an
  otherwise certified ranking sorts numerically only under this partial-view label.
  Full-pool certification and `rankableAverage` are unchanged.
- Rename the displayed Fantasy FP option to **Fantasy Points**; preserve the metric
  key and canonical scoring. NFL legacy Season Stats totals remain totals; the actual
  research window averages remain explicitly per game.
- Default new draft profiles and actual-stat browsing to the shared current
  professional-season resolver. Slate/league-history years no longer override that
  default. Explicit professional research choices remain supported. NFL-only context
  cannot override an NBA season. Manual profile selections survive tab navigation.
- Compact modal framing and collapse lineup choices behind **Draft player** (or
  **Roster actions** for an owner). Retain all team buttons, disabled reasons,
  fixed-slot/correction paths, move/remove handlers and busy checks. Reset body/footer
  scroll on opening/reopening or changing player. Charts, table structures, professional
  tabs, league résumé, Compare Players and Game Center remain intact.

A fresh GET-only Curry service read at 20:04 UTC requested NBA 2027 and returned five
appearances with actual FP 28.9, 32.4, 33.1, 64.6 and 46.8: **41.16 average** under
canonical defaults. It correctly used the provider because the durable cache is stale.
No cache was published. Group/frozen-slate scoring still applies in authenticated UI
contexts; this service check does not impersonate a session or certify the full pool.

The recorded five-game cache is preserved as a dated regression fixture. It is not
presented as a new refresh or a claim that these counts will stay current.

## Retest in the existing Chrome preview

1. Reload the existing main-checkout preview with Player Center enabled. Choose NBA
   Game Stats; sort Fantasy Points, PTS and REB both ways. Values should reorder,
   nulls stay last and partial ordering should say Observed-data sorting.
2. Try Last game / Last 3 / Last 5 / Season, position, search and On slate / All players.
   Repeat in NFL; league-history sorts and legacy NFL totals retain their own meaning.
3. Close/reopen Curry. Check 2026–27, Game Log with Season summary, five games and
   41.16 in Fantasy Season/Last 5. Change season, visit all professional tabs and League
   History, then return; the manual season should remain selected.
4. Scroll down, close/reopen, or open a different player. The header should start at
   the top. Draft player should initially occupy one compact footer row; expand it
   to inspect all choices/reasons without submitting any draft/move/remove action.
5. Check narrow/mobile scrolling, Compare two/three, League History and Escape/focus.
   Automated callback tests do not replace visual/mobile Chrome acceptance.

Backups, task-only diff, exact request/read receipts and validation logs:
`/tmp/111sports-player-center-chrome-vmycraw8`.

Final validation: 263 focused checks passed with no failures/skips; TypeScript passed;
14 edited code/test paths introduced zero lint diagnostics (26 existing errors and
16 warnings retained); diff/whitespace checks passed, including new files. One
production build passed with process-only dummy credentials and public activation
off. No browser automation or visual/mobile acceptance is claimed.
