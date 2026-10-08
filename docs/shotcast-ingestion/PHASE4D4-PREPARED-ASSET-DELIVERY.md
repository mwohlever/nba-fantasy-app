# Phase 4D.4 — prepared asset storage/delivery foundation

Branch `shotcast-3d-take2`; starting HEAD
`f7f2924c2001e29f5ab8a3ce721c02c84028859c`. No activation, uploads, registry
population, application route, renderer change, or live database work by Codex.

The accepted course-only manifest is schema 2 / preparation version `1`, built on
the legacy schema 1 descriptor. Preparation identity hashes the course identity,
configuration, reviewed engine/application, asset hashes and hole references.
It records native feet, metres, degrees, XY horizontal / Z up and configuration
offsets. GLBs are checked at preparation for external buffer/image dependencies;
imagery/materials use the explicit JPEGs and PNG mask. No provider JavaScript is
needed for delivery. Existing research reads hash-check `.bin` files referenced by
`localPath` under `tmp/shotcast-ingestion/packages/`; that path is never used here.
The accepted renderer expects terrain/optional Green GLBs, course/hole JPEGs and
mask URLs, parsed world files and the existing configured world construction.

A bounded hole needs seven static objects: course data/image/world file and hole
terrain/image/world file/mask. Optional detailed Green adds one GLB. Player shots,
round setup/pin and optional flight/putt inputs remain separate; this delivery
index alone does not construct a replay or attest new player registration.

## Storage and contract

Dedicated private Supabase bucket `shotcast-prepared-private`. Fixed keys:
`revisions/<64-character preparation_id>/<canonical asset_id>.bin`.
Browser roles cannot list/read/write these objects or manage this bucket, even
through an existing broad permissive policy. Existing buckets are unaffected.
Server credentials stay behind `server-only` module guards.

One new table, `shotcast_asset_delivery_manifests`, references the existing
revision. Separate explicit delivery approval prevents previously validated
research metadata from authorizing distribution. Its immutable bounded manifest
contains schema 1, accepted package schema 2, preparation ID/version, proof hole,
and seven/eight asset IDs, kinds, fixed paths, SHA256s, byte sizes and MIME types.
Manifest identity is SHA256 using the existing canonical JSON/hash function.
No binary data or signed URLs are persisted. Limits: 16 KiB manifest, 50 MiB/object.

`resolvePreparedShotcastAssets(registry, storage, { request, approvedRevision,
eventCourse, hole })` reuses 4D.2 validation and re-reads current revision approval.
It requires the exact expected revision/course and validated proof hole, checks
all references against registry hashes/roles, validates manifest hash/version,
and checks each exact object's size/MIME with Storage `info`. It signs only that
set for 60 seconds and validates returned origin, object/token scope and expiry.
Failure returns a deterministic unavailable result with no URLs or raw errors.

`createGolfPreparedShotcastAssetDelivery(db, authorizeSlate, storageOrigin)` is a
dormant server factory. A future caller must bind `authorizeSlate` to existing
`authorizeSlateResource(request, slateId)` with ordinary user access. It rejects
internal mode, verifies Golf/league/slate ownership and slate player membership,
then requires reviewed ESPN/PGA event and internal/PGA player/round links. Caller
input contains only slate ID, Golf player ID, round and hole; no bucket/key.
No existing route imports this factory. Future HTTP delivery must use no-store.

## Integrity and manual setup

Future explicitly authorized upload code must run
`verifyPreparedShotcastAssetBytes(asset, bytes)` for **every** asset, upload with
`upsert:false` and the declared MIME type, verify stored object metadata, then
record the immutable manifest/integrity timestamp and explicitly approve delivery
after rights review. Do not overwrite approved keys; changed content requires a
new revision. This phase supplies verification, not an uploader/approval writer.
Read-time checks do not re-hash binaries or acquire provider assets.
Privileged storage operators must honor this immutability contract. Supabase
signed URLs are bearer grants until expiry; revocation prevents new grants but
cannot immediately revoke an already issued URL (maximum 60 seconds).

The user manually applied the **entire** migration successfully on **2026-10-08**:
`supabase/migrations/20261008000100_shotcast_prepared_asset_delivery.sql`
in Supabase SQL Editor. Reported result: **Success. No rows returned.**
The already applied 4D.1 registry migration was its prerequisite. This migration
creates the bucket, scoped restrictive policies, manifest table/RLS and
immutability/approval guard. No further migration action, uploads or approvals are
required in 4D.4. Migration is **applied**; do not rerun it.

Targeted verification uses only metadata fixtures/fake storage objects:
`node --test tests/shotcast-ingestion/prepared-asset-delivery.test.mjs`, repository
TypeScript, scoped ESLint and whitespace checks. No browser/full-suite/build.
Results: **78/78 tests passed**; `npx tsc --noEmit --incremental false`, scoped
ESLint on both server modules and both test files, and whitespace checks passed.
Shared capability production code was unchanged, so 4D.2 tests were not rerun.
