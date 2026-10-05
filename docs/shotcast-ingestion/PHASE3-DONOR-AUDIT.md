# Phase 3 donor audit — stopped at the coordinate gate

Audit date: 2026-10-05. Working directory: `/home/markwohlever/nba-fantasy-app-3d-take2`, branch `shotcast-3d-take2`. Donor: `/home/markwohlever/nba-fantasy-app-3d`, read only. Existing uncommitted Phase 2 work is preserved. This report is the only file added by this audit; no runtime implementation has begun.

## Gate result

**STOP: the strongest independently validated donor flight evaluator does not guarantee that its flight begins at the authoritative shot start.** This is a donor compatibility conflict, not evidence of a Phase 2 world-model defect. It affects the primary Scheffler acceptance context, not just an optional secondary course.

`generalFlightResearch.ts` intentionally retains PGA's Broadcast behavior: start correction applies only when tee-to-start distance exceeds 20 m or the fit type is Incoming. A Broadcast tee shot can therefore begin away from its recorded start. `sedgefield-generalization.test.mjs` explicitly asserts a discrepancy greater than 0.9 m. The independent Sedgefield runtime capture confirms that same discrepancy. Independent parity with PGA's computed path does not imply compliance with Take 2's exact anchor contract.

Read-only evaluation against Scheffler's captured raw PGA data, **using unchanged Take 2 conversion, grounding and meshes**, produced:

| Scheffler R2026027 / R1 / H1 | Donor result | Anchor comparison |
| --- | --- | --- |
| Shot 1, Broadcast | 167 path points; no extension or start correction | Start gap **0.4920964235157554 m**; endpoint gap 0 |
| Shot 2, Incoming | 131 path points; start correction applied | Start and endpoint gaps 0 |
| Shot 3, PGA simulation putt | 46 samples; source duration 7.6000000000000005 s | Start and final sample match grounded anchors exactly |
| Shot 4, PGA simulation putt | 14 samples; source duration 3.1500000000000004 s | Start gap 0; final sample is **0.001424006152357937 m** from authoritative endpoint |

Shot 1 authoritative `from`: `[-115.68310546875,378.721435546875,10.874481308178765]`.

Donor Shot 1 path start: `[-115.63236800224934,379.2109093454895,10.874481308178765]`.

Moving marker 1 to the fit origin, translating the registered world, or concealing the discrepancy with a symbol offset would violate the accepted model. No such change was made. Adding an explicitly endpoint-constrained presentation to a measured fit would be a new adaptation requiring an explicit treatment of this discrepancy; it must not be represented as unchanged PGA path parity. Per the requested gate, implementation stops here instead of silently making that choice.

## Current architecture and destination boundary

Current response → `currentPlayerHole` → development POST → independent player/round/course assignment verification → integrity-checked reusable course assets → `buildHoleWorld` → frozen JSON handoff → `GolfShotcast3D` → existing 2D fallback.

`holeWorld.ts` freezes every stroke's `from`, `endpoint`, native provenance, tee, pin and green bounds. `GolfShotcast3D.tsx` creates fixed scene anchors. Numbered markers use `shot.from`; selection changes colors only. Course/Green changes camera framing in the same scene. Existing Play Hole remains explicitly 2D. `GolfHoleMap2D.tsx` owns the current navigator, Course/Green controls and reset; `GolfHoleReplayPanel.tsx` supplies the selected golfer response. Current Scores and Live architecture stays intact.

**Before → after this audit: unchanged runtime.** Proposed Phase 3 architecture, once the gate is resolved: retain the entire chain above; prepare independent per-shot replay capabilities from the same golfer response; add an immutable replay path plus a separate lifecycle/controller; move only a dedicated replay glyph; derive green shading/flow from the already loaded detailed mesh; add flag/cup children under the unchanged pin anchor.

Destinations below are proposed, not implemented. All donor paths are relative to the read-only donor root; all destination paths are relative to Take 2.

## Migration map

A = safe reusable material. B = adapt before migration. C = research only; do not migrate.

