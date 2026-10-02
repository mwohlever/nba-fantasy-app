# Real-world Live standings: review and QA

Base: `main` at `add0bf0046398f1227e4734ee145c1de53e6b6fd`.
No commits, pushes, database migrations, or production data writes.

## Behavior implemented

Games / Standings is an overview selector, never a Game Center tab. NBA Fantasy
and Skins share the same panel, API/provider adapter, and public team model.
NBA East/West show logos, teams, W-L, PCT, GB once regular-season results exist.
The current 2026-27 zero-record season explains that the regular season has not
started. NBA Playoffs explains that verified playoff positioning is unavailable;
no BPI seeds or row-number seeds are presented as official ranks.

NFL AFC/NFC show four division tables with W-L-T and provider percentages.
Playoffs uses ESPN's conference ranks, separating division leaders (1-4), wild
cards (5-7), and teams outside the field (8-16). These are current positions,
not a claim that the playoff field is finalized. Provider clincher symbols keep
their supplied descriptions for accessible labels/tooltips.

NCAA defaults to explicitly labeled AP Top 25. One select offers Top 25, College
Football Playoff, and all conferences returned by ESPN. Conference records and
overall records use the provider's exact stat types; rows retain provider order.
Nested divisions render only when supplied. Current metadata includes Pac-12
and Sun Belt East/West. CFP has independent official rankings and official seeded
field adapters, validated against the current season. Both are currently absent,
so the view explains they have not been released. No projected field, AP-derived
seeds, or bracket matchup edges are created. See
[provider investigation](live-standings-provider-investigation.md) for endpoints,
field names, discovery evidence, and limitations.

## URL and requests

- NBA: `/live-scores?sport=nba&view=standings&standingsView=east|west|playoffs`.
  The normalized URL retains the Games `date` as return context.
- Skins: `/nba-skins/live?view=standings&standingsView=east|west|playoffs`.
  No annual fantasy season enters the Live standings request or URL contract.
- NFL: `/live-scores?sport=nfl&view=standings&standingsView=afc|nfc|playoffs`.
  Optional `season/seasonType/week` are remembered Games context only.
- NCAA: `/ncaa-pickem/scores?view=standings&standingsView=top25|cfp`, or
  `view=standings&conference=<ESPN conference ID>` (e.g. 5 = Big Ten).
  Optional `season/week` are Games context only. NCAA Games week controls now
  persist that context, including reload and Back/Forward.

Games/Standings changes push history. Standings subviews replace their history
entry, matching Game Center tab changes. Browser Back/Forward restores the
selected subview. A fresh click into Standings defaults to East/AFC/Top 25;
browser Back retains the previously selected subview. Serializers whitelist
parameters: game IDs, game tabs, periods, stats teams and fantasy identifiers are
discarded from standings URLs; standings parameters are discarded from detail
URLs. Existing sport navigation clears the old sport's query context.

All standings always request the current provider season, regardless of the
remembered Games calendar. Public provider fetches use Next's 300-second
revalidation cache and a 20-second timeout. Authenticated API responses are
private/no-store. Entering Standings fetches once; subview changes reuse the same
response. There is no interval polling. Returning to a visible document after
five minutes triggers refresh. Manual refresh uses the same provider cache;
it does not force an ESPN cache bypass. A failed refresh keeps already displayed
data and identifies it as the last loaded standings.

Access uses the existing active-Group enabled-league resolver before provider
fetching. NBA Skins uses `nba_skins`, NCAA uses `ncaa_pickem`. No standings request
loads fantasy rosters, ownership, pick participants, scoring, or slates. Scope
changes abort requests and hide prior data immediately through `useLiveRequest`.
Enabled Groups preserve public standings URLs; disabled destinations use the
existing Group Home fallback. NCAA's client page uses membership identity for
request cancellation, while server auth always uses the logged-in user.

## Automated and browser verification

- 83 focused tests pass: normalizers, real ESPN fixtures, current/preseason
  behavior, CFP source distinction and partial failures, presentation, URL
  round trips, push/replace/Back/Forward/reload, Group authorization, Skins reuse,
  ownership absence, request throttling, and existing NBA/NFL Game Centers.
- Full Node suite: 1206 tests; 1179 pass, 24 skip, 3 fail. The same three
  failures were reproduced before editing on the clean base: Golf mobile-nav
  source extraction (`Unexpected token '!'`), NFL Thursday/Monday slate-lock
  expectation, and NFL PlayerPool season-stat expectation. No new failures.
