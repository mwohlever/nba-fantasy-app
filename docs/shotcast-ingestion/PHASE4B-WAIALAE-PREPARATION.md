# Phase 4B — Course identity and Waialae automated preparation

Date: **2026-10-06**. Branch: **shotcast-3d-take2**. HEAD: **c0977b3e1a4c79dc82465d1f0aa0595d5e1802dd**.

## 1. Executive result — PASS

**PASS for the bounded engineering proof.** Starting from Sony Open event **R2026006**, generic code discovers Waialae **006**, its published configuration, supported engine/application profile and required H10 assets; acquires fresh provider bytes; builds a course-only normalized preparation; registers fresh Gotterup R1 H10 positions; passes the independent retained-reference comparison; and renders with the **unchanged accepted Phase 3 components**.

The discovered rotation is **0.424586 degrees**, not a caller-supplied transform. Eight comparisons (tee, pin, three starts and three endpoints) have **0 m maximum residual**, against a predeclared **1e-8 m** gate. This does not establish new independent survey accuracy or new PGA live-runtime capture parity.

All eight freshly acquired spatial assets match their corresponding retained donor hashes, but **none was copied from the donor into the new package**. Acquisition/normalization completes before the reference is read. The CLI cannot tune/fix a discrepancy: it stops before publication.

Existing 58 tests plus 13 new tests: **71/71 pass**. Desktop/mobile renderer and three failure scenarios: **5/5 pass**. All eight resulting canvas captures were visually inspected. TypeScript, focused lint and production build pass. **168 build traces contain no research assets**. Built proof page, preparation GET/POST and asset GET each return **404**, including with the proof opt-in environment variable set.

Manual user acceptance of the new visuals remains a review step; this report does not claim authenticated Sony Scores acceptance. Sony is absent from the application's slate data, so a guarded local proof page is used. No production 3D/default activation, database registry, scoring mutation, commit, push, merge or deployment was performed.

## 2. Exact event/course identity chain

```text
caller: R2026006 + requested ordinary hole 10
  → PGA 2026 schedule: Sony Open in Hawaii
  → PGA leaderboard: one declared host, Waialae Country Club / "006" / TOURCAST
  → structured TOURCAST page configuration and exact supported profile
  → host asset root: /models/R2026006/3D_Assets/
  → published offsetConfig, selected as base
  → requested H10 terrain/image/worldfile/mask + course imagery/worldfile/data
  → optional detailed Green10 (present)
  → normalized course-only candidate, content-derived revision
  → fresh GetTeeTimes: Gotterup 59095 / R1 → "006"
  → fresh ShotDetailsCompressedV3: exact event/player/round identity
  → native R1 H10 starts/endpoints and independent round pin
  → unchanged accepted Float32 registration and authored surface grounding
  → retained donor oracle comparison; discrepancy rejects, never fits
  → validated local manifest
  → existing development preparation POST/asset GET
  → GolfHoleMap2D → GolfShotcastVisualizationSlot → GolfShotcast3D
```

The new API is `prepareCourseForEvent({ eventId, courseId?, holes }, acquire?)`. Single-course Sony resolves without a supplied course ID. Multi-course requests require an explicit course; the host is not silently substituted. Player/round verification requires tee times even for single-course events.

This phase starts with PGA identity. It does not consolidate the existing ESPN/PGA slate-name resolvers or change Group-aware tournament selection. The existing fantasy/event systems remain untouched.

## 3. Discovered identifiers and typed contract

| Identity | Observed value / ownership |
|---|---|
| Provider event | PGA R2026006; distinct from ESPN identity |
| Tournament | Sony Open in Hawaii |
| Season | 2026 from the ordinary PGA event namespace and matching schedule |
| Provider course | string **"006"**, preserving its leading zeros |
| Course | Waialae Country Club |
| Relationship | sole declared host; TOURCAST scoring |
| Event-course key | pga-tour:R2026006:006 |
| Physical-course identity | **null**; no permanent geographic alias is invented |
| Player / round / hole | Chris Gotterup / 59095 / R1 / H10 |
| Coordinate/engine profile | PGA engine 3.3.1 / pga-f32-z-up-interior-v1 |
| Configuration identity | bc3eb17b4a7667a0872a050891ffda225c8131ac6784e2689712f196d2950bdf |
| Preparation version | 1; course-only manifest schema 2 |
| Preparation content identity | a5d81a10162dab8e72f9348e306d2a513b25eb40494ad7b7d3d150ca7e50fc53 |
| Local package ID | pga-a5d81a10-162d-ab8e-72f9-348e306d2a51 |

