# NFL inline Live Game Center

Implementation starts at `a75e397` on `feature/nfl-inline-live`. No commits,
pushes, migrations, or production data writes are part of this change.

## Architecture and feature audit

Before: `NflLiveScores` kept season/type/week and the selected scoreboard game
in local state. Opening a card mounted `NflGameCenterModal`, which supplied Group
and league scope to the shared `GameCenterModal`. That component combined the
overlay, data loader, tabs, and content. NCAA and NFL fantasy lineup routes also
use the shared football modal.

After: NFL Live reads its overview/detail state from the URL. `NflGameCenter`
loads the exact ESPN event through `useLiveRequest` and passes scoped data to
`FootballGameCenter`, the extracted existing football content. `GameCenterModal`
is a thin compatibility overlay; its content retains the original loader and
modal scrolling for NCAA and NFL lineup consumers. NFL Live uses document
scrolling and a compact Back to games control.

Existing features preserved:

- Summary: scheduled matchup/season preview, offense and defense comparisons,
  team box stats, scoring summary, and final-game story with ESPN link.
- Header: teams/logos/records, score or kickoff time, status, broadcast, supplied
  betting line, and live possession indicators.
- Play-by-Play: previous/current drives combined into deduplicated quarter/OT
  plays; selected-play field visualization and animation; stable matchup
  orientation; down/distance and resulting possession context; scoring plays;
  latest-play action; compact sticky replay and quarter controls at mobile and
  desktop widths.
  There is no separate Drives tab.
- Player Stats: team switching, pregame season statistics and in-game box stats,
  category sorting/filtering, optimized headshots, owner/You labels and row
  highlights, and the existing player details dialog with Season and Game Log
  views, including the live game row.
- Manual detail refresh, 15-second polling for live events, loading/error states,
  and retained last data with a refresh-error notice.
- NCAA ownership suppression and NCAA/NFL lineup modal presentation.

## URL and history contract

NFL's existing public calendar is weekly, not daily. Its scoreboard API accepts
`season`, `seasonType` (1 preseason, 2 regular season, 3 postseason), and `week`.
Keeping this model preserves the existing schedule controls and multi-day week.

```text
/live-scores?sport=nfl&season=2025&seasonType=2&week=2
/live-scores?sport=nfl&season=2025&seasonType=2&week=2&gameId=401772936&tab=summary
/live-scores?sport=nfl&season=2025&seasonType=2&week=2&gameId=401772936&tab=pbp&period=1
/live-scores?sport=nfl&season=2025&seasonType=2&week=2&gameId=401772936&tab=stats&statsTeam=9
```

`gameId` identifies the public event independently of its overview calendar.
Event-only deep links work, for example
`/live-scores?sport=nfl&gameId=401772936&tab=pbp&period=1`.
When calendar context is omitted, an available ESPN summary supplies the event's
season/type/week and the URL is corrected by replacement. If provider context
is unavailable, the event still loads; Back uses the NFL default overview.
An invalid/unavailable event never substitutes another game.

Missing/invalid overview calendar context resolves from the provider's current
schedule, then replaces the URL. Unsupported query parameters, including fantasy
slate IDs, are removed. Unknown tabs default to Summary. Quarter and stats-team
defaults are resolved from the loaded event; corrections replace history.
Selected plays, animation progress, and the secondary player dialog stay local.

Opening a game and changing the overview calendar push history. Tabs, quarter,
stats team, and canonical/default corrections replace history. Back does not
cycle through tab selections. Browser Forward reopens the replaced detail entry.
Reload and mobile pull-to-refresh restore the URL's event and selections.

Back to games uses browser history only when the entry carries the corresponding
overview/event/viewer/Group/league scope marker. Direct/shared links and changed
Groups instead replace the URL with the deterministic NFL overview. Both paths
scroll the document to the top.

## Ownership, requests, scrolling, and shared boundaries

NFL overview/detail requests include viewer, Group, league, NFL context, and
resource identity. `useLiveRequest` aborts superseded calls and checks immutable
identity plus monotonic generation before accepting data, errors, or completion.
It also masks previous-scope data during render, before effect cleanup runs.
The server validates explicit viewer/league/Group identity before provider or
ownership reads. Existing legacy modal authorization remains supported.

Group switching preserves whitelisted public calendar/event/tab/quarter/team
state when NFL is enabled, clears old annotations immediately, and reloads the
destination league's ownership. Disabled NFL Groups resolve to Group Home.
Ownership still uses the actual event kickoff date and canonical athlete IDs.

