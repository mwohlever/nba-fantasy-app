# Draft redesign implementation and QA

Baseline: clean `main`, HEAD and origin/main both `178e35a`. Changes are intentionally uncommitted and unpushed. No schema changes, SQL, production writes, or production build.

## Result

Before: large Draft introduction and directory refresh → selectors/status/standings → admin notification control → Lineup/Players switch → current roster with repeated framing → permanent league roster strip.

After: Draft / slate / Open or Locked / own roster count, with refresh and settings icons → Positions/Players → one selected participant roster OR the existing player pool. The pool remains mounted when hidden so its research mode, comparison selections, sorting, direction, and filters survive view changes.

The header does not infer whose turn it is. Roster completion is a count, not an inferred draft cursor or final-game status. Draft Order and pick-history persistence remain deferred.

The large intro, always-visible configuration, progress bar, footer, and permanent league strip are removed. This should save roughly 150–250px before the positional roster, plus the former 350–450px league strip and some roster framing, based on the investigation's estimates. These are estimates, not measured viewport results. Formation/headshot dimensions remain usable; rows wrap for custom rosters.

## Controls and permissions

Settings contains Season, Slate, View Standings, Proxy Pick Notifications for exactly `currentUser.role === "admin"`, and Sync Player Directory for `systemRole === "super_admin"` on NBA/NFL only. The proxy checkbox remains page-owned state with its existing default and notification POST behavior. No persistence semantics changed.

Sync still posts to `/api/sync-players` or `/api/sync-players-nfl`. It is maintenance, never routine refresh or pull-to-refresh.

The small shared secondary-controls panel has a 44px trigger, label/expanded state, explicit close, Escape/outside-pointer dismissal, focus restoration, ordinary Tab navigation, desktop anchoring and mobile fixed positioning. It sits above bottom navigation and excludes pull gestures while open. Scores' existing panel was not migrated in this batch.

## Refresh and scope

Button and top pull both call `refreshDraft`. It reads `/api/lineups?slateId=…&draft=true`, `/api/slate-availability`, `/api/player-stats`, `/api/team-results`, and NFL's `/api/lineups/nfl-games`. The optional lineup GET metadata validates active Group membership and slate participation and returns current locked state and the frozen roster snapshot. Ordinary lineup GET consumers retain their previous query behavior.

Responses are accepted together only after HTTP/payload checks. Existing data remains visible during routine refresh and survives errors. Results distinguish success, error and skipped. One synchronous in-flight flag prevents duplicate pulls/buttons; generation tokens reject Group/sport/slate changes, A → B → A and unmount results. Starting a mutation invalidates pending reads, and refresh is blocked until the mutation finishes. Assignment remains subject to the existing server validation.

Golf reads stored data and retains the existing accepted-revision guard; it does not call a scoring refresh/reconciliation endpoint. The previous automatic Golf scoring updater is disabled on Draft. Research season statistics and the server-supplied player directory retain their existing loading paths; routine refresh does not remount the pool or sync the directory.

Participant selection is constrained to the accepted selected-slate participant response. It defaults to the active Group's participating team, then the first valid participant. There is no legacy team fallback. Selection survives routine refresh if the participant is still valid. Scope changes wait for authorized participants before showing a roster.

Ordinary members see read-only opponent Positions. The focused continuation below adds commissioner empty-slot drafting targeted to that participant. Filled opponent players continue to open research. The existing Players assignment dialog remains available to authorized proxy drafters.

One NFL Game Center remains outside participant/view switching. Draft supplies its accepted mapping to avoid a second request; selected games survive roster switching. Headshot IDs/URLs, D/ST logos, fallback images and Game Center action labels are unchanged. NFL still displays `Week 1` with `2026` separately in Season, and keeps the current-season/prior-season statistics fallback.

## Automated validation

219 tests passed across 18 suites: NFL usability (19), NFL fantasy games (10), Groups security (9), Groups batches 3b/4/5 (13/18/15), Group navigation/resume/provider switch (7/5/6), score headshots (10), shared pull refresh (27), Scores mobile (22), Scores/Home polish (6), Home pull (5), Golf correctness/reconciliation (5/27), Draft workspace (12), and Draft context API (3).

New behavioral coverage includes settings role gates/dismissal/focus, shared refresh entry points, top-only gesture behavior, mutation races, stale scope rejection, selection preservation, all three sports, saved slots, read-only targeting, image identity, Game Center persistence, and active-participant API filtering.