- Real Chromium fixture browser test passes at 360, 390, and 1024 pixels for
  NBA, Skins, NFL and NCAA: grouping, selector changes without refetch, document
  scrolling, horizontal overflow, mobile bottom-nav clearance, reload/history,
  Group request scope changes, and retained data on refresh errors. These use
  real page/components with intercepted provider data and synthetic Group/Next
  navigation; they do not claim authenticated end-to-end QA. External CDN logo
  rendering still needs checking in the real app/browser.
- Existing real Chromium football tests pass for NCAA modal full/sticky replay,
  inline football document/sticky replay and direction/quarter selection, and
  signed-out NCAA navigation from NFL.
- Actual webpack Dev signed-out check passes for NCAA standings terminal access,
  Games -> Back restoring CFP URL, stable request counts, and 401 responses on
  NBA, Skins, NFL and NCAA standings API access paths. No browser page errors.
- Initial Turbopack Dev run returned 404s for existing and new API routes. The
  alternate webpack Dev compiler returned the expected routes/statuses. After
  the successful production build, a fresh default Turbopack Dev run also
  returned the expected 401 API responses and 200 NCAA standings page. No
  framework configuration or existing API changes were made to mask that issue.
- Fresh HTTP GETs of all four exact ESPN endpoints passed the real normalizers:
  NBA 2026-27 preseason; NFL 2026 valid playoff ranks; NCAA 2026 AP 25, eleven
  conferences, no current CFP field.
- Production `npm run build` passes, including all three new API routes and
  NCAA Scores prerendering. NCAA's URL-reading content has the Suspense boundary
  required by the locally installed Next.js 16.2.4 documentation.
- TypeScript and `git diff --check` pass. Focused new-file ESLint has no errors;
  one existing-style external-team-logo `<img>` advisory remains.

Optional Chromium command (use your installed Playwright path):

```sh
FOOTBALL_BROWSER_MODULE=/path/to/playwright node --test tests/standings-browser.test.cjs
FOOTBALL_BROWSER_MODULE=/path/to/playwright NCAA_DEV_BROWSER_URL=http://localhost:3000 node --test tests/football-inline-browser.test.cjs
```

## Authenticated manual QA remaining

1. In NBA Fantasy Live, select Standings, East/West/Playoffs. Confirm the current
   season/preseason message, logos when records exist, phone readability, and
   absence of fantasy ownership. Browse an old Games date and repeat: standings
   must still be current. Reload standings links and exercise Back/Forward.
2. In a Skins-only Group, repeat those steps through `/nba-skins/live`. Verify
   NBA Fantasy is not required and ownership never appears. Select a historical
   annual Skins season elsewhere, open Live standings, and return: the annual
   season must remain independently remembered.
3. In NFL Live, verify AFC/NFC four-division grouping and W-L-T/PCT; compare the
   Playoffs order with ESPN's current playoff standings. Check provider clincher
   descriptions when symbols appear. Browse a historical preseason/postseason
   week, switch to Standings and back, and verify both current standings and the
   remembered Games calendar.
4. In NCAA Scores, verify AP Top 25 source/date, current records/conferences,
   dropdown options, ACC/Big Ten/SEC/Pac-12 and Sun Belt group structures. Confirm
   CFP is unavailable before release. Use historical captured fixtures for CFP
   rankings/official field validation until actual current-season polls exist.
   Verify no bracket is inferred from rankings.
5. Switch between two enabled Groups while on each standings view. URL selection
   should remain, stale requests must not reappear, and access should use the new
   Group. Switch to a Group without that game: confirm existing fallback. Switch
   sports to NBA/NFL/Skins/NCAA/Golf and check incompatible params are cleared.
6. Return to Games and run real authenticated NBA and Skins Summary/PBP/Player
   Stats, sticky court replay, polling, deep links and ownership (Fantasy only).
   Repeat NFL Summary/PBP/Stats, sticky field direction, Q1-Q4/OT, player season
   and game-log dialogs, polling and ownership. Test Group changes in detail.
7. NCAA Games: confirm favorites, week selection/reload, Picks and background
   scoring; open its unchanged modal and exercise Summary/PBP/Stats and sticky
   field. Check other remaining football modal consumers.
8. On a phone, scroll to the last standings row and check bottom-nav clearance
   and accessibility/focus controls. Verify ESPN team logos against the actual
   CDN rather than the isolated browser fixture environment.
9. Golf smoke check: enabled Group navigation, existing Live tournament selector,
   leaderboard, golfer detail and ShotCast. No Golf files were changed; the only
   added CSS exception targets `main.ncaa-standings-page` exclusively. Existing
   fantasy Home/Draft/Scores/scoring/rules paths remain outside this feature.

No open product decision blocks the implemented portions. NBA authoritative
rank/playoff positioning and official CFP bracket edges need a future provider
investigation; they cannot safely be filled using the fields found here.
