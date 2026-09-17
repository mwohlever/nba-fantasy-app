# NFL V2 shadow projections (Phase C)

Phase C produces only global raw QB/RB/WR/TE stat-line projections. The active shadow version is `nfl-v2-o1-opportunity5-production8-coldstart-v1`; its O1 opportunity/production formula remains frozen, with an explicit early-season prior-season window-fill bridge. It does not modify Draft, Home, Scores, live scoring, standings, or pick-time behavior. D/ST and K have no NFL V2 rows.

## History and model

Generation reads `nfl_player_game_observation_versions`, not the current view. For as-of `T`, it admits only immediately-prior-season or target-season regular observations where both `game_at < T` and `known_at < T`, then chooses the latest known version per provider/player/event. This prevents a later ESPN correction from leaking into an earlier reconstructed projection.

O1 uses last-five mean opportunity and last-eight ratio-of-totals production, exactly as frozen in model selection. During cold start each window independently fills its unused slots with the player's most recent regular-season observations from *only* the immediately preceding season: with one current game, opportunity is one current plus up to four prior and production is one current plus up to seven prior. At five current games opportunity is current-season-only; at eight current games production is current-season-only. There is no weighting layer and no reach into an older season. A player with no current games can therefore project from valid prior-season history; a player with neither remains unavailable. Any bridge projection is `low`; the existing `normal` threshold remains five current-season games.

The live factual versions table must contain the immediately preceding season for this bridge to be available. The frozen local research cohort is intentionally not used as a production fallback because it is not the full active player population. Before the first cold-start generation, manually backfill reviewed 2025 factual observations through the existing Phase B path; do not seed research artifacts directly.

## Cache and scoring

The manual migration `20260927000100_nfl_projection_stat_cache.sql` creates immutable cache versions plus a current view. Cache rows contain raw projected stats, source boundaries, sample/components, confidence, model version, and a deterministic projection hash. They contain no fantasy points, group, league, or slate identity.

Admin-only `GET /api/admin/nfl/projection-shadow?season=2026&slateId=...` shows raw shadow rows, availability, audit counts, and—only when a slate is supplied—read-time fantasy points computed with that slate's frozen `rules_snapshot` through `calculateNflFantasyPoints`. It defaults to the cold-start version; pass `modelVersion=nfl-v2-o1-opportunity5-production8-v1` to audit original first-run cache rows explicitly.

## Rollout

The cache migration is already applied. First manually dispatch **NFL projection observation refresh** with `season=2025` and `dry_run=true`; inspect the result, then repeat with `dry_run=false` only after approval and inspect the factual audit. The workflow's scheduled runs remain 2026. Next deploy this code and manually dispatch the **NFL projection shadow generation** workflow for 2026. It is intentionally unscheduled. Inspect the admin audit, including the explicit model version, before any later cadence decision. No automatic generation is enabled by this repository change.
