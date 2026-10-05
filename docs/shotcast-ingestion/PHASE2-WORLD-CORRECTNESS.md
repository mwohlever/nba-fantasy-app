# Phase 2 world correctness — 2026-10-03

Scope: `shotcast-3d-take2`, current Golf Hole Replay in Scores and Live. No Phase 3, commits, pushes, merges, deployments, or frozen research edits. The earlier browser acceptance is superseded by the tests described here; final acceptance remains the user's authenticated Scores session.

## Proven root cause

The numbered HTML handles were **not** direct projections of the endpoints. `GolfShotcast3D.positionLabel` projected an endpoint, then searched offsets of 0/34/68 pixels to avoid occupied labels. `draw` sorted the selected stroke first, changing the collision order. Orbit/zoom changed overlap and therefore displacement. Pin labels additionally projected a point 5 meters above the cup.

A browser reproduction before edits captured unchanged projected anchors but relocating handles. At the same course camera, Shot 2's anchor remained `(313.5778149159,129.2195488263)` while its button moved between x≈279.578 and x≈313.578. The pin handle moved from y≈95.446 to y≈163.446. Shot 1 stayed at `(285.654,216.645)` because it was isolated. Evidence: `tmp/shotcast-phase2/before-labels.json`, `before.png`, and the saved source baseline in that directory.

The ground registration did **not** depend on selection/camera. Tee and later endpoints already shared `groundNativePoint`. No first-shot-versus-later-shot transform discrepancy was found. This pass makes all starts explicit and removes the misleading screen-space placement layer instead of altering PGA coordinates or terrain.

A separate, smaller camera issue appeared under the stronger checks: resetting/framing while OrbitControls had residual damping left camera motion pending for later renders (a measured ≈0.63-pixel green-anchor movement). Programmatic framing now drains inertia using the public `enableDamping=false; update()` operations before setting the camera. No geographic coordinate changes.

## Actual PGA input and physical sequence

Identity: R2026027 / course513 TPC Southwind / player46046 Scottie Scheffler / R1 / H1. Hash-checked event tee-times independently verifies his round's course513 assignment.

Provider: `ShotDetailsCompressedV3` decompressed hole object. Strokes are identified and ordered by `strokeNumber`; the unchanged current provider deduplicates and sorts these identities. Array transport order is not authoritative.

- Tee: `holes[holeNumber=1].strokes[strokeNumber=1].overview.leftToRightCoords.fromCoords.tourcastX/Y/Z` → replay `shots[strokeNumber=1].leftToRight.from`.
- Every start/end: that stroke's `overview.leftToRightCoords.fromCoords/toCoords.tourcastX/Y/Z` → replay `leftToRight.from/to`.
- Pin in this case: `holes[holeNumber=1].pinGreen.bottomToTopCoords.tourcastX/Y/Z` → replay `pinWorld.x/y/z`. The provider's existing compatibility chain is pinGreen → pinOverview.bottomToTopCoords → legacy hole.pin. Fresh read-only upstream verification confirms pinGreen is present here; pinOverview's native values agree. Its `x/y/z=-1` sentinel image fields are **not** used; neither are enhanced image coordinates.

Raw native feet:

| Point | X | Y | Z |
|---|---:|---:|---:|
| Tee / 1.from | 10119.337 | 11413.122 | 349.056 |
| 1.to / 2.from | 9527.396 | 10842.169 | 349.245 |
| 2.to / 3.from | 9499.511 | 10389.01 | 349.217 |
| 3.to / 4.from | 9458.493 | 10398.129 | 349.47 |
| 4.to / pin | 9463.49 | 10395.55 | 349.42 |

Each continuation is exactly equal in all three native components, and the final endpoint equals the live cup exactly. No endpoint or pin substitution. General modeling sorts numeric identities without inventing continuation across legitimate penalty/repositioning data.

Straight grounded segment lengths are approximately 274/151 yards, 42 feet, and 5.6 feet. Provider text describes Tee Box → Right Intermediate, Intermediate Rough → Left Green, Green → Right Green, Green → Green. Displayed distances are 274yd,151yd,42ft,5ft5in; last-segment coordinate/display difference is a few inches, not a fitted correction. An uncropped affine imagery overlay confirms actual tee box → rough by right fairway bunkers → left green → right green → cup. `tmp/shotcast-phase2/imagery-progression.png` and `hole-green-registration.png` show this. The path in the overlay connects endpoints only; it does not represent flight/roll animation.

