# Take 2: current Golf app with a read-only 3D foundation

> Validation correction: the historical browser checks below intercepted the replay
> API and supplied a local historical database snapshot. They demonstrated the
> current component path with prepared historical contexts, but did **not** prove
> activation in a normal authenticated session against the actual current database.
> In that database, 111 Golf Live currently selects TOUR Championship (slate167),
> not the Southwind/Wyndham historical slates. See ACTIVATION-INVESTIGATION.md.

> Course/player correction: the runtime now combines reusable course assets with the selected golfer's current replay, without reading research native.bin. The historical report below describes the earlier implementation. See [COURSE-PLAYER-SEPARATION.md](COURSE-PLAYER-SEPARATION.md) for the current model and acceptance limits.

## Repository state and scope

Implementation target: `/home/markwohlever/nba-fantasy-app-3d-take2`, branch `shotcast-3d-take2`, based on `81208b555a9c6ea7876545489dfb2c2a8bf62f96` (Use dedicated NBA cron secret). No commits, pushes, merges, rebases or deployments.

`/home/markwohlever/nba-fantasy-app` remains on main at that commit, matching the local origin/main ref and clean. The donor remains on shotcast-3d at `29307237d8b731921aa441a94af53384e9ab95b1`. Its original dirty status and all 12 inventoried source hashes match the initial preservation record. All 36 files in the two copied prepared packages are byte-identical to the donor.

## Current application architecture retained

- `/lineups/scores?sport=golf` → current ScoresDashboard → GolfScoresDashboard → GolfFantasyRows → expandable fantasy teams → StandardRoster / BestBallRoster. R1–R4 and the 18-hole grids remain current main's implementation. Golfer clicks and grid-hole clicks use ReadOnlyPlayerModal / GolfPlayerModal.
- `/golf/live` → current GolfLivePage → GolfLiveLeaderboard with ownership labels → ReadOnlyPlayerModal → GolfPlayerModal.
- GolfPlayerModal's existing **internal** RoundScorecard component → GolfHoleReplayPanel → GolfHoleMap2D.
- GolfHoleMap2D retains its header, shot navigator, details, videos, 2D Green View and existing 2D playback. A small optional render callback replaces only its course imagery/SVG layer. GolfHoleReplayPanel supplies GolfShotcastVisualizationSlot at this callback.
- Development, matching preparation, matching complete current stroke endpoints and a working WebGL renderer → GolfShotcast3D. Missing/unsupported/stale preparation, asset failure, initialization failure or context loss → original imagery/SVG layer.
- Production always uses the original 2D layer. No prepared asset lookup or WebGL initialization occurs.

No Scores, Live, modal, scorecard, scoring, draft, ownership, navigation or refresh architecture was imported from the old app. The current provider and its shot-history path remain unchanged.

## Inventory

### Donor source copied byte-for-byte

- `lib/shotcast/productionGeometry.ts`
- `lib/shotcast/fixturePlacement.ts` (reference geometry used by parity tests)
- `lib/shotcast/visualizationCapabilities.ts`
- `lib/shotcast/ingestion/package.ts`
- `tests/shotcast-ingestion/module-loader.mjs`
- `tests/shotcast-ingestion/visualization-capabilities.test.mjs`
- `docs/shotcast-ingestion/donor-reference/NONZERO-ROTATION.md`, copied from the donor's NONZERO-ROTATION.md. This is a historical evidence report: its commands and relative references refer to the donor research, not Take 2.

### Donor technology adapted

- `GolfShotcast3D.tsx`: validated geometry, world-file UV registration and terrain composition retained. Initial camera fits tee, all endpoints and pin in the current viewport instead of focusing the initially selected last stroke. Selection highlights without changing orbit. Grounded marker lift follows the preserved .017068m observation. Tee label and leaders make overlapping handles readable. Stops event propagation to the enclosing 2D gesture handlers; existing reset/recenter buttons restore the overview. No replay animation.
- `GolfShotcastVisualizationSlot.tsx`: development-only activation, lazy renderer, first-frame readiness, same-context/endpoint gating, error boundary and retained 2D children. Green View and existing 2D playback continue through the original layer.
- `shotcast3dView.ts`: additionally rejects incomplete/stale endpoint sets when current replay has extra strokes.
- `developmentAssetResolver.server.ts`: uses a read-only preparation reader rather than the donor discovery/capture implementation. Verifies package hashes, exact event/player/round/hole, played-course assignment and engine profile; supports optional detailed green. Runtime local filesystem reads are excluded from tracing.
- `ingestion/local.ts`: only the required hash-checked local reader retained; unused legacy fixture-loading exports omitted.
- `app/api/golf/shotcast-3d-dev/route.ts`: imports the filesystem resolver only after the development guard. Unsupported capability lookup returns JSON null; missing asset returns 404. Production returns 404 before importing the resolver.

### Current-main files manually reconciled

