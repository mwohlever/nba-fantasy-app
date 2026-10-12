# Phase 1D.1 — Contest lock and pick visibility

## Investigation findings (recorded before corrections)

The Phase 1D mismatch shown in simulator QA is principally a simulation-control ambiguity: `preLock` is an independent checkbox, initially true. Changing a fictional game to Live does not change it; story presets set it false. Consequently, Live + private personal stories and a different preset + Group stories can both be intentional simulation states. Neither is evidence that production unlocks picks directly from the selected game's client-side status.

Production has an established **contest-wide** lock boundary:

1. `shouldFreezeBracketEntry` in `lib/bracket/lifecycle.ts` closes the contest for stored statuses `locked`, `in_progress`, or `final`, or when the supplied contest lock deadline has passed.
2. `getBracketChallengeDetail` supplies an **effective** deadline from `effectiveBracketLockAt`: the earliest valid contest deadline or scheduled competition-game time. A persisted competition game in `in_progress` or `final` forces an already-expired effective deadline. This is an existing safety rule; it is not the selected game's ESPN/display status independently overriding privacy.
3. `canEditBracketGame` first respects the global contest lock, then checks the individual game's stored status/deadline for remaining editable drafts. Individual game editing locks and the full contest snapshot/privacy boundary are separate.
4. Commissioner status/deadline changes can enter full lock and freeze admitted entries. `maybeFreezeContestEntry` uses the canonical contest resolver and validates master picks before its service-role freeze RPC.
5. `syncBracketCompetitionResults` freezes eligible entries before persisting results. Its existing safety path also freezes all competition contests for a uniquely bound, participant-matched provider event that has started/finished, even if schedule data is missing. It can then persist in-progress status or a validated official final. This trusted synchronization boundary is distinct from a client merely displaying Live/Q3.
6. `freeze_bracket_entry` copies picks/rules into immutable contest entries. The SQL function is restricted to service role; database snapshot guards protect locked historical picks/rules. Admission SQL checks stored contest state/deadline, while application access/edit paths consume the effective deadline. No SQL changes are needed for this pass.

The implications reader already authorizes the active Group's enabled bracket league, filters contest and competition, enforces owned/managed draft access, and uses frozen entries after lock. `bracketInsightVisibility` exposes Group facts only after lock and complete frozen snapshots; invalid snapshot rules/picks suppress comparisons too. `poolState` controls the narrative boundary. Provider-final is never sufficient for earned points or advancement; persisted official results remain required.

Two production propagation weaknesses were identified by tracing the code:

- Subject-list refresh only ran on mount/game/retry/source changes. Analysis polls updated it when a subject was selected, but no selected subject meant newly viewable post-lock entries could remain undiscovered until manual refresh/reopening.
- The reader independently evaluated `locked` and visibility with separate implicit clocks. A request spanning a lock deadline could theoretically use different sides of the deadline for subject access and pool readiness. The correction will use one captured evaluation time for both, without changing the resolver.

## Intended focused correction

Expose the server-evaluated contest lock context alongside pool readiness, use one evaluation time, refresh subject options independently of selection, and replace the ambiguous simulation checkbox with explicit Before/After contest lock options. Simulation game state will remain independent; exceptional Live/Final + Before combinations will be labeled privacy tests. Preserve Phase 1D story priorities, ten presets, scoring, immutable snapshots, and all authorization boundaries.

## Implemented correction

The observed control mismatch was in the simulator. Production did not unlock picks from a displayed Live/Final flag. This pass also closes the production refresh gap and deadline-clock race described above; neither requires changing established lock rules.

- Every implications/list response now includes `contestLock`: contest scope, resolved `locked` decision, stored status, effective deadline, and evaluation timestamp. The reader captures one clock for subject authorization and pool visibility. The existing response still separately reports snapshot readiness, persisted official results, and freshness.
- Bracket options refresh independently of selected-bracket analysis: every 20 seconds for displayed live/final games, otherwise every 60 seconds. This discovers newly authorized post-lock subjects even when no bracket is selected. Existing unambiguous personal defaults, managed entrant separation, and explicit ambiguous-selection behavior remain.
- Client subject-list updates use the server evaluation timestamp. Older list/analysis responses cannot replace a newer privacy/readiness decision. Analysis rendering is keyed by that policy as well as contest, game, selected entry, and simulation revision. A changed policy immediately hides mismatched cards, while existing abort and identity guards prevent late responses for another game/bracket from appearing.
- The simulator has an explicit **Contest lock** select with **Before contest lock** and **After contest lock**, independent of game phase. It uses the canonical lock/visibility helpers for its fictional contest. All ten existing presets explicitly start after lock; initial/reset state starts before lock. The selector visibly shows each preset's lock state.
- Live/provisional/official + Before is retained as an explicitly labeled privacy test. It does not imply a normal production sequence. Changing lock state does not alter official simulated results or award points; simulated official result controls remain responsible for scoring.
- The compact before-lock message is now “Other brackets will be available once the contest locks.” After lock, ready Group stories appear without that disclaimer. Snapshot-pending comparisons still have their existing pending message.

Phase 1D significance priorities, authored narratives, ten scenario presets, result corrections, championship presentation, and completed-tournament recaps are preserved. No production scoring, synchronization, freeze RPC, SQL, or official-result behavior was modified.

## Changed files for this pass

These changes extend the existing uncommitted Phase 1A–1D implementation; the full working-tree status also contains earlier work.

