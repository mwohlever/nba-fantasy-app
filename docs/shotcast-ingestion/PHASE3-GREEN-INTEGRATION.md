# Phase 3 interaction and green integration

## Investigation and implementation gate (before runtime edits)

The current 2D `GolfHoleMap2D.selectShot` selects and starts individual replay.
Map markers, navigator numbers, Previous and Next call this same handler.
Re-click restarts. A shot starting on the green uses Green when the existing
green image/plot is available; other shots use Course. The Phase 2 static-3D
early return suppressed playback and this view selection. The subsequent flight
foundation used an explicit button because selection-only was the earlier gate.
The new user instruction restores the original interaction contract.

`pgaFlight.ts`, `flightReplay.ts`, `holeWorld.ts`, and `productionGeometry.ts`
are locked for this integration. Their initial SHA256 values are respectively
864acdfd58b1e68ed0de95be39b9ab2f85df222a57108b44df6d0d912f7e82b6,
2b650504cc67ac4f922bc5be53abcf68801b2a685ab1923ae2813bbbf094d22b,
4f2c736bff933baf4ed59c1e93aab2c1803be5c9c4bae745a2be4fd2549fa8cb,
6d237a280c637b64c6286dd860b54ce9967f7097d1b28fe2b40c4e2cd6ce6863.

## Putt numeric gate

Source: current-provider normalization of preserved Scheffler R2026027/46046/R1/H1
response in `tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json`.
PGA `reconstructionType=simulation`, native feet, ordered increasing seconds.
Same float32 feet→metres registration, Z-up, offset
`{x:3200.056917,y:3099.998293,z:0,rotate:0}`. Native Z is not the authored green
datum: converted first Z is 106.4413070678711 / 106.51837158203125 m.
Use exact authored triangle elevation at registered XY, as Phase 2 already does.
All 60 supplied sample XY positions lie on the detailed green.

| Coordinate | X | Y | Z |
|---|---:|---:|---:|
| Shot 3 native first (feet) |9499.511|10389.01|349.2169|
| Shot 3 native last (feet) |9458.493|10398.129|349.46973|
| Shot 3 authoritative from / grounded first (m) |-304.60595703125|66.57177734375|10.939206175918256|
| Shot 3 authoritative end / grounded last / Shot 4 from (m) |-317.108154296875|69.351318359375|11.014807185703452|
| Shot 4 native first (feet) |9458.493|10398.129|349.46973|
| Shot 4 native last (feet) |9463.486|10395.547|349.41693|
| Shot 4 grounded last (m) |-315.586181640625|68.564453125|11.000674407321888|
| Shot 4 authoritative end / pin (m) |-315.5849609375|68.565185546875|11.00063925622532|
| Shot 4 last minus authoritative end (m) |-0.001220703125|-0.000732421875|0.0000351510965685975|

Shot 3: 46 samples, 0→7.6000000000000005 s; first/end deltas exactly zero.
Shot 4: 14 samples, 0→3.1500000000000004 s; first delta exactly zero;
last horizontal residual 0.0014235722399524658 m, 3D 0.001424006152358 m.
Recorded Shot 4 `to` and pin are identical; raw final sample is slightly different.

### Defensible adaptation chosen before implementation

Preserve each supplied XY and time, including the final supplied sample.
Between samples interpolate XY by their supplied times and evaluate triangle Z
at the interpolated XY, not a straight 3D chord above/below changing faces.
For a made putt ending at the authoritative cup only, allow a terminal connector
of at most 0.02 m (donor `puttReplay.ts` guard), over a separately identified
0.24 s presentation interval (donor cup interval). Connector XY is linear from
the final supplied sample to the authoritative endpoint; its Z also follows the
exact triangle field. This does not translate, warp, or replace supplied samples.
It is an explicit reconciliation of millimetre endpoint precision, not inferred
ball physics. Shot 3 needs no connector. Exact binary64 copies are returned at
the logical first/final boundaries; interior grounding tolerance is 1e-8 m.
Larger residuals, non-cup residuals, off-mesh samples/interpolation, non-monotonic
times, or mismatched starts must reject that replay rather than alter anchors.

