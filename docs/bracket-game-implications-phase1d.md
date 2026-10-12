# CFP game significance and storytelling — Phase 1D

Implemented locally on `feature/bracket-game-implications`, preserving the uncommitted Phase 1A–1C work. No commits, pushes, deployments, migrations, frozen-rule changes, or production-data edits were performed.

## Changed files

- `lib/bracket/gameSignificance.ts` — new deterministic candidate generation, priority, and overlap suppression.
- `lib/bracket/gameStory.ts` — new editorial stories, game-state treatment, championship celebration, and confirmed points recap.
- `lib/bracket/providerContext.ts` — new refreshed, ID-matched provider-score adapter.
- `lib/bracket/gameImplications.ts` — current entry totals, championship/runner-up context, current team-specific future points, real future pick splits, and complete-tournament points standings.
- `lib/bracket/implicationsNarrative.ts` — exposes the selected editorial story, corrects lost/at-risk wording, and defensively suppresses private comparisons in all presentation fields. Legacy fact/copy fields remain available to existing consumers/tests; the UI uses the selected story.
- `lib/bracket/simulation.ts` — presets and preset-specific fictional entries within the existing immutable simulator.
- `components/bracket/BracketGameCenter.tsx` — supplies refreshed provider context to Implications.
- `components/bracket/BracketGameImplications.tsx` — conditional editorial sections, selective outcome cards, aftermath and championship recap.
- `components/bracket/BracketTournamentSimulation.tsx` — scenario selector and preset-aware source versions.
- `tests/bracket-phase1d.test.cjs` — new significance, story, scoring, privacy, completion, and preset tests.
- `tests/bracket-story-browser.test.cjs` — new real Chromium scenario/story/final-position interactions.
- `tests/bracket-game-implications.test.cjs` — authorized-contest final-position and incomplete-snapshot test.
- `tests/bracket-implications-browser.test.cjs` — retains inline routing and late-response checks, adapted to editorial/provider-final presentation.
- `tests/bracket-simulation-browser.test.cjs` — retains full simulator interactions and denial checks, adapted to the new stories and championship recap.
- `docs/bracket-game-implications-phase1c.md` — points to the updated handoff.
- `docs/bracket-game-implications-phase1d.md` — this handoff.

## Significance and story selection

The existing authorized analysis reader and canonical scorer remain the data boundary. No new endpoint or query was introduced. `deriveGameImplications` enriches its facts in memory using the same graph, official results, picks, and each entry's frozen rules.

`gameSignificance` creates structured candidates with an ID, category, priority, evidence references, and overlap keys. It does not produce a probability or numerical claim about rank movement.

The priority rules are intentionally explicit:

| Story | When it is supported | Priority |
| --- | --- | --- |
| Official result/championship recap | Persisted official winner | 120; bypasses hypothetical candidates |
| Eliminated personal pick, meaningful rival stake | No personal game points remain, but a rival has later points depending on an eligible team | 118 |
| Unequal shared dependence | The viewed entry and rival selected the same team, and the rival has more than twice the viewed entry's later exposure without that team being the viewed entry's champion | 116 |
| Unique personal championship pick | Only the viewed entry has the eligible team as a live champion selection | 114 |
| Low-impact game | No later point exposure; both results award equal immediate points across the authorized pool (or no personal points remain privately) | 110 |
| Another unique championship pick | One authorized live champion selection for an eligible team | 108 |
| Personal championship selection | Viewed champion is involved and remains alive | 104 |
| Shared dependence | Same-team pick with a rival's greater later exposure | 96 |
| Opposing picks | Authorized entries choose both legal participants and have a genuine immediate/future points difference | 90 |
| Multiple future selections threatened | An elimination would remove multiple later selections with positive potential | 88 |
| Unique game pick / consensus / personal path | Supported actual selections | 72 / 65 / 45 |

Priorities represent editorial ordering, not mathematical significance scores. Within the same priority, larger exposure breaks ties; raw totals do not automatically outrank every other category. Round order does not inflate a game's importance. A unanimously picked championship with identical point awards can still have low competitive significance before its official sporting result.

