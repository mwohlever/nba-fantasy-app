# CFP Game Center implications — Phase 1B

[Phase 1C](bracket-game-implications-phase1c.md) subsequently added the complete provider-unavailable shell, personal path stories, and isolated development simulator. That handoff describes the current behavior.

Implemented on the existing `feature/bracket-game-implications` branch. Phase 1 work and unrelated local changes were preserved. No scoring engine, official-result persistence, authorization boundary, schema, or provider mapping was changed.

## UX and identity flow

The CFP Game Center now appears inline within Live Scores, replacing the tournament game list. The app header and navigation remain visible. The shared football component retains Summary, Play-by-Play, Player Stats, score/detail refresh, and its existing polling. CFP supplies an optional controlled Implications tab and refresh callback; NFL/NCAA consumers keep their existing behavior and state ordering.

The viewed-bracket selector appears only within Implications. Authorized subjects are read from the existing read-only implications endpoint. The response now explicitly includes `entrantName` and `isAccountOwner`, calculated by the server. A single account-owned bracket defaults automatically; two or more account-owned brackets require a choice. Managed-only subjects never become an arbitrary personal default. Explicit missing, invalid, or private selections never fall back silently to another bracket.

Account-owned entries use “you” in explanations. Managed entrants and other participants are named, even when the viewer manages their picks. Multiple entries for one entrant retain bracket labels when needed to distinguish them. The selected contest entry remains the analysis subject; the logged-in user remains only the authorization principal.

Bracket identity and detail state live in the URL:

- `gameId` is the authorized competition's bracket game key.
- `tab` is `summary`, `pbp`, `stats`, or `implications`.
- Frozen subjects use `entryId`; drafts use `entrantId` and `bracket`.
- `devEventId` is separate from tournament game identity. It is accepted only in development when it matches the configured development event. The inline view clearly labels it as a development ESPN event, and it has no CFP implications.

Native history updates follow the locally installed Next.js documentation. User actions push history; an unambiguous initial bracket default replaces the current entry. Back to games removes game identity while preserving the chosen bracket and tab. Browser back/forward and refresh restore URL state. Invalid tabs fall back to Summary; unavailable game links show a Back to games state rather than selecting another game.

The selector stays available during analysis loading, pending snapshots, and retry errors. Analysis rendering is gated by contest/game/subject identity, with cancellation and echoed response identity checks. Late requests that ignore cancellation cannot display another subject. Stable selection serialization prevents metadata refreshes from starting repeated analysis requests. Server-returned subject lists can update as snapshots and privacy states change. Game Center refresh also refreshes implications.

## Presentation

A pure presentation function converts the existing structured facts into a short headline, compact outcome cards, named rival effects, and useful later-round/championship notes. It has no AI, probability, scenario-ranking, or rooting-recommendation API.

For example, fixture-derived copy can say a selected entrant has a team winning here while another needs it to go farther, or that a rival's championship pick would be knocked out by the opposing result. Point values come from the selected and rival entries' actual rules. Positive rival awards with different point values are shown where useful. Empty consequence sections and prominent mathematical disclaimers are omitted.

Official finals show only the actual winner and past-tense impact. A live score or provider final remains distinct from persisted official advancement. Unresolved games describe conditional participation, without inventing a matchup. Pre-lock rivals remain private, and incomplete snapshots retain the existing pending states.

CFP has a scoped mobile document-scrolling exception, matching the existing NBA/NFL inline approach. The compact Play-by-Play replay sticks to the viewport without a modal or nested scrolling container.

## Changed files in Phase 1B

