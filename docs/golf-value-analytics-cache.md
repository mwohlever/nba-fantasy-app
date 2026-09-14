# Golf Value V1 historical analytics cache

This foundation separates real ESPN PGA results from fantasy slates. The migration
`20260920000100_golf_value_analytics_cache.sql` is **manual-only** and has not been
applied. Do not invoke refresh or Generate against a database lacking that migration.

## Acquisition and storage

GitHub Actions is the production ESPN worker because deployed Vercel egress is
blocked by ESPN. `golf-analytics-weekly-ingest.yml` runs Sunday at 05:17 UTC and
also supports `workflow_dispatch`; it defaults to the current UTC calendar year,
which matches ESPN PGA's `season.year` representation. The worker fetches the
season directly with the existing Golf user-agent, runs the same pure TypeScript
normalizer used by the app, sends a compact begin manifest, then one completed
raw event snapshot at a time, and finally a compact finalize manifest. It never
sends the 25.5 MB season response to Vercel.

The machine endpoint is `POST /api/internal/golf/analytics-ingest`. It requires
the narrowly scoped `GOLF_ANALYTICS_INGEST_SECRET` bearer token, which exists only
as a GitHub Actions secret and a Vercel server environment variable. GitHub has
no Supabase credential. The retired `/api/admin/golf/analytics-refresh` endpoint
returns `410`; it no longer attempts Vercel-to-ESPN acquisition. Other Golf
provider calls retain their existing proxy/browser paths.

The current 2026 proof measured a 1,183,388-byte begin request and a largest
single-event request of 967,071 bytes. The ingestion endpoint rejects bodies over
2 MB. The worker validates acknowledgements and retries safe transient requests;
an interrupted run leaves only an `ingesting` refresh, which Salary Setup ignores.
It resolves competitor ESPN IDs to existing
`golf_players.id`; it never inserts golfers or creates fantasy slates. The response
reports unresolved identities and event diagnostics. If fetch, validation, identity
lookup, or persistence fails, the endpoint fails and no season refresh is marked
ready. An incomplete `ingesting` run can be retried.

The season refresh row records the full-response hash, byte count, schedule IDs,
normalization hash, diagnostics, first observation time, and last successful check.
Completed events are stored once per event-content and normalized-content hash,
including a JSON text snapshot of that event. This is intentional audit evidence:
the exact stored event text can be rehashed and renormalized without retaining a
duplicate 25 MB season blob for every board. The full-response hash is provenance,
not a promise that the full original response can be reconstructed byte-for-byte.
Normalized observations pin canonical golfer ID (or explicit null), ESPN ID,
status, finish percentile, and V1 regulation-round differentials. Ready event
versions and observations cannot be rewritten. A provider correction, adapter
version change, or newly resolved identity creates a new event version. Identical
source and identity mapping reuse the same version; a successful repeated check
advances only the refresh check time. A season refresh pins its exact event-version
IDs, including accepted and unsupported completed events.

## Salary generation

Generate reads the latest complete season refresh checked within seven days. A
missing/stale/incomplete cache, missing target event in the season schedule,
unresolved target golfer identity, malformed completed individual-event data, or
target start already reached is an error. Explicitly unsupported team formats
are skipped and reported; they do not silently become individual history.
The commissioner should see that error, refresh/reconcile the cache, and retry;
there is no fallback to fantasy slate history. Individual golfers with genuinely
no ESPN performance history still follow V1's existing OWGR/no-history fallback.

The read path selects only ready, accepted event versions pinned by that refresh,
with event end and readiness before the target cutoff, observation/readiness by
the board's `asOfAt`, target event ID excluded, and the existing UTC calendar-year
V1 season policy. `asOfAt` is captured before Salary Setup reads the cache. The
current route uses midnight UTC on the slate's start date as a conservative
cutoff; a future targeted change should use a verified provider/tee-time start
instant. No commissioner request downloads the season response.

The immutable board-input manifest is inserted atomically with the generated
price set. It copies the target field, amateur flags, exact OWGR ranks and rank
observation times, refresh/source hashes, selected event-version IDs and hashes,
selected observation IDs, cutoff, model/normalization versions, and an input hash.
An OWGR value without an observation time, or observed after `asOfAt`/the target
cutoff, becomes unavailable for this board and is recorded with a reason; V1's
existing V1-only/unsupported review behavior then applies. Later rank updates
cannot silently change a generated or frozen board. Replay should load the
manifest's pinned observation IDs and preserved OWGR values, not select today's
latest cache or mutable `golf_players.owgr_rank`.

This migration adds four tables because they have distinct ownership and lifetime:
season refreshes prove complete acquisition and freshness; event versions retain
deduplicated source evidence; observations support canonical golfer history reads;
board inputs freeze the exact game-specific selection. Only the last table links
to a fantasy price set. None of the provider-history tables has `slate_id` or
Group ownership.

## Limits to verify before production activation

The ESPN PGA feed does not establish all-tour coverage. ESPN often omits explicit
cut/WD/DQ status, so partial two-round cards remain `unknown` with real-round
partial weight under current V1 behavior. Validate source status semantics before
changing result grades. The seven 2026 playoff-period events now retain four
regulation rounds; period 5 and 402 are excluded from round differentials.
The worker processes a large response and the server persists thousands of
observations; validate the first real manual run and Vercel function logs after
the migration is manually applied. A provider correction, adapter version change,
or newly resolved identity creates a new version. A failed/missing event batch
cannot pass finalization, so it cannot become a ready source for Salary Setup.
An arbitrary historical as-of query cannot reconstruct provider knowledge from
before the cache began collecting snapshots; reproducibility is guaranteed for
boards whose manifests were generated from captured evidence.
