# Flight investigation and endpoint-constrained foundation

## Investigation gate, before runtime edits

The fresh PGA ShotDetailsCompressedV3 response at 2026-10-05T13:45:43.618Z has the same Scheffler flight inputs as the preserved response. Shot 1 has one Broadcast Flight polynomial, populated normalized polynomial alternatives, and no ballPath. Shot 2 has one Incoming Flight polynomial, no normalized alternatives, and no ballPath. Shots 3/4 have respectively 46/14 source-timed simulation putt samples and no Flight polynomial. Normalized alternatives are coefficient models, not measured XYZ sample arrays. No better supplied flight polyline was found.

PGA 3.3.1 `Xs` evaluates ascending polynomial powers. `jm` samples from t=0 at 0.05 s increments. With angle θ from grounded tee to transformed native fairway center, its first XY is:

`P(0).xy = tee.xy + [zFit[0]*cosθ - xFit[0]*sinθ, zFit[0]*sinθ + xFit[0]*cosθ]`.

Its Z is `yFit(0) + shot.from.z - yFit[0] = shot.from.z`. PGA `Wu` distributes a start correction only for Incoming or tee-to-start distances >20 m. Broadcast tee shots keep their nonzero horizontal fit constants. The donor reproduces that branch accurately. This is the root cause; it is not a delayed first sample, ball radius, elevation, interpolation, registration, float32 error, normalized model or saved-player substitution.

Scheffler Shot 1: xFit[0]=-0.400574, zFit[0]=0.285831; θ=2.4185398647022396 rad. Rotating these constants gives delta **[+0.050737466500663686,+0.48947379861448326,0] m**, length 0.4920964235157554 m.

Sedgefield/Brennan Shot 1: xFit[0]=0.286642, zFit[0]=0.942592; θ=2.4770913818740334 rad. Delta **[-0.9187939989787424,+0.3556134166038305,0] m**. Same cause; nonzero course rotation is already correctly registered.

## Chosen representation and mathematical justification

Keep the source-derived path separate from its constrained presentation. For the airborne path at source coefficient time t∈[0,T], let A be authoritative shot.from, L the unchanged source-derived landing and P(t) the donor path. Define:

`Q(t) = P(t) + (A-P(0))*(1-t/T)`.

Equivalently, subtract P's linear start-to-landing chord to obtain its local shape residual and add the authoritative A-to-L chord at the same normalized time. This preserves that shape residual exactly; it is not an arbitrary visual curve. The correction is the unique affine-in-time field satisfying the two boundary displacements, and minimizes ∫|correction'(t)|²dt. Horizontal acceleration and higher time derivatives are unchanged; heights, apex height/time, contact time/location and the entire original terrain connector remain unchanged. Horizontal velocity receives a small constant adjustment; absolute lateral apex position is therefore intentionally slightly different. This is constrained PGA-derived presentation, not a claim of measured ball motion or unchanged PGA path parity.

Limit this adaptation to horizontal origin residuals; reject a meaningful vertical residual, an end mismatch, off-terrain intermediate positions, newly underground airborne segments or an origin correction >1% of flight XY span. That 1% is a conservative capability cutoff, not an inferred measurement accuracy. Zero-gap Incoming paths retain their source points. Unsupported branches remain static 3D/2D playback.

Scheffler's displacement is 0.1963% of the shot's horizontal chord. At T=7.7054687500000005 s, velocity adjustment is [-0.006584604797815017,-0.06352291009089917,0] m/s. Sedgefield uses T=6.9781249999999995 s; displacement is 0.3874% of chord. Its velocity adjustment is [+0.13166774727863753,-0.05096117031492421,0] m/s. All sampled airborne points remain above unchanged terrain in both cases. No course-specific correction is needed.

This establishes a narrow implementation gate: the same generic transformation preserves the meaningful polynomial shape and all anchor/world invariants in both researched contexts. Implementation may proceed for non-putt paths only. No putt animation, green/flow/flag/camera changes belong in this pass.

Original donor audit remains a record of the earlier stop. This pass resolves that specific gate without expanding into the rest of Phase 3.

## Exact numeric comparisons

Native coordinates are feet. Resolved/source/adapted world coordinates are metres, XY-horizontal/Z-up. Deltas use sample minus authoritative anchor. Endpoint copies are exact binary64 values; table digits are unrounded JSON values from the calculation.

