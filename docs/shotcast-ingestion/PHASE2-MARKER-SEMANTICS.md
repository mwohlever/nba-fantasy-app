# Phase 2 marker semantics and read-only Phase 3 research inventory

2026-10-04. Worktree `nba-fantasy-app-3d-take2`, branch `shotcast-3d-take2`. The user manually confirmed that the earlier world-registration/camera fix substantially improved real authenticated Scores. This pass corrects numbered-marker semantics only; it does not implement Phase 3 or change the Green camera.

## Numbered markers now identify stroke starts

Before: both the Three.js numbered symbol and its HTML handle used `shot.endpoint`, which is the frozen transformation/grounding of that stroke's PGA `overview.leftToRightCoords.toCoords.tourcastX/Y/Z`. Selection highlighted the destination.

After: both use the **existing frozen `shot.from`**, sourced from that stroke's actual `overview.leftToRightCoords.fromCoords.tourcastX/Y/Z`. The marker scene anchor `shot-N` aliases the same Object3D as `from-N`; `to-N` retains an independent, non-visible diagnostic anchor at the existing endpoint. No new coordinate conversion, registration, normalization, offset, or provider modification.

Marker 1 and the tee refer to the same frozen point in `buildHoleWorld`. The renderer hides the redundant T label **and tee sphere** when their world coordinates match; the underlying tee point/scene anchor remains. Marker 1 stays interactive. The pin is still independently anchored to `view.pin`, and now always displays its flag glyph; it is not replaced by the last shot's number.

For Scheffler R2026027 / player 46046 / course 513 / R1/H1:

| Presentation | Exact course-world X | Exact Y | Exact Z |
|---|---:|---:|---:|
| 1 / Shot 1 start / tee | -115.68310546875 | 378.721435546875 | 10.874481308178765 |
| 2 / Shot 2 start | -296.1064453125 | 204.69482421875 | 10.945296698560316 |
| 3 / Shot 3 start | -304.60595703125 | 66.57177734375 | 10.939206175918256 |
| 4 / Shot 4 start | -317.108154296875 | 69.351318359375 | 11.014807185703452 |
| Flag / pin / Shot 4 end | -315.5849609375 | 68.565185546875 | 11.00063925622532 |

Numerical continuity is verified, not assumed: for boundaries 1→2, 2→3, and 3→4, both **raw native XYZ differences and resolved course-world XYZ differences equal `[0,0,0]` exactly**. Shot 4's end equals the pin exactly; Shot 4's start is about 1.714m away. `tmp/shotcast-marker-semantics/coordinate-proof.json` records complete starts/ends, deltas, tee and pin. These are the same geometry values recorded by the earlier correctness pass.

Future animation contract: select marker N → highlight `world.shots[strokeNumber=N].from`; future Shot N animation starts at that same frozen `from` and terminates at the frozen **`endpoint`**. The model's existing field name `endpoint` is the resolved PGA **`to`** coordinate; there is currently no separately named world-model `to` field. No alias, duplicate coordinate array, or rename was introduced for this presentation correction. Pin remains the target independently of whether a stroke is holed. No flight, putt, replay, or slope-flow animation was added.

## Checks and manual retest

Validation completed:

- Focused ShotCast and world-invariance tests: **32/32 passed**. Raw-provider continuity, resolved continuity, frozen geometry and independent final-start/cup assertions pass.
- Browser harness: **12/12 scenarios passed**, including current Scores → Scheffler and current Live → Henley/Brennan at desktop/mobile widths. Actual scene `shot-N` anchors equal `from-N` exactly. Every captured world position and terrain matrix stays exactly equal through all numbered selections, orbit, zoom, reset, Course↔Green, state rerenders and hole remounts. Desktop/mobile worlds also compare exactly. Screen projections change during camera movement. Duplicate T is absent and the independent flag is present. Unsupported H2 and preparation/asset/WebGL failure fallbacks pass.
- `npx tsc --noEmit`: passed. The first attempt found a malformed generated `.next/dev/types/validator.ts`; restarting ordinary Dev regenerated it, and the final check passed without any source/configuration change for that artifact.
- Focused ESLint on the renderer and two changed tests: passed with no output.
- `git diff --check` and explicit whitespace checks for all four current-pass untracked files: passed.
- `npm run build`: passed, including TypeScript and all 106 static pages. Next emitted its existing edge-runtime/static-generation informational warning.
- Donor HEAD, exact status and all 15 inventoried source/asset hashes: unchanged.