- `components/lineups/GolfHoleReplayPanel.tsx`: supplies the visualization callback and the existing selected stroke state.
- `components/lineups/GolfHoleMap2D.tsx`: optional viewport callback and reset request; original surrounding controls and 2D behavior retained.
- `package.json` / `package-lock.json`: only Three.js and its TypeScript types added using the target's dependency installation; donor manifests were not copied.
- `next.config.ts`: excludes ignored `tmp/**/*` research packages and historical snapshots from production output tracing.

`.gitignore`, current `pgaTourShots.ts`, all other shared Golf/provider files, GolfPlayerModal and current routes/dashboards remain unchanged.

### New Take 2 files

- `lib/shotcast/ingestion/prepared.ts`: read-only prepared descriptor/package reader, no acquisition or writers.
- `tests/shotcast-ingestion/current-provider.mjs`: executes the unchanged current provider against preserved upstream transport responses.
- `tests/shotcast-ingestion/foundation.test.mjs`: actual provider compatibility, unchanged geometry, frozen prediction, independent PGA runtime observations, hashes, assignment ambiguity and production boundary.
- `tests/shotcast-ingestion/history-server.mjs`: local PostgREST-shaped historical snapshot boundary; never connects to a database.
- `tests/shotcast-ingestion/browser-acceptance.mjs`: current routes/components, desktop/mobile interactions and failure tests.
- This report.

### Ignored local data/evidence preserved separately

Two packages under `tmp/shotcast-ingestion/packages/`:

- `pga-71908773-fb52-47d0-bb1e-f44f50b34965`: Southwind / Russell Henley / R1 H1.
- `pga-6dd7c507-1e90-4bbc-a90e-8cbff49b24b3`: Sedgefield / Michael Brennan / R1 H1.

Selected original observations, frozen predictions, native fixtures and prototype screenshots are under `tmp/placement-validation/` and `tmp/sedgefield-generalization/`. Separate Take 2 records, historical SELECT snapshot, current-provider replay responses, genuine 2D imagery, screenshots and logs are under `tmp/shotcast-take2/`. These are ignored, local files; no binary assets were placed in public/.

### Intentionally excluded

Old Scores dashboards/navigation, Fantasy/League/Tournament tabs, League preview, GolfShotcastDevelopmentPreview, GolfInlineHoleReplayModal integration, old Tournament Scorecard scaffolding, old provider modifications, donor package manifests and .gitignore. GolfHole3D's research controls/renderer were not copied wholesale; this pass uses the smaller validated geometry-backed renderer. ReplayCamera, pathReveal, puttReplay, experimentalFlight, generalFlightResearch, greenTopography and greenFlow are not needed for this static foundation and remain intact in the donor. Discovery/capture pipelines, authoring routes, lab destinations, debug UI and animation controls were not transplanted.

## Validation results

### Geometry and visual quality

Southwind: unchanged decoder and world-file registration; original coarse and independently observed detailed-green placement agree within the original 1e-8m tolerance. Four grounded endpoints, tee and pin render in the actual current panel on both viewport sizes.

Sedgefield: original nonzero rotation (.919828 degrees) preserved; coarse frozen predictions remain exact and independent runtime observations remain within 1e-8m. Three endpoints, tee and pin render on both viewport sizes. Detailed green is available in the package, but this pass does not newly establish independent detailed-green runtime parity for Sedgefield.

Screenshots were visually compared against the preserved isolated prototypes. Imagery/course landmarks, orientation and endpoint registration agree. The current panel's square viewport requires a fitted overview rather than the research prototype's wider frame. The old integration's selected-final-stroke close-up was diagnosed and removed; no coordinate/world-file offsets were changed. Overlapping handles have leaders to their actual grounded endpoints. All prepared shot handles and tee/pin are visible at initial framing.

### Actual current browser paths

At **1400×900** and **390×844**:

- Scores: Jon/Mark/Andy/Josh directly, expandable Josh roster, R1–R4, 18-hole round scorecard, Sam Burns golfer → Round 1 → Hole 1 → current replay panel. No old League tabs.
- Scores → actual Live navigation, current full field and fantasy ownership labels.
- Live → Russell Henley → Round 1 → Hole 1: 3D; real preserved Hole 2: 2D.
- Live → Michael Brennan → Round 1 → Hole 1: 3D; real preserved Hole 2: 2D.
- Marker selection updates current shot details; orbit and zoom change the view; Reset restores framing; Green View remains existing 2D; close/reopen and H1/H2 navigation restore the proper context.
- No page or modal horizontal overflow, hidden initial markers, uncaught browser errors or console errors in normal scenarios.
- Mobile forced missing preparation, terrain asset HTTP503, unavailable WebGL and lost WebGL context all return to usable genuine 2D imagery. Injected HTTP503 and unavailable WebGL produce the expected network/Three initialization console messages; there are no uncaught application errors.

**Data boundary:** browser tests use real historical DB records captured with SELECTs and the real current provider applied to preserved PGA transport responses. A local PostgREST boundary supplies historical records. Playwright bypasses only replay route reconciliation and unrelated mutation requests. No validation writes reach production. The test boundary reports no unknown queries or unexpected writes. Henley/Brennan were not inserted into fantasy rosters: their supported preparation is tested through the actual full-field Live experience. Scores' genuinely drafted golfer tests scorecard/panel opening with an unavailable replay response rather than another golfer's strokes.

