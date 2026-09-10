# Authoritative fantasy draft history and NFL live QA fixes

Implementation is on `main`, uncommitted and unpushed. No migration, backfill, test SQL, Supabase mutation, or production build was run. SQL files require manual review/application. PostgreSQL transaction behavior has been inspected and contract-tested, not runtime-proven.

## Required rollout — do this in order

1. Review the complete migration and backfill below. Arrange a maintenance window and **pause all NBA/NFL draft picks, roster corrections, historical imports, slate deletion, and draft-order edits**. A paused UI alone is insufficient if old tabs still submit writes; prevent those requests operationally until the new deployment is ready.
2. In Supabase SQL Editor, manually apply **the entire** `supabase/migrations/20260912000100_fantasy_draft_history.sql`, including `begin` and `commit`. No historical roster data is rewritten by this migration.
3. Apply **the entire** `supabase/manual/20260912_nfl_week1_draft_backfill.sql`. It inserts exactly the verified 24 picks for slate 179 and their frozen draft configuration. If any guard fails, stop: do not remove the guard or force the insert. Reconcile the changed records first.
4. Deploy the matching application changes. Run the production build as your separate pre-deployment/pre-commit check; it was deliberately not run here. Require old browser/PWA tabs to reload so requests include `expectedPlayerIds`.
5. Perform the read-only Week 1 QA and controlled future-draft integration QA below. Use a dedicated test Group/slate for mutations and concurrency checks, not the completed Week 1 roster.
6. Resume NBA/NFL drafting only after those checks pass.

**Do not deploy this code early expecting old drafting to continue.** Without the RPC, history reads return an explicit “setup pending” state and valid NBA/NFL mutations return 503. Positions/Players can render and read rosters, but there is no legacy mutation fallback. Validation failures may still return 400/409 before the RPC. Corrections are likewise paused. This prevents undocumented picks from accumulating.

**Do not apply the migration while permitting old production code to draft.** Database guards intentionally reject legacy direct NBA/NFL roster writes immediately after migration. That interval is safe for data integrity, but it is a maintenance outage for drafting/corrections. Old code must not remain the operational writer. Rolling back only the app does not restore legacy writing after the migration.

If the two live fixes need an earlier production release, they must be reviewed and separated into a deployment that does not include the new Draft mutation integration. No such commit or deployment was performed here.

## Existing architecture and mutation inventory

The app uses Next.js 16.2.4 App Router, PIN sessions in `lib/auth.ts`, Group-scoped teams, and server-only Supabase service-role handlers. The installed Next route documentation was read. Slate scope is `slates.league_id -> leagues.group_id`; lineups connect a slate and a Group team. `slate_teams` holds participation and numeric draft order. Active membership filters govern current Draft participants; historical team records remain intact.

Live constraints were supplied from PostgreSQL by the user. `lineups` has primary/team/slate foreign keys, but no unique `(slate_id,team_id)` constraint. `lineup_players` has its primary key, cascading lineup FK, sport and nonnegative-slot checks, and a unique occupied `(lineup_id,roster_slot_position,roster_slot_index)` index. Its existing `validate_lineup_player_for_sport` trigger resolves sport through the lineup/slate and checks the correct player catalog. There is no existing unique drafted player per slate. The migration preserves those constraints/triggers and adds protected history rather than rewriting legacy rosters or imposing a new global Golf constraint.

All roster-assignment/removal paths found:

| Path | Existing behavior | New NBA/NFL behavior |
| --- | --- | --- |
| `POST /api/lineups`, called by `LineupBuilder.persistLineupForTeam` | Desired full player list; separately creates lineup, deletes removed rows, inserts added rows | One transactional RPC with desired/expected roster intent; API authenticates actor; DB checks snake, scope, role, slots and current state |
| `LineupBuilder.handleAssignPlayerToTeam` | Own and commissioner proxy picks; explicit-slot and player-dialog entry points; transfer could remove from old team then add to another | Own/proxy UX retained; existing-owner transfer blocked with direction to commissioner corrections; no partial remove-then-draft transfer |
| `LineupBuilder.handleRemovePlayerFromTeam` | Removes via same save endpoint | Commissioner-authorized reversal and audit; ordinary members cannot remove/correct recorded picks |
| `POST /api/admin/lineup-correction`, called by `app/admin/corrections/page.tsx` | Direct add/replace/remove, then recompute | Commissioner RPC records correction and roster change atomically; recompute remains after commit |
| `DELETE /api/admin/slates/[slateId]`, called by slate administration | Deletes lineup players and lineups before slate cleanup | NBA/NFL direct deletion fails closed; recorded draft FKs also preserve history |
| `scripts/import-2026-historical-raw.ts` | Deletes/imports NBA historical slate dependencies and inserts lineup players | Legacy direct NBA writes fail closed after migration; no history is fabricated for imports |

No other NBA/NFL roster-writing client call sites or assignment RPCs were found. Other `lineup_players` uses inspected were reads for projections, roster/profile pages, scoring, and notifications. NBA Skins has separate draft tables/functions and is untouched. Golf retains its existing direct mutation/scoring paths.

Slate creation and administration set participation/order; reseed computes suggestions. A started authoritative draft freezes its participant IDs/order and resolved slots. Database guards reject changes to frozen draft order, slate sport/league, and rules snapshot/version; locking a slate remains allowed. Current rules are resolved by `lib/rules/leagueRules.ts`, using the slate snapshot, with its intentional legacy-default fallback. Group setting changes do not affect existing snapshots.

Previously, `notifyNextDrafter` summed current roster counts, divided by participant count, and reversed team order on alternating rounds. The normal save API did not enforce that snake turn. Availability/duplicate checks were largely client-side; the API checked active canonical players and roster fit. “On slate” remains the existing player-pool schedule filter, not a new hard drafting eligibility rule. Current roster-slot display was not chronological history.

## Verified Week 1

- Group **111**: `2ac845fb-93c8-4781-aa38-e206a76f46cb`.
- NFL league: `dc82641b-6a31-4044-aa90-e02dcb305c54`.
- Slate **179**, `2026 Week 1`, September 9–14, 2026; frozen rules version **5**.
- Configured order: **Josh (team 2), Andy (team 1), Mark (team 4), Jon (team 3)**. All four were active participants/members when verified.
- Lineups: Josh 1062, Andy 1063, Mark 1064, Jon 1065.
- Frozen roster: QB × 1, RB × 2, WR × 2, TE × 1; K/FLEX/SF/DST × 0. **Four participants, six slots each, six rounds, 24 picks: complete.**
- Every supplied pick matches one current owner and the configured snake. No conflicts, missing picks, or extra picks were inferred.
- Canonical ESPN athlete identity is `players_nfl.nfl_player_id`, not an `espn_id` column. “James Cook” matches canonical **James Cook III**. Punctuation and the other supplied names match canonical records.

`R.P` below means round and pick within round. Exact read-only verification evidence is in `docs/nfl-week1-draft-verification.json`.

