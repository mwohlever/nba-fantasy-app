# CFP Game Center — Phase 1C handoff

[Phase 1D](bracket-game-implications-phase1d.md) subsequently added significance-driven story selection, state-aware aftermath, confirmed points recaps, and simulator scenario presets. That handoff describes the current Implications presentation.

Implemented locally on `feature/bracket-game-implications`. Existing Phase 1A/1B changes were preserved. No commits, pushes, deployments, migrations, production scoring-rule changes, or production-data edits were performed by this implementation or its verification.

## Complete Game Center

Every authorized CFP node now uses the existing shared inline football Game Center shell. The bracket supplies a matchup-header slot; other football consumers retain their original header, state ordering, polling, and tabs.

- Round and game identity appear above the matchup.
- Official topology supplies known teams, seeds, logos, and unresolved dependency slots.
- Scheduled time appears when available; otherwise the header says `Time TBD`.
- Scheduled, live, provider-final awaiting official advancement, and persisted official-final states are distinct.
- Valid provider data supplies the scoreboard and the existing Summary, Play-by-Play, and Player Stats content.
- Missing/unbound provider data retains all four navigable tabs. The three game-detail tabs explain their unavailability; Implications remains functional.
- An unbound adapter carries an empty provider event ID, null scores, and an empty kickoff when unknown. It is always externally loaded, which prevents the shared loader from issuing an ESPN/detail request. The official matchup header renders the real topology rather than those adapter placeholders.
- Back to games, refresh, and the existing game/tab/bracket URL state remain available. Unresolved nodes show established participants and TBD slots; projected opponents never become confirmed participants.
- The older development ESPN event harness remains visibly distinct from actual CFP tournament nodes.

## Personal insights before lock

`derivePersonalGamePath` reads only the viewed entrant's authorized picks, public results/topology, and their scoring rules. It reports the selected team, predicted opponents along the chosen wins, selected championship path, planned exit and next opponent, last selected win, future game IDs/rounds, additional available points, and all currently available points at risk from this team's selected wins.

Predicted opponents are explicitly labeled as the entrant's **predicted path**. The path is never presented as an official matchup. A wrong predicted opponent does not invalidate a later correct winner. Missing picks produce no imaginary wins. Already eliminated, settled, or otherwise unavailable selections contribute no remaining points. Zero-point future wins still retain their structural meaning.

Personal presentation prioritizes a meaningful headline, short path explanation, and compact later-round stakes ahead of immediate outcome cards. A champion pick can be described as going all the way; a team picked to lose next round can be described as the entrant's last selected win. Future totals use actual supplied round values, including nonstandard values in the simulation. Existing official-final cards retain their retrospective explanation of opportunities removed by that result, while personal remaining-point facts use the current official results.

Account-owned entries use second person. Other participants and managed entrants use their names. Before lock, the production endpoint continues to suppress every rival pick-derived fact. Personal path analysis has no rival input. It introduces no AI calls, probability claims, ranking guarantees, or optimal-rooting recommendations.

## Group insights after lock

Existing authorized frozen consensus and exposure calculations remain. The facts now explicitly identify rival selections at the game node, so named agreement also works in zero-point rounds. Explanations can identify same/opposite picks, entrants needing a team to advance farther, rival future points lost, and championship dependencies. Entries remain distinct even when managed by the same account or sharing an entrant.

Each comparison uses that entry's frozen rules and stays within the selected Group contest. Incomplete cohort snapshots still show pending comparisons. Earned points remain separate from future points that might be won or eliminated.

## Simulation architecture and isolation

Local URL: **http://localhost:3000/dev/cfp-simulation**

The App Router server page calls `notFound()` unless `NODE_ENV` is exactly `development`. Test, unset, and production environments are denied. There is no simulation API route or environment override that enables the simulator in a production build. Direct production page/data/API requests were checked against the built local production server and returned 404.

