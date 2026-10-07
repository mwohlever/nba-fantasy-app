# Phase 4D.1 — durable registry foundation

Branch: `shotcast-3d-take2`. Starting checkpoint:
`9de70e8951ece837f75c414d9c8fab73f1a97899`.

This implements a metadata seam only. Existing requests, scoring, UI, renderer,
research guards and 2D defaults remain unchanged. No runtime acquisition, worker,
asset hosting, backfill or capability resolver is added.

## Existing identity boundary

Golf has no separate canonical tournament table: Group-owned `slates` hold ESPN
`external_event_id`; `golf_event_players` link those slates to `golf_players`.
Rounds/holes belong to event-player/round records. `golf_course_holes` holds existing
slate-scoped scoring metadata and is unchanged. ShotCast currently resolves PGA
schedule/player identities separately by name through its existing provider path.
`owgr_player_id` is used by ranking imports; this registry does not reinterpret it
as a universal ShotCast player mapping or change existing provider mappings.

The new provider-wide registry is shared across Groups. An optional explicitly
reviewed ESPN/PGA event link bridges the existing tournament identity; an optional
explicit `golf_player_id` on an assignment bridges the existing player identity.
Missing links remain missing. No names, host flags or leaderboard course fields
create inferred links. Future application callers must retain slate/Group authorization.

## Tables and application seam

- `shotcast_events`: PGA event/season/name, optional unique ESPN link and its source,
  small schedule/inventory provenance.
- `shotcast_event_courses`: composite event/course key, host/alternate relationship,
  provider scoring coverage. Course IDs remain text, including leading zeroes.
- `shotcast_player_round_courses`: composite event/PGA-player/round key,
  authoritative or unresolved state, optional event course, reason and tee-time
  provenance. Composite foreign keys prevent cross-event course joins.
- `shotcast_prepared_revisions`: immutable preparation/configuration/profile hashes,
  package identity, asset root, prepared holes and bounded validation evidence.
- `shotcast_revision_assets`: immutable individual asset IDs/roles/source URLs/hashes.
  No binary assets or large provider payloads are stored.

`registry/resolution.ts` exposes
`resolveCourseForPlayerRound(reader, eventId, pgaPlayerId, roundNumber)`.
It returns event/course/player/round, state, source and provenance, or an explicit
unresolved reason. Inventory validates the assigned alias. Missing, conflicting,
unlisted or invalid-provenance assignments cannot select the host. The current or
final leaderboard course has no assignment role.

`createShotcastRegistryReader(db)` reads only Supabase metadata.
`findShotcastEventForTournament(db, espnEventId)` reads an explicit stored event link.
Neither acquires provider resources or changes records; no existing route imports them.
Database read errors propagate rather than being hidden as lack of coverage.

`registryRecordsFromTeeTimes(...)` reuses the accepted Phase 4C
`assignmentFromTeeTimes` integrity/query/membership gates and returns event, inventory
and assignment rows. `registryRecordsFromPreparedCourse(...)` reuses
`validatePreparedCourse` and returns a staged revision, asset rows, and a separate
validated-state patch when its existing bounded proof passes. These are explicit
projection functions, with no database writer or transport.

## Revision states and persistence order

States: `pending`, `staged`, `validated`, `rejected`, `stale`.
Pending reserves a known content identity; staged records prepared metadata/assets;
validated retains accepted bounded registration evidence. Rejected/stale require a
reason. A validated proof covers its recorded hole/native-input hash, not every
hole, round, setup or production-delivery capability.

For a future explicit writer: register event/courses first, insert the staged
revision, insert its asset hashes, then apply the returned validation patch.
Do this transactionally when persistence is implemented. Existing content hashes
and validation evidence cannot be overwritten; changed content needs a new revision.
The projection always leaves `is_current=false`. Explicit approval can select a
validated revision as current; the database permits at most one per event/course.
`selectCurrentPreparedRevision` rejects absent, multiple, stale, rejected or
unvalidated selections. It is a metadata selector, not a capability resolver.
No automatic freshness detection, approval, persistence or state-transition worker
is implemented in 4D.1.

## Migration status

Migration **was manually applied successfully on 2026-10-07** by the user in the
shared/live Supabase project's SQL Editor:
`supabase/migrations/20261007000100_shotcast_registry_foundation.sql`.
The reported SQL Editor result was **Success. No rows returned**.
No further migration action is required.
This migration creates five tables, constraints/indexes, revision/asset immutability
guards, RLS, and service-role-only permissions. No browser policies are added.
Applying it does not activate any application path.

## Bounded verification

`node --test tests/shotcast-ingestion/registry-foundation.test.mjs` uses compact
projections of accepted Phase 4C evidence and a metadata-only prepared Spyglass
fixture. It needs no ignored local assets, provider calls or browser.
Coverage includes single/multi-course assignments, Morikawa R1 Spyglass/R2–R4 Pebble,
missing/conflicting/unlisted assignments, historical leaderboard isolation, query/
hash provenance rejection, explicit identity links, revision states and metadata reads.

Results: **18/18 targeted tests passed**. Repository TypeScript, the final registry
compile using repository configuration, scoped ESLint and whitespace checks passed.
No browser tests or production build were run.

No Phase 4A–4C research, geometry proofs, historical browser scenarios or full
repository test suite were repeated. Phase 4D.2 is not begun.
