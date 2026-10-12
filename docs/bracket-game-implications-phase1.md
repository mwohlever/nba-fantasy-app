# CFP Game Implications — Phase 1 handoff

The selector and Game Center presentation described below were subsequently refined by [Phase 1B](bracket-game-implications-phase1b.md). That handoff documents the current inline UX; the calculation and authorization foundations remain in place.

Implemented on `feature/bracket-game-implications`, based on `66e1ad1`.
The existing `feature/groups-platform` branch did not contain the bracket infrastructure at this baseline. Both existing branches were left unchanged; no additional worktree was created.

## Behavior

CFP Live Scores now has an explicit viewed-bracket selector. Bound provider games retain Summary, Play-by-Play, and Player Stats, with an additional Implications tab. Games without usable provider details have a separate official-bracket implications view. No matchup is invented for unresolved participants.

The three sections explain the viewed bracket's pick and points, other contest entries' exposure, and immediate/future scoring consequences. Championship entry names and detailed losses expand on demand. The model counts entries, including managed entrants and multiple brackets, rather than unique owners.

Available facts:

- The viewed game pick, its current scoring status, and whether it can still score.
- Immediate points for each confirmed legal outcome, separately for the subject and every rival, using each entry's frozen round values.
- Downstream picks made impossible by a losing team, including zero-point picks, and the associated future scoring ceiling lost.
- Entry counts at the game node, championship selections and viability, longer rival paths, and structured win-now/lose-later exposure.
- Conditional winner points and downstream team exposure when the participants are unresolved. These facts explicitly require that the team first reaches the game.
- A single confirmed result and its actual impact once persisted. Historical eliminated opportunities are reconstructed even after later rounds have finished.
- Whole-bracket earned points and remaining pick potential, displayed separately from this game's effect.

Loss of future potential is never described as guaranteed rank improvement, an optimal rooting preference, or a change in win probability.

## Exact identity and data flow

1. Bracket-page links and bracket navigation preserve `entryId` or `entrantId` plus `bracket`. Live Scores has no automatic first-entry or account-default selection.
2. `GET /api/bracket-challenge/contests/[contestId]/implications` lists authorized subjects. With a selection and `gameId` (the graph game key), it also returns the analysis.
3. `getCurrentUser()` supplies the authorization principal. `getBracketChallengeDetail()` resolves the active Group's enabled bracket league, filters the contest by that league, and loads/validates its competition graph.
4. The implications reader loads the admitted cohort once, scoped by both contest and competition, with joined entrant/master metadata. It verifies the master/entrant/competition relationship. Games must be found in that competition; this endpoint only supports `college_football` / `cfp`.
5. A frozen subject uses the selected contest entry's immutable picks/rules snapshots. An incomplete frozen entry stays pending and never reads mutable master picks. Before lock, an owned/account-managed existing master can be selected by entrant plus bracket number; its private master picks and current contest rules are used. The endpoint never creates, admits, or freezes a bracket.
6. Rival facts are returned only after lock and when the entire admitted cohort has usable frozen snapshots. Invalid or incomplete rivals suppress all Group comparisons while a valid personal subject remains available. Before lock, no rival pick-derived facts are returned.
7. The pure analyzer consumes the validated topology, persisted official final results, subject picks/rules, and authorized frozen cohort. It never writes or mutates those inputs. Correct downstream winners do not require a correct predicted opponent.
8. Responses echo Group/contest/competition, game key/database ID/provider binding, entry/master ID, entrant, bracket number, and draft/frozen/pending status. They include the official winner/status, read time, topology version, and a deterministic serialization of the persisted result state.
9. The client validates the returned contest/competition/game/entry or entrant-number context. Rendering is keyed by request identity, and aborted/late responses are ignored. Switching subjects or games immediately hides the previous analysis. Refresh failures clear implications and offer retry.

The implications endpoint performs no provider fetches. Provider status/score context comes from the existing Game Center, including its refreshed detail; only persisted official finals confirm advancement. Existing Live Scores result synchronization is unchanged.

## Files

New:

- `lib/bracket/gameImplications.ts` — pure game analysis.
- `lib/bracket/gameImplications.server.ts` — authorized subject/cohort reader and response types.
- `lib/bracket/implicationsContext.ts` — selection serialization and response identity validation.
- `app/api/bracket-challenge/contests/[contestId]/implications/route.ts` — authenticated read-only endpoint.
- `components/bracket/BracketGameImplications.tsx` — explanation UI and guarded request lifecycle.
- `tests/bracket-game-implications.test.cjs` — analysis/access fixtures.
- `tests/bracket-implications-browser.test.cjs` — real browser interactions against isolated fixtures.
- `docs/bracket-game-implications-phase1.md` — this handoff.