| Capability / class | Exact donor files | Exact proposed Take 2 destination | Inputs and coordinate assumptions | Mutation, player/assets dependence, determinism | Supporting evidence |
| --- | --- | --- | --- | --- | --- |
| Replay clock / A | `lib/shotcast/pathReveal.ts`: `createRevealClock` | `lib/shotcast/pathReveal.ts` | RAF milliseconds and explicit active state; no world coordinates | Internal clock only; no player/assets; deterministic for supplied timestamps | `tests/shotcast-ingestion/path-reveal.test.mjs` pause/hidden/restart checks |
| Lifecycle / B | `components/shotcast-fixture/GreenTopographyView.tsx`: `prepareShot3`, `showPutt`, restart/select/draw/cleanup | New `lib/shotcast/replayLifecycle.ts`; `components/lineups/GolfShotcast3D.tsx`; existing `GolfShotcastVisualizationSlot.tsx` / `GolfHoleMap2D.tsx` seam | Current stroke number, context revision, play/reset commands, active/hidden state; selection must not start playback | Prototype mutates glyph/ring and hides endpoint balls; those behaviors cannot replace fixed markers. Prototype identities are shot3/first-putt specific; extract policy only. Deterministic commands/clock | `non-putt-replay-controller.test.mjs`, `shotcast-ux-browser.mjs`, `docs/shotcast-ingestion/UX-CAMERA-VALIDATION.md` |
| Path reveal / A, boundary adapter B | `lib/shotcast/pathReveal.ts`: `createPathReveal`; reveal shader in `GreenTopographyView.tsx` | `lib/shotcast/pathReveal.ts`; `GolfShotcast3D.tsx` | Registered metre/Z-up polyline and explicit UI duration; cumulative 3D distance, not coefficient time | Does not mutate inputs, but retains caller's point references. Adapt types/ownership to frozen Take 2 points. No player/assets; deterministic | `path-reveal.test.mjs`; independent Southwind/Sedgefield pending animation captures establish 3000 ms for those researched shots only |
| Non-putt fit evaluator / B, **blocked** | `lib/shotcast/flightResearch.ts`: `evaluateRadarFit`; `lib/shotcast/generalFlightResearch.ts`: `reconstructGenericPgaFlight` | Proposed `lib/shotcast/flightReplay.ts`; current provider normalization and development handoff need additional metadata | Full source Flight fit/type/interval/impactTime status, grounded tee/from/end, transformed **native fairwayCenter**, coarse terrain sampler; coefficients already in researched engine frame, no extra feet conversion | Own generated points receive PGA's weighted Incoming correction, contact search and grounded endpoint connector. Inputs/world anchors aren't mutated. Broadcast start mismatch remains. Generic evaluator has no player/assets hardcoding; fixture adapters do. Deterministic | `sedgefield-generalization.test.mjs`, `non-putt-flight.test.mjs`, independent runtime comparison tests and captures listed below |
| Original Southwind evaluator / C for runtime | `lib/shotcast/flightResearch.ts`: `reconstructPgaFlight` | No runtime copy of this restricted evaluator | Zero-origin, no-impactTime, no-extension Southwind branch | Deterministic but deliberately narrow; retain as evidence, not a second course-specific runtime algorithm | Superseded for generalization by `generalFlightResearch.ts`; original frozen hashes remain evidence |
| Experimental flight registry / C | `lib/shotcast/experimentalFlight.ts`; `packages/shotcast-experiments/southwind-shot3-replay.json`; import in `GreenTopographyView.tsx` | None | Saved Henley identity/path and first radar-bearing research stroke | Player-specific observed-path branch, research-only bundled vertices and hardcoded flight count/timing; generic branch still reads package research strokes. Deterministic does not make it safe | `NON-PUTT-FLIGHT-EXPERIMENT.md`, `SEDGEFIELD-GENERALIZATION-EXPERIMENT.md` explicitly bound claims |
| Putt traversal / B | `lib/shotcast/puttReplay.ts`; putt glyph/line shader in `GreenTopographyView.tsx` | `lib/shotcast/puttReplay.ts`; `GolfShotcast3D.tsx`; handoff of current selected stroke samples | Native PGA timed samples converted with existing course offset; interpolate adjacent XY and resample detailed mesh Z; explicit made/lip-out status and authoritative endpoint/cup | Does not mutate samples. Generates surface lift and a separate 0.24 s cup presentation that bridges up to 0.02 m residual. Must distinguish sample completion from exact endpoint and glyph center from surface anchor. Pure helper has no player/assets dependence; fixture's first-path/commentary detection is C. Deterministic | `putt-replay.test.mjs`, `putt-replay-browser.mjs`, `PUTT-REPLAY-PROTOTYPE.md`; Scheffler read-only audit above |
| Detailed green field / A | `lib/shotcast/greenTopography.ts` | `lib/shotcast/greenTopography.ts` (replace type-only `Primitive` import with existing `TerrainPrimitive`) | Original detailed mesh positions/indices, metre XY/Z-up; first authored containing face | Mesh unchanged; only sample/output fields and acceleration structure generated. No golfer/saved paths/new assets; deterministic | `green-topography.test.mjs`, `GREEN-TOPOGRAPHY-PROTOTYPE.md`, existing independent detailed-green placement evidence |
| Elevation presentation / A logic, B rendering | `components/shotcast-fixture/GreenTopographyView.tsx`: detailed green color/material loop | Existing `GolfShotcast3D.tsx` detailed mesh/material branch | Same loaded green, true heights, 2nd–98th percentile relative color range, original normals for lighting | Adds vertex colors/material; **no geometric elevation exaggeration or mesh translation**. No player-specific input/sprite. Deterministic colors; lighting camera dependent | `green-topography-browser.mjs`; `tmp/green-topography/geometry-report.json`; report distinguishes color display from physical precision |
| Downhill flow / A math, B rendering | `lib/shotcast/greenFlow.ts`; cyan Points shader/attribute updates in `GreenTopographyView.tsx` | `lib/shotcast/greenFlow.ts`; `GolfShotcast3D.tsx` | Exact green field, independent RAF clock, optional Green-layer visibility; deterministic seed phases/respawn | Mutates only its owned particle buffers, never green/world anchors. No sprite or golfer dependency. Deterministic for same timesteps; presentation speed is not ball physics. Adapt active/hidden/reduced-motion policy and optional controls | `green-flow-temporal.test.mjs`, `green-flow-browser.mjs`, `cyan-flow-browser.mjs`, `GREEN-FLOW-ANIMATION.md` supersedes earlier weak motion claims |
| Flagstick/cup / A presentation, B attachment | `components/shotcast-fixture/GreenTopographyView.tsx`: lines 288–297 | `GolfShotcast3D.tsx`, children of existing `pin` anchor | Authoritative current pin; Z-up local geometry: dark cup disc, white 1.6 m cylinder, yellow triangular flag | Presentation dimensions/local lift only; no movement of pin. No sprite/research mesh. Deterministic geometry. Reject fixture's package pin lookup and label collision offsets | `putt-replay-browser.mjs`, `shotcast-ux-browser.mjs` and screenshots in `tmp/shotcast-ux/final/`; visual evidence, not surveyed flag/cup dimensions |
| Replay camera / A direction, B framing | `lib/shotcast/replayCamera.ts`; `frameView` in `GreenTopographyView.tsx` | `lib/shotcast/replayCamera.ts`; existing `GolfShotcast3D.tsx` camera-only fitting | Valid path bearing/bounds and viewport aspect; green bounds from same scene | Camera only; no points mutated, player-specific pose or research assets. Deterministic fit inputs; free orbit intentionally user controlled | `replay-camera.test.mjs`; `UX-CAMERA-VALIDATION.md` oblique/side/mobile framing comparison |