Candidates are sorted deterministically, and overlapping keys suppress repeated observations about the same championship, team exposure, or pick split. A low-impact game gets one short headline/explanation and no forced outcome cards. Other games receive at most two non-overlapping supporting insights. Outcome comparisons appear only when useful and disappear after official results. Unresolved matchups retain conditional wording.

Group candidate generation is disabled before lock and while snapshots are pending. It never derives rival consensus, uniqueness, exposure, or final leaders in those modes. The narrative adapter also strips comparison fields before generating any legacy or editorial copy when the pool is unavailable.

## Game-state differences

- **Pregame:** The strongest supported championship threat, relative rival dependence, conflict, consensus, or quiet-game story leads. Personal path language is a fallback rather than the universal opening.
- **Live:** Valid, ID-matched scoreboard scores identify a leader and margin. Threatened championship picks are conditional on that lead holding. A tied/missing/invalid score cannot generate a leading-team claim. No live lead becomes an official result.
- **Provider-final:** The scoreboard's apparent winner is described only as finishing ahead. Advancement, points, and eliminations remain conditional. Hypothetical two-outcome cards are omitted in favor of the pending-result story.
- **Official-final:** A single actual-result recap replaces pregame comparisons. It distinguishes points earned here, possible points lost from later selections, and points that remain available now. Championship threats eliminated by this result are described as actual losses.

The adapter uses refreshed detail competitors matched by team ID; it does not rely on an old score-card snapshot when newer scores are available. Negative, blank, nonfinite, mismatched, and tied scores cannot supply an unsupported lead. Official results remain authoritative even if provider status differs.

## Championship and tournament completion

An officially final championship always celebrates the actual winning team instead of leading with an eliminated personal pick. The recap highlights the champion, identifies the official runner-up, explains the viewed champion selection and championship points, and shows a valid provider final score only when the participants and scoreboard winner match the official result.

The tournament is complete only when every graph node has a validated official winner. Provider-final alone never enables completion. Final positions additionally require the complete authorized frozen cohort. Current points use the canonical scorer with each entry's own rules.

The final ordering follows the existing leaderboard's **points-based ranking**: equal scores share the same rank, with competition numbering (1, 1, 3). The UI explicitly says “on points.” It identifies the first-place points entry or shared first-place entries. It does not invent a tiebreaker winner or claim a unique contest champion when scores tie. Any future tiebreaker adjudication remains outside this implementation.

If snapshots are incomplete, the public national champion and authorized personal scoring can still be shown, but final Group positions and leaders are withheld.

## Scoring and privacy safeguards

- Account ownership controls authorization and second-person wording; the selected contest entry remains the analysis subject.
- Managed entrants and multiple entries remain separate in counts, exposure, and final positions.
- The existing active-Group league, contest, competition, game, and draft/frozen ownership checks are unchanged.
- Rival facts and final positions use only the selected contest's fully frozen authorized entries. A same-master entry from another Group contest cannot enter the cohort.
- Immediate game points and future losses are separate. Future elimination exposure excludes the current node, already settled picks, and selections impossible before that result.
- Official-result retrospectives reconstruct opportunities just before that game. Current team-specific available points are separately computed from the **current** official map, so an earlier recap cannot call later eliminated points “still available.”
- Incorrect predicted opponents still do not invalidate a later correct winner.
- Zero-point rounds preserve pick facts without falsely implying a scoring edge.
- No graph, picks, results, snapshots, or simulation input is mutated by analysis or story selection.
- No hypothetical result is persisted. No AI API, odds model, or probability dependency was introduced.

## Simulator scenarios

Open **http://localhost:3000/dev/cfp-simulation** with `npm run dev` running.

The new **Story scenario** selector reuses the same simulator and real Game Center components. Choosing a preset resets only in-memory simulated conditions and enables fictional Group comparisons. The pre-lock checkbox can still be used to test private personal treatment.