- `lib/bracket/lifecycle.ts` — context adapter reporting the existing lock resolver.
- `lib/bracket/gameImplications.server.ts` — explicit context and shared evaluation time.
- `lib/bracket/implicationsContext.ts` — context consistency and response ordering helpers.
- `lib/bracket/implicationsNarrative.ts` — compact privacy wording.
- `lib/bracket/simulation.ts` — canonical fictional lock/visibility and deterministic preset state.
- `components/bracket/BracketGameImplications.tsx` — independent option refresh and privacy-aware stale response suppression.
- `components/bracket/BracketTournamentSimulation.tsx` — explicit independent lock control and privacy-test note.
- `tests/bracket-game-implications.test.cjs` — four additional server authorization/clock tests.
- `tests/bracket-lock-privacy.test.cjs` — six new deterministic lock/privacy tests.
- `tests/bracket-lock-browser.test.cjs` — two new real Chromium lock-transition/list-refresh tests.
- `tests/bracket-implications-browser.test.cjs` — delayed-response fixture now supplies the actual list/analysis lock contract.
- `tests/bracket-simulation-browser.test.cjs` — existing simulator interactions use the new select.
- `docs/bracket-game-implications-phase1d1.md` — investigation and handoff.

## Privacy and authorization verification

Server-reader tests exercise the actual reader with isolated in-memory database fixtures. Before lock, even early-frozen rival snapshots remain unavailable, and selecting unauthorized entries is rejected. Owned/managed drafts, multiple entries, foreign Group contests, shared masters across contests, missing/invalid snapshots, and official-result boundaries remain covered by the existing suite. No new client-only access rule substitutes for the server gate.

Pure tests verify all four game phases with both lock states. Before lock, analysis contains only the authorized subject: rival exposure, consensus counts, championship entry lists, and final Group standings are absent. Generated narrative objects do not contain competing entrant names. After lock, the complete authorized frozen cohort becomes available. Provider-final does not award confirmed points; official-final does. A request crossing the deadline retains one consistent access/privacy decision.

Real Chromium tests toggle before/after while live, provisional-final, and official-final; switch entrants; exercise all ten presets; verify reset; and check old stories disappear. An intercepted production-client fixture verifies post-lock discovery with no selection, rejection of an older option snapshot, and suppression of late Group analysis after a newer private decision. Existing game/bracket switching and URL navigation tests also pass. These fixtures do not replace authenticated production-data QA.

## Verification results

- Focused server reader: **26 passed**, including the four new regressions.
- Focused lock/privacy suite: **6 passed**.
- Combined bracket and relevant shared football/NCAA regressions: **279 tests; 272 passed, 7 optional Chromium tests skipped in the default invocation; zero failures**.
- Separately enabled bracket Chromium checks: **7 passed** across component/Next routing, delayed responses, simulator transitions, storytelling/completion, new lock behavior, and production denial. Simulator interactions ran at **390px and 1024px**, with no horizontal overflow, page errors, or production API requests.
- Additional shared football Chromium layout regressions: **2 passed** at both widths; the unrelated signed-out NCAA Next lifecycle test remained optional/skipped in that invocation.
- Production simulator page, direct Next data URL, and API URL return **404**. The denied page renders no simulator and sends no API requests.
- `npx tsc --noEmit`, scoped ESLint, `npm run build`, and `git diff --check` pass. Scoped lint has one existing advisory `no-img-element` warning in the simulator header. Build emits the existing edge-runtime/static-generation notice. No new failures remain. Unrelated Live Scores/shared Football effect lint failures recorded in Phase 1C were not modified or included in this scoped lint pass.

Reproduce the non-browser regression invocation:

```sh
node --test tests/bracket-*.test.cjs tests/football-play-visualization.test.cjs tests/ncaa-game-center-logos.test.cjs tests/nfl-inline-live.test.cjs tests/nfl-live-integration.test.cjs tests/ncaa-inline.test.cjs
npx tsc --noEmit
npm run build
git diff --check
```

Browser logs are `/tmp/bracket-phase1d1-browser.log`, `/tmp/bracket-phase1d1-production-denial.log`, and `/tmp/bracket-phase1d1-shared-browser.log`. Screenshots from the lock tests are `/tmp/bracket-phase1d1-lock-390.png` and `/tmp/bracket-phase1d1-lock-1024.png`.

## Simplest local QA

Open **http://localhost:3000/dev/cfp-simulation** with the Dev server running (`npm run dev` if needed).

1. Set **Game state → Live** while **Contest lock → Before contest lock**. Personal stories remain useful; competing picks stay private. The small note identifies this as a privacy-test combination.
2. Change **Contest lock → After contest lock**. Authorized fictional Group comparisons become available. Switch **Viewing bracket** between Alex, Jordan, Casey, and Taylor; stories update for that subject.
3. Try the existing story presets for championship threats, consensus, quiet games, and completed tournament. Every preset visibly selects After contest lock. Toggle Before to verify private personal presentation; Reset returns to Before.
4. Test Provider final versus Official final: only the latter confirms points and advancement. Keep lock state independent while switching these phases.

All simulated entries/results stay in memory. No Supabase records, active Group, background jobs, real standings, or historical statistics are changed. Production access remains denied.

## Remaining authenticated QA and next step

Verify a real authorized Group across its effective deadline: owned and managed drafts before lock; admitted foreign brackets only after lock; incomplete snapshot processing; multiple brackets without arbitrary defaults; the same master in separate contests; and Group switching. Confirm real provider display versus trusted persisted-start/official-result behavior. Polling can take up to 60 seconds before kickoff or 20 seconds during live/final display; manual Game Center refresh is immediate. A cohort snapshot pending freeze deliberately keeps comparisons pending.

The next recommended step is this authenticated lock-boundary QA before planning Phase 2. Exact incomplete-tournament rank ranges, winning scenarios, optimal rooting, and probability modeling remain deferred. This pass does not start Phase 2.

No commits, pushes, merges, deployments, migrations, production-data modifications, or unrelated sports/3D-worktree edits were performed in this pass.