## Data reconciliation still required

- The current provider already exposes selected-player `flightTrajectory`, `radarData` and native `ballPath` with source timestamps/reconstruction type. No need to resurrect a saved Henley replay.
- `currentPlayerHole` deliberately strips replay down to static native anchors. `Shotcast3DView` currently contains no fit, samples, effective offset or native fairway center. Replay data needs its own verified handoff without modifying `HoleWorld` anchors.
- The raw Scheffler source includes `hole.fairwayCenter`. The prepared Southwind course-data asset contains only `pinsTees`, `cameraTargets`, `holeCenterLines`; it does **not** contain that radar-frame fairway center. Using Henley's saved native.bin to fill this gap would regress course/player separation. Preserve the field from the current response instead, if proceeding later.
- Current normalized `GolfShotFlightTrajectory` preserves the first Flight row and coefficient interval, but drops source impactTime/other-row information needed for the donor's rejection rules. Do not infer unsupported branches from the reduced shape. Audit/preserve source capability metadata before granting replay.
- Scheffler Shots 3 and 4 both have PGA `reconstructionType: simulation`. These are actual supplied sample arrays, not evidence of measured physical ball trajectories. Both lie on the detailed mesh. Select by `strokeNumber`, never “first path” or Henley's Shot 4.
- Donor generated contact/connector geometry and UI reveal duration must remain distinct from physical flight/roll. Southwind Henley and Sedgefield Brennan pending queues independently show 3000 ms reveal; that does not independently establish Scheffler playback duration.

