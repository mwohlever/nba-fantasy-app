# Josh Allen game-log regression samples

Captured read-only from ESPN on November 16, 2026; athlete identity 3918298 was verified against the Bills roster. These samples retain numeric facts and the metadata consumed by Player Center. Navigation/image metadata was removed. No database export or Group information is included.

Sources:
- `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3918298/gamelog?season=2026`
- `https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2026/types/2/athletes/3918298/statistics`
- `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/3918298/stats?season=2026&seasontype=2`
- `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event={eventId}`

Week 1: event 401872660, September 13; 334 passing yards, 2 passing TDs, 0 passing interceptions, 23 rushing yards, 2 rushing TDs. Summary evidence verifies zero receiving production and zero fumbles lost: 35.66 FP with existing default rules.

Week 2: event 401872932, September 18 UTC (September 17 local); 248 passing yards, 3 passing TDs, 0 passing interceptions, 69 rushing yards, 2 rushing TDs. Summary evidence verifies zero receiving production and zero fumbles lost: 40.82 FP with existing default rules.

The raw athlete log lacks receptions, receiving yards, receiving TDs, fumbles lost and explicit completed status. These rows are outside the initial five-summary window. Tests exercise bounded requests for visible older games and subsequent cache reuse; they never infer zero from missing fields.