TypeScript: `npx tsc --noEmit --pretty false` passed. `git diff --check` passed. NFL/NBA/Golf Draft routes returned HTTP 200 and compiled in Dev, but showed the existing unauthenticated data-unavailable response. Authenticated visual/interactions were not executed. No browser automation capability was available in this session.

## Original layout QA — approved by the user

The user subsequently completed and approved the visual layout. The checklist below is retained as the original record; it does not need to be repeated for this continuation. Only the two focused checks at the end remain.

Run NFL first, using a safe test slate for actions that save a pick. No live pick or directory-sync action was executed during this implementation.

1. At 360, 390, 430, 476 and 480px, then desktop, open Draft with NFL / 2026 / Week 1. Verify compact heading, `Week 1`, Open/Locked state and your roster count. Confirm no large intro or permanent league strip and no page-wide horizontal overflow.
2. Open settings using pointer and keyboard. Confirm Season is 2026 and Slate is Week 1. Tab through fields/link/toggle, close explicitly, reopen and press Escape, then reopen and click outside. Check focus returns to the trigger and the panel stays above bottom navigation.
3. Change Season/Slate and confirm only valid participants appear for the selected slate. Follow View Standings and confirm NFL/active Group context.
4. As a player, confirm no proxy toggle or directory sync. As role=admin without super-admin, confirm proxy toggle only. As super-admin, confirm directory sync is available for NFL/NBA. Confirm changing the proxy toggle affects the existing notification option when making an authorized test proxy pick. Avoid global sync against production merely for QA.
5. Click compact refresh and pull from the top. Verify one routine request set, polite success/error feedback, stable participant/view/pool controls and no directory sync or scoring POST. Try a short pull, mid-page pull, horizontal participant scroll, and pull with settings/modal open: none should refresh. During a test pick, refresh must not overwrite the save.
6. Confirm Positions defaults to `Mark · You` when Mark participates. Select Josh, Andy, then Jon. Only that roster should display; the pills must not open participant profiles. Test a nonparticipating user and a larger Group with horizontal overflow.
7. On each opponent roster, verify the read-only label, inert empty slots, inspectable filled players, and no removal/reassignment/draft modal from Positions. As admin, use the distinct proxy shortcut and choose the intended team in the existing Players assignment dialog.
8. On your roster, tap an empty slot, inspect a candidate, return to the slot picker and make an authorized test selection. Verify saved slot restoration, count and frozen custom slot configuration. Repeat with K/FLEX/SF/D/ST where configured.
9. Check NFL player headshots, synthetic D/ST logos and initials fallback. Use View Game, View Live Game and View Final where actual game state provides those labels. Switch participant with Game Center open and confirm it remains open without reloading the provider map.
10. In Players, check 2025 fallback when 2026 production is absent, position-specific stats, both sort directions, search, filters, Compare Players and research modal. Switch to Positions and back; repeat after refresh. Confirm local choices survive.
11. At every target width, check readable player names/positions, empty-slot touch targets, visible focus, scrollable participant pills, and settings height/position. Check desktop anchoring too.
12. NBA regression: G/F/C/UTIL default/custom frozen slots, own draft/slot restoration, opponent read-only behavior, headshots, player research, refresh, settings and standings context.
13. Golf regression: configured golfer count, saved slots, images/research, own/opponent actions, participant switching, read-only routine refresh. Confirm no scoring-reconciliation request caused by pulling Draft, and that normal 4-round/72-hole assumptions remain intact.

## Changed files

- `app/lineups/draft/page.tsx`: remove main hero and routine-looking maintenance action.
- `components/lineups/LineupBuilder.tsx`: compact Draft workspace, selection, settings and safe refresh.
- `components/lineups/DraftRosterCourt.tsx`: compact framing and explicit read-only capability.
- `components/lineups/NflFantasyGameCenter.tsx`: optional accepted Draft mapping; existing Scores behavior retained.
- `components/lineups/RefreshPlayersButton.tsx`: maintenance label.
- `components/ui/SecondaryControlsPanel.tsx`: reusable secondary panel.
- `app/api/lineups/route.ts`: optional authorized read-only Draft context.
- `app/globals.css`: Draft/panel layout.
- `tests/draft-workspace.test.cjs`, `tests/draft-context.test.cjs`: focused tests.
- `docs/draft-redesign-qa.md`: this report.


