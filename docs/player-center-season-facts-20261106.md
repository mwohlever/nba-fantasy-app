# Player Center season facts and Draft sorting

Branch: `feature/player-center-season-facts`, based on production main `e604dfd`.

Profiles now use ESPN published season totals and GP for season averages, independently of game-log coverage. Fantasy totals reuse the existing canonical scorer with the authorized Group settings or frozen slate snapshot. All required scoring inputs must be numeric; missing fields and GP remain unavailable. D/ST season fantasy scores still require game-level tier calculations; kicker fantasy scoring remains unconfigured.

NFL profile enrichment requests at most five recent appearance summaries, in groups of at most three concurrent reads. Unknown or failed recent appearances do not cause requests for older replacement summaries. Older stored observations and durable snapshot games remain accessible; no history is deleted or written. Recent-window verification uses the validated chronological appearance log independently of season GP/scoring-field completeness.

Draft Season sorting uses bulk facts joined only through verified ESPN identities, with eligible local player IDs supplied by the browser. Unknown/duplicate mappings and absent players cannot borrow data or become zero-stat players. Complete rankings require coverage of every relevant eligible player; partial values sort numerically with missing values last in either direction. NFL bulk fantasy scores remain unavailable without total fumbles lost; explicitly loaded complete individual season facts can contribute qualified partial coverage. Negative-stat sort choices are removed from both current and stored-season Draft controls; profile/game/scoring fields remain intact.

## Sources and limits

Individual source:
`https://sports.core.api.espn.com/v2/sports/{basketball|football}/leagues/{nba|nfl}/seasons/{year}/types/{phase}/athletes/{ESPN-ID}/statistics`

Bulk source:
`https://site.web.api.espn.com/apis/common/v3/sports/{basketball|football}/{nba|nfl}/statistics/byathlete?season={year}&seasontype={phase}&isqualified=false&sort={general.gamesPlayed|passing.passingYards}:desc&limit=100&page={page}`

NBA uses ending years (2027 = 2026–27); NFL uses starting years. Phase 1/2/3 means preseason/regular/postseason. Parsers validate response identities, season/phase, category-qualified names, numeric values, pagination and duplicate identities. Bulk batches publish atomically after every page succeeds. Limits: 100 rows/page, 40 pages/4,000 rows, 3 MB/response, 15-second batch deadline, at most three concurrent pages after page one establishes pagination. A mismatch or failed page retains the previous successful batch instead of publishing a partial pool.

Profile and bulk caches are separate bounded process-local caches, with request deduplication, 15-minute current-season / 24-hour historical-season TTLs, 30-second failure backoff and bounded stale fallback. Bulk facts contain no Group scores. Cold server instances fetch again; no distributed cache or new infrastructure was added. Fetch timestamps describe retrieval, not an ESPN guarantee of real-time updates.

Live read-only verification on November 6 returned 452 unique NBA rows and 1,940 unique NFL rows. NFL bulk omits total `general.fumblesLost`; rushing-only/receiving-only losses are not substitutes. The first sequential NFL probe took about 13 seconds; the final reader fetches remaining pages in bounded concurrent groups.

## Validation

- 171 focused/regression tests pass, including captured Burrow, Castle and Curry reconciliation, frozen-rule scoring, nullable inputs, stale/error caches, atomic pagination, identity conflicts, sorting, comparisons, modal recovery and retained history.
- Burrow's seven captured completed games, including September 13, reconcile to 169.60 FP / 24.23 per game. Castle: 237.80 FP / 29.725 per game over eight games. Curry: 294.70 FP / 42.10 per game over seven games.
- Chromium: existing NBA/NFL Draft flows pass at 360/390/1280px with Player Center enabled and disabled. Published-season sorting/profile checks pass at 360/390px. Existing Burrow/Castle checks also pass against the local Next.js Dev server. Browser tests intercept APIs and reject writes.
- TypeScript and production build pass; `git diff --check` passes.
- Changed/new code has no new lint violations. Full repository lint retains 763 errors / 155 warnings; the four errors in the touched PlayerPool file were independently reproduced from the production base. No unrelated lint cleanup was included.

No scoring-rule, ingestion, observation semantics, database/schema/migration, or draft-history changes. No production writes, pushes, merges or deployments. Existing WIP stash preserved.