## Exact transformation and terrain registration

`convertNativePoint` reproduces the preserved PGA float32 engine procedure:

1. Write native X/Y/Z to Float32Array.
2. Multiply each component by 0.3048, writing back to float32.
3. Build float32 Z-axis quaternion `[0,0,sin(rotate*pi/360),cos(rotate*pi/360)]`; rotate with cached input components and double intermediates, writing components back to float32.
4. Subtract float32 course offsets, writing back to float32.
5. Retain registered X/Y. Resolve Z at that X/Y by vertical barycentric intersection of the first containing authored green triangle, otherwise the authored terrain triangle. No nearest-surface fit, edge nudging, altitude guessing, or off-mesh placement. Missing intersection fails closed.

Southwind config: `(x,y,z,rotate)=(3200.056917,3099.998293,0,0)`; effective float32 X/Y offsets are 3200.056884765625 and3099.998291015625. Converted native Z is about106m; it is **not** the terrain-relative elevation. The preserved/independently verified PGA grounding procedure replaces it with authored surface Z (about11m here), for every point. Existing golden/frozen comparisons remain exact.

Terrain and detailed green are authored Z-up meter coordinates. GLB node transforms are rejected. Renderer meshes retain identity translation/rotation/scale; no object centering, selected-shot origin, bounding-box normalization, or camera-dependent transform. Course/hole UVs are inverse affine world-file mappings of the terrain's X/Y and affect texture sampling only:

`det=A*E-B*D; u=((x-C)*E-B*(y-F))/det/width; v=(A*(y-F)-D*(x-C))/det/height`.

Course world file: `(A,D,B,E,C,F,width,height)=(.018288,0,0,-.018288,-1399.99212,599.992704,153106,65617)`.
Hole world file: `(-.041905,.027277,.027277,.041905,-285.233256,-38.192029,3951,10448)`.

Resolved anchors, meters (exact double values retained in evidence JSON):

| Point | X | Y | Z |
|---|---:|---:|---:|
| Tee | -115.68310546875 | 378.721435546875 | 10.874481308178765 |
| Shot1 | -296.1064453125 | 204.69482421875 | 10.945296698560316 |
| Shot2 | -304.60595703125 | 66.57177734375 | 10.939206175918256 |
| Shot3 | -317.108154296875 | 69.351318359375 | 11.014807185703452 |
| Shot4 / pin | -315.5849609375 | 68.565185546875 | 11.00063925622532 |

## Before → after architecture

Before: current raw replay → grounded tee/endpoints/pin → stable Three scene + camera-projected, collision-displaced, selection-reordered HTML handles. Course only; Green and navigator playback used the separate 2D image frame.

After: current raw replay → verified reusable course registration → `buildHoleWorld` with every from/end, tee, pin and native provenance → deeply frozen geometry on server and after JSON handoff → scene anchors with identity parent transforms → camera projection → directly anchored handles. Selection controls color/stacking and details, never positions or marker order. Symbol elevation is local to its scene anchor; geographic anchors remain on the surface. Overlapping points are allowed to overlap; the existing navigator provides separate selection controls.

The replay equality guard now checks all native starts/ends exactly and the current native pin. Changed replay fields require new preparation; no stale geometry earns a refreshed context. Course bounds are camera inputs only. Nothing rebuilds geographic geometry because of selection, orbit, zoom, reset, or viewport size.

## Green View and intentional fallback

Existing Green used `greenBottomToTop` enhanced coordinates plus the normalized `greenPin` over a dedicated flat image. Existing navigator/Play Hole drove its 2D animation state and could switch to that view.

Prepared Green now uses the same Three scene, terrain, texture registration, tee, endpoints and cup. Only camera bounds change. Focus bounds come from actual green vertices, and require the current cup to intersect that authored mesh. Southwind green bounds are X[-324.2242736816406,-299.9021911621094], Y[49.99987030029297,74.79106903076172], Z[10.756793022155762,11.450657844543457] — about0.694m of authored elevation variation, not a fabricated plane.

Supported 3D navigator selections change selection only. Green details resolve from the complete hole sequence, including shots outside its close camera frame. Existing replay remains explicitly labeled **Play Hole (2D)**; while it runs, the registered scene remains mounted/invisible and the genuine existing 2D playback is displayed. This is an intentional Phase2 limit; no 3D trajectories or animation added. Completing/canceling playback returns to the registered static view.

