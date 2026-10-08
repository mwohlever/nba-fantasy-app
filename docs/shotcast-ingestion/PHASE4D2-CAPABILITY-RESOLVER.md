# Phase 4D.2 — read-only 3D capability resolver

Result: **PASS**. Branch: `shotcast-3d-take2`. Starting and current HEAD:
`5a07c04982bb1faca9e57e5a39a1960fd61ce1dd`. Changes remain uncommitted.

## Server seam

```ts
const resolve = createShotcast3DCapabilityResolver(authorizedServerSupabaseClient);
const result = await resolve({
  eventId: "R2026005", playerId: "50525", round: 1, hole: 1,
});
```

The adapter is in `lib/shotcast/registry/supabaseReader.server.ts`. The injectable
`resolveShotcast3DCapability(reader, request)` and its types are in
`lib/shotcast/registry/capability.server.ts`. IDs are PGA IDs; this API does not infer
ESPN/internal-player links. Callers retain existing Group/slate authorization.
No product route or UI imports the resolver yet.

## Result and selection

`status: "available"` returns request, event, player, round, hole, authoritative
event course and assignment provenance, selected revision, preparation ID/version,
and separate `staticCourse`, `detailedGreen`, `flightReplay`, `suppliedPuttReplay`
capabilities. `status: "unavailable"` returns request, a typed reason and diagnostic
detail. Unavailable results expose no usable capabilities.

Course resolution reuses 4D.1's player/round assignment gates. No host or final
leaderboard fallback exists. Revisions and asset reads are scoped to the assigned
event/course and selected preparation, respectively.

Exactly one `is_current === true` revision must exist, and its state must be
`validated`. Multiple current selections fail closed, even though the database
normally prevents them. Unapproved validated revisions cannot be selected. No
timestamp ordering is used. Without approval, a uniform ineligible state yields
its state-specific reason; mixed states yield `revision_not_approved` regardless
of row order.

The existing explicit selector is reused. Additional gates check proof hashes,
finite bounded residuals, integral comparison count, validation/reference dates,
requested prepared hole and proof hole, package identity, accepted preparation
version and previously reviewed profile fingerprints, configuration hash shapes,
event-course asset root, unique revision asset identities/hashes, and required
roles/paths. Required IDs and paths follow the accepted `normalizeCourse`
projection convention. Missing required static asset metadata rejects readiness.
Unknown states and inconsistent metadata fail closed.

The proof is bounded to its recorded hole and native-input hash. Listing another
hole in `prepared_holes` cannot expand validation coverage. The result attests
registered static geometry metadata; it does not attest arbitrary player shots,
pins/setups, asset delivery or fresh asset bytes. No hashes are recomputed from
provider resources on this read path.

## Fallback codes

- `invalid_request`
- `event_not_registered`
- `course_assignment_missing`
- `course_assignment_ambiguous`
- `course_assignment_unresolved`
- `course_not_registered`
- `no_prepared_revision`
- `revision_not_approved`
- `revision_ambiguous`
- `revision_pending`
- `revision_staged`
- `revision_rejected`
- `revision_stale`
- `revision_not_validated`
- `required_assets_missing`
- `hole_not_prepared`
- `validation_failed`

The accepted projection's combined `missing_or_ambiguous_assignment` reason maps
to `course_assignment_unresolved`, retaining the original diagnostic in `detail`.
Other malformed identities/provenance map to `validation_failed` with detail.
Database read errors continue to propagate, as in 4D.1; they are not disguised as
missing coverage.

## Granularity and boundaries

Static capability returns this hole's seven required asset metadata records.
Detailed Green is available when its canonical asset reference is present and
consistent; otherwise it reports `unavailable / asset_not_recorded` while static
geometry remains available. Inconsistent registered assets fail closed.

4D.1 has no shot-specific replay evidence or flight/putt asset roles. Both replay
capabilities truthfully report `unknown / replay_evidence_not_recorded`. They never
claim a path exists or that the provider lacks one. Missing replay evidence does
not invalidate static geometry. No replay acquisition or new schema is needed.

No migration added/applied. No remote database changes, acquisition, preparation,
workers, asset loading, renderer changes, UI integration or production activation.
Existing 2D product behavior remains unchanged. Phase 4D.3 has not begun.

## Verification

- `node --test tests/shotcast-ingestion/registry-capability.test.mjs`: passed.
  Direct targeted execution also confirmed **50/50 cases**, with no failures.
- `node --test tests/shotcast-ingestion/registry-foundation.test.mjs`: passed.
- `npx tsc --noEmit --incremental false`: passed.
- Scoped ESLint on the two production files and new test: passed.
- `git diff --check`: passed.

Tests reuse the accepted assignment and prepared Spyglass fixtures. Pebble uses a
clearly labeled synthetic metadata selector fixture; no geometry proof is rerun
or newly claimed. Tests cover R1 Spyglass / R2–R4 Pebble selection and no host
leakage, all ineligible states, absent/ambiguous approval, bounded proof coverage,
required assets, bad metadata, granular optional capabilities, scoped Supabase
selects, error propagation, zero fetch calls and unchanged input records.

No browser tests, production build or full repository suite were run. Main and
donor are unchanged. No commit, push, merge or deployment occurred.

Next step: review this working-tree change for Phase 4D.2 acceptance. Phase 4D.3
requires a separate instruction.