Logs, per-action world/projection captures, results and screenshots are retained under `tmp/shotcast-marker-semantics/`. Browser results are engineering evidence, not final authenticated human acceptance. The temporary historical backend and test Dev were stopped. Ordinary `.env.local` Dev is running at `http://localhost:3001`.

Manual retest: `http://localhost:3001/lineups/scores?sport=golf` → FedEx St. Jude Championship → team containing Scottie Scheffler → Scottie Scheffler → Round 1 → Hole 1. Expand ShotCast as needed. Expect 1 at the tee (no overlapping T), 2 at the first-shot landing lie, 3 at the approach landing lie, 4 at the final putt's start, and a separate flag at the cup. Select 1→2→3→4 and back repeatedly; orbit, zoom, reset, and switch Course↔Green. Positions stay attached; only selection/highlighting changes. Reopen H1 and check H2 remains the existing 2D fallback. Repeat at desktop/mobile width. The Green camera is unchanged, and off-camera tee/long-shot starts may be outside its close green frame.

## Donor inspected read-only

Root: `/home/markwohlever/nba-fantasy-app-3d`, active branch **`shotcast-3d`**. Inventory refers to its **current, substantially uncommitted working tree**, including untracked research modules, not merely branch HEAD. No donor code/assets were copied into Take 2, no donor tests/build were run (several tests write research reports), and no donor file was edited. Donor HEAD/status plus inventoried source/green-asset hashes are captured before/after in `tmp/shotcast-marker-semantics/donor-before.json` and `donor-after.json`.

### Reusable math and simulation

| Donor file | Actual responsibility | Future migration |
|---|---|---|
| `lib/shotcast/greenTopography.ts` | `createGreenTopography`, `createGreenSample`; exact authored triangle planes, barycentric XY containment, spatial buckets, elevation, rise/run slope, normalized downhill XY, per-green 2nd–98th percentile elevation display range. Authored normals are not used for physical slope. Off-mesh samples return null. | Migrate the pure field and tests, adapting its type-only `Primitive` import to Take 2's structurally equivalent `TerrainPrimitive`. Consume already registered green vertices; do not transform player data again. |
| `lib/shotcast/greenFlow.ts` | `createGreenFlow`, `createGreenFlowClock`, `flowSpeed`; deterministic useful upstream seeds, midpoint downhill integration, substeps ≤1/120s, flat/stall/lifetime recycling, bounded elapsed-time clock, typed position/weight/history buffers. Default budget 64 heads, two history points each. | Migrate this existing implementation with temporal tests, as visualization over the current authored green; no player-specific dependencies or additional dot assets. |
| `lib/shotcast/fixturePlacement.ts` | Historical GLB decode, surface intersection and native registration used by fixture loading/tests. | Preserve as research evidence. Take 2 already has verified `productionGeometry.ts`; do not introduce a second runtime registration pipeline. |

Current flow choices: flat threshold 0.003 rise/run; speed `min(3.2,0.9+40*(slope-0.003))` above threshold; max active clock delta 0.25s; history interval 0.28s; visual surface lift 0.012m. Those speeds communicate grade and **are not golf-ball physics**. The true triangle geometry determines height/direction. Numeric choices belong to the inspected current code; the initial topography report describes older counts/speeds and must not override it.

### Topography and blue/cyan-dot rendering

[`components/shotcast-fixture/GreenTopographyView.tsx`](../../../nba-fantasy-app-3d/components/shotcast-fixture/GreenTopographyView.tsx) contains the presentation implementation, not `components/lineups/GolfShotcast3D.tsx`:

