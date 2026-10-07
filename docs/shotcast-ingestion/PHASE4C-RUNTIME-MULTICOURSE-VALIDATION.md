# Phase 4C — Independent runtime validation and multi-course generalization

Date: **2026-10-07**. Scope: bounded research/development proof; no production activation.

Evidence labels: **VERIFIED** = observed code/data or executed computation; **STRONGLY SUPPORTED** = multiple independent observations with stated limits; **INFERRED** = proposed design; **UNKNOWN** = not established.

## 1. Executive result — PASS

**PASS for the stated bounded architecture gate using PGA's observable published registration/grounding functions.** Fresh Sony and AT&T data were prepared through generic code. The same registration engine places Waialae, Spyglass and Pebble correctly, and the accepted Southwind regressions remain unchanged.

**Public PGA page capture: PARTIAL.** Chromium received HTTP **403** from the official TOURCAST URL and loaded no engine. The independent oracle therefore executes the actual current PGA webpack coordinate functions and original PGA 3.3.1 surface-query functions in a controlled browser. It does not use our registration/grounding code or donor algorithms. It is not a live public-page scene/CDP capture.

**VERIFIED maximum 3D errors**, using the unchanged **1e-8 m** CPU gate:

| Context | Maximum residual |
|---|---:|
| Waialae / Gotterup R1 H10 | 9.272582701669307e-13 m |
| Spyglass / Morikawa R1 H1 | 1.5631940186722204e-12 m |
| Pebble / Morikawa R2 H1 | 3.7765346405649325e-12 m |

XY is exact. These residuals are insignificant binary64 ray/plane arithmetic differences, not transform fitting. Provider strict queries with nudging/nearest fallback disabled reproduce the provider's normal-mode results for all **31 diagnostic anchors** in both coarse and detailed modes.

**VERIFIED:** fresh tee times map Morikawa 50525 R1 to Spyglass **205**, and R2–R4 to Pebble **005**. His finalized leaderboard course is 005; that field cannot resolve R1. Both new course packages were freshly acquired and prepared without donor assets or manually supplied transforms.

Checks: **88/88 focused tests**, **31/31 browser scenarios** (original Phase 3 16 + Waialae 5 + Spyglass 5 + Pebble 5), TypeScript, lint, build and diff checks pass. **168 production traces** have no research files. All **seven** built production route checks return 404. Production remains 2D.

## 2. Starting repository, branch, HEAD and working tree

- Worktree: `/home/markwohlever/nba-fantasy-app-3d-take2`.
- Branch: `shotcast-3d-take2`.
- HEAD: `c0977b3e1a4c79dc82465d1f0aa0595d5e1802dd`.
- Starting tree intentionally contained Phase 4A/4B work: one tracked modification to `lib/shotcast/ingestion/prepared.ts`, plus the proof page/client, preparation modules/scripts/tests, fixture and both reports.
- Initial snapshot: **961 files**, including the prior prepared packages and Phase 4B replay/numeric/browser artifacts. Stored in ignored `tmp/shotcast-phase4c/baseline-files.json`.
- Separate main started at **375c456a0a743bc330bc93f23c146867bc3acc66**, clean. Donor started at **29307237d8b731921aa441a94af53384e9ab95b1**, with its established dirty tree.

**VERIFIED:** all prior reports and all inventoried prior prepared/replay/browser artifacts remain byte-identical. Six Phase 4B source/test files were extended; none was discarded. No Phase 3 file changed from the starting Phase 4B tree, including the already modified shared reader.

Reviewed Phase 4A/4B reports, accepted Phase 3 baseline, coordinate/world/marker and donor multi-course/runtime research. Installed Next 16.2.4 page/searchParams and client-boundary documentation was read before extending the guarded page.

## 3. Waialae independent runtime-validation method

### Direct public page attempt

**VERIFIED:** on 2026-10-07 Chromium visited:

`https://tourcast.pgatour.com/tourcast.html?id=R2026006#/hole-view?pid=59095&round=1&hole=10&gv=true`.

CloudFront returned 403; `window.golfEngine` was absent. The existing donor console methods require a loaded engine/paused caller frame and cannot run on that response. No authentication, CAPTCHA, proxy or access-control workaround was attempted. The result/body summary is preserved in `tmp/shotcast-phase4c/runtime-page-probe.json`.

Ordinary public HTTPS acquisition still retrieved bootstrap, JavaScript, provider APIs and selected assets. This made a fresh directly consumed code-path oracle feasible.

### Independent oracle

**VERIFIED execution**, implemented in `scripts/pga-runtime-oracle.mjs`:

1. Read freshly acquired provider input bodies; verify their recorded SHA-256 hashes.
2. Register the original published webpack modules in a controlled Chromium page. Execute module **27308**'s `getTourcastOffset` and its existing private coordinate converter, with the actual **19811 / 54318 / 83000** quaternion/vector dependencies.
3. A single export hook exposes the existing private converter; its function body is unchanged. Missing unrelated dependencies are inert stubs for code not called by these functions; math dependencies execute actual provider modules.
4. Execute the complete original PGA engine 3.3.1 bundle with a single read hook exposing its existing `b` Vector3, `iE` terrain grid, `sE` green grid, `rE` query state and `Ia` grounding functions. No transform, triangle-intersection or height algorithm is rewritten.
5. An independent GLB accessor adapter reads original untransformed POSITION/index buffers and builds the SDK's point/index inputs. It does not use our GLB decoder, our geometry/registration modules or donor placement code.
6. Supply raw native coordinates, published offsetConfig and selected course identity. Run the provider's normal coarse/detailed query path.
7. Separately run its available strict diagnostic flags, disabling XY nudging and nearest fallback; compare results.
8. Write exclusive, immutable oracle outputs before using them as preparation acceptance references.

