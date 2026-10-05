# ShotCast Take 2 — accepted Phase 1–3 baseline

Accepted by the user on 2026-10-05 through the real authenticated Scores UI on
localhost:3001. Branch: `shotcast-3d-take2`, worktree:
`/home/markwohlever/nba-fantasy-app-3d-take2`. The finalization pass documents and
validates this accepted implementation; it does not change runtime behavior or
implement Phase 4. No speculative cleanup/refactor was required.

This is the current completion record. Earlier reports remain historical evidence,
including their then-pending acceptance, selection-only behavior and temporary
explicit replay button. Those descriptions are superseded by this baseline and
the later integration/polish reports, rather than erased from the history.

## Phase 1–3 history

- [TAKE2-FOUNDATION.md](TAKE2-FOUNDATION.md): selectively recovered registered
  geometry, preparation, integrity checks and the current-product viewport seam.
- [ACTIVATION-INVESTIGATION.md](ACTIVATION-INVESTIGATION.md): distinguished the
  current Live tournament from historical prepared contexts and corrected the
  limits of browser-harness evidence.
- [COURSE-PLAYER-SEPARATION.md](COURSE-PLAYER-SEPARATION.md): course preparation is
  reusable; current selected-player PGA strokes supply the replay.
- [PHASE2-WORLD-CORRECTNESS.md](PHASE2-WORLD-CORRECTNESS.md) and
  [PHASE2-MARKER-SEMANTICS.md](PHASE2-MARKER-SEMANTICS.md): frozen world identity,
  direct marker projection, independent pin, and numbered starts.
- [PHASE3-DONOR-AUDIT.md](PHASE3-DONOR-AUDIT.md): the original coordinate gate
  correctly stopped at the Broadcast fit-origin discrepancy.
- [PHASE3-FLIGHT-FOUNDATION.md](PHASE3-FLIGHT-FOUNDATION.md): numerical explanation
  and mathematically bounded endpoint-constrained PGA-derived flight.
- [PHASE3-GREEN-INTEGRATION.md](PHASE3-GREEN-INTEGRATION.md): restored the existing
  numbered-control replay contract, supplied putts, authored relief/flow and cup.
- [PHASE3-GREEN-VISUAL-POLISH.md](PHASE3-GREEN-VISUAL-POLISH.md): accepted sparse,
  subtle cyan context with selected-putt emphasis.
- [donor-reference/NONZERO-ROTATION.md](donor-reference/NONZERO-ROTATION.md): preserved
  independent Sedgefield registration evidence; its relative research paths refer
  to the donor, not new Take 2 product routes.

## Architecture and data ownership

The existing Scores and Live flows remain:

`current PGA response → existing provider normalization → current Hole Replay →
currentPreparationInput → development preparation POST → independent event/player/
round/course verification → hash-checked reusable course assets → frozen HoleWorld
and replay paths → registered Three.js scene → existing 2D fallback`.

Scores remains `/lineups/scores?sport=golf`, including tournament and R1–R4
selection, fantasy teams and golfer/hole drilldown. Live remains `/golf/live` with
full-field leaderboard, ownership and golfer/round/hole drilldown. The integration
replaces the viewport through `GolfHoleReplayPanel` / `GolfHoleMap2D`; it does not
restore obsolete League/Tournament views, previews, navigation or scoring.

The provider preserves current native starts/ends, pin, optional native fairway
center, radar polynomial eligibility and supplied ball-path samples. Preparation
verifies the selected golfer's course assignment using preserved event tee-times.
The descriptor is projected to course fields; research selection, saved-player
strokes and `native.bin` never supply runtime replay coordinates. Ambiguous or
invalid preparation fails closed. Paths are separate from the frozen hole world.

## Coordinate and registration contract

- Native PGA coordinates are feet. The preserved PGA 3.3.1 profile
  `pga-f32-z-up-interior-v1` performs float32 feet→metres, float32 quaternion Z
  rotation about the native origin, then float32 course-offset subtraction.
- Registered XY is authoritative. Z uses vertical barycentric intersection of the
  first containing authored detailed-green triangle, then coarse terrain when
  applicable. Missing intersections fail closed; there is no fitted placement.
- Meshes are authored metres, XY horizontal/Z-up, with identity scene transforms.
  Unexpected GLB node transforms are rejected. World-file UV mappings affect
  texture registration only, never shot positions.