## Selective donor migration map

| Donor file | Take 2 destination | Classification / assumptions |
|---|---|---|
| `lib/shotcast/greenTopography.ts` | same path | A: pure indexed mesh metre XY/Z-up; type-only import changed to TerrainPrimitive. Exact plane elevation, gradient, downhill; deterministic; never mutates mesh or depends on players/assets outside input. |
| `lib/shotcast/greenFlow.ts` | same path | A: deterministic exact-field advection and clock; same world; 0.012 m glyph lift only; no ball physics or coordinate mutations. |
| `lib/shotcast/puttReplay.ts` | `lib/shotcast/puttReplay.ts` | B: reuse supplied-time interpolation / triangle lookup / bounded cup connector policy; adapt to frozen authoritative anchors, retain raw source provenance, remove donor 0.13 m ball-anchor lift and sinking endpoint displacement. |
| `components/shotcast-fixture/GreenTopographyView.tsx` | `components/lineups/GolfShotcast3D.tsx` | B: vertex elevation colours, lighting, sprite-free cyan THREE.Points shader, local primitive cup/pole/flag. Keep Take 2 camera, mesh positions, pin and markers. |
| fixture routes, saved-player selection, label offsets, old camera/registration, controls | none | C: research only; rejected. |

Evidence: previous `PHASE3-DONOR-AUDIT.md`, donor topology/flow/putt tests and
GreenTopographyView, independently captured detailed green mesh. Southwind
4166 vertices / 8158 triangles, Z span 10.756793022155762→11.450657844543457 m;
2–98% display range 10.810505294799805→11.381348991394043 m. No exaggeration
of geometry. Colours/lighting and downhill dots are presentation only.

## Intended runtime architecture

Map2D retains one selection/navigation handler and emits numbered replay events
with monotonically increasing IDs, so re-click works even when selection is equal.
Its 2D animation is canceled before a supported 3D event. 3D marker clicks call
that same handler; panel selection remains authoritative for navigator/details.
One renderer playback controller dispatches unchanged flight reveal or supplied
putt-time reveal; neither owns navigation, camera, world, pin or marker objects.
Manual Course/Green changes frame the same world and preserve active 3D replay.
Play Hole remains explicitly 2D and resets 3D playback when inactive.

## Validation and final results

Numeric suite: 53/53 tests pass across foundation, visualization capabilities,
world invariance, existing flight replay and the new green replay suite.
TypeScript (`tsc --noEmit --incremental false`) passes. New/updated 3D and pure
logic files pass focused ESLint with zero findings. Including the two older
replay components reports their identical Phase 2 baseline: four errors and
six warnings (no new findings). `git diff --check` passes.

`npm run build` passes. All 165 production NFT traces contain zero local `tmp`,
ShotCast test fixtures or research-UI assets; route manifest contains zero
fixture/lab routes. Local production GET, POST and terrain-asset requests to
`/api/golf/shotcast-3d-dev` all return 404. Production eligibility is unchanged.
Browser acceptance: 16/16 scenarios pass at desktop 1400×900 and mobile 390×844.
Current Scores → Scheffler's team → Scottie → R1 → H1 exercises all four paths;
current Live validates Henley static world and independently validated Brennan
flight. Tests observe actual scene-object world positions and ball frames, not
just server coordinates. Verified exact first/final frames, repeated replay,
marker/navigator/details synchronization, mid-flight replacement by Next/Previous
and putt selection, view changes, reset, orbit/zoom, frozen path/anchor identity,
flow motion with exact surface grounding, and same-world remount/reopen.
H2 is 2D in every prepared validation context. Preparation, asset, WebGL init and
WebGL context-loss injection all retain usable 2D with no overflow/page errors.
No browser transport mutation occurred; the local database boundary report is
empty. Screenshots/world evidence and machine-readable results are preserved in
`tmp/shotcast-take2/green-browser/`. These are ignored engineering artifacts,
not application routes or authenticated manual acceptance.