## Green math and best flag source

Southwind detailed mesh: **4,166 vertices / 8,158 triangles**. True Z: **10.756793022155762–11.450657844543457 m** (0.6938648223876953 m span). Relative elevation color interval: **10.810505294799805–11.381348991394043 m**. Same existing prepared asset; no duplication.

With U=B−A, V=C−A, D=UxVy−UyVx: `gx=(UzVy−UyVz)/D`, `gy=(UxVz−UzVx)/D`; `z=Az+gx(x−Ax)+gy(y−Ay)`. Grade is `hypot(gx,gy)`; downhill is `(-gx,-gy)/grade`. Barycentric containment uses the existing 1e-10 tolerance. Spatial buckets accelerate lookup; authored normals are lighting inputs only.

The latest flow uses this exact field with midpoint integration, substeps ≤1/120 s, contained candidates and uphill rejection. At grade ≤0.003, visual speed is zero; otherwise `min(3.2,0.9+40*(grade−0.003))` m per animation second. Maximum clock delta is 0.25 s. Latest default budget is **64 heads**, each with two history dots; deterministic upstream origin screening avoids short edge loops. Display lift is 0.012 m. The current fixture shader draws cyan circles directly with `gl_PointCoord`; no external sprite. Projected masks may hide dots near context; they must never relocate markers or determine flow direction.

`GreenTopographyView.tsx` has the best compatible developed flag/cup presentation. `components/lineups/GolfHole3D.tsx` is a useful historical terrain/camera investigation but uses `courseData.pinsTees[0]` and its own rendering/transform scaffolding. Its whole implementation is unsuitable for migration; use only the fixture's primitive flag geometry attached to Take 2's current pin.

## Evidence inventory and exclusions

Strongest flight evidence:

- `docs/shotcast-ingestion/NON-PUTT-FLIGHT-EXPERIMENT.md`, `SEDGEFIELD-GENERALIZATION-EXPERIMENT.md`, `NON-PUTT-RUNTIME-CAPTURE.md`, `SEDGEFIELD-RUNTIME-CAPTURE.md`.
- `tmp/non-putt-flight/frozen-prediction-v2.json`, `southwind-shot3-hole-runtime.json`, `southwind-shot3-animation-runtime.json`: 92-point independently observed Henley path and pending UI configuration.
- `tmp/sedgefield-generalization/frozen-prediction.json`, `runtime-capture1.json`, `runtime-capture2.json`: 168-point independently observed Brennan path, including the Broadcast start mismatch and half-second extension; later observed 3000 ms pending configuration differs from the prototype's 6000 ms choice.
- Relevant tests: `non-putt-flight.test.mjs`, `non-putt-runtime.test.mjs`, `path-reveal.test.mjs`, `sedgefield-generalization.test.mjs`, `sedgefield-runtime-comparison.test.mjs`, `sedgefield-animation-comparison.test.mjs`, `replay-camera.test.mjs`.

Strongest green/replay presentation evidence:

- `GREEN-TOPOGRAPHY-PROTOTYPE.md` geometry/shading, superseded flow behavior in `GREEN-FLOW-ANIMATION.md`, `PUTT-REPLAY-PROTOTYPE.md`, and later `UX-CAMERA-VALIDATION.md`.
- `tmp/green-topography/geometry-report.json`, `tmp/putt-replay/path-audit.json`, `tmp/putt-replay/temporal-validation.json`, `tmp/green-flow-animation/`, `tmp/shotcast-ux/final/report.json`, `pixel-validation.json`, screenshots and performance observations.
- Tests: `green-topography.test.mjs`, `green-flow-temporal.test.mjs`, `green-flow-browser.mjs`, `cyan-flow-browser.mjs`, `putt-replay.test.mjs`, `putt-replay-browser.mjs`, `non-putt-replay-controller.test.mjs`, `shotcast-ux-browser.mjs` and their pixel-check scripts.

**C exclusions:** all donor fixture/lab/tourcast routes and asset APIs; `components/shotcast-fixture/ShotcastFixture.tsx`; entire fixture page/control layout; saved-player flight registry/JSON; first radar/first putt selection; commentary-only made detection; endpoint-based marker selection; label collision offsets/clamping; local debugger globals/readbacks; old `GolfHole3D.tsx` transform/camera diagnostic branches and backup copies; `GolfShotcastDevelopmentPreview.tsx`; obsolete Scores/dashboard/Tournament/League navigation. Tests using those pages are evidence to inspect, not production UI to copy. No donor file or test was modified or executed with its artifact-writing behavior.

## Verification performed in this audit

- Existing Take 2 Node foundation/capability/world suite: **32/32 pass** (`node --test tests/shotcast-ingestion/foundation.test.mjs tests/shotcast-ingestion/visualization-capabilities.test.mjs tests/shotcast-ingestion/world-invariance.test.mjs`). Includes preservation hashes, native.bin separation, immutable anchors, exact Scheffler continuity, integrity and production guards.
- Read-only donor module evaluation against current captured Scheffler raw data: exact results in gate table; neither source data nor generated Phase 2 world changed.
- Independent donor captures reread and compared with unchanged freezes: Henley 92 points, maximum error **8.86402062860725e-13 m**; Brennan 168 points, maximum error **2.9416469260468148e-12 m**. Path reveal at 0/3 s returns each supplied polyline's first/last vertex exactly. This demonstrates why reveal logic alone cannot repair a wrong start vertex.
- Two identical Southwind green-flow instances evaluated through 120 × 1/60 s: buffers agree exactly at every step; **64 heads**; largest observed head-height difference from independent Take 2 triangle lookup, after removing display lift, **9.904265194649042e-7 m**. This is Float32 display rounding, not anchor adjustment.
- `git diff --check`: pass. Installed Next 16.2.4 lazy-loading documentation inspected for the existing client-only visualization seam.
- No new runtime tests, browser/manual Phase 3 acceptance, TypeScript check or production build claimed. No implementation occurred, so a new expensive build would not validate the unresolved flight contract. Prior Phase 2 browser/build reports were inspected as historical evidence, not rerun or claimed as Phase 3 results.

## Limitations and next decision

Phase 3 is **not implemented**. Resolve how endpoint-constrained playback should represent the Broadcast fit-origin discrepancy before continuing A→G. Preserve all Phase 2 coordinates, reject unsupported fit branches, retain supplied putt samples and separately specify final endpoint/cup presentation. A new replay controller must prove fixed markers/pin/world, deterministic replay/reset, safe shot switches, hidden-tab behavior, remount and Course/Green identity with actual scene tests.

Current production gating, 2D playback and asset/integrity/WebGL fallbacks remain unchanged. No new routes/assets were exposed. Donor SwiftShader desktop/mobile functional evidence is useful but not a hardware-phone performance or Safari release pass; its reported smoothness concerns remain relevant.

Manual Phase 3 replay acceptance cannot be performed yet. For unchanged Phase 2 review: ordinary Take 2 dev port is **3002** according to the existing harness; open `/lineups/scores?sport=golf` → FedEx St. Jude → Scheffler's fantasy team → Scottie Scheffler → R1 → H1. Markers still represent stroke starts; select/orbit/zoom/reset and switch Course/Green to inspect existing world behavior; H2 remains 2D. No dev server was started during this gated read-only audit; no running Next dev process was found. There is no new replay/flow/flag UI to accept.

Nothing was committed, pushed, merged, rebased or deployed. Main and the donor worktree were not modified. Exact final `git status --short` (existing Phase 2 changes plus this report under the already untracked docs directory):

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