The root layout delegates its existing runtime tree to `AppRuntime`. On the exact simulation path, it renders the server page without AppHeartbeat, GroupProvider, SportProvider, AppResumeTracker, notification/account integrations, or normal app navigation. On all normal paths it retains the original provider tree and order. This prevents simulation mounts, focus changes, or refreshes from launching real background work or changing the active Group. The simulation uses a static branded header instead of account/Group navigation.

The simulator has twelve fictional teams and four fictional entrants—Alex, Jordan, Casey, and Taylor—with valid, complete, internally consistent 11-game CFP picks. Their championship picks are distinct. The entries include a major upset path, a win-today/lose-next-round path, a win-today/lose-in-the-semifinal path, and championship dependence on multiple later wins. Casey uses different round values to exercise per-entry scoring.

All game phases, winners, official simulated results, and revisions live in React memory. No database/provider modules are imported by the simulation model. There is no fetch, persistence, admission, freezing, or real result synchronization in the simulator controller. Reset and reload restore the initial state.

The real `BracketGameCenter`, shared football shell, bracket selector, `BracketGameImplications`, `deriveGameImplications`, canonical `scoreBracket`/result validators, and `gameImplicationsNarrative` are reused. The only adapters are:

- an injected in-memory list/analysis source instead of the production authenticated endpoint;
- explicitly simulated scores and period/status on fictional provider objects;
- the shared shell's external request, preventing provider requests;
- static fictional logos and the isolated branded header;
- simulation controls held in memory instead of restoring tournament results from URL/storage.

The source includes a revision in request identity. Game, entrant, privacy-mode, state, and result changes hide obsolete implications immediately; aborted/late requests cannot show a previous simulation or subject. Production game/tab/bracket URL behavior remains unchanged.

Official simulated transitions validate legal participants and earlier advancement. Changing/removing an earlier official winner clears dependent results, phases, and winner selections before revalidation; unrelated results remain. Later-round states cannot be finalized until feeders establish both participants. The optional preparation button applies legal feeder results using the viewed fictional picks, explicitly within the simulation.

## Testing the controls

1. Start `npm run dev`, then open the local simulation URL. The page must say **SIMULATION — NOT REAL RESULTS**.
2. In Implications, switch `Viewing bracket` among Alex, Jordan, Casey, and Taylor. River vs. Lake exercises their contrasting paths and scoring values.
3. Leave `Pre-lock personal insights` checked for personal-only explanations. Uncheck it for frozen-style fictional Group comparisons and simulated scoring totals.
4. Switch Game state from Pregame to Live to Provider final. Scores are simulated; neither live nor provider-final advances the official in-memory graph.
5. Choose a legal winner and select Official final. Review actual points and eliminated future selections. Change the winner to compare the impact.
6. Select a quarterfinal, semifinal, or championship. Review TBD/conditional exposure first. Use **Prepare legal feeder results from viewed picks** or manually finalize earlier games, then explore the established matchup.
7. Finalize the championship, return to an earlier game, and change its winner. Dependent later outcomes become unresolved again.
8. Use Reset simulation to restore all initial conditions. Back to games opens the simulation's game list, preserving the viewed fictional entrant.

## Changed files in Phase 1C