The initial browser run was invalidated by a development Fast Refresh while an
effect dependency changed. A fresh complete run then passed without injected
changes. Final normal development is running on localhost:3001 with `.env.local`;
test dev3002, mock-history54329 and local production3003 were stopped.

## Implemented behavior

Before: supported 3D numbered controls selected only; flight required a separate
button. Green was textured geometry with a closer camera and no putt/flow replay.
After: the existing `selectShot` handler cancels 2D animation, selects the stroke,
keeps its original Course/Green rule, and emits a replay request for a prepared
3D path. Map markers call this same handler through the viewport seam. Previous
and Next retain the original limits and handler. A monotonically increasing
request ID supports re-clicks, including the currently selected number.
Unsupported paths use the unchanged individual 2D replay; Play Hole remains 2D.
The renderer uses one `createShotPlayback` clock for flights and putts. The old
flight-only controller remains in the locked file for its existing tests but has
no runtime renderer consumer. A new request cancels/replaces the old replay;
selection from outside these controls remains distinct from a replay event.

Flight timing/geometry still uses the unchanged `createFlightReveal`. Putts use
supplied timestamps. A made-cup glyph shrinks during the small terminal connector;
its logical position never sinks or lifts away from the registered surface.
The last logical ball coordinate is exactly the cup even when the glyph vanishes.
Both path types own their glyph/line, not the marker/pin/terrain anchor objects.

Green uses the original authored geometry and normals (computed if absent), with
MeshStandardMaterial vertex colours from donor dark `#235830` → light `#b6d875`
over the 2–98% elevation range, plus the existing hemisphere/directional lighting.
No geometry height exaggeration, plane replacement, separate registration, or
saved-player selection is introduced. Course retains its accepted imagery shader.
Existing camera fitting and orbit controls remain; manual view switching preserves
active 3D replay and changes only the camera/materials in the same scene.

Topology solves `z=zA+gx(x-xA)+gy(y-yA)` on the containing indexed triangle.
Grade is `hypot(gx,gy)`; downhill is `(-gx,-gy)/grade`. Authored shading normals do
not determine slope. Flow copies donor logic verbatim: 64 deterministically seeded
heads with two fading history dots each, midpoint downhill integration with bounded
substeps and no accepted uphill move; flat/sink/edge particles fade/respawn.
Speeds are slope display choices, not putt physics. Positions are grounded to
triangle Z plus 0.012 m presentation lift. THREE.Points circular cyan head/trail
shaders use no sprite image. Hidden, inactive, offscreen and non-Green states pause
flow; its clock clears rather than catching up when returning.

Cup, pole and flag copy donor primitive presentation: a dark 0.16 m display-radius
circle locally 0.02 m above the pin, thin 1.6 m vertical pole and 0.7 m triangular
flag. These readable symbols are local children of the pin group. The pin group's
actual position remains exactly `pinWorld`; the floating HTML flag is removed.
No label collision offsets, screen displacement or moving coordinates are used.

## Files changed in this pass

- `components/lineups/GolfHoleMap2D.tsx`: normal selection handler and viewport event seam.
- `components/lineups/GolfHoleReplayPanel.tsx`: forwards the same handler/events.
- `components/lineups/GolfShotcastVisualizationSlot.tsx`: freezes putts and reports supported replay strokes.
- `components/lineups/GolfShotcast3D.tsx`: unified clock, putt lines/ball, green relief/flow, primitive cup/flag; removes explicit button.
- `lib/shotcast/shotcast3dView.ts`: selected-player putt handoff/validation.
- `lib/shotcast/developmentAssetResolver.server.ts`: prepares supplied paths using existing registered course assets.
- `lib/shotcast/greenTopography.ts`: migrated donor pure mesh field.
- `lib/shotcast/greenFlow.ts`: migrated donor pure flow/clock.
- `lib/shotcast/puttReplay.ts`: adapted supplied-time surface replay and bounded terminal connector.
- `lib/shotcast/shotReplay.ts`: single renderer lifecycle dispatching existing flight or supplied putt reveal.
- `tests/shotcast-ingestion/green-replay.test.mjs`: focused numeric, determinism, immutable-world and donor/hash comparisons.
- `tests/shotcast-ingestion/browser-acceptance.mjs`: tests normal numbered controls for both replay kinds; no extra button.
- `docs/shotcast-ingestion/PHASE3-GREEN-INTEGRATION.md`: this investigation, gate and report.