**Boundary:** this executes real published runtime functions with controlled query state and an accessor adapter; it does not initialize the full PGA graphics scene or run its GLTF loader/page lifecycle. Actual live-page marker state, hidden feature paths and hardware rendering remain **UNKNOWN**. Source inspection of the classic call chain and all inspected GLB identity transforms **STRONGLY SUPPORT** equivalence of this placement path for the proven assets.

No predicted world coordinate is an input to the oracle. No donor code supplies its results. Our code is used only afterward to compute comparison residuals.

Artifacts: `provider-runtime-oracle.json`, `provider-runtime-oracle-strict.json`, `initial-runtime-comparison.json`, and `strict-check.json` under `tmp/shotcast-phase4c/`. The new committed fixture preserves numeric results/provenance, not provider bundles/meshes.

## 4. Waialae runtime-parity results

**VERIFIED:** event R2026006; course 006; Gotterup 59095; R1 H10. Fresh source configuration still publishes x=3225.238265, y=3122.877394, z=0, rotate=0.424586°.

The provider executes a Float32 quaternion **[0,0,0.0037052033003419638,0.9999931454658508]** and Float32 translation **[3225.23828125,3122.87744140625,0]**. Our unchanged converter produces the same registered triples.

| Anchor | Raw PGA XYZ, ft | Our world XYZ, m | PGA function result XYZ, m | 3D error, m |
| --- | --- | --- | --- | --- |
| tee-from | [10137.592,9821.615,9.941] | [-157.569091796875,-106.43359375,-19.777041853871197] | [-157.569091796875,-106.43359375,-19.777041853871197] | 0 |
| pin | [11050.44,10259.26,11.84] | [119.671142578125,29.0185546875,-19.235471572331665] | [119.671142578125,29.0185546875,-19.235471572332244] | 5.790923296444817e-13 |
| from-1 | [10137.592,9821.615,9.941] | [-157.569091796875,-106.43359375,-19.777041853871197] | [-157.569091796875,-106.43359375,-19.777041853871197] | 0 |
| to-1 | [10930.474,10252.798,7.213] | [83.120849609375,26.77783203125,-20.57729180450313] | [83.120849609375,26.77783203125,-20.577291804504057] | 9.272582701669307e-13 |
| from-2 | [10930.474,10252.798,7.213] | [83.120849609375,26.77783203125,-20.57729180450313] | [83.120849609375,26.77783203125,-20.577291804504057] | 9.272582701669307e-13 |
| to-2 | [11037.69,10254.604,11.77] | [115.795654296875,27.570556640625,-19.252282164396593] | [115.795654296875,27.570556640625,-19.252282164396092] | 5.009326287108706e-13 |
| from-3 | [11037.69,10254.604,11.77] | [115.795654296875,27.570556640625,-19.252282164396593] | [115.795654296875,27.570556640625,-19.252282164396092] | 5.009326287108706e-13 |
| to-3 | [11050.44,10259.26,11.84] | [119.671142578125,29.0185546875,-19.235471572331665] | [119.671142578125,29.0185546875,-19.235471572332244] | 5.790923296444817e-13 |

**VERIFIED:** first start, all subsequent starts/endpoints and pin agree within 1e-8 m. Detailed pin/putt-region anchors are marked on-green by PGA's query; all points also have valid containing surfaces. Coarse/detailed queries both pass independently.

The round's rounded published tee produces a different point from exact Shot 1.from: PGA-function world **[-157.569580078125,-106.43505859375,-19.77703505870886]** versus exact-start world **[-157.569091796875,-106.43359375,-19.777041853871197]**. This roughly 1.54 mm horizontal difference is a **source-field difference**, not float noise or registration error. Accepted exact Shot 1.from semantics remain frozen.

The new source revision was validated in a separate candidate, **without publishing a duplicate Waialae package**. Default Waialae still uses the original Phase 4B preparation and replay; its independent current-engine comparison corroborates the original world.

## 5. Registration engine-profile findings

| Question | Finding / confidence |
|---|---|
| Units/scale | **VERIFIED** actual converter scales by 0.3048 into Float32 arrays |
| Axes | **VERIFIED** XY registration and authored Z grounding; provider scene source uses right-handed/Z-up camera conventions |
| Rotation | **VERIFIED** degrees, positive Z quaternion, native-origin rotation before offset subtraction |
| Offset | **VERIFIED** complete selected x/y/z/rotate replacement for a course override; not additive |
| Elevation | **VERIFIED** app's endpoint engine inputs flatten Z; engine grounds against authored surfaces. Converted native altitude is not displayed terrain-relative Z |
| Green frame | **VERIFIED** untransformed sampled buffers/query coordinates share course XY; **STRONGLY SUPPORTED** full loader/world-frame equivalence from scene/loader source and identity nodes |
| Grounding | **VERIFIED** original SDK green-first/terrain query matches our containing-triangle result at tested points |
| Off-surface behavior | **VERIFIED source difference** PGA can nudge/recover or use nearby terrain; our accepted architecture rejects ungroundable inputs. Strict provider results show no recovery is needed here |
| Global geography/survey datum | **UNKNOWN**; no geographic CRS or survey-accuracy claim |
| One engine across courses | **STRONGLY SUPPORTED**, with measured independent parity and unchanged Southwind regressions |