- `HoleWorld` contains all ordered stroke `from`/`endpoint` anchors and their native
  provenance, tee, independent pin and authored green bounds. Geometry is deeply
  frozen before serving and after the JSON handoff.
- Marker N equals `shot N.from`; animation begins exactly there and ends exactly
  at `shot N.endpoint` (resolved PGA `to`). The renderer owns copies for its replay
  glyph; it never animates a marker, pin or terrain object.
- Marker labels directly project the actual anchors without collision offsets,
  clamping or selection-dependent relocation. Course/Green, selection, replay,
  camera movement, reset and remount cannot redefine those anchors.

Primary accepted anchors, metres:

| Anchor | X | Y | Z |
|---|---:|---:|---:|
| Marker 1 / tee | -115.68310546875 | 378.721435546875 | 10.874481308178765 |
| Marker 2 | -296.1064453125 | 204.69482421875 | 10.945296698560316 |
| Marker 3 | -304.60595703125 | 66.57177734375 | 10.939206175918256 |
| Marker 4 | -317.108154296875 | 69.351318359375 | 11.014807185703452 |
| Independent pin / cup | -315.5849609375 | 68.565185546875 | 11.00063925622532 |

Scheffler's consecutive boundaries are exactly equal: 1 ends at marker 2, 2 at
marker 3, 3 at marker 4, and 4 at the cup. Logical boundary values are exact
binary64 copies. Interior CPU geometry uses 1e-8 m tolerance; Float32 rendering
buffers use 5e-5 m tolerance without rounding authoritative world coordinates.

## Replay and interaction

`GolfHoleMap2D.selectShot` remains the shared interaction handler for markers,
navigator numbers, Previous and Next. It selects the shot, updates details and
emits a monotonically numbered replay request when that stroke has a supported 3D
path. Re-clicking emits a new request; switching strokes replaces the active
replay. There is no separate 3D replay button. Selection data and replay events
remain distinct internally, allowing equal-selection replays without moving world
objects. One runtime `createShotPlayback` clock dispatches flight or putt reveal.
The older flight-only helper is retained for its focused historical tests; it is
not a competing renderer state machine.

Flights use supplied PGA Broadcast/Incoming polynomial coefficients evaluated by
the selectively migrated donor/PGA engine model. These are radar-derived models,
not measured XYZ arrays or a generic parabola. Broadcast nonzero constant terms
explain the 0.492096 m Scheffler origin residual. For source airborne P(t),
authoritative start A and unchanged contact time T, the accepted representation is
`Q(t)=P(t)+(A-P(0))*(1-t/T)`. It preserves the residual about the coefficient-time
chord, heights/apex timing and unchanged landing/terrain connector, while giving
exact endpoint constraints. Only small horizontal residuals (≤1% of airborne XY
span), supported source branches and valid terrain are eligible. Replay uses the
accepted 3-second arc-length presentation; this is not physical flight timing,
measured roll/bounce or a claim of unchanged absolute PGA path parity.

Putts retain all supplied PGA `simulation` samples and their native/time provenance:
Shot 3 has 46 samples over 7.6000000000000005 s; Shot 4 has 14 over
3.1500000000000004 s. Sample XY uses the same registration; sample/interpolated Z
uses exact authored green triangles. No synthetic curve replaces the samples.
Shot 3 has exact supplied start/end. Shot 4 starts exactly and its supplied final
sample has a 1.424006 mm 3D cup residual. The accepted separately identified
0.24 s terminal connector follows the surface to the exact cup, allowed only for
a made cup putt with ≤0.02 m residual. All supplied samples remain unchanged.
The glyph shrinks at the cup; its logical position never sinks or shifts.

## Course, Green and presentation

The existing selection rule uses Green for shots starting on the green when the
existing green context is available; non-putts use Course. Manual Course/Green
controls frame the same scene and preserve active replay. Existing orbit, zoom,
reset and camera fitting are accepted unchanged. Points outside the close Green
camera may be offscreen, without being relocated.

Course uses registered imagery and terrain. Green uses the same authored detailed
mesh, elevation vertex colours and lighting, with no vertical exaggeration.
Southwind has 4,166 vertices / 8,158 triangles and true height range
10.756793022155762–11.450657844543457 m. Colours use the existing 2nd–98th percentile
range. `greenTopography` derives triangle planes, gradient, grade and normalized
downhill direction from positions/indices; authored normals serve lighting only.