| Preset | What to explore |
| --- | --- |
| Original conflicting paths | Existing four-entry fixture |
| Everyone agrees; later picks split | Shared current winner, genuine later semifinal split |
| Low-impact early game | Same immediate award, no later exposure for either participant; short treatment |
| Unique championship pick threatened | View Jordan's sole River championship selection |
| Opposing semifinal picks | Officially established River/Forest matchup and opposing future dependencies |
| Earn today; preserve a rival’s bigger path | Alex earns from River while Jordan has much more riding on later wins |
| Viewed pick already eliminated | Jordan cannot score this quarterfinal; Casey still has Lake opportunities |
| Major upset and lost future picks | Official Lake upset eliminates Jordan's River championship path |
| Championship: split contest | Prior results are official; two entries pick each finalist |
| Completed tournament and final positions | Official Harbor title; Casey/Taylor share first on points, Alex/Jordan share third |

In **Completed tournament**, change the official winner from Harbor to Summit. The national champion, correct championship selections, final points, and first-place points entries update. Switching the viewed entrant changes personal wording and final position. In **Unique championship pick threatened**, choose Live, make Lake the simulated leader, then Provider final and Official final to see conditional language become an actual loss recap.

All teams/entrants remain fictional. Preset fixtures are validated with the production pick/result validators and scorer. Existing downstream invalidation, reset, source-revision cancellation, development gate, and root-runtime isolation remain. The simulator makes no API calls, stores no state in Supabase, and cannot be accessed in a production build.

## Verification

- Fourteen new focused Phase 1D tests pass for significance, prioritization, overlap suppression, quiet games, championship uniqueness, relative exposure, eliminated selections, live/provider-final/official language, first-round/quarterfinal/championship effects, valid later winners despite wrong opponents, complete ranks/ties, privacy, presets, and no mutation.
- Added server coverage confirms final positions are contest-scoped and withheld when any required snapshot is incomplete.
- Combined bracket and relevant shared Game Center suite: **237 tests, 232 passed, five optional browser tests skipped** in the default invocation; no failures.
- All **five** separately enabled Chromium tests pass: existing component and Next routing checks, simulator state/correction checks, production denial, and new editorial scenario tests. Mobile and desktop interactions ran at **390px and 1024px**.
- The new browser test verified eight distinct headlines and eight primary story categories, quiet-game card suppression, live lead changes, provisional versus official results, champion/runner-up presentation, final points positions, and winner/entrant switching. It observed zero API requests and no page errors.
- Production page/data/API URLs return 404. Loading the denied page in Chromium renders no simulator and launches no API/background requests.
- TypeScript, scoped lint for the changed story/analysis/UI/tests, production build, and `git diff --check` pass. The existing simulation image lint warning remains advisory. Existing unrelated effect/memoization lint failures documented in Phase 1C were not expanded or repaired here.

Screenshots: `/tmp/bracket-phase1d-complete-390.png`, `/tmp/bracket-phase1d-complete-1024.png`, and `/tmp/bracket-phase1d-aftermath-390.png` / `1024.png`.

Example new browser test command:

```sh
LD_LIBRARY_PATH=/usr/lib/firefox \
FOOTBALL_BROWSER_MODULE=/home/markwohlever/.npm/_npx/e41f203b7505f1fb/node_modules/playwright \
BRACKET_DEV_BROWSER_URL=http://localhost:3000 \
node tests/bracket-story-browser.test.cjs
```

## Limitations and Phase 2

The prioritization is authored and deterministic; its relative exposure rule is an editorial criterion, not an optimal-rooting calculation. Remaining point totals follow the existing scoring model. No incomplete-tournament rank range, winning scenario enumeration, expected value, win percentage, or probability is claimed.

Final positions are authoritative **on points**, matching the existing leaderboard. Tiebreaker winners are not inferred. Authenticated real-data QA remains for actual memberships, managed/multiple entry labels, custom rules, and provider updates. Fictional browser tests do not replace that check.

Phase 2 remains exact legal CFP scenario enumeration, attainable/guaranteed rank paths, tie/tiebreaker handling, and contest-win paths. Probabilistic and optimal-rooting features require their own explicit models.