| Scheffler Shot 1 point | X | Y | Z |
| --- | --- | --- | --- |
| Raw PGA from, native ft | 10119.337 | 11413.122 | 349.056 |
| Raw PGA to, native ft | 9527.396 | 10842.169 | 349.245 |
| Take 2 from, m | -115.68310546875 | 378.721435546875 | 10.874481308178765 |
| Take 2 endpoint, m | -296.1064453125 | 204.69482421875 | 10.945296698560316 |
| Donor first, m | -115.63236800224934 | 379.2109093454895 | 10.874481308178765 |
| Donor last, m | -296.1064453125 | 204.69482421875 | 10.945296698560316 |
| Donor first delta, m | 0.050737466500663686 | 0.48947379861448326 | 0 |
| Donor last delta, m | 0 | 0 | 0 |
| Adapted first, m | -115.68310546875 | 378.721435546875 | 10.874481308178765 |
| Adapted last, m | -296.1064453125 | 204.69482421875 | 10.945296698560316 |
| Adapted first delta, m | 0 | 0 | 0 |
| Adapted last delta, m | 0 | 0 | 0 |

| Sedgefield Brennan Shot 1 point | X | Y | Z |
| --- | --- | --- | --- |
| Raw PGA from, native ft | 9875.441 | 10414.859 | 835.63 |
| Raw PGA to, native ft | 9321.095 | 9791.156 | 831.032 |
| Take 2 from, m | -314.09130859375 | 392.534423828125 | 6.314507678962158 |
| Take 2 endpoint, m | -479.982666015625 | 199.74169921875 | 4.927202630385926 |
| Donor first, m | -315.01010259272874 | 392.89003724472883 | 6.314507678962158 |
| Donor last, m | -479.982666015625 | 199.74169921875 | 4.927202630385926 |
| Donor first delta, m | -0.9187939989787424 | 0.3556134166038305 | 0 |
| Donor last delta, m | 0 | 0 | 0 |
| Adapted first, m | -314.09130859375 | 392.534423828125 | 6.314507678962158 |
| Adapted last, m | -479.982666015625 | 199.74169921875 | 4.927202630385926 |
| Adapted first/last deltas, m | 0 | 0 | 0 |

Sedgefield origin gap is 0.9852123195677156 m. Scheffler Shot 2 has zero donor/adapted start and endpoint deltas. Its from is `[-296.1064453125,204.69482421875,10.945296698560316]`, endpoint `[-304.60595703125,66.57177734375,10.939206175918256]`. Its Incoming source correction is retained; no additional origin correction is applied.

Shape effects are explicitly bounded and disclosed:

| Shot | Source/adapted sampled apex Z, m | Coefficient apex time, s | Apex XY displacement, m | Initial tangent change |
| --- | --- | --- | --- | --- |
| Scheffler 1 | 51.55909249568556, unchanged | 4.049999999999994, unchanged | 0.2334501840849768 | 0.023455126911212456° |
| Scheffler 2 | 42.96692572001198, unchanged | 3.149999999999997, unchanged | 0 | 0° (identical points) |
| Brennan 1 | 33.643157484870365, unchanged | 3.7499999999999947, unchanged | 0.45576548415291096 | 0.10190889679973048° |

This preserves coefficient-time shape residuals and acceleration, not identical absolute XY, measured launch velocity, or mathematically identical spatial curvature. The connector is PGA's geometric terrain-to-endpoint connector, not measured rollout or bounce. No physics was invented from spin/speed statistics.

Full machine-readable rows: `tmp/shotcast-phase3-flight/numeric-comparison.json`. Fresh raw/normalized responses: `current-raw.json`, `current-replay.json`, `enriched-replay.json` in the same ignored directory. Regression projection of the fresh H1 source: `tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json`. No prepared mesh/image/config asset was copied or changed.

## Source audit by shot

| Shot | Authoritative native from → to | Supplied flight/path data | Supplied statistics versus derived rendering |
| --- | --- | --- | --- |
| 1 | (10119.337,11413.122,349.056) → (9527.396,10842.169,349.245) | One Broadcast Flight row, 7 XYZ coefficients each, interval [0,7.705], measured interval [0.023,7.559], valid interval [0,9.001]; spin-rate coefficients; normalized/V2 alternate fits populated; **no ballPath** | Source apexHeight 133.5 ft, ballSpeed 178.67 mph, launchSpin 4003.35, spinAxis 16.16, actualFlightTime 8. These metadata do not determine animation duration. Terrain contact, connector, source path evaluation and constraint are derived |
| 2 | (9527.396,10842.169,349.245) → (9499.511,10389.01,349.217) | One Incoming Flight row, 7 XYZ coefficients each, interval [0,6.346], measured [-0.012,6.307], valid [0,7.837]; spin-rate coefficients; normalized arrays empty; **no ballPath** | Source apexHeight 105.05 ft, ballSpeed 118.2 mph, launchSpin literal 0, spinAxis -17.31, actualFlightTime 6. No invented bounce/roll/velocity samples |
| 3 | (9499.511,10389.01,349.217) → (9458.493,10398.129,349.47) | **46 PGA simulation samples**, irregular timestamps 0–7.6000000000000005 s, no Flight row | Supplied reconstructed putt polyline, not measured physical ball tracking. Left untouched; no 3D putt animation in this pass |
| 4 | (9458.493,10398.129,349.47) → (9463.49,10395.55,349.42) | **14 PGA simulation samples**, irregular timestamps 0–3.1500000000000004 s, no Flight row | Same distinction; source final sample has the previously documented millimetre cup residual. No alteration/3D putt implementation |