`greenFlow` advects deterministic surface-bound seeds through that field using
midpoint integration and bounded substeps. Its speeds and 0.012 m display lift
are presentation, never ball physics. The accepted display retains 28 of 64
families (43.75% density), with 5px heads / 1.9px trails and muted cyan shader
circles; no sprite asset. `greenFlowPresentation` uses Gaussian distance to the
selected supplied putt polyline (2.25 m scale, alpha 0.30→0.58), plus smooth tracer
and projected glyph clearances. These affect opacity only. The legend stays
removed; ball/path/cup lead the visual hierarchy. Clocks pause when inactive or
hidden rather than catching up later.

The dark cup disc, thin 1.6 m pole and triangular flag are adapted donor primitive
presentation, local children of the exact pin group. Readable symbol dimensions
and local lifts do not move the pin coordinate. No floating HTML flag is restored.

## Fallback and development/production boundaries

Unsupported contexts/H2, missing or invalid native data, assignment ambiguity,
missing/corrupt assets, ungroundable points, invalid replay branches and WebGL
failure retain existing 2D functionality. A valid static 3D world can coexist with
an unsupported individual 3D path, which uses existing 2D replay. Play Hole (2D)
remains available; it suspends the 3D playback/view while using the original layer.

3D eligibility remains development-only. The production visualization slot returns
its original 2D children; development preparation/asset GET and POST return 404
before importing the filesystem resolver. Hash-checked local reads are excluded
from production traces, and `next.config.ts` excludes `tmp/**/*`. No fixture/lab
routes or research geometry were added to `public/`. The local POST is a read-only
projection of the current application replay, not a public authenticated PGA
attestation API or a production asset-distribution service.

## Validated scope and local reproduction

Primary: FedEx St. Jude Championship, R2026027, TPC Southwind/course 513,
Scottie Scheffler/player 46046, R1/H1: four starts, two flights, two supplied putts.
Southwind/Henley provides independent spatial/research evidence, never Scheffler's
runtime stroke source. Secondary: Wyndham R2026013, Sedgefield/course 752,
Michael Brennan/player 61522, R1/H1; independently validated nonzero registration
and the same generic flight constraint. This does not certify other rounds,
players, courses or holes, or broaden the existing eligibility gate.

Prepared assets remain ignored local packages:
`tmp/shotcast-ingestion/packages/pga-71908773-fb52-47d0-bb1e-f44f50b34965` (Southwind)
and `.../pga-6dd7c507-1e90-4bbc-a90e-8cbff49b24b3` (Sedgefield). No assets were
duplicated or added to the commit. A fresh checkout without this retained local
preparation intentionally renders 2D. Full engineering tests require the preserved
packages, local parity evidence/historical SELECT snapshot and the read-only donor
captures; these requirements are documented in the historical reports.

Normal manual path: `npm run dev -- --port 3001` →
`/lineups/scores?sport=golf` → FedEx St. Jude → team containing Scottie → Scottie →
R1 → H1. Numbered controls replay immediately; check 1→2→3→4, re-click, Prev/Next,
rapid replacement, orbit/zoom/reset, Course/Green and reopen. Green retains relief,
sparse cyan flow and cup/flag. H2 remains 2D. No extra replay control is needed.

## Final validation and cleanup

Final checks on 2026-10-05:

- Focused ShotCast suite: **58/58 passed** (`node --test
  tests/shotcast-ingestion/*.test.mjs`).
- Browser regression: **16/16 scenarios passed**, including current Scores/Live
  integration, exact endpoints and invariant world anchors, all numbered control
  interactions, re-click/Prev/Next/rapid replacement, camera/reset/remount/reopen,
  Course/Green identity, Play Hole (2D), H2 and preparation/asset/WebGL failures.
  No unexpected page errors, overflow or historical database mutations occurred.
- Fresh Green visual inspection: **12/12 captures passed** for both Shots 3/4,
  default and lower angled views, at desktop 1400×900 and mobile 390×844/486×900.
  All twelve canvas captures were visually inspected. Relief, selected putt,
  sparse cyan flow and cup/flag retained the accepted hierarchy; the 28 displayed
  particle families and selected-putt emphasis were unchanged.
