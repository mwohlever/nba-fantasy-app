# NBA inline Live: local browser QA

Run `npm run dev` in this checkout, then use an authenticated local browser. Automated component fixtures and unauthenticated Dev HTTP checks do not replace these checks. Test desktop and a real narrow mobile viewport, including Safari/mobile pull-to-refresh if that is your normal client. No migration or production data changes are required.

**URL and history — repeat for both NBA Fantasy and NBA Skins**

1. Start from `/live-scores?sport=nba` and `/nba-skins/live`, respectively. The current Eastern date should appear via URL replacement. Browser Back should leave Live in one step, without an extra default-date entry.
2. Open `/live-scores?sport=nba&date=2026-05-25` or `/nba-skins/live?date=2026-05-25`. Choose a completed game; if that day has none, choose another date with a game. Record its date as D and its ESPN `gameId` as G from the resulting URL.
3. Tap the game. Expect the same route with `date=D&gameId=G&tab=summary`. Game Center replaces the overview, with a compact Back/title/refresh header. There should be no overlay and no large date controls.
4. Switch to Play-by-Play and Player Stats. Expect `tab=pbp` and `tab=stats`, using replacement. Browser Back should return directly to Games on D. Forward should restore G and the last tab.
5. Reload while on each tab. Confirm G, D and the tab survive. On mobile, pull-to-refresh while viewing Player Stats and PBP and check the same result.
6. Copy the detail URL into a new tab. Confirm its game, date and tab load. Click Back to games; expect the deterministic overview on D in that tab, without leaving the app.
7. In a new tab, open `/live-scores?sport=nba&gameId=G&tab=pbp` or `/nba-skins/live?gameId=G&tab=pbp`, substituting the recorded G. Confirm the correct game loads without needing its scoreboard, and `date` is replaced with the event's Eastern calendar date. Back to games should use that date.
8. Try `gameId=bad`, an empty `gameId=`, and `gameId=999999999999`. Expect a useful invalid/unavailable message and a working Back to games control, with no substitute game. Also try overview `date=2026-02-30`; it should replace the invalid date with the current Eastern date.

**Ownership, Groups and season memory**

1. In NBA Fantasy Player Stats, use a game/date with drafted players. Confirm the same owner labels, “You” styling, and unowned rows as before. Refresh and switch teams; keep the selected tab/team on refresh.
2. Switch to a second Group with NBA Fantasy enabled while viewing G. Confirm the game/date/tab remain, old ownership disappears immediately, and owners reload for the new Group. Test with network throttling and switch A → B → A quickly.
3. Switch to a Group with NBA Fantasy disabled. Expect that Group's Home. Repeat in Skins with destination Groups having Skins enabled/disabled, including a Skins-only Group without NBA Fantasy.
4. In NBA Skins Player Stats, confirm there are no ownership labels, “You” badges, or fantasy highlighting. Inspect the game-detail response: it must omit `ownership`, with `context=nba-skins` in the request. (Server fixture tests separately verify zero ownership-loader calls.)
5. On Skins Home, select an available historical season, such as 2025. Visit Live, change dates, open G, switch tabs, reload, and return separately to Home, Draft and Standings. Each season page should restore the remembered historical season. Repeat in another Group with a different remembered season.
6. From NBA Fantasy/Skins detail, switch to NFL. Expect `/live-scores?sport=nfl` with no NBA `gameId`, date, tab, or fantasy `slateId`. Switch back to NBA; expect NBA Games with its canonical default date. Confirm desktop/mobile Live navigation remains active for each Live route. Existing NFL/NCAA Game Centers should still be modals.

**Replay, scrolling and refresh**

1. Open PBP on a completed game with multiple periods. Select Q1, Q4 and overtime where available. Click made/missed shots and free throws; check shot origins, attack direction and animations.
2. On mobile, scroll until the full court leaves the viewport. The compact court should stick at the top during play-list scrolling. Click different plays while scrolled; compact replay should animate the chosen play. Scroll back to the full court; the compact court should disappear and full replay resume. Only one court should animate at a time.
3. Confirm the whole Game Center scrolls with the document, without a second overall vertical scrollbar. The stats table may scroll horizontally. Verify the final play/row clears the fixed bottom navigation in portrait and landscape, and check browser zoom and reduced motion.
4. On an in-progress game, confirm detail polls every 15 seconds. Games overview should poll every 30 seconds when a game is live. Refresh manually, background/foreground the tab, and check fresh scores, tab/team retention and ownership. A failed refresh should retain the last accepted update with a message.
5. With slow network, rapidly use Back/Forward between Games and details, change dates and switch Groups. Older responses/errors must not overwrite the active event or Group. Changing games should reset period, selected play and selected stats team; refreshing the same game should retain appropriate selections.

**Implementation boundaries**

Shared `NbaGameCenter` owns data/content, with a thin optional modal shell. NBA Live's URL is authoritative; opening detail pushes, tabs/default dates replace, and an app-owned history marker permits Back only for a known corresponding overview in the same viewer/Group/league/app scope. Direct links replace to Games. Requests use immutable identity, abort and generation checks. NBA/NFL future standings are type contracts only; Golf has leaderboard/detail contracts and no standings. No NFL/NCAA presentation conversion or Golf Live implementation is included.