The exact radar-fitting method/measurement accuracy is not established by this payload. It supplies radar-derived polynomial models and measurement-domain metadata, not an array of measured flight positions. The donor research is deterministic reconstruction using these supplied coefficients and the preserved PGA engine algorithms; it is not a generic inferred parabola. The new constraint is an explicit presentation adaptation of that reconstruction.

Root-cause alternatives eliminated numerically: coefficient sample 0 is t=0; pre-display Z delta is zero; the tee and current start are identical for each Broadcast shot; both use the same validated float32 native conversion and terrain registration; source first XY equals the rotated constant coefficients to 1e-12 m; neither reconstruction reads normalized alternatives; the generic helper has no player/event registry. The independently observed Sedgefield path confirms the donor's branch behavior rather than a transform error. The raw measured interval beginning at 0.023 s for Scheffler does not change the model's stated zero-origin evaluation interval.

## Implementation boundary and files

Current selected golfer response → unchanged static `currentPlayerHole` → separate optional flightData (current native fairway center + eligible source fit) → existing independent course/asset verification → unchanged frozen `HoleWorld` plus independently frozen constrained paths → current 3D renderer with a dedicated replay glyph/line.

`buildHoleWorld`, `productionGeometry`, registration, all scene marker/pin anchors and prepared assets are unchanged. Paths receive no camera, selection, viewport or marker coordinates as fitting inputs. The existing three-dimensional scene stays mounted through selection, Course/Green and replay. Selection emphasizes the marker/path and does not show/move a replay glyph. Explicit Replay starts it; Reset, shot switching, context refresh and 2D playback cancel it. Visibility suspension clears the clock without hidden-tab catch-up. RAF runs for active replay and existing camera damping, not a permanent idle playback loop.

Files changed/added in this pass (distinct from preexisting Phase 2 changes):

- `lib/shotcast/pgaFlight.ts` — migrated donor `evaluateRadarFit` and generic evaluator, with bounded supported inputs. No saved-player registry or research JSON imported.
- `lib/shotcast/flightReplay.ts` — chord-residual constraint, immutable path, distance-based reveal, isolated selection/play/reset lifecycle.
- `lib/providers/pgaTourShots.ts` — additive preservation of current native fairway center and explicit single-Flight/no-impactTime eligibility. Existing coordinates, coefficients and 2D behavior unchanged.
- `lib/shotcast/shotcast3dView.ts` — separate flight preparation input and strict path handoff validation against authoritative start/end.
- `lib/shotcast/developmentAssetResolver.server.ts` — reconstruct supported selected-player fits using verified course assets; retain static world when a fit fails.
- `components/lineups/GolfShotcastVisualizationSlot.tsx` — bind refreshed flight inputs to preparation; freeze paths after JSON handoff; keep existing development/production/error gating.
- `components/lineups/GolfShotcast3D.tsx` — isolated replay glyph/line and compact explicit Replay control within current Hole Replay; no camera/green/flag redesign.
- `tests/shotcast-ingestion/flight-replay.test.mjs` — numeric source/shape/anchor/immutability/lifecycle/capability/production tests.
- `tests/shotcast-ingestion/fixtures/scheffler-flight-h1.json` — H1 projection of freshly fetched real PGA source for regression; no assets or saved-player runtime dependency.
- `tests/shotcast-ingestion/browser-acceptance.mjs` — opt-in flight tests through current components (`SHOTCAST_TEST_FLIGHTS=1`); existing fallbacks/navigation tests retained.
- This report.

No edits in this pass to `GolfHoleMap2D.tsx`, `GolfHoleReplayPanel.tsx`, scores/navigation/scoring, or donor files. Their preexisting Phase 2 modifications remain.

## Verification and limits