Inline field visibility observes the viewport (`IntersectionObserver.root=null`).
Modal field visibility retains `[data-game-center-scroll]` as its root.
The inline overall Game Center has no constrained height or vertical scroll
container; stats tables retain horizontal scrolling. NFL Live keeps mobile
bottom-navigation clearance and existing AppNav Live highlighting.

Shared changes are limited to native history helpers extracted unchanged from
NBA, the existing request primitive's sport-neutral fallback error text, NFL URL
types/adapters, Group-switch whitelisting, and an optional scope-validation hook
in the football handler. NBA content, replay, and APIs are unchanged. NCAA keeps
its existing modal, loader, polling, tabs, field model, and ownership suppression.
Golf Live and ShotCast are untouched. No standings UI/API is implemented; the
separate future NFL `view=standings&season=...` type contract remains available.

## Exact authenticated manual browser QA

Automated tests use synthetic hooks/history and read-only fixtures. They do not
represent authenticated browser QA. Run these checks locally in your signed-in
session, at mobile width first and then desktop.

1. Run `npm run dev` and select a Group with NFL Fantasy enabled. Open NFL Live
   from AppNav. Verify Live highlighting and the visible mobile bottom nav.
   Verify the URL resolves to explicit season/type/week. Change all three
   controls, including preseason and postseason; reload and confirm the same
   selections, schedule, day grouping, and favorite teams. Test an empty week.
2. Open a game card. Verify a single inline Game Center replaces the overview;
   `gameId` is that card's ESPN ID, `tab=summary`, and the weekly context remains.
   Confirm the header, score/status/kickoff, broadcast, supplied line, records,
   possession when live, and Back to games control.
3. Exercise Summary on scheduled, live, and final games where available. Check
   scheduled matchup preview, team stats, scoring summary, final game story,
   and ESPN link. Confirm loading/unavailable states remain understandable.
4. Open Play-by-Play. Select Q1 and an overtime period if available; confirm
   `tab=pbp&period=...`. Select multiple kinds of plays, verify field orientation,
   animation, LOS/first-down markers, down/distance/resulting possession, scoring
   plays, and Latest. Scroll down until the compact field appears; change quarter
   and play there, then scroll back up. Verify normal page scrolling, no overall
   nested scroll area, and bottom-nav clearance.
5. Open Player Stats, switch to the other team, and verify `tab=stats&statsTeam=...`.
   Check categories, row filtering/sorting, horizontal table scrolling, headshots,
   owned/unowned players, owner labels, You labels, and ownership highlights.
   Open a player, exercise Season and Game Log, then return to game stats.
6. Use the Game Center refresh button in each main tab; confirm tab/quarter/team
   remains selected. On a live event, wait at least 15 seconds and verify polling
   without losing the selected view. Reload and perform mobile pull-to-refresh
   inside Summary, a non-default PBP quarter, and the other stats team. Verify
   the exact event, view state, and correct ownership restore each time.
7. From an overview, open a game and switch tabs/quarter/team repeatedly. Press
   browser Back once: it must return to that week's games. Press Forward: it
   must reopen the same event with the last detail selections. Repeat using the
   Back to games control after opening a card.
8. Copy a detail URL into a new tab. Verify direct loading and refresh restoration.
   Click Back to games: it must show the specified week's overview, without
   leaving Live for an unrelated prior page. Also open the event-only example
   above; confirm it resolves to 2025 regular-season Week 2. That historical game
   may have no fantasy ownership; use a current slate game for ownership QA.
9. In a detail URL, try `gameId=bad`, `gameId=` and an unavailable numeric ID.
   Verify a useful error, no substitute matchup, and deterministic Back to NFL
   games. Try an unknown tab and unavailable quarter/team selection; confirm
   safe default correction without extra Back entries.
10. With a public game open, switch to another NFL-enabled Group. Verify the same
    event/calendar/tab/quarter/team remains, old owners disappear immediately,
    and only destination owners appear. Repeat A → B → A quickly. Switch to a
    Group without NFL enabled and verify its Group Home. Switch back and open
    a game to confirm normal NFL behavior.
11. Open game A, return to games, open B, then A rapidly. Use network throttling
    if helpful. Verify header, data, errors, and ownership always match the URL
    and destination Group, including refresh races.