`CourseIdentity` distinguishes event ID, season/name, provider course ID/name, event-course relationship, asset root, configuration hash, registration profile and units. `EventIdentity` retains the full course inventory and schedule/inventory provenance. `PreparedCourseManifest` adds immutable content revision, normalized asset/hole references, profile evidence, provisional capabilities and a registration proof.

No course name/ID is treated as a permanent physical-course version. The contract can be persisted later; no permanent registry schema or database table was needed for this proof.

## 4. Exact asset/configuration provenance

All sources were freshly acquired over HTTPS on 2026-10-06 with bounded no-redirect retrieval. Requests do not bypass denied access. Structured bootstrap parsing uses JSON Flight records, never eval. The engine/application fingerprints match the previously researched profile; unknown fingerprints fail closed.

The following table records the latest repeat-run discovery evidence. The local package retains its original successful acquisition clocks; a subsequent successful run reuses that package rather than overwriting it. Retrieval clocks and unrelated schedule status changes do not change the geometry content identity.

| Input | Exact source | Retrieved UTC | SHA-256 |
| --- | --- | --- | --- |
| schedule | [source](https://data-api.pgatour.com/schedule/R/2026) | 2026-10-06T11:00:33.727Z | `63f5b82eca8eb29cfce3ec4e705a5d1ac6de4b4edabf0b03a663d4075773fd22` |
| bootstrap | [source](https://tourcast.pgatour.com/tourcast.html?id=R2026006) | 2026-10-06T11:00:33.765Z | `9086375e4cc152b6b7c18d5a2bd43918b6950e2d475b41314e955664377a9378` |
| leaderboard | [source](https://data-api.pgatour.com/leaderboard/R2026006) | 2026-10-06T11:00:34.010Z | `3eb6abbb25773f7a09ec363d9abd9dc91b2375c84d210106f218cfb1933d5fb5` |
| engine | [source](https://static-assets.pgatour.com/golf-engine/3.3.1/golfEngine.min.js) | 2026-10-06T11:00:34.308Z | `2a64bbe1e11db7343aab33ca91a357e87139ef0becbbc869d89c73c4a99f3018` |
| application | [source](https://tourcast.pgatour.com/_next/static/chunks/app/%5Bproduct%5D/page-0078146f4ff96bcc.js) | 2026-10-06T11:00:34.396Z | `b4e64727f646e6baa8d68f6c3cae308c25eb86c039d9869b6bf998ca12a225cd` |
| tee-times | [source](https://orchestrator.pgatour.com/graphql); GetTeeTimes {"id":"R2026006"} | 2026-10-06T11:00:35.063Z | `8d746c072b80c87d0c4b6072413c719d885617dc7ec76feab04d4e1da3d331ad` |

Spatial assets: exact URLs/hashes below are the same in both successful acquisition runs. The renderer's materials use registered course/hole JPEGs, affine worldfiles and the cutout mask; it does not ingest an arbitrary external GLTF material library.

| Normalized asset | Exact provider URL | Bytes | SHA-256 |
| --- | --- | --- | --- |
| course-data | [asset](https://tourcast.pgatour.com/models/R2026006/3D_Assets/data/courseData.json) | 3658 | `757e515b13b2fa7bcd3b8cb49c1f6c115bef95ec896580c4070d5b1508ec35d0` |
| course-image | [asset](https://tourcast.pgatour.com/models/R2026006/3D_Assets/terrain/course.jpg) | 1384124 | `4d0627391533a99f2c91ecc73c8ba167318ffb16370a3f3ed0fb7891c7d6e552` |
| course-world | [asset](https://tourcast.pgatour.com/models/R2026006/3D_Assets/terrain/course.tfw) | 45 | `e07d10ce23b42edeb0308f21789de9b5305492df95483c0b325f5711d2f291fd` |
| h10-green | [asset](https://tourcast.pgatour.com/models/R2026006/3D_Assets/terrain/greens/Green10.glb) | 150500 | `cd8bd8c36ce0a68d544c03da67ff032df2bb2e8b3edda7f67f1138dd0ef8e487` |
| h10-image | [asset](https://tourcast.pgatour.com/models/R2026006/3D_Assets/terrain/terrain10.jpg) | 3308412 | `eb6439d00edb541b5acdf9d2c755b5ea91c5d5649e9d4182f047364dc8a4619d` |
| h10-mask | [asset](https://tourcast.pgatour.com/models/R2026006/3D_Assets/terrain/cutouts/10.png) | 4278 | `fca8a0ccd31e8c7d401778c3a923b0a3911cf880940beba4edebdd55ce7cdbce` |
| h10-terrain | [asset](https://tourcast.pgatour.com/models/R2026006/3D_Assets/terrain/cutGlb/terrain10.glb) | 781324 | `dff9fd5d6ccd17fcc64460221fb96b2641a571d9bf24e19cfbf2476edf8b7552` |
| h10-world | [asset](https://tourcast.pgatour.com/models/R2026006/3D_Assets/terrain/terrain10.tfw) | 79 | `2d59cbc2784d01c4f112424730fa532be5f9352af152a37f8e5c5cc8ddec50bc` |

The first package's complete per-asset retrieval clocks and all 14 input records are in its `descriptor.json` / `provenance.json`; latest observation metadata is in `tmp/shotcast-phase4b/numeric-proof.json`.

Fresh native acquisition:

| Body | Endpoint / operation / variables | Retrieved UTC | SHA-256 |
| --- | --- | --- | --- |
| response | [GraphQL](https://orchestrator.pgatour.com/graphql); ShotDetailsCompressedV3; {"tournamentId":"R2026006","playerId":"59095","round":1,"includeRadar":true} | 2026-10-06T11:00:35.523Z | `f4f3312380b58785d129ec3bf9cf7c17109d80579e86c51d405f628c47d124a2` |
| native | [GraphQL](https://orchestrator.pgatour.com/graphql); ShotDetailsCompressedV3; {"tournamentId":"R2026006","playerId":"59095","round":1,"includeRadar":true} | 2026-10-06T11:00:35.523Z | `b60e91e0c88d90603e6dea757b6cf113c25089d41ce363290cbc022f2d549451` |

The native body is a base64/gzip decode of the compressed response, without coordinate modifications. Raw bootstrap bytes may contain public bootstrap API material; they remain ignored local research inputs. Request headers/keys are not copied into the manifest, report or committed test fixture.

## 5. Automatically discovered transform values

| Field | Published value | Provenance/meaning |
|---|---:|---|
| courseOffset.x | 3225.238265 | bootstrap configData.offsetConfig.x |
| courseOffset.y | 3122.877394 | bootstrap configData.offsetConfig.y |
| courseOffset.z | 0 | bootstrap configData.offsetConfig.z |
| rotation | 0.424586° | bootstrap configData.offsetConfig.rotate |
| native unit | feet | existing validated engine profile, not a new JSON CRS assertion |
| world unit | metres | validated authored-mesh/profile contract |
| feet-to-metres scale | 0.3048 | frozen accepted registration profile |
| axes | horizontal XY; Z up | existing validated profile |
| vertical placement | detailed green, then terrain | frozen first-containing-triangle grounding |

The selected transform is the **base configuration**. For alternate courses, a unique published course override replaces all x/y/z/rotate fields; it is not added to the base. Missing/ambiguous alternate-course overrides reject preparation.

The CLI accepts event/player/round/hole and a reference location, **no transform parameters**. Generic preparation code contains no Southwind or Waialae coordinate constants. Numeric constants in the new regression fixture are expectations, not preparation inputs.

The test removing rotation causes over 20 m of horizontal displacement at the first native start. Its material effect is explicitly checked; merely carrying rotation metadata would not pass.

## 6. Raw → registered coordinate table

Native coordinates are feet. Registered coordinates are metres in the authored model frame. Negative Z is expected here. Z is grounded from the actual authored triangles, not converted native altitude.

| Anchor | Native XYZ, ft | Registered XYZ, m | Reference delta, m |
| --- | --- | --- | --- |
| shot-1.from | [10137.592,9821.615,9.941] | [-157.569091796875,-106.43359375,-19.777041853871197] | 0 |
| shot-1.to | [10930.474,10252.798,7.213] | [83.120849609375,26.77783203125,-20.57729180450313] | 0 |
| shot-2.from | [10930.474,10252.798,7.213] | [83.120849609375,26.77783203125,-20.57729180450313] | 0 |
| shot-2.to | [11037.69,10254.604,11.77] | [115.795654296875,27.570556640625,-19.252282164396593] | 0 |
| shot-3.from | [11037.69,10254.604,11.77] | [115.795654296875,27.570556640625,-19.252282164396593] | 0 |
| shot-3.to | [11050.44,10259.26,11.84] | [119.671142578125,29.0185546875,-19.235471572331665] | 0 |
| pin | [11050.44,10259.26,11.84] | [119.671142578125,29.0185546875,-19.235471572331665] | 0 |

Shot 1's endpoint equals Shot 2's start; Shot 2's endpoint equals Shot 3's start. Shot 3 ends at the independent pin. Markers remain **starts**, never landing points. The tee is exact Shot 1.from, not the rounded hole tee metadata.

Registration proof: **8 comparisons**, maximum residual **0 m**, tolerance **1e-8 m**. The resolved world hash is `d21c1ec05198d3d7791ecda555c9ea288be18b8167634c3d74e4fbe088e94829`. The current application provider is exercised against the fresh native bytes; its current-player projection equals the direct native projection exactly.

## 7. Comparison with retained donor evidence

Read-only oracle:

`/home/markwohlever/nba-fantasy-app-3d/tmp/shotcast-ingestion/packages/pga-2f61f589-ec68-4c2a-a188-c8effb517698`.

The independently retained `placement-check.json` detailed endpoint output has SHA-256 `d13246d2764cf94c45e825dfbee379074ea33b3d2c0759a7d7d8a224b7e26e93`; the reference descriptor SHA-256 is `d8618bc9d38a730d6e6d8341ab7502bf8f653c362efb0f5079bc638895445113`.

Comparison procedure:

1. Complete provider discovery, profile verification, required asset acquisition and normalization first.
2. Acquire fresh native shots and independently verify the current player-round course.
3. Only then read the reference descriptor, verify reference terrain/green hashes and reference event/course/player/round/hole.
4. Compare the automatically discovered offset with retained configuration; disagreement stops the proof.
5. Compare all three newly resolved endpoints with frozen retained detailed endpoint outputs.
6. Compare tee, pin and starts with the read-only donor implementation's surface query, using independently retained geometry/configuration.
7. Reject any meaningful mismatch before publishing a descriptor. No fitted translation, scale, rotation, elevation correction or visual tuning exists.

All eight newly acquired spatial byte hashes match their donor counterparts. This is validation of fresh acquisition, **not copying**. The new package has different course-only metadata and a content-derived ID; it has no saved-player `shotSource`, `selection` or `native.bin`.

Independence limit: three endpoint expectations are frozen retained outputs; tee/pin/start comparisons use retained donor geometry and its separate implementation. This is strong numeric reproduction evidence, not a new Waialae PGA live-runtime capture or an independently surveyed geographic truth. A fresh independent PGA runtime capture belongs in the next validation phase.

## 8. Existing-path audit and Southwind/Waialae comparison

Read before implementation: Phase 4A audit, accepted Phase 3 baseline, Take2 foundation, Course/Player Separation, world/marker correctness and flight/green integration reports; read-only donor discovery/profile/multi-course source and provenance. Installed Next 16.2.4 route-handler, page and client-boundary documentation was read before adding the proof route.

Classification: **A** already generic; **B** needs abstraction; **C** fixture/research-only and excluded from the scalable core.

| Existing assumption/responsibility | Class | Outcome |
|---|---|---|
| Float32 feet conversion, degree Z rotation, offset subtraction | A | Unchanged productionGeometry.ts |
| Authored terrain/green triangle grounding and UV worldfiles | A | Unchanged; fresh Waialae assets consumed directly |
| Frozen HoleWorld, tee/start markers, pin, camera independence | A | Unchanged |
| Flight endpoint constraint, branch/terrain gates and playback clock | A | Unchanged; Waialae Shot 1 passes |
| Supplied simulation putting, topography and sparse flow | A | Unchanged; no H10 simulation fabricated |
| Current-player data separate from course geometry | A | Preserved; normal resolver never reads package native.bin |
| Event/course/player-round verification and unique candidate selection | A | Existing runtime retained; preparation uses stricter explicit multi-course semantics |
| Research descriptor requires saved player/selection for validation | B | New schema-2 course-only manifest; legacy schema-1 path retained |
| Manually retained event/course package availability | B | Generic discover/acquire/normalize API plus replaceable local proof cache |
| Known source/profile/root naming | A, constrained | Generic for the pinned profile; unknown profiles/root semantics reject |
| Southwind and Sedgefield golden positions/fixture IDs | C | Regression/oracle only; no generic preparation constants |
| Donor validation script and stored player bytes | C | Numeric oracle/engineering transport only; not runtime replay sources |
| Preserved historical Scores snapshot/synthetic account | C | Not extended with an invented Sony slate |
| Ignored tmp storage, production 404 gate, WebGL/2D fallback | C for storage; A for safety | Kept as explicit proof boundary; no production asset delivery |

| Item | Accepted Southwind | New Waialae |
|---|---|---|
| Preparation source | retained legacy research capture | fresh generic provider/event discovery |
| Descriptor | schema 1 projected to course fields | course-only schema 2 |
| Rotation | published zero | published nonzero 0.424586° |
| Ground | accepted terrain + detailed H1 green | freshly obtained terrain + detailed H10 green |
| Runtime shot source | current provider selected player | same handoff; proof uses newly acquired Gotterup data |
| Rendering/math | accepted Phase 3 | exactly the same components/math |
| Paths | two supported flights, two simulations in accepted Scheffler case | Shot 1 flight; no usable H10 simulation |
| Production eligibility | 2D | 2D |

Only one accepted file changes: **ingestion/prepared.ts**, adding schema-2 validation/projection. Legacy validation/projection remains; Southwind package bytes, golden numbers, math, renderer, UI and fallback behavior are unchanged. Baseline hash audit found that file to be the only changed file among the 870 initially inventoried tracked files plus the Phase 4A report.

## 9. Generic preparation architecture

```text
courseIdentity.ts
  typed event/course aliases, inventory, actual course join, published override selection
        ↓
pgaAcquisition.server.ts
  injectable bounded byte transport + source evidence
  JSON bootstrap, schedule/inventory/profile discovery
  separate tee-time and native-shot acquisition
        ↓
prepareCourse.server.ts
  resource integrity, accepted GLB/image/worldfile normalization
  content identity → staged course-only candidate (no 3D admission yet)
  authored-world construction → independent reference gate
        ↓
explicit research CLI storage adapter
  local bytes / provenance → validated descriptor written last
        ↓
existing prepared.ts delivery projection
  schema 1 unchanged / schema 2 strict validation
        ↓
existing development resolver / Phase 3 renderer
```

The normalized result is independent of the network and storage adapter. Tests inject acquired resource bytes; the proof CLI chooses local ignored files. No API route starts acquisition or performs an on-demand course download.

Determinism is **content identity, normalized spatial references and numerical world**, not identical retrieval timestamps. Repeated fresh runs produce the same full preparation identity and package ID. Unknown profiles, failed hashes, missing required assets and failed reference comparisons never publish an eligible course.

Capabilities in the course-only candidate are provisional. `course3d`, `registrationValidated`, `shotCoordinates` and `pin` remain false before the numeric gate. Detailed-green presence is separately recorded. Current-player replay eligibility remains the accepted runtime's per-stroke capabilities; geometry preparation alone never claims radar or simulation replay.

## 10. Exact files added/changed

**Changed existing file:**

- `lib/shotcast/ingestion/prepared.ts` — recognize a validated schema-2 course-only manifest and project it into the existing renderer contract.

**Added implementation:**

- `lib/shotcast/preparation/courseIdentity.ts` — typed provider/event/course identity, inventory/assignment and transform selection.
- `lib/shotcast/preparation/pgaAcquisition.server.ts` — bounded injectable provider transport and event/profile/native discovery.
- `lib/shotcast/preparation/prepareCourse.server.ts` — deterministic normalization, asset integrity, capabilities and numeric registration gate.
- `scripts/prepare-shotcast-course.mjs` — explicit research acquisition/reference proof and local cache publication.
- `lib/shotcast/preparation/developmentProof.server.ts` — opt-in, hash-checked fresh proof replay reader; no scoring/database calls.
- `app/shotcast-3d-proof/page.tsx` — development + explicit opt-in guard before loading proof data.
- `components/lineups/GolfShotcastPreparationProof.tsx` — existing map controls/slot/renderer composition, no new scene.

**Added tests/documentation:**

- `tests/shotcast-ingestion/course-preparation.test.mjs` — 13 focused tests.
- `tests/shotcast-ingestion/fixtures/waialae-r2026006-r1-h10.json` — real native anchors and retained numeric expectations/provenance; no meshes/images.
- `tests/shotcast-ingestion/preparation-browser.mjs` — actual renderer/browser/fallback evidence.
- `docs/shotcast-ingestion/PHASE4B-WAIALAE-PREPARATION.md` — this report.

Pre-existing untracked **PHASE4-SCALABILITY-AUDIT.md is preserved byte-for-byte**. No package/dependency, Next configuration, production API, tournament resolver, fantasy/scoring, Group rules, accepted renderer or accepted replay file changed.

## 11. Tests and checks

| Check | Exact result |
|---|---|
| Baseline before edits | 58/58 Node tests pass |
| `node --test tests/shotcast-ingestion/*.test.mjs` | **71/71**, zero fail/skip; original 58 retained |
| Preparation numeric gate | **8/8 comparisons**, maximum residual **0 m** |
| Repeat event-driven acquisition | same full content revision/package ID; original local package retained |
| New browser proof | **5/5 scenarios**: desktop, mobile, asset failure, preparation failure, unavailable WebGL |
| Visual inspection | **8/8 canvas images**: Course, flight, Green, Green orbit at each viewport |
| TypeScript | `npx tsc --noEmit --incremental false`: pass |
| Focused ESLint | changed/new TS/TSX and scripts/tests: zero errors/warnings |
| Production build | `npm run build`: pass, no build warnings in the final run |
| File tracing | **168 traces**, zero tmp/donor/research references; proof-page trace 109 files, zero workspace docs/tests/scripts |
| Built route checks with proof opt-in set | proof page / preparation GET / preparation POST / asset GET: **404 each** |
| Whitespace/diff checks | pass |
| Preservation | only prepared.ts changes from initial file inventory; donor HEAD/status/diff identical; active HEAD unchanged |

Focused tests exercise identity and event-course resolution, explicit multi-course selection and complete offset replacement, actual player-round assignment, zero/-1 sentinels, unsupported profiles, malformed/ambiguous bootstrap, asset/hash/HTTP failures, optional green absence, deterministic revision, material nonzero rotation, reference mismatch rejection, manifest admission, current provider consumption/no native.bin reads and production/opt-in guards.

The earlier 16-scenario historical Scores/Live browser harness was not rerun here; the accepted renderer/control sources are unchanged, all original Node regressions pass, and this phase's browser proof directly exercises the actual components/endpoints. No new authenticated Scores claim is made.

The proof page uses an explicit early `return notFound()` so production compilation excludes its development data imports. The final trace audit also rejects research documentation/test fixtures and preparation scripts, beyond the existing tmp-asset exclusion. No production isolation rule was relaxed.

Logs/results remain ignored under `tmp/shotcast-phase4b/`: baseline-tests.log, tests.log, types.log, lint.log, build.log, numeric-proof.json, browser/results.json, production-traces.json and production-gates.json.

## 12. Browser evidence and manual review

A read-only Supabase **SELECT** for Golf slates with Sony in their display name returned **HTTP 200 and zero rows**. Creating one merely to expose this proof would require unrelated product/data work. The proof page reads a newly acquired, hash-checked replay and uses the real components, with no synthetic fantasy tournament.

Start/retain development with:

```sh
SHOTCAST_PREPARATION_PROOF=1 npm run dev -- --port 3001
```

Open **http://localhost:3001/shotcast-3d-proof**. This page is unavailable without the opt-in and always 404 in production. The proof server was left running on port 3001 for review; the temporary production-check server was stopped.

Manual checks: markers 1–3 are starts; pin/terrain remain fixed; click 1 for supported flight; use Course/Green, orbit/zoom/Reset and Play Hole (2D). H10 has no usable simulation, so unsupported putting continues through existing 2D behavior.

Representative captures:

- [Desktop Course](../../tmp/shotcast-phase4b/browser/desktop-course-canvas.png)
- [Desktop flight](../../tmp/shotcast-phase4b/browser/desktop-flight-canvas.png)
- [Desktop Green](../../tmp/shotcast-phase4b/browser/desktop-green-canvas.png)
- [Desktop Green orbit](../../tmp/shotcast-phase4b/browser/desktop-green-orbit-canvas.png)
- [Mobile Course](../../tmp/shotcast-phase4b/browser/mobile-course-canvas.png)
- [Mobile flight](../../tmp/shotcast-phase4b/browser/mobile-flight-canvas.png)
- [Mobile Green](../../tmp/shotcast-phase4b/browser/mobile-green-canvas.png)
- [Mobile Green orbit](../../tmp/shotcast-phase4b/browser/mobile-green-orbit-canvas.png)

All eight show registered geometry and were inspected. Green 10 has **4,183 vertices / 8,108 triangles**, true Z range **-19.42197608947754 to -18.574983596801758 m**. Existing colour quantiles and non-exaggerated topography remain. Flow retains **28 of 64 families**, advances on the surface, and stays camera-independent.

Browser evidence uses Chromium/SwiftShader at 1400×900 and 390×844, not physical Safari/iPhone performance. Application-wide client API hooks are intercepted to prevent database side effects; preparation POST and asset GET are real. No successful 3D response is mocked. The normal scenarios have zero page/console errors; intentional WebGL/asset failures produce expected diagnostics and 2D fallback.

## 13. Capability matrix

| Capability / stage | Unvalidated course candidate | Validated Gotterup R1 H10 runtime |
|---|---|---|
| course3d | not admitted | available |
| detailedGreen | asset present, parsed/hash checked | available; pin inside authored green |
| registrationValidated | false | true for this bounded prepared hole/profile/reference gate |
| shotCoordinates | not a shared-geometry claim | all three native starts/endpoints grounded |
| pin | no setup substitution | fresh round pin grounded independently |
| radarFlight | no shared-player claim | **Shot 1 supported** |
| simulatedPutt | no shared-player claim | **unavailable**; zero accepted H10 paths |
| Green topography/flow | candidate geometry only | available with unchanged accepted derivation |
| production 3D | unavailable | unavailable; existing production remains 2D |

A missing optional detailed green can produce a partial candidate; it does not claim Green View readiness. A suitable separately validated coarse reference could admit Course only. This Waialae proof uses detailed geometry and its detailed reference, so a missing detailed green cannot silently pass that comparison.

Required failures return `{status:"unsupported", reason, stage, sourceUrl?, httpStatus?}` or reject local manifest admission. Optional replay failures keep existing static/2D behavior. The existing resolver also rejects multiple eligible revisions until an explicit future revision-selection policy exists.

## 14. Known limitations / what remains fixture-specific

- The local storage and proof UI are explicit research adapters, not a production registry or asset host.
- The CLI uses the existing engineering TypeScript loader/current-provider transport helper. It exercises unchanged provider normalization against fresh data; it does not replace the normal application's fetch/resolver.
- Independent acceptance uses a caller-selected retained reference. There is no automated universal oracle/physical survey validator.
- Runtime publication currently admits a single reference-validated hole. Multi-hole candidates can be staged; per-hole proof/validation records and revision selection need a later contract.
- Provider profile/root templates are pinned to exact researched engine/application bytes. Benign provider rebundles may reject; there is no speculative auto-upgrade.
- The reference CLI assumes the retained donor research descriptor/asset layout. That assumption is an **oracle adapter**, outside generic acquisition/normalization.
- Actual Pebble/AmEx acquisition/rendering is not claimed. Identity tests establish readiness of the semantics, not universal multi-course validation.
- No 3D putt is claimed for Sony H10. Camera paths elsewhere remain unsupported; no sample fitting/generation was added.
- Coverage across all players, rounds, holes, historical course revisions and live partial payloads is not certified.
- A clean checkout lacks ignored local geometry and replay, as with the accepted baseline; new fixture-independent unit cases coexist with local acquired-asset proof tests.
- No full geographic CRS/survey datum or physically predictive putting model is established.
- Main's ref remained unchanged. Unrelated Football/NBA live-score working-tree edits appeared in the separate main worktree during this session; **this phase did not author, modify or revert them**. Donor HEAD and pre-existing dirty status/diff matched the initial snapshot.

## 15. Asset acquisition/storage boundary

The proof reads/downloads **one hole**: eight spatial assets (~5.63 MB total), bootstrap, schedule, leaderboard, exact engine/application bytes and tee-time metadata. Native shots and normalized replay are separate ignored proof artifacts, not course geometry. Browser fallback evidence additionally caches the actual 2D hole/green images. No course library was built and no files were placed in public/.

Acquisition uses bounded HTTPS transport and can be replaced by a permitted cache/source adapter. Normalization consumes bytes/evidence and does not require permanent copied-asset hosting. Local persistence is chosen only by the explicit research CLI. It writes the descriptor last, checks an existing content ID before reuse, and does not overwrite existing prepared assets.

Course cache location: `tmp/shotcast-ingestion/packages/pga-a5d81a10-162d-ab8e-72f9-348e306d2a51/`. Separate player/proof/browser evidence: `tmp/shotcast-phase4b/`. Runtime never reads donor geometry or prepared-package native.bin. The new package contains no player-shot artifact.

Production must still decide permitted acquisition, cache/storage duration, derivation and distribution/delivery model. This phase grants no rights or production delivery permission, and does not encode a legal-policy workaround. The new acquisition transport refuses production use. Existing NODE_ENV guards and tmp tracing exclusions remain intact.

Reproduce discovery/preparation/numeric proof:

```sh
node scripts/prepare-shotcast-course.mjs \
  --event R2026006 --player 59095 --round 1 --hole 10 \
  --reference /home/markwohlever/nba-fantasy-app-3d/tmp/shotcast-ingestion/packages/pga-2f61f589-ec68-4c2a-a188-c8effb517698
```

The reference argument supplies an acceptance oracle only. It never supplies bytes/configuration to the discovered candidate. A mismatch exits before an eligible descriptor is written; repeat successful runs preserve the original package.

## 16. Recommended Phase 4C next step

After manual review of this proof:

1. Strengthen registration independence with a fresh original PGA Waialae runtime capture, then withheld holes/rounds; keep accepted math/tolerances fixed.
2. Make registration proof/capability records explicitly per hole/setup and separate source/profile validation from current-player eligibility. Add reason-code/freshness tests and explicit revision selection.
3. Use **Spyglass vs Pebble** as the next bounded multi-course proof: actual player-round joins, alternate root and complete offset replacement; include Farmers/AmEx STATS rejection cases. Do not acquire a speculative course library.
4. Keep production 2D and resolve delivery rights separately before any production acquisition/hosting proposal.

This is the smallest next validation/generalization gate. Background preparation, all-history backfill, future prewarming and automatic production defaults remain later work.

## 17. Exact git status --short

```text
 M lib/shotcast/ingestion/prepared.ts
?? app/shotcast-3d-proof/
?? components/lineups/GolfShotcastPreparationProof.tsx
?? docs/shotcast-ingestion/PHASE4-SCALABILITY-AUDIT.md
?? docs/shotcast-ingestion/PHASE4B-WAIALAE-PREPARATION.md
?? lib/shotcast/preparation/
?? scripts/prepare-shotcast-course.mjs
?? tests/shotcast-ingestion/course-preparation.test.mjs
?? tests/shotcast-ingestion/fixtures/waialae-r2026006-r1-h10.json
?? tests/shotcast-ingestion/preparation-browser.mjs
```

HEAD and branch are unchanged. No commit, push, merge or deployment. Phase 4B stops here for review.