- Lines 19, 138–153: original green positions/indices/normals, `MeshStandardMaterial`, hemisphere/directional lighting, geometry-derived vertex colors from `#235830` to `#b6d875`. Modes are normal, elevation, and elevation + flow. Detailed green is drawn over coarse context without translating/exaggerating its geometry.
- Lines 155–167: muted surrounding course imagery registered through the existing course world file.
- Lines 304–323: `createGreenFlow`, dynamic BufferGeometry position/weight attributes, a **single THREE.Points draw call**, cyan-head/history shader. Heads are 7.5 CSS px with a dark rim; trails 2.8px; cyan RGB is `(0.20,0.78,0.95)`. **There is no blue-dot sprite texture/image asset:** circles are generated by the fragment shader from `gl_PointCoord`.
- Lines 327–364: visibility masks around cup/shot/path context, using world clearances plus camera-projected pixel clearances. These suppress flow glyph visibility; they do not move geographic shot markers or derive downhill direction from the camera.
- Lines 365–375 and 385–412: mode/pause lifecycle, active/hidden clock handling, field stepping, dynamic buffer upload, invalidation and disposal. The renderer also contains separate replay clocks; those are not required just to migrate topography/flow.
- Lines 495–523: research-only mode controls, top-down camera toggle, pause, low/high legend, cyan-flow explanation. Extract the useful presentation pieces into the current Hole Replay renderer in a deliberate later pass; do not mount this separate viewer wholesale or replace the current Green camera.

The file also imports `puttReplay.ts`, `pathReveal.ts`, `replayCamera.ts`, `experimentalFlight.ts`, and `packages/shotcast-experiments/southwind-shot3-replay.json`. Those support **separate animation experiments** and are not dependencies of the pure topography/flow modules. The Henley/Shot3 research evidence and package-selected shot coordinates must never replace the selected golfer's frozen starts/ends. The donor endpoint-number labels, label offsets/collision avoidance, combined final endpoint/pin label and camera-switching UI must not be carried into Take 2's corrected marker semantics.

### Real assets and provenance

The topography field uses preserved indexed **detailed green GLBs** (positions/indices, optionally authored normals for lighting), plus coarse terrain/course imagery/world file for context. No separate raster slope map or precomputed blue-dot dataset is required.

| Donor preserved package | Green source / context |
|---|---|
| `tmp/shotcast-ingestion/packages/pga-71908773-fb52-47d0-bb1e-f44f50b34965/green.bin` | Southwind H1 `Green01.glb`; SHA256 `25b3e1b8b77e4403a8565dae2281deb7c7c7935a60e3ccba0d06380c029887ce`. Identical asset already prepared in Take 2. Legacy descriptor also references `tmp/shotcast-cache/R2026027/Green01.glb`, `course.jpg`, `course.tfw`. |
| `.../pga-6dd7c507-1e90-4bbc-a90e-8cbff49b24b3/green.bin` | Sedgefield H1, already prepared in Take 2; legacy `wyndham.json` references `tmp/placement-validation/nonzero-rotation/Green01.glb`. |
| `.../pga-263ee539-cb26-4f1e-8064-2b24d587fcdb/green.bin` | Detroit H8; legacy `rocket.json` references `tmp/placement-validation/rocket/Green08.glb`. |
| `.../pga-2f61f589-ec68-4c2a-a188-c8effb517698/green.bin`, `.../pga-f6cdc43a-0e3a-46cc-91ac-ab63cf3cf686/green.bin` | Waialae H10, separate preserved package revisions; future resolver must select a verified revision rather than accept ambiguity. |
| `.../pga-f58c4c80-b35a-4dcd-9563-35e437dd5288/green.bin` | Spyglass H1. |
| `.../pga-8e2b9134-40a5-4427-9de5-36bf56d06521/green.bin` | Pebble Beach H1. |

Package `descriptor.json`, asset hashes, `course-image`, `course-world`, terrain, and provenance remain the source of identity/registration evidence. Additional donor coverage is an inventory, not automatic Take 2 capability approval. No assets were migrated in this pass.

### Tests and retained research evidence