Provider, scoring, tournament selection, Golf Live, navigation, prepared assets,
production eligibility and accepted numerical implementations were not changed
in this pass. Other entries in final git status predate this pass and are preserved.

## Manual acceptance

Normal development will be left at `http://localhost:3001`, using normal local
configuration, without the engineering harness's mocked database or session.
Open `/lineups/scores?sport=golf`, select FedEx St. Jude Championship, expand the
fantasy team containing Scottie Scheffler, open Scottie → R1 → H1.

1. Confirm four numbered start markers and independent cup. No separate Replay 3D button.
2. Tap navigator 1: flight immediately starts at marker 1, ends at marker 2.
3. Tap course marker 2: flight immediately starts there, ends at marker 3.
4. Tap navigator 3: existing auto-Green rule applies; supplied putt goes 3 → 4.
5. Tap marker or navigator 4: supplied putt goes 4 → authoritative cup; glyph disappears there.
6. Re-click each number, then switch numbers mid-replay; details/selection/playback synchronize.
7. Use Previous/Next; manual Course/Green; orbit and zoom during replay. Anchors stay fixed.
8. In Green, inspect elevation colours/shading and cyan downhill dots. Dots move along actual green relief.
9. Inspect cup/pole/flag, reset, repeat, close/reopen and repeat at mobile width.
10. Open H2 for normal 2D fallback. Play Hole (2D) remains available in prepared H1.

## Limits

PGA calls these putt samples simulations, not measured ball tracks. Native Z is
retained for provenance while visible ball Z follows the accepted authored mesh.
The made-putt terminal 0.24 s interval is presentation reconciliation, not supplied
PGA timing. Flow speed is illustrative grade display and never affects the ball.
Flight's accepted 3 s arclength presentation remains unchanged. Symbols are
intentionally enlarged for readability. Course/Green changes may hide markers that
are physically outside the camera's current field of view, without relocating them.
No additional holes/courses, production 3D, research routes or Phase 4 work.
Automated browser evidence uses the current product components with preserved
PGA/DB transport fixtures; it is not authenticated live-user manual acceptance.

## Exact final git status --short

```text
 M components/lineups/GolfHoleMap2D.tsx
 M components/lineups/GolfHoleReplayPanel.tsx
 M lib/providers/pgaTourShots.ts
 M next.config.ts
 M package-lock.json
 M package.json
?? app/api/golf/shotcast-3d-dev/
?? components/lineups/GolfShotcast3D.tsx
?? components/lineups/GolfShotcastVisualizationSlot.tsx
?? docs/shotcast-ingestion/
?? lib/shotcast/developmentAssetResolver.server.ts
?? lib/shotcast/fixturePlacement.ts
?? lib/shotcast/flightReplay.ts
?? lib/shotcast/greenFlow.ts
?? lib/shotcast/greenTopography.ts
?? lib/shotcast/holeWorld.ts
?? lib/shotcast/ingestion/
?? lib/shotcast/pgaFlight.ts
?? lib/shotcast/productionGeometry.ts
?? lib/shotcast/puttReplay.ts
?? lib/shotcast/shotReplay.ts
?? lib/shotcast/shotcast3dView.ts
?? lib/shotcast/visualizationCapabilities.ts
?? tests/shotcast-ingestion/
```

All Phase 2/3 changes remain uncommitted. Nothing was committed, pushed, merged,
deployed, reset, stashed or discarded. Main and the donor worktree were not modified.
