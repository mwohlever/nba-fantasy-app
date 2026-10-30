# Isolated Player Center preview captures

`captured.json` contains public ESPN game logs/season statistics normalized by the existing read-only reader, joined only to exact reviewed local/native/provider IDs. It was captured with bounded public GETs and catalog SELECTs; zero database writes. It includes two NBA players, a prior NBA season, and NFL QB/RB/WR/K/D/ST examples. Metadata includes capture time, request count, identity source, source URLs, field-level missing values and coverage issues. Partial observations are deliberately retained.

These are **preview fixtures**, not a production cache, mapping backfill, complete league pool or current freshness guarantee. The preview freezes comparisons at the capture time and labels the sample pool. It never substitutes another player or season. Uncaptured seasons show unavailable; the missing-data toggle is explicitly a simulated QA case. Browser tests simulate DNP/live/unknown inputs independently of the captures.

Normal authenticated Player Center routes do not import this directory. `/player-center-preview` dynamically loads it only in development; production returns 404. The development preview bypasses background heartbeat maintenance, authenticated Group-context reads and notification preference initialization. Preview interactions never save a draft. CDN headshots use the existing component and fall back to initials if unavailable.

Optional recapture: `node scripts/capture-player-center-preview.cjs --live`. This makes read-only catalog SELECTs and bounded ESPN GETs (at most eight cold requests per profile; eight chosen profiles). It writes only this local JSON. It does not invoke ingestion/refresh/worker routes. Normal preview viewing needs no database/provider connection for the statistics. The fixture route therefore requires no authenticated API calls; these development-only guards do not affect normal production behavior.

October 26 normalization follow-up: `normalizationCorrections` records verified
fumbles-lost corrections for three player records across two games. The original
October 23 season cutoff/GP sample is retained; the preview banner discloses the
later evidence verification. Reproduce offline with
`node scripts/replay-player-center-preview-corrections.cjs`. The script validates
exact IDs/context and all unchanged box-score values before writing local JSON.
It does not contact a provider or database. See
`docs/player-center-nfl-scoring-investigation.md` for the evidence and limitations.