2D remains for production, unsupported event/course/hole (including H2), invalid/missing data, absent preparation, integrity/load/WebGL failures, and Green without an authored mesh containing the live pin. No identity/profile/integrity checks were loosened. No Scores/Live redesign or preview route.

## Validation and review

- Focused foundation/capability/world suite: **31/31 pass**, including raw PGA field normalization, exact sequence/anchors, preserved engine parity, immutable handoff/remount, shuffled transport, source equality, missing green and invalid starts.
- Engineering browser harness: **12 scenarios pass** at1400×900 and390×844. All six supported player/viewport cases prove exact actual scene-anchor invariance through forward/back selection, orbit, zoom, reset, Course/Green, rerender and remount. Scheffler desktop/mobile anchors compare exactly. Camera actions change projection; visible HTML markers remain at their actual world projections. Course/Green and selection retain the same canvas/scene. H2, missing preparation, terrain503, unavailable WebGL and WebGL loss retain2D. Normal scenarios have no page/console errors or overflow; injected failures produce expected diagnostics only.
- Whole-project TypeScript: **pass**. Focused ESLint on changed/new ShotCast modules and tests: **pass**. The two existing replay component files retain exactly their pre-pass baseline **4 errors / 6 warnings**; no additional rule/message diagnostics.
- `git diff --check`: **pass**. `npm run build`: **pass**, with the existing edge-runtime/static-generation notice.
- Actual built production GET asset and POST preparation endpoints: **404**. All165 production route traces contain **zero** prepared/research artifacts.
- Fresh read-only upstream PGA call: native replay exactly matches the capture, correct raw pinGreen source confirmed, actual development preparation resolves and source equality passes. Evidence: `tmp/shotcast-phase2/provider-field-evidence.json`; complete raw response is kept in that ignored directory, with a9.5KB coordinate-only projection in `tests/shotcast-ingestion/fixtures/scheffler-native-h1.json` for regression tests.
- All20 descriptor-referenced preserved asset/config/native hashes match; frozen parity evidence tests pass. No prepared geometry, registration configuration, research strokes or frozen predictions changed.

Evidence: `tmp/shotcast-phase2/browser/results.json`, `southwind-scheffler-desktop-world.json`, `southwind-scheffler-mobile-world.json`, screenshots alongside them, `world-trace.json`, `focused-tests.log`, `typescript.log`, `focused-lint.log`, `build.log`, `production-gate.json`, and baseline/current lint JSON.

Engineering browser tests use the existing historical SELECT snapshot, simulated local session, and preserved real PGA replay transport, through current Scores/Live components and the actual development preparation endpoint. They do not replace normal authenticated manual acceptance. No database mutations reach production; only simulated local session updates are allowed.

New/changed files for this pass: `GolfShotcast3D.tsx`, `GolfShotcastVisualizationSlot.tsx`, `GolfHoleMap2D.tsx`, `GolfHoleReplayPanel.tsx`, `productionGeometry.ts` (readonly point type), `shotcast3dView.ts`, `developmentAssetResolver.server.ts`, new `holeWorld.ts`, `world-invariance.test.mjs`, enhanced `browser-acceptance.mjs`, new captured `fixtures/scheffler-native-h1.json`, and this report. Preexisting package/config/ingestion work is retained.

## Manual retest

Run ordinary `npm run dev` in this worktree (not the historical test server). Open localhost → `/lineups/scores?sport=golf` → FedEx St. Jude Championship → team containing Scottie Scheffler → Scottie Scheffler → Round1 → Hole1. Expand ShotCast if needed.

Orbit/zoom: tee, endpoints and pin must stay attached to terrain features. Select1→2→3→4 and back repeatedly using the navigator: only highlight/details change. Switch Course↔Green, orbit the green, and reset in both views; geographic positions remain fixed. Coincident/close endpoints overlap honestly in overview; use the navigator or green camera to distinguish them. The gold ring marks the cup (coincident with Shot4). Play Hole (2D) remains existing playback; Course cancels/returns to static3D. Close/reopen H1. Open unsupported H2 and verify 2D. Repeat at desktop and mobile width.

Manual acceptance is outstanding. Before Phase3, general asset coverage and approved production asset distribution remain future work; this pass has not established physical iPhone/Safari or hardware-GPU acceptance.

## Exact final git status --short

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
