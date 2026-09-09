# NFL Live fantasy integration and field QA

Implemented on `main`, left uncommitted. No migrations, SQL, schema writes, commits, pushes, or production build.

## Architecture and ownership

- `NflLiveScores` owns the NFL schedule, calendar/week controls, favorites and selected game. The NFL fantasy surfaces open the same event through `NflFantasyGameCenter`.
- Both now enter an NFL-only `NflGameCenterModal` wrapper. NCAA continues using its existing wrapper and shared `GameCenterModal`.
- Game Center uses `/api/live-scores/nfl/game-detail?eventId=...`. Its authenticated shared handler gets summary, drives/PBP and box scores in one request to `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=...`.
- Existing pregame preview/team-season statistics and player-detail endpoints remain unchanged. Shared Game Center retains Summary, quarter-grouped PBP, Player Stats and the nested player modal.
- The existing 15-second live refresh carries the ownership map and field state. No additional provider request or polling loop was introduced. Ownership uses at most four batched database reads per refresh, independent of the number of displayed player rows. The map is reused across all stat categories.
- Server authorization remains `getNflLiveAccess` → `getActiveLeagueForSport(user, "nfl")`, resolving the active Group's enabled standard NFL league. A requested `groupId` must match the authorized Group before ownership is read. The response is private/no-store.
- Slate matching reuses `nflSlateWindow`, also used for fantasy-to-Game-Center links. Convert the provider kickoff to an Eastern calendar date, then select the single NFL slate in the authorized league whose inclusive window contains it. This handles Monday UTC rollover, future dates and postseason date windows without a hardcoded year/week. No match or overlapping matches means no annotation. No fallback to today's slate or a previous week.
- Current ownership comes from `lineups` → `lineup_players`, for that slate. Teams are independently restricted to the authorized Group. Historical roster/team relationships are retained; there is no destructive cleanup or draft-history dependency.
- Local `lineup_players.player_id` maps through `players_nfl.id` to `players_nfl.nfl_player_id`, which the existing NFL sync stores as the ESPN athlete ID. Numeric IDs normalize to strings; names never determine identity. Synthetic D/ST rows are explicitly excluded by position. Conflicting owners for a provider ID are omitted.
- Labels use existing Group team/participant names (`teams.name`). The current user's Group team receives a light sky treatment and `Owner · You`; another owner's row gets a lighter slate treatment and their name. Undrafted players receive no annotation. Existing row click/keyboard handlers and player detail remain intact.
- The NFL wrapper keys the modal by Group, league and event, clearing old annotations synchronously on a switch. Existing request aborts reject late A → B → A responses. Response ownership is additionally checked against the current Group, league and event before rendering. GroupProvider itself was not changed.

## Provider findings and field semantics

Inspected the actual summary for event `401772936` from both the site and site.web endpoints. A reduced, unchanged sample of its home and away plays is in `tests/fixtures/nfl-field-401772936.json`. This is a **final game**, not evidence of a live session. Automated field replays explicitly construct a synthetic live envelope around those captured plays.

Observed fields:

| Information | Provider fields |
| --- | --- |
| Explicit possession | `header.competitions[0].competitors[].possession`, competitor/team `id` |
| Game phase | `header.competitions[0].status.type.state`, `.name`, `.completed` |
| Team identity/branding | competitor `homeAway`, `team.abbreviation`, `team.color` |
| Drives | `drives.previous[]`, drive `team.id`, `plays[]`; existing app also consumes `drives.current` during live games |
| Snap spot | play `start` and `end`: `team.id`, `yardsToEndzone`, `yardLine`, `possessionText` |
| Down/distance | play `start` and `end`: `down`, `distance`, `shortDownDistanceText`, `downDistanceText` |
| Snap time | play `period.number`, `clock.displayValue` |
| Transitions | play `type.text`, `scoringPlay`, `isTurnover` |
| Player stats identity | `boxscore.players[].statistics[].athletes[].athlete.id` |
| PBP involvement | `teamParticipants` contains team IDs; no athlete IDs in the inspected play feed |

The field is an **after-latest-play snapshot**, explicitly labeled as such. It uses the latest play's end spot, quarter and clock together. It does not claim a continuously running clock or use undocumented live status-clock fields. Real-live-game validation is still required for current-drive updates and transition timing.