12. While viewing NFL detail, switch to NBA Fantasy, NBA Skins, and Golf through
    AppNav. Verify NFL game/quarter/team/week/slate identifiers do not transfer.
    Confirm NBA and NBA Skins still support inline detail, Summary, PBP/court,
    sticky replay, Player Stats, refresh, Back/Forward, and direct links. Verify
    Fantasy NBA ownership and Skins ownership suppression.
13. Open an NFL game from a fantasy lineup, and an NCAA football game from its
    scores page. Both must still use the modal, preserve their tabs/field/stats
    and close behavior, and keep NCAA free of fantasy ownership labels. Repeat
    the NFL inline scrolling/navigation checks at desktop width.

## Validation interpretation

Final validation:

```sh
node --test tests/nfl-inline-live.test.cjs tests/nfl-live-integration.test.cjs tests/football-play-visualization.test.cjs tests/live-scores.test.cjs tests/live-scores-periods.test.cjs tests/group-navigation.test.cjs tests/nba-live-url.test.cjs tests/nba-live.test.cjs tests/nba-skins-live.test.cjs tests/bracket-game-center.test.cjs
npx tsc --noEmit
npm run build
node --test tests/*.test.cjs
git diff --check
```

The focused NFL/football/NCAA/Group/navigation/NBA sets pass. The final full suite
has 1,190 tests: 1,164 pass, 23 skip, and three baseline failures remain.
The optional isolated Chromium suite separately passes both layout tests, each
at 390px and 1024px. Its signed-out Next Dev transition test is skipped; the user
already confirmed NCAA loads after restarting. TypeScript, the production build,
and the whitespace check pass. The build requires network access for the
configured Geist fonts.

Three full-suite failures were reproduced using `a75e397` sources loaded from
Git into memory, without checking out another worktree or changing this branch:

- `golf-product-ui.test.cjs`: canonical mobile-nav source extraction fails on a
  TypeScript non-null assertion (`Unexpected token '!'`).
- `nfl-background-scoring.test.cjs`: Thursday–Monday locking assertion.
- `nfl-usability.test.cjs`: PlayerPool regular-season stats assertion.

The NFL endpoint integration fixture explicitly mocks its Supabase dependency,
so it runs without credentials or database access.

## Restart follow-up: field and lifecycle findings

The user clarified the NCAA symptom on Ohio State–Kent State, Week 3
(`401858454`): the full field is visible on entering PBP, but disappears on
scrolling. The extracted content still renders the same full field with the
same selected-play/team props as `a75e397`. The missing desktop compact replay
came from the inherited `narrow` condition (below 640px), rather than a removed
full-field render. Both modal and inline hosts now show compact replay when the
main field leaves their respective observation area, at all viewport widths.

The interrupted NFL fix already supplied the explicit `presentation` prop,
viewport observation, and scoped mobile `overflow-x: clip; overflow-y: visible`
CSS. Without that CSS, the generic mobile horizontal-overflow rule creates a
vertical scrolling ancestor and prevents document sticky positioning. The
follow-up also makes observers attach when initially empty PBP receives plays;
the effect depends only on host and field presence, disconnecting on cleanup.

The direction corrections had survived: stable home-left/away-right scrimmage
coordinates are unchanged from `a75e397`, while end-zone and signed-yardage
labels now agree with that orientation. Punt named landings and receiver-relative
endpoints are converted to the same display space. Regression data covers both
offenses, drives and all four quarters, plus synthetic turnovers through OT.
The baseline scrimmage fixture was generated from `a75e397` normalization.

No runaway effect, fetch loop, duplicate poller, observer leak or history loop
was found. Tests verify one poller through repeated rerenders, observer stability
and teardown, delayed plays, and idempotent NFL URL corrections. The follow-up
adds an equal-state guard to avoid redundant history replacement. This evidence
does not establish a cause for the computer slowdown.

Next authenticated Chrome QA: reopen Ohio State–Kent State from both NCAA
Pick'em and Scores; select Q1, scroll until compact replay pins under the tabs,
select plays from each offense and change quarters, then return to the full
field and confirm the compact duplicate disappears. Repeat at mobile width.
For NFL, repeat document scrolling, play and quarter/OT changes, bottom-nav
clearance, reload, Back/Forward, event-only deep links and Group switching.
Check the NFL lineup modal and a bracket football modal, then smoke-test NBA
Fantasy and NBA Skins inline Live. Use the existing authenticated QA list for
ownership, player dialogs and live polling.