- `app/layout.tsx` — delegates the existing runtime tree to the simulation-aware wrapper.
- `app/dev/cfp-simulation/page.tsx` — new server-gated development route.
- `app/bracket-challenge/[contestId]/live/page.tsx` — passes official matchup metadata and refresh callback to the Game Center.
- `components/platform/AppRuntime.tsx` — new runtime isolation for the simulation path.
- `components/bracket/BracketGameCenter.tsx` — complete shared shell for provider-bound and unbound games; injected simulation source support.
- `components/bracket/BracketMatchupHeader.tsx` — new topology/provider matchup presentation.
- `components/bracket/BracketGameImplications.tsx` — path/stakes presentation and versioned in-memory-source support.
- `components/bracket/BracketTournamentSimulation.tsx` — new interactive controls using real components.
- `components/live-scores/FootballGameCenter.tsx` — optional matchup-header/unavailable-content slots; existing consumers retain their behavior.
- `lib/bracket/gameCenter.ts` — new official header facts and safe unbound model adapter.
- `lib/bracket/personalPath.ts` — new personal-only path analysis.
- `lib/bracket/gameImplications.ts` — personal path facts and explicit rival node selections.
- `lib/bracket/implicationsNarrative.ts` — richer personal stories/stakes and zero-point-round agreement.
- `lib/bracket/simulation.ts` — new fictional fixture, immutable transitions, validated advancement, source responses, and simulated scoring.
- `public/simulation/cfp-team.svg` — generic fictional team badge.
- `tests/bracket-phase1c.test.cjs` — new shell/path/advancement/isolation/gate tests.
- `tests/bracket-simulation-browser.test.cjs` — new real-browser simulator and production-denial tests.
- `docs/bracket-game-implications-phase1b.md` — points readers to this updated behavior.
- `docs/bracket-game-implications-phase1c.md` — this handoff.

## Verification results

- All 15 focused Phase 1C tests pass, including shell rendering, resolved/TBD slots, names/seeds/logos/status, actual-rule future exposure, incorrect predicted opponents, eliminated/incomplete picks, personal privacy, zero-point agreement, legal advancement/correction, no mutation, and environment denial.
- Combined existing bracket and relevant shared Game Center regressions: **221 tests, 217 passed, four optional browser tests skipped** in the default invocation. No failures.
- Separately enabled Chromium checks pass at **390px and 1024px**: two existing component/Next-routing tests, the full simulation interaction test, and the production-denial test. The simulator was exercised by changing all entrants, phases, winners, earlier results, and later-round game selections—not merely checking for controls.
- The simulation test observed **zero API requests**, including after refresh, reset, game switching, and Back to games. An active-Group storage sentinel remained unchanged. Real application requests in the ordinary CFP browser fixtures were intercepted, including all writes.
- Local production denial returned 404 for the page, a Next data URL, and `/api/dev/cfp-simulation`. Chromium loading the denied page did not render the simulator or launch API/background requests.
- `npx tsc --noEmit` and `npm run build` pass. The production build includes the gated dynamic route.
- Scoped lint has no new errors. The new image rendering has two advisory `no-img-element` warnings. The existing Live Scores effect lint error and shared Football Game Center's three effect/memoization errors remain pre-existing.
- `git diff --check` passes.

Screenshots: `/tmp/bracket-phase1c-simulation-390.png` and `/tmp/bracket-phase1c-simulation-1024.png`.

Example browser command (with Dev server running):

```sh
LD_LIBRARY_PATH=/usr/lib/firefox \
FOOTBALL_BROWSER_MODULE=/home/markwohlever/.npm/_npx/e41f203b7505f1fb/node_modules/playwright \
BRACKET_DEV_BROWSER_URL=http://localhost:3000 \
node tests/bracket-simulation-browser.test.cjs
```

The production-denial check additionally uses a local `next start` server, `BRACKET_PRODUCTION_BROWSER_URL`, and `BRACKET_PRODUCTION_BUILD_ID`.

## Limitations and Phase 2

The simulation does not manufacture game stories, plays, player statistics, real schedules, or odds. Those tabs intentionally explain their unavailability. Scores/periods are explicit fixed fictional examples. Its fixture picks are read-only; the privacy toggle exercises personal versus Group presentation. It is available only in local development, not a production build or generic test environment. There is no saved simulation state across reloads.

Authenticated real-data QA remains for actual Group membership, managed/multiple entries, provider bindings/logos/schedules, and real provider-final-to-official-final refresh transitions. The simulation's fake data and browser fixtures do not substitute for those checks.

Phase 2 still requires exact legal remaining CFP scenario enumeration, tie/tiebreaker handling, attainable/guaranteed rank paths, and contest-win paths. Probability claims need a separate probability model. No current sentence claims an outcome guarantees rank improvement or an optimal rooting preference.
