# Phase 3 green visual polish

Presentation-only pass after authenticated manual acceptance of the Phase 3 world,
flight, putt, green relief, flag/cup and interaction. Worktree/branch:
`nba-fantasy-app-3d-take2` / `shotcast-3d-take2`. All existing work remains uncommitted.

## Parameters changed

| Presentation | Before | After |
|---|---|---|
| Simulated particle heads | 64 | 64, unchanged |
| Render-eligible heads | 64 | 28 (43.75% retained, 56.25% reduction) |
| Head + two trail glyph capacity | 192 | 84 |
| Head / trail diameter in CSS pixels | 7.5 / 2.8 | 5.0 / 1.9 |
| Steady head alpha before lifecycle fade | 1.0 | 0.30 background → up to 0.58 near putt, then protective fades |
| Cyan shader RGB | (0.20, 0.78, 0.95), dark outlined heads | (0.18, 0.64, 0.76), no dark outline |
| Circular edge feather | radius 0.43→0.50 | radius 0.30→0.50 |
| Green explanatory legend | Elevation/dots text | Removed |

Retain family i iff `floor((i+1)*0.45) > floor(i*0.45)`. This evenly selects every
second/third original particle family, with its existing two trails. Selection is
fixed by index, independent of rerender, camera, selected stroke and random state.
Source simulation density, seed bank, positions, weights, slopes, speeds, clocks,
lifetimes and respawn rules are untouched. Lifecycle and protective fades mean
actual visible head counts vary below the 28-head capacity; no hidden heads are
reseeded or moved. Rendering uses a separate `displayAlpha` buffer.

## Selected-putt emphasis and visual protection

Use the current selected putt's registered PGA sample positions and its existing
authoritative endpoint. Distance d is the minimum XY point-to-segment distance to
that supplied polyline. No curve, new PGA sample, physics or geometry is generated.

`alpha(d) = 0.30 + (0.58 - 0.30) * exp(-0.5 * (d / 2.25m)^2)`

A broad Gaussian falloff gently emphasizes relevant slopes without a corridor
boundary or stripe. Far-field indicators remain visible. A narrow smoothstep
centreline fade (0.18→0.45m) keeps the actual white tracer clear. Additional smooth
projected opacity masks protect selected start/destination markers (14px), cup/pin
(18px), and current ball (10px); each mask feathers over another 6px. These masks
change alpha only, never screen/world positions. Current camera matrices are
updated before mask projection, so orbit/zoom do not leave stale opacity masks.
The existing foreground render order for tracer, ball, flag/cup and HTML markers
is preserved. Selecting 3/4 switches which original polyline supplies proximity.
Manual Green with a non-putt selected uses uniformly subdued background indicators.

## Accepted behavior deliberately preserved

- All PGA coordinates, all 46/14 supplied putt samples and times, source provenance,
  endpoint constraints, tiny cup connector, ball/replay timing and flight math.
- Authored green/terrain buffers, native course registration, hole world, marker
  semantics, pin anchor, elevation colours, normals, lighting and vertical scale.
- Exact triangle elevation/gradient/downhill calculations and flow advection.
- Accepted white putt path (existing opacity 0.9) and ball tracker (11px). Reducing
  dot competition was sufficient; no path thickening or tracker redesign.
- Course View, selection/replay/controller semantics, existing numbered controls,
  Previous/Next, re-click, replacement, Course/Green, orbit/zoom, reset and reopen.
- Existing 2D playback, H2/failure fallbacks and development/production gates.

## Visual validation

Captured and inspected BEFORE and AFTER Shots 3/4, default/top-down-ish and lower
angled views, at desktop 1400×900, mobile 390×844 and mobile 486×900: 12 matched view
pairs, each with full current Scores modal and cropped viewport screenshots.
Browser-only RAF holding captures a live replay frame for inspection; no capture
control or fixture route is present in the product.

Before: bright outlined dots crowded the putt corridor and drew attention away
from the shot, particularly at mobile width. After: white ball/tracer, selected
start and flag/cup read first; green colour/physical relief second; muted smaller
cyan motion third. Indicators remain visible on both light/dark green areas and
at mobile widths. Emphasis is gradual; no visible corridor stripe or hard edge.
Existing short-putt marker/cup proximity remains authoritative; zoom still works.
No material, lighting, geometry, sample or replay adjustments were needed.

Examples (ignored engineering artifacts, not application routes/assets):