- TypeScript passed (`tsc --noEmit --incremental false`). Focused lint passed with
  zero errors and one existing provider `_cacheBust` warning. Full-file comparison
  of the older 2D/panel components found the same **4 errors/6 warnings** as HEAD,
  with **zero new diagnostics**; these pre-existing findings were not suppressed.
- `git diff --check` and `npm run build` passed. Inspection of **165 route traces /
  167 total traces** found no research asset files or fixture/research routes.
  Built preparation GET/POST and terrain asset GET each returned **404** in the
  local production server.
- All **48 previously accepted changed/new files** remained byte-identical
  throughout finalization. Only this completion document was added. Main's ref
  and the donor's HEAD, dirty status and complete diff hash remained unchanged.
  The full accumulated diff was reviewed: no unrelated changes, credentials,
  generated binaries or unintended package upgrades were found. Three.js and its
  type dependencies are the intentional package additions.
- Ordinary development was restored on **localhost:3001**, without the test
  boundary environment; the current Scores URL returned HTTP 200.

User authenticated manual acceptance is established above; automated browser
evidence uses current product components with preserved PGA transport and a local
historical SELECT boundary, not a replacement live login. Final evidence remains
ignored under `tmp/shotcast-take2/final-acceptance/`: test/build/lint logs,
`browser/results.json`, `green-visuals/results.json`, production trace/gate results
and preservation/review records. Representative local screenshots:

- [Desktop Shot 3, default](../../tmp/shotcast-take2/final-acceptance/green-visuals/after-desktop-shot3-default-canvas.png)
- [Desktop Shot 4, angled](../../tmp/shotcast-take2/final-acceptance/green-visuals/after-desktop-shot4-low-canvas.png)
- [390px Shot 3, angled](../../tmp/shotcast-take2/final-acceptance/green-visuals/after-mobile390-shot3-low-canvas.png)
- [486px Shot 4, default](../../tmp/shotcast-take2/final-acceptance/green-visuals/after-mobile486-shot4-default-canvas.png)

These ignored screenshots are local review evidence, not deployable assets or a
promise that a fresh checkout includes them. Historical reports document the
browser harness and retained local fixture prerequisites.

No obsolete runtime/debug debris required removal. The reports, raw public PGA
regression projections, reference geometry and engineering DOM diagnostics remain
because they document/prove the accepted implementation. Existing full-file lint
findings in the older 2D/panel components are outside this task; no accepted code
was refactored to suppress them. No golf data, geometry, camera, replay, flow or
presentation changes were made during finalization.

## Known limitations

- Prepared fixture coverage only; automated acquisition, generalized availability,
  historical backfill and production 3D distribution are not implemented.
- Flight eligibility is bounded to the validated polynomial/terrain branches.
  Flight reveal, terrain connector, cup interval and flow speed are presentation.
  PGA calls the supplied putt paths simulations, not measured physical ball tracks.
- Close authoritative lies can overlap in overview/default mobile framing,
  including the short final putt; existing navigator/zoom provide access without
  displacing markers. Symbols are intentionally scaled for readability.
- Automated mobile evidence uses Chromium/SwiftShader emulation, not a physical
  iPhone/Safari or hardware GPU performance certification.
- Full fixture/parity tests depend on retained ignored local research evidence;
  their successful local results do not imply a self-contained asset-enabled clone.

## Phase 4 Boundary

Phase 3 intentionally proves the experience on the validated fixtures. Phase 4
should investigate/generalize automated 3D availability across tournaments,
courses and holes. The existing tournament/event resolver should lead that future
decision, so users are not required to choose a separate “3D mode.” No Phase 4
automation, additional geometry or production activation is implemented here.

Questions for the next session:

1. How can geometry be discovered, obtained/generated, registered, validated,
   cached and served automatically?
2. Which PGA tournaments expose sufficient native coordinates and path data?
3. Can course assets be prepared ahead of upcoming tournaments, and historical
   tournaments backfilled?
4. How should missing/incomplete holes automatically retain 2D, and what explicit
   validation gate determines that a hole is safe to expose as 3D?
5. How should assets be stored/versioned without shipping research/dev assets?
6. Which Southwind-specific preparation choices can become data-driven without
   weakening the accepted coordinate/identity contracts?