- `tests/shotcast-ingestion/green-topography.test.mjs`: analytic planes, exact elevations/gradients, winding and shading-normal independence, flat/invalid/vertical geometry, outlier display normalization, indexed-vs-original surface lookup, preserved multiple greens, surface-following history and performance checks.
- `tests/shotcast-ingestion/green-flow-temporal.test.mjs`: clock/pause/hidden handling, equivalent 10/60fps planar travel, grade/speed behavior, stalled-particle recycling, deterministic sustained real-green flow.
- `tests/shotcast-ingestion/green-topography-browser.mjs`: mode/camera/pause/selection/cleanup/mobile prototype checks.
- `tests/shotcast-ingestion/green-flow-browser.mjs` and `green-flow-pixels.py`: actual GPU readback, submitted attributes, surface positions, sustained visible movement and frozen paused frames.
- `tests/shotcast-ingestion/cyan-flow-browser.mjs` and `cyan-flow-pixels.py`: later cyan-vs-white rendering separation and framebuffer validation. Adapt relevant tests to the current Scores/Live seam later; keep frozen research assertions/evidence intact.
- `docs/shotcast-ingestion/GREEN-TOPOGRAPHY-PROTOTYPE.md`, `GREEN-FLOW-ANIMATION.md`, and cyan-flow portions of `NON-PUTT-FLIGHT-EXPERIMENT.md`: mathematical derivation, original limitations, subsequent runtime correction, later shader/color revision. `UX-CAMERA-VALIDATION.md` documents additional research controls/diagnostics.
- `tmp/green-topography/geometry-report.json` and `browser/`; `tmp/green-flow-animation/temporal.json`, `browser/report.json`, `browser/pixel-analysis.json`; `tmp/non-putt-flight/browser/report.json`, `pixel-validation.json`: preserved measurements, actual GPU/framebuffer captures and screenshots. They are historical research evidence, not tests rerun in this pass or physical-phone acceptance.

### Scaffolding to retain as research, not restore into current UI

`components/shotcast-fixture/ShotcastFixture.tsx`, `app/shotcast-fixture/page.tsx`, `app/shotcast-fixture-rocket/`, `/api/shotcast-fixture-asset`, `/api/shotcast-prepared-asset`, `packages/shotcast-fixtures/{southwind,rocket,wyndham}.json`, and the donor ingestion/discovery scripts load captured research players/packages and expose isolated experiments. Keep them as reference/regression inputs; do not add their routes, loader, controls or saved golfer coordinates to the current Scores/Live product.

The older `GolfHole3D.tsx`, `TourcastV1Harness.tsx`, `/shotcast-3d-lab`, `/tourcast-v1`, `/api/golf/shotcast-3d-asset`, obsolete Golf Tournament/League UI, backup files (`*.before*`, `*.bak*`), and collectors are diagnostic or superseded scaffolding, not the green slope/blue-dot implementation. No reason to migrate them for this system.

Later migration should therefore extract **the pure math/flow modules, relevant material/Points lifecycle, and meaningful tests** into the current registered renderer, consume current-player frozen geometry for context masks, and preserve current camera/navigation/fallback/identity rules. That is documented future work, not implemented here.

## Current-pass changes and final status

Only four files were changed/added in this correction:

- `components/lineups/GolfShotcast3D.tsx`: start-anchored symbols/labels, redundant tee presentation hidden, independent pin flag.
- `tests/shotcast-ingestion/world-invariance.test.mjs`: exact start/end continuity and animation-boundary assertions.
- `tests/shotcast-ingestion/browser-acceptance.mjs`: start-anchor semantics, corrected expected coordinates, tee/pin assertions throughout existing invariance scenarios.
- `docs/shotcast-ingestion/PHASE2-MARKER-SEMANTICS.md`: this report and donor inventory.

No change to the frozen world builder, provider coordinates, registration, terrain, Green camera, fallback gates, or animation implementation. The earlier `PHASE2-WORLD-CORRECTNESS.md` is historical: its descriptions of endpoint-numbered labels and the combined final endpoint/pin presentation are superseded by this correction.

Exact `git status --short` (all work remains uncommitted; most of this status predates the current correction):

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
?? lib/shotcast/holeWorld.ts
?? lib/shotcast/ingestion/
?? lib/shotcast/productionGeometry.ts
?? lib/shotcast/shotcast3dView.ts
?? lib/shotcast/visualizationCapabilities.ts
?? tests/shotcast-ingestion/
```
