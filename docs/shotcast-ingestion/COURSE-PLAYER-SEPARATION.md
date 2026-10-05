# Phase 2: reusable course preparation and current player replay

## Runtime model

Before this correction, the development resolver matched event/player/round/hole to a research descriptor, read that descriptor's `native.bin`, and returned frozen research endpoints and tee/pin. That correctly prevented Henley's strokes being attributed to another golfer, but also restricted reusable Southwind spatial assets to Henley's captured round.

The current runtime combines **prepared event/course/hole spatial assets** with **the selected golfer's current hole response**:

1. Current Scores / Live and GolfPlayerModal / RoundScorecard / GolfHoleReplayPanel remain unchanged by this correction.
2. The existing visualization slot projects identity, native first-shot/start coordinates, native endpoints and `pinWorld` from the replay already fetched by the current panel. It sends only that static subset to the same-origin development endpoint using a read-only POST. There is no new PGA fetch, fake player response, scoring write or navigation destination.
3. `readPreparedCourseDescriptor` projects course fields out of the preserved research descriptor. It does not expose research `shotSource`, `selection` or player-specific validation cases to runtime preparation.
4. The resolver matches event and prepared hole, verifies the selected golfer's round/course assignment against hash-checked event tee-times, rejects ambiguity, validates the engine/course configuration, and checks the required spatial asset hashes.
5. The unchanged validated geometry operations ground every current endpoint, the current first-shot start (tee marker) and current round pin. Missing, non-finite, duplicate or ungroundable data returns no view. There is no fallback to research strokes or research tee/pin.
6. The resulting handoff is tied to the current event/player/round/hole. Existing endpoint equality and capability checks remain. The current selected stroke controls the same markers and callbacks.
7. The 2D viewport remains visible until the renderer's first frame; errors or WebGL failure retain 2D. Changed replay coordinates remount preparation/renderer so a previous ready frame cannot activate a refreshed hole.

The development POST accepts the current panel's read-only projection, not an authenticated server attestation of arbitrary submitted coordinates. The normal application source is its existing PGA replay flow. Independent event/course assignment and geometry validation still occur server-side. This is a local development renderer, not a new public PGA data API.

## Artifact ownership

| Artifact | Ownership / runtime use |
| --- | --- |
| Terrain GLB, green GLB, course/hole images, world files, mask, course data and PGA offset configuration | Reusable prepared event/course/hole assets; preserved bytes and geometry unchanged |
| Event `tee-times.bin` and provenance hash | Independently verifies the CURRENT selected golfer's round/course assignment; event ID must also match |
| Original `descriptor.json` | Frozen research envelope; projected into a course-only descriptor at runtime, never rewritten |
| Original Henley/Brennan `native.bin`, research selection, validation cases and frozen observations | Player-specific research evidence only; runtime preparation never reads native.bin |
| Current replay identity and `shots[].leftToRight.from/to` | Selected golfer's actual provider data, sent unchanged by the current slot |
| Current replay `pinWorld` | Selected golfer/round/hole's authoritative provider pin; no research pin substitution |
| Tee marker | Current first stroke's native `leftToRight.from`, representing the actual tee-shot start; not a reused/rounded research `teeOverview` |

No asset/package duplication or third-party binaries in public/. Production still renders 2D and the development GET/POST endpoints return 404 before importing the resolver.

## Scheffler regression input

`tests/shotcast-ingestion/fixtures/scheffler-r2026027-r1-h1.json` is a captured real current-provider response projected to static fields. It retains all four unmodified native endpoints, first-shot start and pin. Its capture/source metadata is included. It is an engineering test input, not injected normal-user acceptance or a newly authored PGA fixture.

Scheffler resolves to R2026027 / player46046 / R1/H1; preserved tee-times independently assigns course513 (TPC Southwind). The same Southwind package ID/assets used by Henley ground all four Scheffler endpoints. The first three differ from Henley's; the pin/final endpoint legitimately coincide for this round/hole.

## Acceptance boundary

Focused tests cover the original Henley/Brennan provider transports, same-assets Scheffler preparation, exact current coordinate grounding, no runtime native.bin reads, wrong event/unassigned player, ambiguity/wrong course, missing preparation/data, production gating and frozen geometry/evidence hashes.

`browser-acceptance.mjs` is explicitly an ENGINEERING harness. It uses captured historical database records, a simulated local account and intercepted preserved replay responses. Its Scheffler Scores case uses the real captured current provider response and the historical actual Jon roster; it verifies the real current component seam, renderer and interactions. It does not prove a normal authenticated user session. The real development POST/asset endpoint is used, not intercepted successful preparation.

Normal authenticated Scores acceptance is left to the user when agent login access is unavailable:

1. Run `npm run dev` in nba-fantasy-app-3d-take2 and use the port Next prints.
2. Open `/lineups/scores?sport=golf` and select FedEx St. Jude Championship.
3. Expand the team containing Scottie Scheffler (Jon in the captured historical roster).
4. Open Scottie Scheffler, Round 1, Hole 1 and expand ShotCast if collapsed.
5. Expect the existing slot to show Southwind terrain with the 3D ShotCast label, tee/pin and numbered markers1–4. Navigator and marker selection must agree; orbit, zoom and Reset remain. Main's navigator still starts existing 2D replay and can switch putts to Green View. Non-putt replay returns to static 3D when finished; use the existing Course button to return from Green or cancel playback. No 3D animation was added.
6. Close the replay and open Hole 2. It remains 2D because H2 spatial preparation is absent. Other events/courses without preparation remain 2D.

The current Golf Live tournament behavior is untouched. No animation or Phase 3 behavior is enabled.

## Completed checks

- Focused foundation/capability/parity suite: 25/25 pass. Includes runtime no-native.bin-read coverage, selected-player course verification with wrong/ambiguous assignments, corrupt-asset integrity rejection and production GET/POST guards.
- Whole-project TypeScript and focused ESLint: pass. `git diff --check`: pass.
- Production build: pass. All165 production route traces contain zero prepared packages/local research evidence. The existing edge-runtime/static-generation notice remains.
- Engineering browser harness: all12 scenarios pass, at1400x900 and390x844. Current Scores/Jon/Scheffler R1/H1 shows four markers, tee and pin; marker/navigator selection, orbit, zoom, Reset, Course/Green switching and remount pass. Real captured H2 remains2D. Missing preparation, terrain503, unavailable WebGL and WebGL context loss all fall back. Normal scenarios have no console/page errors or horizontal overflow. Injected failures produce only their expected network/Three diagnostics.
- Screenshots/results: `tmp/shotcast-activation/separation-browser/`; explicitly engineering evidence, not normal authenticated acceptance.
- After restoring normal `.env.local` development on localhost3001, fresh real upstream provider responses were submitted to the actual development POST endpoint. Scheffler/Southwind R1H1, Henley/Southwind R1H1 and Brennan/Sedgefield R1H1 resolve, independently verify course assignment and match every current endpoint. Actual Scheffler/Southwind H2 and Henley/TOUR Championship H1 return null/2D eligibility. All returned asset URLs are relative. This is an endpoint diagnostic; the browser lacks an authenticated normal account.
- Main and donor HEAD/status and all inventoried donor source hashes remain unchanged. All36 copied prepared files are byte-identical to the donor. Geometry, native research responses and frozen parity observations are unchanged.

No commit, push, merge, deployment or Phase3 work. Normal current-app manual Scores acceptance is still the user's final step.