| # | R.P | Canonical player | players_nfl.id | NFL provider ID | Receiving participant (team ID) |
| --- | --- | --- | --- | --- | --- |
| 1 | 1.1 | Jahmyr Gibbs | 283 | 4429795 | Josh (2) |
| 2 | 1.2 | Josh Allen | 80 | 3918298 | Andy (1) |
| 3 | 1.3 | Christian McCaffrey | 774 | 3117251 | Mark (4) |
| 4 | 1.4 | Bijan Robinson | 44 | 4430807 | Jon (3) |
| 5 | 2.1 | Puka Nacua | 518 | 4426515 | Jon (3) |
| 6 | 2.2 | Kyle Pitts Sr. | 43 | 4360248 | Mark (4) |
| 7 | 2.3 | Ja'Marr Chase | 169 | 4362628 | Andy (1) |
| 8 | 2.4 | Jonathan Taylor | 385 | 4242335 | Josh (2) |
| 9 | 3.1 | Jaxon Smith-Njigba | 809 | 4430878 | Josh (2) |
| 10 | 3.2 | Amon-Ra St. Brown | 300 | 4374302 | Andy (1) |
| 11 | 3.3 | Saquon Barkley | 701 | 3929630 | Mark (4) |
| 12 | 3.4 | James Cook III | 85 | 4379399 | Jon (3) |
| 13 | 4.1 | CeeDee Lamb | 232 | 4241389 | Jon (3) |
| 14 | 4.2 | Justin Jefferson | 569 | 4262921 | Mark (4) |
| 15 | 4.3 | De'Von Achane | 532 | 4429160 | Andy (1) |
| 16 | 4.4 | Nico Collins | 335 | 4258173 | Josh (2) |
| 17 | 5.1 | Trey McBride | 18 | 4361307 | Josh (2) |
| 18 | 5.2 | Chase Brown | 166 | 4362238 | Andy (1) |
| 19 | 5.3 | Lamar Jackson | 66 | 3916387 | Mark (4) |
| 20 | 5.4 | Jalen Hurts | 711 | 4040715 | Jon (3) |
| 21 | 6.1 | Colston Loveland | 151 | 4723086 | Jon (3) |
| 22 | 6.2 | Chris Olave | 635 | 4361370 | Mark (4) |
| 23 | 6.3 | Tyler Warren | 388 | 4431459 | Andy (1) |
| 24 | 6.4 | Bo Nix | 270 | 4426338 | Josh (2) |

Before the initial backfill was applied, the user revised the authoritative historical input: Kyle Pitts replaces Brock Bowers as Mark's original second-round pick (#6, round 2, pick 2). This approved preseason/injury replacement creates neither an extra pick nor a `draft_corrections` record. Future corrections still use the general audited correction architecture. Kyle Pitts's canonical name is **Kyle Pitts Sr.**, ID **43**, provider ID **4360248**. Read-only re-verification at `2026-09-10T03:54:19.485Z` confirmed Mark (team 4), lineup 1064, lineup-player row 3936, TE slot index 0, all 24 owners/slots, unchanged frozen rules and the configured snake. Every existing backfill guard remains in place.

Tyler Warren is exactly **#23** and Bo Nix exactly **#24**. There is no #25 record or next-turn indication for this completed roster.

## Persisted history, authority and corrections

`fantasy_drafts` freezes scoped participant IDs, resolved roster slots and original rules snapshot. It is configuration, **not a second cursor**. `draft_picks` stores immutable overall pick/round/pick-in-round, Group/league/sport/slate, receiving team, canonical player, snapshot display labels, slot, actor/proxy metadata, created/occurred timestamps, source, and reversal status. `draft_corrections` is append-only, storing removed/added player identities and names, receiver, actor and time, with original pick linkage where known (including replacement chains).

`mutate_fantasy_draft` locks the slate row first. Under that lock it validates actual actor membership/commissioner authority, receiving team, league/Group/sport, participation, lock state, frozen rules, expected roster, player identity/active status, legal unique slots, and other rosters' player ownership. The trusted server resolves rules and slot matching using the canonical resolver; the DB rechecks the exact rules snapshot, slot eligibility and assignments. Clients cannot provide authoritative rules, pick numbers, actor or proxy state.

The next pick is `max(overall_pick)+1` across **all history, including reversed picks**. Round and receiver follow the frozen participant array, generic for participant count/roster size. A unique slate/pick constraint and active slate/player index supplement serialized writes. Expected roster IDs reject stale tabs, including the same participant drafting at a snake-round boundary. Roster and history insert either both commit or both roll back. Direct legacy NBA/NFL lineup writes are guarded, preventing bypass through old apps, imports or deletion handlers.

Normal picks record the authenticated actor, snapshot actor name, and `is_proxy` from actor-versus-receiver identity in the DB. Group commissioners, super-admins and the established legacy-admin proxy role retain pick authorization. Ordinary members cannot proxy. Removal/correction requires commissioner authority. Original pick numbering and player labels remain; reversal fields can transition once and later corrections append rows. Replacement players are **roster corrections, not invented draft picks**. Vacancies after draft completion require correction, never a rewound cursor or fake pick 25. Legacy populated drafts without verified history cannot accept new picks; commissioner corrections remain auditable without fabricated chronology.