- `app/bracket-challenge/[contestId]/live/page.tsx`: inline/detail URL flow; removed page-level selector.
- `app/globals.css`: CFP-only inline scrolling treatment.
- `components/bracket/BracketGameCenter.tsx`: new inline wrapper and controlled tab/refresh integration.
- `components/bracket/BracketGameCenterModal.tsx`: compatibility export of the inline component.
- `components/bracket/BracketGameCenterDevHarness.tsx`: reusable configured development-game factory.
- `components/bracket/BracketGameImplications.tsx`: in-tab selector and compact narrative UI.
- `components/live-scores/FootballGameCenter.tsx`: optional extra-tab control and refresh callback, preserving existing consumers.
- `lib/bracket/gameImplications.server.ts`: explicit entrant-name/account-owner metadata only.
- `lib/bracket/liveState.ts`: new URL parsing, URL patching, safe default resolution, and subject serialization.
- `lib/bracket/implicationsNarrative.ts`: new deterministic presentation helper.
- `tests/bracket-game-center.test.cjs` and `tests/bracket-live-scores-ui.test.cjs`: retained regression coverage adapted to inline presentation.
- `tests/bracket-game-implications.test.cjs`: explicit account/managed identity checks.
- `tests/bracket-implications-ux.test.cjs`: new URL/default/narrative tests.
- `tests/bracket-implications-browser.test.cjs`: isolated component interactions plus actual Next Dev URL/history/refresh testing.
- `docs/bracket-game-implications-phase1.md`: link to this updated UX handoff.
- `docs/bracket-game-implications-phase1b.md`: this handoff.

## Verification

- 21 focused calculation/access/identity tests pass; all prior Phase 1 calculation and privacy cases remain covered.
- Nine additional UX tests pass for safe defaults, managed entrants, malformed selection, URL persistence, named comparisons, different scoring rules, finals, live/provider-final distinction, zero-point rounds, and unresolved matchups.
- The combined bracket and relevant shared Game Center suite passes: 204 tests, 202 passed and two optional browser tests skipped in the default invocation. This includes NFL integration, football replay, and NCAA logo regressions.
- Separately enabled real Chromium tests both pass at 390px and 1024px. They cover the selector moving into Implications, all tabs, default ambiguity, managed/rival selection, delayed requests, inline replacement, retained app header, browser back/forward, refresh/reload, selected-game persistence, invalid selections, official-final copy, and mobile sticky replay. All API calls—including POSTs from existing background behavior—are intercepted by fixture responses; these tests do not access production data.
- TypeScript and production build pass. Scoped lint passes for new/reworked CFP components, presentation/state helpers, server metadata, and updated tests. The Live Scores page retains its one pre-existing effect lint error; shared Football Game Center retains its three pre-existing effect/memoization errors and existing image warnings. No new lint errors were introduced.
- `git diff --check` passes.

The Dev server initially served a stale cached stylesheet. Restarting it with regenerated `.next/dev` assets resolved that cache issue; the previous generated cache was preserved under `/tmp/bracket-phase1b-dev-cache-20261012-0939`. No dependency installation was required.

Browser verification command used in this environment:

```sh
LD_LIBRARY_PATH=/usr/lib/firefox \
FOOTBALL_BROWSER_MODULE=/home/markwohlever/.npm/_npx/e41f203b7505f1fb/node_modules/playwright \
BRACKET_DEV_BROWSER_URL=http://localhost:3000 \
node tests/bracket-implications-browser.test.cjs
```

Fixture screenshots: `/tmp/bracket-phase1b-390.png` and `/tmp/bracket-phase1b-1024.png`.

## Local real-data QA still needed

Open `/bracket-challenge/<authorizedContestId>/live`, choose a game, then Implications. Verify a single personal entry defaults, multiple personal entries require selection, managed entrants are named, and another admitted frozen entry can be selected after lock. Check real pre-lock privacy, partially frozen contests, game provider availability, and provider-final-to-official-final refresh transitions. Follow Bracket navigation and return to confirm the chosen identity is preserved.

Provider-unavailable/unresolved games retain a useful inline implications view; Summary/Plays/Stats require existing valid provider details. Play period and selected player/team controls retain their existing internal behavior; Phase 1B persists the requested game, tab, and bracket identity. Exact ranks, win odds, and optimal rooting analysis remain outside Phase 1B.

No commits, pushes, deployments, migrations, or production-data changes were performed.