- Desktop Shot 3 default: [before](../../tmp/shotcast-take2/green-polish/before/before-desktop-shot3-default-canvas.png) / [after](../../tmp/shotcast-take2/green-polish/after/after-desktop-shot3-default-canvas.png).
- Desktop Shot 4 angle: [before](../../tmp/shotcast-take2/green-polish/before/before-desktop-shot4-low-canvas.png) / [after](../../tmp/shotcast-take2/green-polish/after/after-desktop-shot4-low-canvas.png).
- Mobile 390 Shot 3 angle: [before](../../tmp/shotcast-take2/green-polish/before/before-mobile390-shot3-low-canvas.png) / [after](../../tmp/shotcast-take2/green-polish/after/after-mobile390-shot3-low-canvas.png).
- Mobile 390 Shot 4 default: [before](../../tmp/shotcast-take2/green-polish/before/before-mobile390-shot4-default-canvas.png) / [after](../../tmp/shotcast-take2/green-polish/after/after-mobile390-shot4-default-canvas.png).
- Mobile 486 Shot 4 angle: [before](../../tmp/shotcast-take2/green-polish/before/before-mobile486-shot4-low-canvas.png) / [after](../../tmp/shotcast-take2/green-polish/after/after-mobile486-shot4-low-canvas.png).

All captures/JSON are in `tmp/shotcast-take2/green-polish/{before,after}/`.
This uses the existing current-product engineering harness with preserved transport
fixtures; the user's authenticated manual acceptance remains separate.

## Exact files changed in this pass

1. `components/lineups/GolfShotcast3D.tsx`: flow-only display buffer/shader, selected
   putt proximity and projected glyph fades, legend removal.
2. `lib/shotcast/greenFlowPresentation.ts`: pure deterministic presentation helpers.
3. `tests/shotcast-ingestion/green-flow-presentation.test.mjs`: density, continuity,
   read-only proximity/masking, deterministic selection and unchanged-source checks.
4. `tests/shotcast-ingestion/browser-acceptance.mjs`: optional before/after capture
   scenarios and selected-putt display assertions in existing regression scenarios.
5. `docs/shotcast-ingestion/PHASE3-GREEN-VISUAL-POLISH.md`: this report.

## Checks and final status

- Focused ShotCast suites: **58/58 pass** (foundation, capabilities, world invariance,
  flight replay, green replay and the five new presentation tests).
- Browser: **16/16 regression scenarios pass**, plus **12 before + 12 after visual
  captures**. Includes navigator/marker replay, re-click, replacement, Previous/Next,
  Course/Green, orbit, zoom, reset, reopen, H2, Play Hole (2D), unsupported identity,
  asset/preparation failure, unavailable WebGL and lost WebGL context. No overflow,
  unexpected page errors or database-boundary mutations.
- All 12 before/after captures have exactly equal world anchors and original putt
  sample arrays. Default camera poses agree within 1e-9. Lower views use the same
  OrbitControls drag recipe; capture-time damping can produce slightly different
  poses. Reconstructed display opacity agrees within **2.95e-8** in every capture.
  Captured visible heads: 24–28 after lifecycle/protective fades.
- **20 protected source/data/asset SHA-256 hashes unchanged**, including the actual
  authored Southwind green and terrain bytes. Focused tests also pin core accepted
  math/data hashes without depending on the generated comparison manifest.
- `tsc --noEmit --incremental false`: pass. Focused ESLint: pass.
- `git diff --check`: pass. `npm run build`: pass.
- Production: **165 route traces / 167 total traces**, zero research/test/local
  assets and zero fixture/lab/research routes. Built preparation GET, POST and asset
  GET all return **404**. Existing production visualization eligibility stays 2D.
- Test Dev3002, history54329 and local production3003 stopped. Ordinary
  `npm run dev -- --port 3001` runs with `.env.local`, without mock overrides.

Evidence: `tmp/shotcast-take2/green-polish/` contains focused-test, TypeScript,
lint/build logs, `regression/results.json`, visual captures, `capture-checks.json`,
protected hashes, production guards and normal-development handoff. Browser
validation uses the existing current-product harness and captured PGA transport,
with desktop/mobile Chromium software WebGL; physical-phone/authenticated user
visual acceptance remains a separate manual retest. The existing very short Shot 4
can still overlap its selected marker at default mobile zoom; dots do not obscure
it, and the existing zoom/angled view is available. No marker/camera/data changes
were introduced to alter that accepted proximity.

## Manual retest

Normal development will be left on localhost:3001. Open
`/lineups/scores?sport=golf` → FedEx St. Jude Championship → Scheffler's team →
Scottie → R1 → H1. Tap 3, inspect default Green and replay; orbit lower, zoom and
re-click 3. Tap 4 and verify the subtle emphasis follows that putt/cup instead.
Repeat at 390–486px width. Confirm dots remain legible across the green while
putt/ball/markers/cup are visually dominant and the legend is absent. Test marker
clicks, Previous/Next, rapid switching, Course/Green, reset and reopen. Open H2 for
2D fallback; Play Hole (2D) remains available. No separate replay control is added.

## Uncommitted worktree status

Full status includes preserved Phase 2/earlier Phase 3 work as well as this pass:

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
?? lib/shotcast/greenFlowPresentation.ts
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

Nothing was committed, pushed, merged or deployed. Main and the read-only donor
worktree were not modified. No assets were duplicated or production gates expanded.