New history tables have RLS enabled, no anon/authenticated policies, and no service-role direct write grants. Only the service-role entry RPCs are granted execution; authenticated app access is enforced by server PIN/Group checks and repeated inside the mutation RPC. History/configuration updates/deletes are guarded. Sport-specific canonical player validation follows the existing polymorphic player-catalog architecture; no provider IDs are replaced.

`read_fantasy_draft` reads history, current roster counts and configuration in one statement snapshot. The API supplies all scope keys after authorization. It returns only actual picks. Unknown legacy history requires review; completed drafts remain visible; locked incomplete drafts show closed rather than on-clock.

Proxy Pick Notifications retain the existing admin toggle, recipients, preferences and templates. NBA/NFL next-turn selection now uses authoritative history. A successful pick passes its committed overall number; an already-advanced cursor suppresses that pick's stale notification, preventing two successful requests from both notifying the later turn. Failed/no-op/correction requests do not send pick notifications. Delivery remains post-commit and best-effort, not a transactional outbox. Golf and excluded game-type semantics are unchanged.

## Backfill safety

The backfill locks the target slate and roster/participation tables for verification/insertion. It verifies exact Group/league/NFL/slate/date identity, snapshot/version, configured participant order and active membership, capacity, all 24 canonical IDs/provider IDs and positional eligibility, all current lineup owners and saved slots, roster/lineup counts, and the exact snake sequence. Any existing draft configuration/history/corrections causes a hard stop. Re-running is intentionally rejected, not silently merged. The final insertion derives rounds/pick-in-round from verified participant count. No assignments are changed and no pick after 24 is inserted.

`source='verified_backfill'`, `actor_user_id=NULL`, `actor_name=NULL`, `is_proxy=NULL`, `occurred_at=NULL`. Only record `created_at` records insertion time. No historical action time/actor/proxy status is fabricated. Live picks require their actual actor/proxy/occurrence metadata.

## Draft Order UI

A third compact chronological view is added to the existing Positions/Players switch. It shows overall pick, round.pick, participant, player and position, plus compact proxy/reversed indicators. Corrections can be expanded for original-pick linkage, removed/added names and actor. Backfilled metadata is explicitly described as unknown. PlayerPool remains mounted; participant selection, existing own/opponent slot UX, Game Center inspection, refresh button and real-device pull wiring are preserved. New history joins the existing scoped read refresh after successful picks and manual/pull refresh. No polling loop or global directory sync was added.

## NFL live QA fixes

### Persistent field

Root cause: normalization required every live field/clock/down value from the latest play and returned null on punt/timeout/transition; `NflLiveField` returned no markup for null. It now always renders its existing compact field shell in PBP, even when state is neutral, loading, or failed. The shell is outside the detail-loading/error branches. Missing individual data hides only unsupported markers/labels; no guessed possession, yard line, down, distance, first-down line, clock or direction is introduced.

For explicitly typed timeout/administrative events, the normalizer can look back within the **current drive and unchanged explicit possession**, skipping only known non-moving administrative events. It will not cross a snap, penalty, punt, turnover, score, known period change or drive boundary. Retained values remain labeled “Last structured spot” with the source play's actual clock; no newer clock is attached to an older ball spot. A penalty's structured end state can be used; a penalty/no-play with no reliable end state yields neutral markers. New possession with no matching new drive/spot clears old possession/ball presentation. The next valid new-possession spot restores markers. Pregame/final/unknown states retain the neutral shell. Polling, dimensions and normalized left-to-right orientation remain unchanged. No play-description parsing is used.

### Final/live/left

Root cause: the NFL refresh initialized absent-boxscore players with zero lifecycle counts and persisted team `games_remaining: 0`. Scores displayed those stored zeros. The pipeline now determines lifecycle from each canonical player's uniquely matched team game in the slate-wide schedule, independently of whether an athlete appears in a box score, and sums remaining entries. Summary status can refine the scoreboard status. Ambiguous/missing events remain unresolved instead of being marked complete. D/ST matches its synthetic provider team identity in the scoring pipeline.