Modified:

- `app/bracket-challenge/[contestId]/live/page.tsx` — selector, URL context, game key, pending-matchup opening.
- `app/bracket-challenge/[contestId]/bracket/page.tsx` — explicit live link for the viewed bracket.
- `components/AppNav.tsx` — preserve bracket query context between Bracket and Live Scores.
- `components/bracket/BracketGameCenterModal.tsx` — opt-in tab and provider-unavailable view.
- `components/bracket/BracketLiveScoreCard.tsx` — implications action on official graph fallback cards.
- `components/live-scores/FootballGameCenter.tsx` — optional extra-tab slot; existing consumers keep three tabs and their original state ordering.
- `tests/helpers/football-browser-bundle.cjs` — optional bracket component bundle.

## Local QA

Use an authorized CFP contest in the active Group:

- `/bracket-challenge/<contestId>/live` — choose a bracket, open a game, then Implications.
- `/bracket-challenge/<contestId>/live?entryId=<frozenEntryId>` — view another admitted frozen entry after lock.
- `/bracket-challenge/<contestId>/live?entrantId=<ownedOrManagedEntrantId>&bracket=2` — specific draft/managed bracket.
- `/bracket-challenge/<contestId>/bracket?entryId=<frozenEntryId>` — follow the live-implications link and return via bracket navigation.

Check both a bound matchup and an unresolved/fallback game. Confirm selection persistence when closing a modal, returning to Bracket, and returning to Live Scores. Verify private drafts before lock, incomplete pool snapshots, live status, provider-final awaiting advancement, and persisted official final.

## Verification

- 20 focused analysis/access/identity tests pass, including another viewer's frozen bracket, managed/multiple brackets, one master in two Group contests with different snapshots, disabled access, cross-Group rejection, draft privacy, unadmitted owned masters, incomplete/invalid snapshots, early freezing, different round values, wrong predicted opponents, zero points, no mutation, championship exposure, and persisted-final distinctions.
- All 18 bracket test files pass via `node --test --test-concurrency=2 tests/bracket-*.test.cjs`. Optional browser tests are separately enabled below; a default suite pass does not imply browser execution.
- Shared regressions pass: `football-play-visualization.test.cjs`, `nfl-live-integration.test.cjs`, and `ncaa-game-center-logos.test.cjs`. The NFL integration file's 34 tests also pass directly.
- Real Chromium fixture interactions pass at 390px and 1024px: tab navigation, immediate stale-card clearing, delayed bracket/game requests, provider-final wording, errors/retry, and provider-unavailable fallback. This is component browser verification, not authenticated production-data QA.
- Signed-out Next Dev route compilation and endpoint authorization were checked; the endpoint returns 401 without a session.
- `npx tsc --noEmit` passes. Production `npm run build` passes; the initial sandbox build could not download the existing Google Fonts, and the authorized rerun succeeded.
- Scoped lint passes for the new implementation files, wrapper, tests, and browser helper. The touched existing UI files retain eight lint errors confirmed against `66e1ad1`: four in Bracket page, one in Live page, three in shared Football Game Center. Those are existing React effect/purity/memoization and unescaped-entity issues. Existing image/hook warnings remain.
- `git diff --check` passes.

Browser command for this environment:

```sh
LD_LIBRARY_PATH=/usr/lib/firefox \
FOOTBALL_BROWSER_MODULE=/home/markwohlever/.npm/_npx/e41f203b7505f1fb/node_modules/playwright \
node tests/bracket-implications-browser.test.cjs
```

Launching the browser requires permission outside the sandbox in this environment. No dependencies were installed.

## Pending data and Phase 2

Unselected subjects require selection. Missing personal frozen snapshots show pending. Pre-lock rivals remain private. Incomplete/invalid cohort snapshots keep comparisons pending. Unresolved participants show conditional exposure only, and the development event harness has no bound tournament implications. Provider-unavailable games still support official graph analysis; live score and play details depend on the existing provider binding.

Remaining pick potential follows the existing scoring model. It is not an exact scenario bound for arbitrary conflicting possibilities. Phase 2 must enumerate legal remaining CFP outcomes with per-entry rules and define tie/tiebreaker handling before providing attainable ranks, guaranteed ranks, contest-win paths/odds, or optimal rooting recommendations. Probability claims additionally need an explicit probability model.

No commits, pushes, deployments, migrations, scoring-rule changes, or production-data mutations were performed.