7. Can available green geometry automatically produce validated topography?
8. What happens when PGA changes coordinate frames, tee/pin/course setup or payload
   shape, and how are stale preparation and unsupported profiles detected?
9. How does verified availability integrate with the current tournament/event
   resolver while preserving current Scores/Live interactions?

Recommended starting point: a read-only availability/provenance audit through the
existing event resolver, using the accepted fixture contracts as validation
criteria. Design an availability matrix and asset validation boundary before
proposing generalization or production distribution.

## Exact accepted file inventory

The following inventory includes runtime integration, dependency/configuration
changes, regression evidence and all Phase 1–3 reports. Existing upstream Scores,
Live, modal, scorecard and scoring files outside this list are unchanged by Take 2.

### Runtime and integration

- `app/api/golf/shotcast-3d-dev/route.ts`
- `components/lineups/GolfHoleMap2D.tsx`
- `components/lineups/GolfHoleReplayPanel.tsx`
- `components/lineups/GolfShotcast3D.tsx`
- `components/lineups/GolfShotcastVisualizationSlot.tsx`
- `lib/providers/pgaTourShots.ts`
- `lib/shotcast/developmentAssetResolver.server.ts`
- `lib/shotcast/fixturePlacement.ts`
- `lib/shotcast/flightReplay.ts`
- `lib/shotcast/greenFlow.ts`
- `lib/shotcast/greenFlowPresentation.ts`
- `lib/shotcast/greenTopography.ts`
- `lib/shotcast/holeWorld.ts`
- `lib/shotcast/ingestion/local.ts`
- `lib/shotcast/ingestion/package.ts`
- `lib/shotcast/ingestion/prepared.ts`
- `lib/shotcast/pgaFlight.ts`
- `lib/shotcast/productionGeometry.ts`
- `lib/shotcast/puttReplay.ts`
- `lib/shotcast/shotReplay.ts`
- `lib/shotcast/shotcast3dView.ts`
- `lib/shotcast/visualizationCapabilities.ts`
- `next.config.ts`
- `package-lock.json`
- `package.json`

### Tests and captured PGA regression inputs

- `tests/shotcast-ingestion/browser-acceptance.mjs`
- `tests/shotcast-ingestion/current-provider.mjs`
- `tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json`
- `tests/shotcast-ingestion/fixtures/scheffler-native-h1.json`
- `tests/shotcast-ingestion/fixtures/scheffler-r2026027-r1-h1.json`
- `tests/shotcast-ingestion/flight-replay.test.mjs`
- `tests/shotcast-ingestion/foundation.test.mjs`
- `tests/shotcast-ingestion/green-flow-presentation.test.mjs`
- `tests/shotcast-ingestion/green-replay.test.mjs`
- `tests/shotcast-ingestion/history-server.mjs`
- `tests/shotcast-ingestion/module-loader.mjs`
- `tests/shotcast-ingestion/visualization-capabilities.test.mjs`
- `tests/shotcast-ingestion/world-invariance.test.mjs`

### Reports

- `docs/shotcast-ingestion/ACTIVATION-INVESTIGATION.md`
- `docs/shotcast-ingestion/COURSE-PLAYER-SEPARATION.md`
- `docs/shotcast-ingestion/PHASE2-MARKER-SEMANTICS.md`
- `docs/shotcast-ingestion/PHASE2-WORLD-CORRECTNESS.md`
- `docs/shotcast-ingestion/PHASE3-ACCEPTED-BASELINE.md`
- `docs/shotcast-ingestion/PHASE3-DONOR-AUDIT.md`
- `docs/shotcast-ingestion/PHASE3-FLIGHT-FOUNDATION.md`
- `docs/shotcast-ingestion/PHASE3-GREEN-INTEGRATION.md`
- `docs/shotcast-ingestion/PHASE3-GREEN-VISUAL-POLISH.md`
- `docs/shotcast-ingestion/TAKE2-FOUNDATION.md`
- `docs/shotcast-ingestion/donor-reference/NONZERO-ROTATION.md`

Total: **49 files** in the accepted accumulated change, including this
completion document. Local geometry, screenshots, historical DB snapshots, logs,
`.env.local`, build outputs and browser tooling are ignored and excluded.
