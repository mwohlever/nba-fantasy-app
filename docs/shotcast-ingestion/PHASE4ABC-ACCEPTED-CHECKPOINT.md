# ShotCast Phase 4A–4C accepted checkpoint

Accepted on 2026-10-07, on `shotcast-3d-take2`. Phase 1–3 base:
**c0977b3e1a4c79dc82465d1f0aa0595d5e1802dd** (`c0977b3`).

**Phase 4D has not begun. Production continues to use 2D; automatic production
3D defaults have not been enabled.**

## Accepted scope

- **Phase 4A: CONDITIONAL GO.** Published PGA geometry, configuration and native
  coordinates support a validated subset of tournaments. Coverage, historical
  versions, optional flight/putt data and distribution rights limit that scope.
- **Phase 4B: PASS.** Sony event R2026006 automatically resolves Waialae 006 and
  prepares Gotterup 59095 R1/H10 from fresh provider assets/configuration. Its
  published **0.424586°** rotation is discovered without a manual transform;
  retained-reference comparison has zero residual.
- **Phase 4C: PASS for bounded published-runtime-function and multi-course
  generalization.** Original current PGA coordinate/grounding functions provide
  an independent oracle. Direct live-page capture remains **PARTIAL** because
  Chromium received HTTP 403; the evidence is controlled provider-function
  execution, not a live public-page scene capture.

Proven courses: **Southwind, Waialae, Spyglass and Pebble**. The accepted Southwind
math, coordinates, renderer, controls and fallbacks remain unchanged. Waialae's
original preparation/replay and prior evidence are preserved.

## Proven architecture and assignment semantics

`PGA event → player/round course assignment → provider course identity → published
assets/configuration → generic normalization → fixed registration engine →
objective validation → current-player world → accepted renderer / 2D fallback`.

Course-specific values are data: IDs, roots, offsets/rotation, geometry, imagery,
setup, native shots and optional paths. No course-specific registration algorithm,
corrective offset or donor-package copying supplies the new preparations.

For **AT&T Pebble Beach R2026005**, fresh tee times assign **Morikawa 50525 R1 to
Spyglass 205**, and **R2–R4 to Pebble 005**. Tee-time player membership within the
requested round is authoritative; event inventory validates the alias. The final
leaderboard's course 005 cannot resolve historical R1. Missing/conflicting joins
reject instead of selecting the host. Permanent physical-course/version aliases
remain a later registry responsibility.

Measured maximum registration errors against current published PGA functions:

| Proof | Maximum 3D residual |
|---|---:|
| Waialae R1/H10 | 9.272582701669307e-13 m |
| Spyglass R1/H1 | 1.5631940186722204e-12 m |
| Pebble R2/H1 | 3.7765346405649325e-12 m |

XY is exact; the unchanged CPU gate is **1e-8 m**. Provider strict queries match
normal queries for all 31 diagnostic anchors, without requiring nudging/nearest
recovery. These are computational parity results, not survey-accuracy guarantees.

## Validation and production boundaries

Admission requires unambiguous identity, supported reviewed profile, finite and
source-consistent configuration, matching asset roots/hashes, valid native inputs,
containing geometry, correct green/pin and independent registration evidence.
Adversarial wrong assignments, transforms, mixed assets and invalid inputs reject.
Uncertain critical inputs retain **2D**. Optional flight/putt/Green capabilities
are separate; unsupported paths are never fabricated.

Preparation separates acquisition, normalization and delivery. Research acquisition
is disabled in production; the proof page additionally requires development mode
and explicit opt-in. Existing production GET/POST guards and tracing exclusions
remain. No downloaded PGA JavaScript, course binaries/images/worldfiles, raw
payload dumps, screenshots, logs, caches, build output or donor packages enter this
checkpoint. Numeric regression projections and provenance summaries are retained.

**Production acquisition, storage, derivation and distribution rights remain
unresolved. Public access does not establish those rights.**

Not implemented: a persistent production course registry, production asset hosting,
background preparation, universal coverage, broad historical backfill, future-event
prewarming or automatic production 3D defaults.

## Fresh acceptance evidence reused

Phase 4C completed the following immediately before this checkpoint review:

- **88/88 focused tests**, including original 58 Phase 3, 13 Phase 4B and 17 Phase
  4C tests; final Phase 4C focused rerun also passed.
- **31/31 browser scenarios**: original Scores/Live 16, Waialae 5, Spyglass 5 and
  Pebble 5. Historical test boundary reported no errors or mutations.
- TypeScript and lint passed; production build passed.
- Diff/whitespace checks passed.
- **168 production traces** contained no research files.
- **7/7 production isolation checks** returned **404**, including all proof
  variants, preparation GET/POST and both new course asset requests.
- Southwind/Waialae preservation and fresh Spyglass/Pebble proofs passed.

This finalization adds only this document. Full tests, browser suites and production
build are **not rerun**. Lightweight checks review file scope, size, whitespace,
obvious secrets/generated artifacts and staged contents.

Detailed durable reports:

- [Phase 4A scalability audit](PHASE4-SCALABILITY-AUDIT.md)
- [Phase 4B Waialae preparation](PHASE4B-WAIALAE-PREPARATION.md)
- [Phase 4C runtime/multi-course validation](PHASE4C-RUNTIME-MULTICOURSE-VALIDATION.md)

Ignored evidence remains under `tmp/shotcast-phase4c/`; local prepared assets remain
under `tmp/shotcast-ingestion/packages/`. A fresh checkout needs permitted local
preparation/evidence for asset-dependent tests and proofs; the checkpoint does not
ship those files. Guarded scripts retain that research workflow.

## Phase 4D starting scope, pending approval

Unify existing authorized Golf event resolution with player/round course identity;
introduce a minimal metadata/version registry; record per-hole/setup validation and
immutable hashes; build capability resolution with deterministic 2D reasons; add
explicit reuse/invalidation and normal development integration. Model current and
upcoming readiness separately from production delivery or background scheduling.

Do not start Phase 4D automatically. Production activation, hosting and rights
decisions require separate review.