- Reuses the existing explicit-possession helper. Never derives possession from the drive, play text, or an old final game.
- Requires in-progress status, exactly one possessing team, a current drive for that team, and an end spot for the same team.
- The offense always moves left-to-right. `ball = 100 - end.yardsToEndzone`. The captured home and away examples demonstrate why directly plotting `yardLine` would invert one side. Stadium/broadcast direction is neither available nor inferred.
- Both ends are labeled with team abbreviations. The ball/solid scrimmage line share the normalized coordinate. The optional dashed first-down line is `ball + distance`.
- If distance reaches the opponent goal line, show `& Goal` and omit a separate first-down marker. Positions below/above midfield resolve to opponent/own territory; midfield is `50`. No parsing of play-description names or yardage text.
- The field graphic is 80px high with an accessible text description, visible possession/down/distance/time text, a line-style legend, and the latest play beneath it. Provider color appears only in a small accent; readable markers have independent colors/text.
- Missing/invalid spot, down, distance, clock or identity hides the field. Pregame, halftime, final, period-end, scoring, turnover, kickoff, punt and extra-point snapshots are hidden. Only ordinary rush/pass/sack/penalty end spots are accepted. Timeouts and unsupported play types also hide it conservatively. The existing PBP feed stays available.

## Deferred

- **PBP ownership:** no reliable athlete involvement IDs in the inspected feed. `teamParticipants` is insufficient. No text-name inference was added.
- **Fantasy points:** `lib/scoring/nfl.ts` has canonical helpers, but Game Center holds category-specific display-stat arrays rather than the refresh pipeline's complete numeric inputs (including turnovers/fumbles and specialist scoring). Safely showing numbers requires a shared provider-stat adapter with snapshot-scoring parity validation. No new scoring engine, rules change, or current-settings fallback was added.
- A separate running clock/authoritative situation can be considered only after observing it in actual live summary data. The current field deliberately uses a clearly labeled latest-play snapshot.

## Validation

- 31 focused integration tests: stable-ID ownership, own/other/unrostered UI, scoped batched roster reads, missing/ambiguous slate, Week 1/2, Group isolation, request races, player-detail action, NCAA exclusion, provider request count, access gate and optional roster failures; field coordinates, possession, transitions, goal-to-go, clock, compact accessible rendering and captured home/away payload semantics.
- Existing regression suites: NFL usability, NFL fantasy games, Live Scores/Game Center, Groups security, GroupProvider switching and pull-to-refresh all passed.
- `npx tsc --noEmit --pretty false` and `git diff --check` passed.
- Dev smoke: NFL Live returned HTTP 200; NFL Game Center API compiled and returned expected HTTP 401 without an authenticated session. This does not constitute authenticated UI or live-game QA.
- No production build was run, per task instructions.

## Manual QA checklist

Use an authenticated session and an actual live game with drafted players:

1. NFL Live → game → Player Stats: verify your players, another participant's players, undrafted players, repeated categories, owner names, and tap/keyboard player details.
2. Switch A → B → A, including while loading: ownership must clear and then reflect the current Group. Check another NFL week and a Group/week without a matching slate.
3. PBP: compare the **latest completed play's** spot, possession, next down/distance, clock and quarter to ESPN. Field offense always moves right; it need not match the broadcast camera.
4. Observe own territory, midfield, opponent territory/red zone, a first down and goal-to-go. Confirm scrimmage/first-down lines move correctly.
5. Observe a possession change and, when practical, turnover, touchdown, PAT, kickoff, punt, quarter break, halftime and final. Uncertain/break states must hide the field; normal PBP continues updating every ~15 seconds.
6. Check Summary, quarter selectors, Player Stats/details, favorites, odds, calendar/week controls, pull-to-refresh, fantasy Game Center links and fantasy Scores.
7. Check a narrow phone/PWA in dark and light mode: annotations remain compact, player/stat scrolling works, field labels remain readable, and the graphic stays a compact band. Check desktop too.
8. Open NCAA Game Center to confirm its existing Summary/PBP/Stats behavior and absence of NFL ownership/field UI.

Live transition timing, authenticated Group switching with real rosters, and visual mobile/PWA QA remain unverified manually. No live fantasy points or PBP owner labels are expected in this implementation.

## Files

- `app/api/live-scores/nfl/game-detail/route.ts`
- `lib/live-scores/game-detail.ts`
- `lib/live-scores/nflOwnership.ts`
- `lib/live-scores/nflOwnership.server.ts`
- `lib/live-scores/nflField.ts`
- `components/live-scores/NflGameCenterModal.tsx`
- `components/live-scores/GameCenterModal.tsx`
- `components/live-scores/FantasyOwnerLabel.tsx`
- `components/live-scores/NflLiveField.tsx`
- `components/live-scores/NflLiveScores.tsx`
- `components/lineups/NflFantasyGameCenter.tsx`
- `tests/nfl-live-integration.test.cjs`
- `tests/nfl-fantasy-games.test.cjs` (wrapper expectation)
- `tests/fixtures/nfl-field-401772936.json`
- `docs/nfl-live-integration-qa.md`