Production server: current Scores → Live navigation and ownership render normally, supported Henley H1 remains 2D, and **zero** preparation/3D requests occur. Both production development endpoint queries return 404. All 165 production route traces contain zero local research files.

### Automated checks

- ShotCast foundation/capability tests: **16/16 pass**, including frozen geometry and independent runtime comparisons.
- Whole-project TypeScript: **pass**.
- Focused ESLint on all new code, transplanted modules, test harnesses and next.config: **pass**.
- Changed current components: no added diagnostics relative to main. Full-file lint still reports main's existing **4 errors / 6 warnings** (setState-in-effect and existing warnings); production components were not refactored to suppress them.
- Additional current Golf UI/refresh regression suite: **36/37 pass**. The existing navigation test evaluates untranspiled TypeScript non-null syntax with Function and throws `Unexpected token '!'`; the unchanged HEAD AppNav declaration independently reproduces it. This is a baseline test-harness failure, not a navigation change.
- Production build: **pass**. Existing Next edge-runtime/static-generation notice remains; the earlier accidental filesystem trace warning was resolved.
- Diff/whitespace checks: **pass**.

Machine-readable browser results: `tmp/shotcast-take2/browser/results.json` and `navigation-production.json`. Production boundary, integrity and preservation records: `tmp/shotcast-take2/production-boundary.json`, `package-integrity.json`, `preservation-final.json`.

Screenshots: `tmp/shotcast-take2/browser/` contains scores-desktop/mobile, live-desktop/mobile, southwind-desktop/mobile, sedgefield-desktop/mobile, real unsupported-H2 screenshots, four failure screenshots and production-2d.

## Local reproduction

This worktree runs today's app with `npm run dev`. Ordinary configured app data flows through current main's unchanged APIs and refresh/reconciliation behavior. With no corresponding prepared package, the visualization stays 2D. The local packages are not production distribution assets.

To reproduce the isolated historical browser validation, from Take 2:

```sh
node tests/shotcast-ingestion/history-server.mjs
```

In another terminal, run the current app against that local boundary (test values override any existing .env.local):

```sh
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54329 \
SUPABASE_SERVICE_ROLE_KEY=local-validation-only \
NEXT_PUBLIC_SUPABASE_ANON_KEY=local-validation-only \
npm run dev -- --port 3002
```

Then run the browser harness with your installed Playwright module and Chromium executable. This environment reused existing donor tooling **read-only** and wrote all outputs in Take 2:

```sh
SHOTCAST_PLAYWRIGHT_MODULE=/home/markwohlever/nba-fantasy-app-3d/tmp/placement-validation/browser-tools/node_modules/playwright/index.mjs \
SHOTCAST_CHROMIUM_BIN=/home/markwohlever/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome \
LD_LIBRARY_PATH=/home/markwohlever/nba-fantasy-app-3d/tmp/placement-validation/browser-tools/libs/usr/lib/x86_64-linux-gnu \
node tests/shotcast-ingestion/browser-acceptance.mjs
```

The local historical boundary requires ignored `tmp/shotcast-take2/history.json`; geometry tests require the copied ignored packages and parity evidence. The browser harness supplies a synthetic local session and preserved replay transport; opening the dev server alone does not install those browser interception boundaries. No new application route or historical preview UI was added.

Focused tests:

```sh
node --test tests/shotcast-ingestion/foundation.test.mjs tests/shotcast-ingestion/visualization-capabilities.test.mjs
```

## Remaining limits / stopping point

Only the two prepared R1/H1 contexts are validated here; other contexts deliberately retain 2D. This is desktop/mobile Chromium with software WebGL, not a physical iPhone/Safari or hardware GPU test. Material/camera composition was visually checked against research output; it is not a new claim of complete PGA renderer parity. Historical DB scores/statuses were used as captured and were not reconciled or changed. General asset coverage/acquisition and authorized production asset distribution remain future work. Existing full-file lint and navigation-test baseline issues are recorded above.

No non-putt replay, putt replay, slope/flow, experiments or Phase 3 work has begun. All changes remain uncommitted for review.

## Exact git status --short

```text
 M components/lineups/GolfHoleMap2D.tsx
 M components/lineups/GolfHoleReplayPanel.tsx
 M next.config.ts
 M package-lock.json
 M package.json
?? app/api/golf/shotcast-3d-dev/
?? components/lineups/GolfShotcast3D.tsx
?? components/lineups/GolfShotcastVisualizationSlot.tsx
?? docs/shotcast-ingestion/
?? lib/shotcast/developmentAssetResolver.server.ts
?? lib/shotcast/fixturePlacement.ts
?? lib/shotcast/ingestion/
?? lib/shotcast/productionGeometry.ts
?? lib/shotcast/shotcast3dView.ts
?? lib/shotcast/visualizationCapabilities.ts
?? tests/shotcast-ingestion/
```
