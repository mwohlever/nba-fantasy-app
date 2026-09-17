# NFL V2 shadow projections (Phase C)

Phase C produces only global raw QB/RB/WR/TE stat-line projections for the frozen `nfl-v2-o1-opportunity5-production8-v1` model. It does not modify Draft, Home, Scores, live scoring, standings, or pick-time behavior. D/ST and K have no NFL V2 rows.

## History and model

Generation reads `nfl_player_game_observation_versions`, not the current view. For as-of `T`, it admits only target-season regular observations where both `game_at < T` and `known_at < T`, then chooses the latest known version per provider/player/event. This prevents a later ESPN correction from leaking into an earlier reconstructed projection.

O1 uses current-season last-five mean opportunity and last-eight ratio-of-totals production, exactly as frozen in model selection. Zero current-season history abstains; 1–4 games are `low` confidence and 5+ are `normal`.

## Cache and scoring

The manual migration `20260927000100_nfl_projection_stat_cache.sql` creates immutable cache versions plus a current view. Cache rows contain raw projected stats, source boundaries, sample/components, confidence, model version, and a deterministic projection hash. They contain no fantasy points, group, league, or slate identity.

Admin-only `GET /api/admin/nfl/projection-shadow?season=2026&slateId=...` shows raw shadow rows, availability, audit counts, and—only when a slate is supplied—read-time fantasy points computed with that slate's frozen `rules_snapshot` through `calculateNflFantasyPoints`.

## Rollout

After Mark manually reviews/applies the migration, deploy code and manually dispatch the **NFL projection shadow generation** workflow. It is intentionally unscheduled. First inspect the admin audit, then decide whether Tuesday/Wednesday factual refreshes should be followed by a separately dispatched generation run. No automatic generation is enabled by this repository change.