- **46/46 Node tests pass**: existing foundation/capability/world suites plus 14 new flight tests. Tests prove exact CPU boundaries, independent unconstrained donor/PGA capture parity, unchanged chord residuals/Z/contact/connector, frozen model and terrain/config preservation, sample precedence, invalid-source rejection, repeated replay/reset, safe switches and hidden-tab resume.
- **16/16 engineering browser scenarios pass**, including four flight scenarios (Scheffler and Brennan, desktop 1400×900/mobile 390×844). Each supported flight completes twice; the first rendered replay frame is exactly at its scene from-anchor and the last is exactly at its to-anchor. Every observed frame retains all marker/pin world anchors; replay coordinates equal camera-independent path traversal within 1e-8 m. Orbit/zoom during playback preserves path data. Selection stops the old replay; supplied putts get no new control. Existing tests verify Course/Green same-scene identity, remount, ordinary 2D playback, unsupported H2, preparation failure, terrain failure, unavailable WebGL and context loss. No normal page/console errors or horizontal overflow.
- Browser validation uses captured real PGA transport plus a local historical SELECT boundary through **current Scores/Live components**; it is not authenticated user manual acceptance. Software SwiftShader/mobile emulation does not establish physical iPhone/Safari performance. No production database writes are involved; the local boundary permits only simulated session updates. Historical server/test Dev are stopped.
- Logical path endpoints and replay glyph positions are exact binary64 copies. Interior/chord calculations use **1e-8 m CPU tolerance**. Render line vertices use Float32, checked with **5e-5 m display-buffer tolerance**; GPU projection necessarily adds ordinary Float32 rendering precision. No geographic anchor is rounded to satisfy a display test.
- Whole-project TypeScript: **pass**. Focused ESLint: **0 errors**, one preexisting `_cacheBust` unused-variable warning in the provider (confirmed in HEAD). `git diff --check` and explicit whitespace checks for new files: **pass**.
- `npm run build`: **pass** (existing edge-runtime/static-generation notice). Actual built production preparation GET/POST and terrain-asset GET: **404**. **165 production route traces contain zero research/test assets**; no donor fixture/lab/tourcast routes in the built route manifest. Existing production visualization gating remains 2D.
- Ordinary `.env.local` development is left running on **http://localhost:3001**; this is the established ordinary Take 2 port, distinct from the historical test port 3002. Preparation was checked on this ordinary server with the current real Scheffler inputs: exactly two eligible paths (Shots 1/2), exact starts/ends.

Evidence: `tmp/shotcast-phase3-flight/focused-tests.log`, `typescript.log`, `lint.log`, `build.log`, `browser/results.json` and screenshots/world captures, `production-gate.json`, `production-traces.json`, `normal-development-handoff.json`, plus raw response/numeric comparison files noted above. The initial browser launch needed existing extracted libraries via `LD_LIBRARY_PATH=/tmp/111-browser-libs/root/usr/lib/x86_64-linux-gnu`; no installs or donor edits were needed. A TypeScript tuple annotation was corrected before the successful final check/build.

Eligibility remains narrow: single Flight, Broadcast/Incoming, zero-origin, no impactTime, supported finite coefficient/terrain branches, small horizontal correction. Unsupported fits retain static registered 3D and existing 2D playback; unsupported courses/holes and asset/WebGL failures retain 2D. No claim of physical timing, sampled flight motion, measured carry/roll or universal PGA branch coverage. The three-second arc-length reveal is labeled **PGA-derived path · 3 s presentation**. Geometric contact/connector have source provenance but no observed rollout timing. Green/flow/putt/flag/camera refinement remains outside this pass.

## Exact manual acceptance

1. Open **http://localhost:3001/lineups/scores?sport=golf** using your ordinary login.
2. Select **FedEx St. Jude Championship → Scheffler's fantasy team → Scottie Scheffler → R1 → H1**. Expand ShotCast if needed; keep **Course** selected for full-flight context.
3. Select **Shot 1** in the existing navigator. Selection highlights marker 1 and the path; it must not begin playback. The compact **Replay shot 1 (3D)** control sits below the 3D heading, away from the initial tee marker.
4. Press **Replay shot 1 (3D)**. The white replay glyph begins at marker 1 and finishes at marker 2. Orbit/zoom while it moves: all numbered markers and pin remain at their registered positions.
5. Press **Reset**, reselect Shot 1 if needed and replay twice. Press Replay again during playback to restart from the same authoritative start.
6. Select **Shot 2**, then **Replay shot 2 (3D)**: marker 2 → marker 3. Switch shots during playback; the old replay must stop and selection alone must leave the glyph hidden.
7. Select Shots **3/4**: no new 3D putt replay button. Existing **Play Hole (2D)** remains available. Course/Green switches retain the same world; no new green topography/flow/flag presentation was added.
8. Close/reopen H1 and repeat at mobile width. Open **H2** and confirm the existing 2D experience. Optionally repeat **Wyndham / Michael Brennan / R1 / H1 / Shot 1** on Sedgefield to validate the same adaptation on the nonzero-rotation course.

## Change control / exact final status

All work remains uncommitted. Nothing committed, pushed, merged, rebased or deployed; main and the read-only donor were not modified. Existing Phase 2 changes and prepared assets remain preserved.

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
?? lib/shotcast/holeWorld.ts
?? lib/shotcast/ingestion/
?? lib/shotcast/pgaFlight.ts
?? lib/shotcast/productionGeometry.ts
?? lib/shotcast/shotcast3dView.ts
?? lib/shotcast/visualizationCapabilities.ts
?? tests/shotcast-ingestion/
```