A real profile drift occurred: current application is

[page-9b53da48a23ead21.js](https://tourcast.pgatour.com/_next/static/chunks/app/%5Bproduct%5D/page-9b53da48a23ead21.js),

SHA-256 **09870190bcc511bcd988a7bee22edd9758a0640fa52019bb2e0d00f388232811**. The initial Phase 4B gate correctly rejected it. Its current coordinate functions, course override selection and host/alternate root templates were inspected and independently executed before adding that exact hash to the reviewed list.

The previous **b4e64727f646e6baa8d68f6c3cae308c25eb86c039d9869b6bf998ca12a225cd** remains valid for Phase 4B. Engine hash remains **2a64bbe1e11db7343aab33ca91a357e87139ef0becbbc869d89c73c4a99f3018**. Unknown app/engine bytes still reject. No broad version-string/regex-only acceptance was added.

## 6. AT&T Pebble Beach event identity

**VERIFIED fresh discovery:** **R2026005**, season 2026, **AT&T Pebble Beach Pro-Am**.

Inventory:

| Provider ID | Course | Relationship | Coverage |
|---|---|---|---|
| 005 | Pebble Beach Golf Links | host | TOURCAST |
| 205 | Spyglass Hill Golf Course | alternate | TOURCAST |

Fresh tee times have 20 groups at each course in R1/R2, then 27 host groups in each R3/R4. No additional course appears in this inspected 2026 inventory. This does not generalize older editions' course lists.

| Input | Exact URL | Retrieved UTC | SHA-256 |
| --- | --- | --- | --- |
| bootstrap | [source](https://tourcast.pgatour.com/tourcast.html?id=R2026005) | 2026-10-07T11:17:04.978Z | `4e1ff0d18a4a1fd2ef0baf8c058342caac0808f4ca58afa3d40ab5d326cfee83` |
| leaderboard | [source](https://data-api.pgatour.com/leaderboard/R2026005) | 2026-10-07T11:17:04.982Z | `315bf882366f31b699727da5b8f72855b0f859d3ff69909277157c620c28e9b8` |
| schedule | [source](https://data-api.pgatour.com/schedule/R/2026) | 2026-10-07T11:17:04.991Z | `63f5b82eca8eb29cfce3ec4e705a5d1ac6de4b4edabf0b03a663d4075773fd22` |
| engine | [source](https://static-assets.pgatour.com/golf-engine/3.3.1/golfEngine.min.js) | 2026-10-07T11:17:05.051Z | `2a64bbe1e11db7343aab33ca91a357e87139ef0becbbc869d89c73c4a99f3018` |
| application | [source](https://tourcast.pgatour.com/_next/static/chunks/app/%5Bproduct%5D/page-9b53da48a23ead21.js) | 2026-10-07T11:17:05.105Z | `09870190bcc511bcd988a7bee22edd9758a0640fa52019bb2e0d00f388232811` |
| tee-times | [source](https://orchestrator.pgatour.com/graphql) | 2026-10-07T11:17:05.530Z | `9e38e33c86040e296f7ddabaaffc436fcd29d7dbe32ad8122aa721660e0ece84` |

GetTeeTimes variables are `{"id":"R2026005"}`. ShotDetailsCompressedV3 variables are `{"tournamentId":"R2026005","playerId":"50525","round":1 or 2,"includeRadar":true}`. Wire/decompressed body hashes are preserved separately in each numeric proof.

## 7. Spyglass player/round/course identity chain

**VERIFIED**, with no substitution:

```text
R2026005
  → current event course inventory: 005 host / 205 alternate
  → fresh GetTeeTimes roundInt=1
  → group containing player 50525 (Collin Morikawa)
  → group.courseId="205"
  → inventory: Spyglass Hill Golf Course, TOURCAST
  → /models/R2026005/205/3D_Assets/
  → unique courseOffset override for "205"
  → H1 native payload + terrain01/Green01
```

Selected effective configuration: **x=3249.926282, y=3400.209492, z=0, rotate=0**.

Prepared package: **pga-edd97431-8542-76e6-657d-3b73cc2e4ef6**. Full preparation ID: **edd97431854276e6657d3b73cc2e4ef6ff70f659ebc6696521ea652579d63743**.

## 8. Pebble player/round/course identity chain

**VERIFIED**, same player/event, another round:

```text
R2026005
  → fresh GetTeeTimes roundInt=2
  → group containing player 50525
  → group.courseId="005"
  → inventory: Pebble Beach Golf Links, host, TOURCAST
  → /models/R2026005/3D_Assets/
  → published base offsetConfig
  → H1 native payload + terrain01/Green01
```

Selected effective configuration: **x=2649.998874, y=3300.061931, z=0, rotate=0**.

Prepared package: **pga-5ac095f0-0635-03d0-0233-b07a6aff9d74**. Full preparation ID: **5ac095f0063503d00233b07a6aff9d7420c286a0f1d112bb46327901e72638e0**.

R3/R4 tee times also assign Morikawa to 005. His finalized leaderboard `scoringData.courseId` is 005 and would select the **wrong historical course for R1**.

## 9. Multi-course resolver semantics

**VERIFIED implementation:** `resolveCourseForPlayerRound(eventId, playerId, roundNumber, acquire?)` returns a typed assignment plus source evidence. `prepareCourseForPlayerRound({eventId,playerId,roundNumber,holes}, acquire?)` feeds the selected alias into the existing generic preparation API, then re-checks the join against the candidate's preserved tee-time response.

Provenance includes inventory evidence, tee-time URL/hash/query variables/time and matching round/group indices. A course changing during acquisition rejects the candidate.

| Source | Precedence |
|---|---|
| Tee-time player membership within requested round | REQUIRED actual assignment |
| Event leaderboard course inventory | validates alias/name/host/coverage |
| Final/current leaderboard player's course | DIAGNOSTIC; cannot override historical assignment |
| ShotDetails native hole | validates event/player/round/hole; sampled payload contains no course ID |
| Published config | selects frame for resolved alias |
| Asset root/hashes | selects and versions that course's geometry |

Missing/ambiguous/unlisted/STATS-only assignments reject. No host/name fallback is allowed. Physical-course identity remains **null** as a permanent registry concept: this phase proves the provider's event-scoped physical venue selection, not a global historical alias database.

Event, event-course, player/round, requested hole, profile/configuration and geometry revision are separate. No large persistent database registry was introduced.

## 10. Spyglass asset/configuration provenance

**VERIFIED:** fresh provider retrieval, alternate root and complete override selection. All eight bytes were reacquired, parsed/hash checked and prepared before reading the acceptance oracle.

| Asset | Exact URL | SHA-256 |
| --- | --- | --- |
| course-data | [asset](https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/data/courseData.json) | `7dc2d881137479742ba09b735a832dedbcc44d4e0d9c4aac9822b2e43dbac40c` |
| course-image | [asset](https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/terrain/course.jpg) | `553f34d17c30576a2fa0bb2008a6651e347958f1a5b4432d3db84e82792e8425` |
| course-world | [asset](https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/terrain/course.tfw) | `833ddb92c581bba7692fc49d55ef0307b4165a1da7dcc8f1d5874dc21646bafb` |
| h1-green | [asset](https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/terrain/greens/Green01.glb) | `03176551e7450e15dd5e16e66506f1ed93c939c20e6c00d42fdee82091223b4f` |
| h1-image | [asset](https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/terrain/terrain01.jpg) | `06a853198199908fc2f60d26934751e5dd17d83537f4a4714c297be3b7d05374` |
| h1-mask | [asset](https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/terrain/cutouts/1.png) | `704ac9336db4edcf8a9f01b00cedace0a920ee498602652ac21b10ce2a74ad80` |
| h1-terrain | [asset](https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/terrain/cutGlb/terrain01.glb) | `6d74d6d798364c0f2afb230c98f5040c93c79bb1bc332fadfb25bfabe035d6d9` |
| h1-world | [asset](https://tourcast.pgatour.com/models/R2026005/205/3D_Assets/terrain/terrain01.tfw) | `c7dad12198d09789dc170b30d417f0b6909871264333c991cbd16b9fd94db83f` |

Configuration comes from the fresh TOURCAST structured bootstrap, whose offsetConfig includes base 005 fields and a separate complete 205 override. Current source explicitly switches nonhost root to the course-ID path. Source observation clocks/profile hashes are preserved in the package descriptor/provenance and numeric proof.

## 11. Pebble asset/configuration provenance

**VERIFIED:** fresh host-root retrieval; base transform selected from the same event's published configuration.

| Asset | Exact URL | SHA-256 |
| --- | --- | --- |
| course-data | [asset](https://tourcast.pgatour.com/models/R2026005/3D_Assets/data/courseData.json) | `18219ed145a2d7aecea1aa4f4139a73c9546e114092b536e34fa3dbf090022e8` |
| course-image | [asset](https://tourcast.pgatour.com/models/R2026005/3D_Assets/terrain/course.jpg) | `fa2bc146d6f74312ab1623768bcf9c23de9f3e5c1aebbf5d5036fcba7fc0d6f8` |
| course-world | [asset](https://tourcast.pgatour.com/models/R2026005/3D_Assets/terrain/course.tfw) | `9e8b024428aefae92a4c75e75b947daa486193ee1363c06d2745caa61bc26505` |
| h1-green | [asset](https://tourcast.pgatour.com/models/R2026005/3D_Assets/terrain/greens/Green01.glb) | `e115eaabf31bd387b39d8526e57524b59669c4d3efa2171e46e4ea28dc383492` |
| h1-image | [asset](https://tourcast.pgatour.com/models/R2026005/3D_Assets/terrain/terrain01.jpg) | `12ea11604b7dd36c3567cafca6cc3bc7230e0799461499936211276fec751e76` |
| h1-mask | [asset](https://tourcast.pgatour.com/models/R2026005/3D_Assets/terrain/cutouts/1.png) | `a2b611b70fb4725c62edae16dbd3a293459aa8c9374b947e91f6985791eb462f` |
| h1-terrain | [asset](https://tourcast.pgatour.com/models/R2026005/3D_Assets/terrain/cutGlb/terrain01.glb) | `aca3d8076b5a070514acd5d0f8850e5cf823ebb24b2fc0ba5ce628529f96560b` |
| h1-world | [asset](https://tourcast.pgatour.com/models/R2026005/3D_Assets/terrain/terrain01.tfw) | `f43f090899ab87c319a82395af2dec66117c0e013655bbb38db2dd99a35e5258` |

No filename/root, offset or geometry byte was supplied by a donor package. No course-specific registration algorithm was added.

## 12. Spyglass numeric registration table

Raw feet → authored world metres, using fresh R1 H1 native inputs and the automatically selected 205 override:

| Anchor | Raw PGA XYZ, ft | Our world XYZ, m | PGA function result XYZ, m | 3D error, m |
| --- | --- | --- | --- | --- |
| tee-from | [9669.644,10199.654,193.35] | [-302.618896484375,-291.354736328125,49.89744316657575] | [-302.618896484375,-291.354736328125,49.89744316657561] | 1.3500311979441904e-13 |
| pin | [9019.42,11607.57,70.8] | [-500.80712890625,137.778076171875,12.496472026741618] | [-500.80712890625,137.778076171875,12.496472026741685] | 6.750155989720952e-14 |
| from-1 | [9669.644,10199.654,193.35] | [-302.618896484375,-291.354736328125,49.89744316657575] | [-302.618896484375,-291.354736328125,49.89744316657561] | 1.3500311979441904e-13 |
| to-1 | [9665.526,11073.654,126.086] | [-303.873779296875,-24.959716796875,29.246308589210877] | [-303.873779296875,-24.959716796875,29.246308589210457] | 4.192202140984591e-13 |
| from-2 | [9665.526,11073.654,126.086] | [-303.873779296875,-24.959716796875,29.246308589210877] | [-303.873779296875,-24.959716796875,29.246308589210457] | 4.192202140984591e-13 |
| to-2 | [9338.851,11604.462,76.119] | [-403.444580078125,136.83056640625,14.096534948499702] | [-403.444580078125,136.83056640625,14.096534948499539] | 1.6342482922482304e-13 |
| from-3 | [9338.851,11604.462,76.119] | [-403.444580078125,136.83056640625,14.096534948499702] | [-403.444580078125,136.83056640625,14.096534948499539] | 1.6342482922482304e-13 |
| to-3 | [9021.382,11604.277,70.841] | [-500.208984375,136.774169921875,12.536343050989416] | [-500.208984375,136.774169921875,12.536343050987853] | 1.5631940186722204e-12 |
| from-4 | [9021.382,11604.277,70.841] | [-500.208984375,136.774169921875,12.536343050989416] | [-500.208984375,136.774169921875,12.536343050987853] | 1.5631940186722204e-12 |
| to-4 | [9019.42,11607.57,70.8] | [-500.80712890625,137.778076171875,12.496472026741618] | [-500.80712890625,137.778076171875,12.496472026741685] | 6.750155989720952e-14 |

**VERIFIED:** maximum error **1.5631940186722204e-12 m**; exact XY; pin on detailed green. First endpoint also matches the independently retained original PGA coarse-runtime capture.

## 13. Pebble numeric registration table

Raw feet → authored world metres, using fresh R2 H1 native inputs and the automatically selected 005 base frame:

| Anchor | Raw PGA XYZ, ft | Our world XYZ, m | PGA function result XYZ, m | 3D error, m |
| --- | --- | --- | --- | --- |
| tee-from | [6558.25,12054.898,67.616] | [-651.044189453125,374.27099609375,-25.931448491930652] | [-651.044189453125,374.27099609375,-25.931448491932315] | 1.6626700016786344e-12 |
| pin | [7566.2,12477.68,87.93] | [-343.821044921875,503.134765625,-19.690487522062735] | [-343.821044921875,503.134765625,-19.69048752206254] | 1.9539925233402755e-13 |
| from-1 | [6558.25,12054.898,67.616] | [-651.044189453125,374.27099609375,-25.931448491930652] | [-651.044189453125,374.27099609375,-25.931448491932315] | 1.6626700016786344e-12 |
| to-1 | [7102.537,12460.478,77.963] | [-485.1455078125,497.8916015625,-22.706016572028922] | [-485.1455078125,497.8916015625,-22.706016572028602] | 3.197442310920451e-13 |
| from-2 | [7102.537,12460.478,77.963] | [-485.1455078125,497.8916015625,-22.706016572028922] | [-485.1455078125,497.8916015625,-22.706016572028602] | 3.197442310920451e-13 |
| to-2 | [7507.924,12475.433,85.246] | [-361.58349609375,502.449951171875,-20.491309862854767] | [-361.58349609375,502.449951171875,-20.491309862858543] | 3.7765346405649325e-12 |
| from-3 | [7507.924,12475.433,85.246] | [-361.58349609375,502.449951171875,-20.491309862854767] | [-361.58349609375,502.449951171875,-20.491309862858543] | 3.7765346405649325e-12 |
| to-3 | [7563.913,12475.55,87.826] | [-344.51806640625,502.485595703125,-19.719518216997905] | [-344.51806640625,502.485595703125,-19.71951821699622] | 1.6839862837514374e-12 |
| from-4 | [7563.913,12475.55,87.826] | [-344.51806640625,502.485595703125,-19.719518216997905] | [-344.51806640625,502.485595703125,-19.71951821699622] | 1.6839862837514374e-12 |
| to-4 | [7566.2,12477.68,87.93] | [-343.821044921875,503.134765625,-19.690487522062735] | [-343.821044921875,503.134765625,-19.69048752206254] | 1.9539925233402755e-13 |

**VERIFIED:** maximum error **3.7765346405649325e-12 m**; exact XY; pin on detailed green. No fitted offsets or endpoint substitution.

## 14. Runtime/donor comparison and residuals

The **primary oracle** is freshly executed provider registration/grounding code. Donor material was read afterward only for secondary comparison.

| Context | Primary provider-function max error, m | Retained detailed endpoint max error, m | Eight asset hashes match retained |
| --- | --- | --- | --- |
| waialae-runtime | 9.272582701669307e-13 | 0 | true |
| spyglass-r1 | 1.5631940186722204e-12 | 0 | true |
| pebble-r2 | 3.7765346405649325e-12 | 0 | true |

Secondary donor placement hashes: Waialae **d13246d2764cf94c45e825dfbee379074ea33b3d2c0759a7d7d8a224b7e26e93**; Spyglass **6e67b34973c395ac1bba3a5a1ed28a28fe26e54ed7b1863389bfab8c9e261f44**; Pebble **7e459096849e73db99102d6b082824dc813e7d5cc080fca5dceed5c053883d92**.

Original Spyglass user runtime capture at 2026-09-28T10:08:11.846Z reports first endpoint Z=29.246308589210457, exactly the fresh provider-function result. Our unchanged result is 29.246308589210877: residual about **4.19e-13 m**.

The accepted **1e-8 m CPU** gate and **5e-5 m rendering-buffer** tolerance are unchanged. They are computational parity budgets, not geographic/survey accuracy. Corresponding native points are compared; rounded hole tees and exact first-shot starts are recorded separately.

## 15. Browser/rendering evidence

**VERIFIED:** the existing Phase 4B guarded page now has minimal research-proof links. It uses the unchanged GolfHoleMap2D → GolfShotcastVisualizationSlot → GolfShotcast3D path, actual preparation POST and asset GET. No second renderer or successful-response mock was introduced.

Manual URLs on the restored development server:

- http://localhost:3001/shotcast-3d-proof — preserved Waialae default.
- http://localhost:3001/shotcast-3d-proof?proof=spyglass-r1
- http://localhost:3001/shotcast-3d-proof?proof=pebble-r2

Requires `SHOTCAST_PREPARATION_PROOF=1 npm run dev -- --port 3001`; every variant is 404 in production.

Desktop 1400×900 and mobile 390×844 cover correct course/round/hole, exact fixed starts/endpoints/pin, supported flight boundaries, Course/Green, relief/flow, orbit/reset and Play Hole (2D). Source-supported optional paths: Spyglass flights **1,2**; Pebble flight **2**; both **zero** accepted putt paths. Missing paths remain existing 2D replay.

Sixteen new course canvas captures (four views × two devices × two courses) were visually inspected. Examples:

- [Spyglass desktop Course](../../tmp/shotcast-phase4c/browser/spyglass-r1-desktop-course-canvas.png)
- [Spyglass desktop Green](../../tmp/shotcast-phase4c/browser/spyglass-r1-desktop-green-canvas.png)
- [Spyglass mobile Green orbit](../../tmp/shotcast-phase4c/browser/spyglass-r1-mobile-green-orbit-canvas.png)
- [Pebble desktop Course](../../tmp/shotcast-phase4c/browser/pebble-r2-desktop-course-canvas.png)
- [Pebble desktop flight 2](../../tmp/shotcast-phase4c/browser/pebble-r2-desktop-flight-canvas.png)
- [Pebble mobile Green orbit](../../tmp/shotcast-phase4c/browser/pebble-r2-mobile-green-orbit-canvas.png)

Both detailed greens retain actual non-exaggerated relief and **28/64 flow families**. Close start/cup symbols can overlap; a selected flight connector can remain visible when manually viewing Green. Existing presentation/camera behavior was preserved.

All normal new scenarios have zero page/console errors and no horizontal overflow. Three injected failures per course (asset, preparation, WebGL) safely render 2D. A browser timing assertion was changed to await actual flow advancement in an active visible viewport, rather than assume a software-GPU frame within 350 ms; no renderer/flow code changed.

Browser evidence uses Chromium/SwiftShader, not physical Safari/iPhone certification. Proof data is current provider data, with application-wide client hooks intercepted to avoid database writes. Original Scores/Live regression uses its established read-only historical SELECT boundary, not a new authenticated user session.

## 16. Objective registration-validation findings

**VERIFIED evidence informs the proposed contract**, not an invented confidence score:

| Check | Classification | Finding |
|---|---|---|
| Unambiguous player/round course and query/body identity | REQUIRED | current leaderboard is demonstrably wrong for R1 |
| Recognized exact reviewed app/engine profile | REQUIRED | actual rebundle rejected before explicit review |
| Finite/complete config and unique override | REQUIRED | missing/nonfinite/placeholder/duplicate values reject |
| Config metadata agrees with original bootstrap body/hash | REQUIRED | new source-consistency gate prevents metadata-only tuning |
| Asset source root, version/hash and supported node frame | REQUIRED | swapped course assets reject before geometry use |
| Authoritative tee/start/end coordinates, valid native schema | REQUIRED | missing/sentinel/ungroundable values reject |
| Actual containing terrain/green triangle | REQUIRED | renderer survival or nearby terrain is insufficient |
| Pin inside authored detailed green | REQUIRED for Green | bounds alone are weaker than triangle containment |
| Independent same-input provider function parity | REQUIRED for profile/proof admission | measured 1e-12 scale errors pass established gate |
| Native/transformed continuity | REQUIRED semantic check; DIAGNOSTIC as registration evidence | a wrong rigid transform preserves continuity too |
| Coarse/detailed green course-world compatibility | REQUIRED | same-source frame and current pin agreement verified |
| Plausible geometry extent/lie/routing | DIAGNOSTIC, becoming REQUIRED on unexplained outlier | containment in a large tile alone cannot prove correct hole |
| Strict provider query equals normal query | DIAGNOSTIC / useful admission evidence | all tested anchors need no recovery |
| Flight/putt data | OPTIONAL for Course; REQUIRED for that replay | absence is a truthful capability loss |
| Finite Z alone | NOT RELIABLE | provider nearest fallback can produce plausible height |
| Course ID/name alone across years | NOT RELIABLE | Phase 4A frame/version changes remain relevant |
| Availability flag / HTTP 200 alone | NOT RELIABLE | schema, bytes, assignment and frame must validate |
| Green centre or nominal yardage as a registration fit | NOT RELIABLE | no exact independent correspondence |
| Absolute native Z / guessed elevation offset | NOT RELIABLE | authored surface grounding owns displayed Z |
| Geographic accuracy / complete provider correctness | UNKNOWN | coherent upstream mislabeling or survey error remains possible |

No percentage confidence, visually fitted translation or generous residual cutoff was introduced. Full live freshness/penalty/drop handling and a generalized capability resolver remain Phase 4D work.

## 17. Adversarial validation results

**VERIFIED tests**, with no saved asset/payload modification:

| Deliberate bad input | Observed rejection |
|---|---|
| Missing/conflicting player-round mapping | no host fallback; missing_or_ambiguous_assignment |
| Wrong/unlisted course | unknown_or_ambiguous_course |
| Wrong GraphQL assignment event/query | assignment_query_mismatch / event mismatch |
| Course moves while preparing | course_assignment_changed |
| Wrong rotation or offset in descriptor | identity/transform mismatch |
| Missing transform / NaN | schema/profile/transform rejection |
| Pebble green or terrain assigned to Spyglass | source_integrity_failure |
| Incorrect manifest course identity | identity rejection |
| Wrong round bound to Spyglass assets | wrong_played_course |
| Wrong hole | unprepared_hole |
| Far/off-green pin | unregistered_shots_or_pin |
| Unreviewed app/engine bytes | unsupported_profile |
| Unknown/traversal proof selector | no proof / 404 |
| Broken asset/preparation/WebGL | actual browser 2D fallback |

Candidates are not available merely because decoding succeeds. Geometry is provisional until source, assignment and numeric gates pass. The accepted runtime also re-verifies current player's course and current native endpoints.

## 18. Capability implications

| Context | Static Course | Detailed Green/flow | Flight replay | Supplied putt replay |
|---|---|---|---|---|
| Accepted Southwind control | retained | retained | accepted original flights | accepted original simulations |
| Waialae R1 H10 | retained Phase 4B | available | shot 1 | unavailable |
| Spyglass R1 H1 | available | available | shots 1,2 | unavailable |
| Pebble R2 H1 | available | available | shot 2 | unavailable |
| Unknown/ambiguous/failed context | existing 2D | existing 2D | existing 2D | existing 2D |

These are context-specific proof capabilities. An event-wide permanent has3D flag is not supported. A missing optional replay does not fabricate a path or invalidate independently valid static geometry. Production is still 2D everywhere.

## 19. Exact generic versus course-specific boundary

**STRONGLY SUPPORTED conclusion:** one architecture explains all four courses:

```text
existing tournament identity
  → PGA event
  → requested player/round assignment
  → event-scoped provider course identity
  → published root/configuration and compatible immutable assets
  → generic normalization and fixed registration profile
  → objective source/geometry/parity checks
  → current-player world and optional paths
  → accepted renderer / existing 2D fallback
```

**Data/configuration:** event ID, season/name, course inventory and aliases, player/round assignment, host/alternate relationship, full published offset/rotation, hole assets/images/worldfiles, mesh topology/elevations, raw shots/pin/radar/samples, source/profile hashes and preparation identity.

**Generic code:** strict identity/cardinality handling, profile selection, source acquisition interface, parsing/integrity, normalization, Float32 registration, containing-triangle grounding, validation, runtime course match and renderer/capability seam.

**No new course-specific algorithm, corrective offset, geometry editing, camera tuning or marker relocation.** Southwind math/rendering/source assets remain frozen. The two multi-course roots and offsets differ because provider data differs.

## 20. Remaining fixture/research-only pieces and changed files

**Preserved:** all Phase 4A/4B reports, original Waialae package/replay/numeric/browser evidence, original course-preparation fixture/tests and preparation CLI; all accepted Phase 3 runtime/math/UI files.

**Extended Phase 4B files:**

- `pgaAcquisition.server.ts`: specifically reviewed second application hash.
- `prepareCourse.server.ts`: same reviewed profile support; config-body/asset revision validation before placement.
- `developmentProof.server.ts`: guarded, bounded proof choice loading.
- `app/shotcast-3d-proof/page.tsx`: awaited searchParams; retained explicit early production return.
- `GolfShotcastPreparationProof.tsx`: minimal proof links; same map/slot/renderer.
- `preparation-browser.mjs`: output override to preserve prior captures.

**Added:**

- `lib/shotcast/preparation/playerRoundCourse.server.ts`.
- `scripts/pga-runtime-oracle.mjs`.
- `scripts/prepare-shotcast-player-round.mjs`.
- `tests/shotcast-ingestion/runtime-multicourse.test.mjs` (17 tests).
- `tests/shotcast-ingestion/multicourse-browser.mjs`.
- `tests/shotcast-ingestion/fixtures/pga-runtime-multicourse.json`.
- This report.

Research-only: caller-selected oracle case files, private-function exposure adapter, independent accessor/SDK-grid input adapter, engineering provider transport loader, local proof cache/index, curated holes/rounds, manual profile review and browser diagnostics. No persistent production registry or unattended source-profile approval exists.

**UNKNOWN:** full public-page lifecycle parity, hardware graphics differences, global geodetic identity, all alternative formats, renovations/versions and live partial payload timing.

## 21. Asset acquisition/storage implications

**VERIFIED:** two bounded new course/hole packages were acquired from current provider sources. Original donor packages were never copied into Take2. SDK source bundles and raw input bodies are ignored local research material. No files were added to public/.

Waialae's new source revision remains validation-only; publishing it would create an ambiguous duplicate alongside the preserved Phase 4B package. This deliberately leaves original behavior available while demonstrating current-source parity.

Acquisition, normalization and local storage remain separate. The new CLI writes a validated descriptor last, uses exclusive proof/package creation and requires an independent oracle. Source/profile/geometry/native correspondence must match before publication.

Proofs live in `tmp/shotcast-phase4c/proofs/`; course assets in existing ignored `tmp/shotcast-ingestion/packages/`. Provider JavaScript is stored under ignored discovery directories. No producer is called from a public replay request. Production acquisition guard and tracing exclusions remain intact.

**UNKNOWN / prerequisite:** permission/SLA for production acquisition, caching, transformation and distribution. Public readability does not establish those rights. No legal policy or permanent asset hosting model was encoded here.

## 22. Phase 4D recommended architecture/scope

**INFERRED next implementation**, requiring manual approval first:

| Step | Exact scope / acceptance gate |
|---|---|
| 4D.1 Unified resolution contract | adapter from existing authorized Golf event/slate/ESPN resolution to unique PGA identity and actual player-round course; preserve Group/slate scope and frozen rules |
| 4D.2 Minimal persistent metadata registry | event-course aliases, explicit physical/layout version when known, immutable geometry/profile/config hashes, evidence references and states: pending/staged/validated/rejected/stale; separate player/round setup |
| 4D.3 Objective capability resolver | required identity/source/geometry/registration checks; independent optional flight/putt/Green decisions; stable deterministic 2D reason codes; no confidence percentage |
| 4D.4 Reuse and invalidation | explicitly compatible revisions only; changed app/config/asset or ambiguous alias stays pending/2D; pin/tee/setup updates revalidate without blindly rebuilding geometry |
| 4D.5 Normal development integration | existing Hole Replay requests a capability/approved manifest lookup; no heavy acquisition in rendering; original Course/Green/control and 2D seams preserved |
| 4D.6 Current/upcoming readiness model | represent known venue/base assets versus missing assignment/setup/shots; test readiness transitions without background scheduler or production activation |

Accept only if all four course regressions, both Morikawa round joins, adversarial negatives, missing/changed-source cases, 2D reasons and production isolation pass. Add explicit per-hole/setup validation records and revision selection instead of a permanent event-wide bool.

Production asset delivery rights, hosting, unattended workers, broad historical backfill and automatic production defaults need separate subsequent review/authorization. A source-missing lookup must immediately keep existing 2D, not launch speculative preparation or guessed geometry.

## 23. Tests, build, isolation and preservation

**VERIFIED final checks:**

- Initial baseline **71/71**.
- Full focused suite **88/88**, zero failures/skips, including original **58** Phase 3 + **13** Phase 4B + **17** Phase 4C.
- Final Phase 4C focused rerun **17/17** after strict-mode evidence/assertions.
- Original Phase 3 Scores/Live browser **16/16**; local historical boundary reports **zero errors, zero mutations**.
- Preserved Waialae browser **5/5**; Spyglass **5/5**; Pebble **5/5**: total **31**.
- Sixteen new course canvas captures visually inspected; current world/camera/replay invariants preserved.
- TypeScript and focused lint pass.
- Production build passes; **168 traces**, no tmp/donor/research docs, fixtures or scripts.
- With proof opt-in set, production default/Spyglass/Pebble proof pages, preparation GET/POST and both course asset GETs return **404**: **7/7**.
- git diff --check and new-file whitespace checks pass.
- All prior reports and inventoried prepared/replay/browser artifacts are byte-identical.
- Main/donor were read only; their starting HEAD/status/diff fingerprints are checked separately. No branch/ref or destructive operation was performed.

Logs/results are under `tmp/shotcast-phase4c/`: baseline-tests.log, tests.log, runtime-tests-final.log, types.log, lint.log/lint-final.log, build.log, phase3-browser/, waialae-browser/, browser/, production-gates.json, production-traces.json and the runtime/proof evidence files.

Temporary historical test services and production-check server are stopped. Normal opted-in development is restored on localhost:3001. No real scoring/database mutation, commit, push, merge or deployment.

## 24. Exact git status --short

```text
 M lib/shotcast/ingestion/prepared.ts
?? app/shotcast-3d-proof/
?? components/lineups/GolfShotcastPreparationProof.tsx
?? docs/shotcast-ingestion/PHASE4-SCALABILITY-AUDIT.md
?? docs/shotcast-ingestion/PHASE4B-WAIALAE-PREPARATION.md
?? docs/shotcast-ingestion/PHASE4C-RUNTIME-MULTICOURSE-VALIDATION.md
?? lib/shotcast/preparation/
?? scripts/pga-runtime-oracle.mjs
?? scripts/prepare-shotcast-course.mjs
?? scripts/prepare-shotcast-player-round.mjs
?? tests/shotcast-ingestion/course-preparation.test.mjs
?? tests/shotcast-ingestion/fixtures/pga-runtime-multicourse.json
?? tests/shotcast-ingestion/fixtures/waialae-r2026006-r1-h10.json
?? tests/shotcast-ingestion/multicourse-browser.mjs
?? tests/shotcast-ingestion/preparation-browser.mjs
?? tests/shotcast-ingestion/runtime-multicourse.test.mjs
```

Phase 4C stops here for manual review. Phase 4D has not begun.