Scores uses its existing `NflFantasyGameCenter` slate schedule context for immediate display, so already-stored zero counts do not require a DB backfill to render correctly. Team-code mapping is canonical and never uses player names; D/ST is one roster entry classified by its team game. Scheduled=`left`, in-progress=`live`, completed=`final`. A known schedule status takes precedence over a stale stored player status. When the schedule has no mapping, a current-slate stored `game_status` of 3/2 is used; otherwise the entry remains `left` (unresolved). Bye, inactive roster entries, cancelled/postponed/suspended, missing and ambiguous mapping are not silently counted as finished. They remain relevant roster entries until removed; “left” includes unresolved entries, not a promise that a game will occur. Thus final+live+left partitions the full relevant roster. Fantasy points and scoring formulas are unchanged.

The existing schedule fetch/refresh mechanism is reused. Context includes slate identity, and cached schedule state is cleared on slate changes; aborted A-B-A requests cannot repopulate old counts. No extra polling is introduced, and Group/provider/global navigation architecture is unchanged.

## Validation and limitations

- `node --test tests/*.test.cjs`: **28 test files, 28 passed, 0 failed**. Includes Draft, Groups/security, corrections, NBA/NFL/rules, notifications, Scores/Game Center, pull-to-refresh, and existing unrelated regression guards.
- New `draft-history.test.cjs` exercises generic snake/round/capacity, canonical frozen slots, full read scope, missing infrastructure, all verified backfill identities/owners/order, API actor/receiver/forged chronology, proxy denial/toggle, stale/duplicate error propagation, and static SQL constraints/locks/audit contracts.
- Extended Draft workspace tests cover post-pick history, selected view/refresh, mounted pool, cross-Group clearing, exact completed/reversed Week 1 presentation; existing proxy/pull tests remain passing.
- Extended field tests cover normal plays, independent missing fields, punt, unknown play, timeout without location/period, penalty/no-play, score/final, new possession and persistent shell without guessed markers.
- `nfl-roster-status.test.cjs`: six upcoming; one live+five upcoming; mixed partitions; live-only/missing/unknown schedules; D/ST; unchanged point values; A-B-A aborted fetch/cached state; pipeline scheduled/exceptional states and remaining aggregation.
- One existing corrections test failed solely because it required a one-line resolver call although HEAD already used multiple lines. Its regex now allows whitespace/trailing comma; the stat-correction implementation was not changed.
- Final affected recheck: Draft history, field, NFL status and corrections — **4 test files passed, 0 failed**. An additional recheck after moving the shell outside loading/error content covered field, Live Scores, NFL fantasy games and Draft history — **4 files passed, 0 failed**.
- TypeScript: `npx tsc --noEmit --pretty false` passed.
- `git diff --check` passed.
- Local Dev server started successfully. Read-only NBA/NFL Draft, NFL Scores and scoped API requests compiled and returned access-controlled 404s without module/type errors. There was no authenticated browser session, real pick, database write or device test in this run.
- SQL contract assertions are **not PostgreSQL integration tests**. Function/trigger installation, exact rollback behavior, locks under real concurrent sessions, grants/RLS and backfill guards require the controlled runtime QA below. No claim of runtime-tested database atomicity is made.

## Manual QA after reviewed SQL/deployment