## Focused continuation: pull and commissioner proxy picks

The approved layout was retained. No reset/stash, commit, push, build, SQL, schema change or production mutation was performed.

### Pull diagnosis and repair

Home attaches the gesture to its main page. Scores expands its surface into the content gutters and opts standings buttons into the shared gesture. Draft attached to its inner workspace, without gutter coverage, and its pills, tabs and roster circles were all rejected by the shared button exclusion. Tests using actual Draft markup reproduce that rejection without a Draft-specific opt-in. Existing non-button header pulls and the routine handler work in the test harness; there was no evidence of a permanently active mutation lock or incorrect top detector.

The hook/gesture now accepts a page-specific button selector. Draft opts in only `button[data-draft-pull-start="true"]` on participant pills, Positions/Players buttons and positional roster buttons. The workspace includes its outer gutters without changing content alignment. A completed button-origin pull must have a cancelable release and cancels its compatibility click, using the existing Scores mechanism. Normal taps, horizontal participant scrolling, interactive exclusions, top detection, busy/scope gates and refresh outcomes remain intact. Settings, refresh, Game Center and research controls are not opted in.

The icon and pull still use the same routine Draft reload; visible state, participant/view selection, frozen slots, availability and game mapping handling are unchanged. Maintenance sync is not invoked.

### Commissioner workflow and authorization

The existing Group `canAdministerGroup` capability includes Group admins and super-admins. The shared `canProxyDraftForGroup` helper uses that capability and preserves the legacy `role === "admin"` proxy path, after active-Group access is established. The Draft GET returns this capability, and the lineup POST independently enforces it for opponent targets. The prior POST checked Group membership of the target but did not distinguish own-team writes from ordinary-member opponent writes; that gap is now closed. Cross-Group and slate checks still apply first.

Ordinary members see `Read-only` and cannot assign to an opponent through either Positions or the player dialog. Authorized commissioners see `Commissioner`. Select Josh, tap an empty slot labeled `Draft for Josh`, then choose a player in the existing slot modal, whose heading and accessible label identify Josh and the position. The save targets Josh and reloads his selected roster in place. Filled opponent players remain research/Game Center interactions, without new remove/reassign actions. Changing participant clears the prior slot target.

Notification semantics are unchanged: the legacy admin proxy toggle retains its false default and existing payload behavior; Group commissioners whose legacy role is player retain the existing automatic notification behavior. No second notification path or recipient change was added.

### Continuation validation

187 tests passed across 15 suites: Draft workspace/context (16/5), NFL usability/fantasy (19/10), Groups security and batches 3b/4/5 (9/13/18/15), navigation/resume/provider switch (7/5/6), headshots (10), shared pull (27), Scores mobile (22), Home pull (5). The tests include gesture opt-in rejection/recovery, release click cancellation, protected controls, mutation/stale-scope behavior, member denial, commissioner/super-admin/legacy admin targets, notification payloads and cross-Group rejection. TypeScript and diff whitespace validation passed.

Files changed in this continuation: `lib/client/pullToRefresh.ts`, `lib/client/usePullToRefresh.ts`, `lib/lineups/draftPermissions.ts`, `components/lineups/LineupBuilder.tsx`, `components/lineups/DraftRosterCourt.tsx`, `components/lineups/SlotDraftModal.tsx`, `app/api/lineups/route.ts`, `app/globals.css`, `tests/helpers/pull-harness.cjs`, `tests/draft-workspace.test.cjs`, `tests/draft-context.test.cjs`, and this report. Earlier uncommitted redesign files remain preserved.

### Only remaining manual checks

1. On a phone at Draft page top, pull from metadata, a participant pill, a tab, a roster circle and a gutter. Verify one routine reload and no trailing participant/tab/slot activation. Verify taps still work, horizontal pills scroll, and mid-page/modal/busy pulls do not refresh.
2. On a safe test slate, view Josh as a commissioner, tap `Draft for Josh` on an empty slot and save a pick. Verify Josh receives it, his roster stays selected, filled players remain inspect-only, and the existing notification option behaves as before. An ordinary member should see read-only and no opponent drafting action.

These device checks were not executed by the agent. No full layout reapproval is needed. Draft Order remains deferred.
