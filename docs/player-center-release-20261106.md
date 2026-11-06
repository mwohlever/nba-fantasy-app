# Player Center release

Release branch: `release/player-center-20261106`, based on `origin/main`.

## Production deployment — requires approval

1. Review the release diff and approve the release commit. Do not merge the WIP branch.
2. Merge only this release branch into `main` through the normal reviewed release process.
3. Build/deploy that exact commit with the existing Vercel Production configuration. Ensure `NEXT_PUBLIC_PLAYER_CENTER_ENABLED` is unset or `true` at build time; `false` disables statistical profiles. Do not enable local read-only review mode in production.
4. Run no migrations, ingestion, backfills, refresh scripts or scheduled-job changes.
5. Check login and Group context, NBA/NFL profiles, factual stats, comparison windows, league history, and mobile layouts. Inspect draft controls without submitting a production pick solely for testing.

## Rollback

Record the current Production deployment ID and commit before release. If acceptance fails, restore that previous deployment using Vercel's rollback controls. No database rollback is needed: this release changes no schema or stored data. Revert the release merge through the normal review process to keep `main` aligned. An emergency rebuild with `NEXT_PUBLIC_PLAYER_CENTER_ENABLED=false` disables professional statistical profiles, but restoring the previous deployment is the complete rollback.

## Known limits

Missing provider mappings, incomplete observations, stale data and unsupported fantasy inputs remain disclosed. Observed-data sorting is not a certified full-pool ranking. Kicker fantasy scoring remains unavailable. Local write interactions use fixtures; no production draft was submitted. Vercel Preview is intentionally skipped because an isolated Preview database is not configured.

The shared NBA ingestion parser, semantic-append infrastructure, canonical scoring rules and draft-history mutation implementation are unchanged from the release base.