1. Open NFL slate 179 in Group 111 and select Draft Order. Compare all rows with the table above, especially Kyle Pitts / Mark #6, Tyler Warren #23 and Bo Nix #24; check each receiving participant and round.pick.
2. Confirm “Draft complete”, no Pick 25, and the unknown historical actor/time note.
3. Confirm Positions, Players, selected participant, commissioner opponent roster slots, filled-player inspect-only behavior and research/Game Center remain intact.
4. Refresh using both compact button and real-device top pull while Draft Order is selected. The selected view persists. Network must not contain `/api/sync-players` or `/api/sync-players-nfl`.
5. Switch Groups/sports/slates, including A-B-A during an in-flight refresh; history and current status must never leak from the previous scope.
6. In a dedicated empty NBA test draft and NFL test draft, verify first self-pick creates one current assignment and one matching history record. Verify custom roster slots, non-four participant snake, turns/round boundaries, complete status and no invented future rows.
7. Test commissioner proxy drafting: receiver belongs to selected team, actor is signed-in commissioner, proxy=true. Self-pick proxy=false. Ordinary opponent requests and forged actor/overall/round data must not change authority.
8. Test two tabs, two users, and commissioner+participant submitting concurrently, including consecutive snake picks belonging to the same receiver. Exactly one stale roster request succeeds; no duplicate pick number/player or skipped turn. Re-read both roster and history after each failure.
9. Induce a rejected player/occupied slot/unauthorized receiver and verify neither roster nor history changed. Confirm direct legacy insert/update/delete attempts fail using a controlled integration test client.
10. As commissioner, replace/remove a drafted player, then correct the vacancy. The original pick remains reversed/auditable, correction linkage and actor are retained, later numbers do not shift, and no extra chronological pick is created. Ordinary correction/removal requests fail.
11. Verify locked drafts reject picks, history remains readable, frozen participant/rules edits fail, and changed Group settings affect only a new slate.
12. Verify proxy notification toggle on/off and existing recipients/settings. Failed/stale/correction requests must not notify; an advanced turn must not receive a duplicate stale notification.
13. Review/re-run backfill only in a controlled test environment: repeat invocation, changed ownership, wrong provider/slot/order/rules, extra roster row and existing history must abort without partial history. Do not alter production Week 1 merely to test these guards.
14. During a live NFL game, watch normal offense -> timeout -> penalty/no-play -> punt/turnover -> new possession -> score. Field shell must stay mounted; trustworthy markers stay on timeout, uncertain old-possession markers disappear on transition, new structured spot restores them. Repeat at final and on a failed refresh. Verify unchanged mobile field size/orientation/PBP polling.
15. On NFL Scores, verify six upcoming, one live+five upcoming, mixed final/live/left and DST against actual weekly schedule. Sum must equal roster entries. Repeat Group/week switches, unknown/missing provider state and refresh; fantasy points must remain unchanged by lifecycle classification.

Remaining operational limitations: no automatic reconstruction of other populated legacy drafts; no destructive history deletion/import bypass; score recomputation and notification delivery remain post-commit operations and can fail after a successfully audited roster correction/pick. Corrections at a completed draft repair rosters rather than reopening chronology. Runtime SQL QA, authenticated device QA, and the separately requested pre-deployment production build remain manual rollout gates.

## Files changed

- `app/api/admin/lineup-correction/route.ts`
- `app/api/lineups/route.ts`
- `app/api/refresh-stats-nfl/route.ts`
- `components/lineups/DraftOrder.tsx`
- `components/lineups/LineupBuilder.tsx`
- `components/lineups/NflFantasyGameCenter.tsx`
- `components/lineups/ScoresDashboard.tsx`
- `components/live-scores/GameCenterModal.tsx`
- `components/live-scores/NflLiveField.tsx`
- `docs/draft-history-rollout-and-qa.md`
- `docs/nfl-week1-draft-verification.json`
- `lib/draftNotifications.ts`
- `lib/lineups/draftHistory.server.ts`
- `lib/lineups/draftHistory.ts`
- `lib/lineups/nflRosterStatus.ts`
- `lib/live-scores/nflField.ts`
- `lib/providers/nfl.ts`
- `supabase/manual/20260912_nfl_week1_draft_backfill.sql`
- `supabase/migrations/20260912000100_fantasy_draft_history.sql`
- `tests/corrections-scoping.test.cjs`
- `tests/draft-history.test.cjs`
- `tests/draft-workspace.test.cjs`
- `tests/groups-batch-3b.test.cjs`
- `tests/helpers/scores-harness.cjs`
- `tests/nfl-live-integration.test.cjs`
- `tests/nfl-roster-status.test.cjs`
