# NFL commissioner correction replacement investigation

Starting local and remote main: `375c456a0a743bc330bc93f23c146867bc3acc66`.
Branch: `fix/nfl-commissioner-correction-replacement`.

## Exact conflict

`POST /api/lineups` delegates NBA/NFL writes to `mutateFantasyDraft`, which
calls the service-role-only PostgreSQL `mutate_fantasy_draft` RPC.

The RPC's ordinary-pick path compares each participant's active
`lineup_players` count to their count of **all** `draft_picks`:
`supabase/migrations/20260912000100_fantasy_draft_history.sql:212–215`.
Reversed historical picks deliberately remain in the latter count.
A removal therefore causes a mismatch before turn enforcement is reached.

The exception is SQLSTATE `P0001`, message:
`Roster correction required before drafting can continue`.
The route forwards it as HTTP 409:

```json
{"error":"Roster correction required before drafting can continue"}
```

This exact response was reproduced with the actual application route and
unchanged PostgreSQL RPC on starting production main in an isolated test
cluster. No production mutation was attempted to retrieve an error.

## Other conflict paths traced

The lineup route has three NBA/NFL conflict exits:

1. Missing/invalid `expectedPlayerIds`: refresh/current-roster-version error.
2. A thrown assignment/query/helper error: message forwarded as 409.
3. RPC error: database message forwarded as 409 (missing history infrastructure
   is explicitly 503).

`buildDraftAssignments` rejects occupied/ineligible pinned slots and rosters
that do not fit the canonical frozen slots. The route separately rejects
roster overflow, invalid/inactive players and ineligible slots with 400.

The mutation RPC checks authorized Group/league/sport, active actor and Group
membership, proxy/correction permissions, lock and snake format for ordinary
picks, receiving participation/membership, unchanged rule snapshot, valid slot
configuration, duplicate IDs/overflow, duplicate legacy lineups, expected
roster version, single-player mutation shape, ownership across lineups,
assignment coverage/unique positions, canonical position eligibility, saved
slot pins, frozen draft configuration, initialization/verified history,
participant order, roster/history counts, chronology completion, expected
team, and expected round roster count. Those exceptions become 409.

Database constraints retain unique `(slate_id, overall_pick)`, active-only
`(slate_id, player_id)` uniqueness, pick status/reversal consistency, live-pick
actor/time requirements, scoped foreign keys and correction audit checks.
Roster writes must use the authoritative RPC. Pick/correction history and
draft configuration remain guarded against modification/deletion. No index,
constraint, function or trigger is changed by this fix.

Availability, roster counts and client ownership derive from active
`lineup_players`; the correction correctly deleted Nico's assignment.
The snake cursor is `max(overall_pick)+1` over all historical picks. The
historical #17 continues occupying its chronological slot, intentionally.
The client sends the active roster snapshot; the reproduced conflict is
neither a stale-player request nor WR-slot collision nor duplicate ownership.

## Production slate 193: authenticated SELECT-only inspection

- NFL 2026 Week 5; unlocked; not archived; rules version 5.
- Frozen participants `[2,4,1]`: Josh, Mark, Andy. Jon is opted out.
- Mark is an active Group admin; all three participants have active membership.
- Mark's lineup: `1080`; five active players:
  Bijan Robinson (`44`, RB #1), Jonathan Taylor (`385`, RB #0),
  Puka Nacua (`518`, WR #0), Trey McBride (`18`, TE #0),
  Kyren Williams (`530`, FLEX #0).
- Josh lineup `1079`: five active players. Andy lineup `1081`: six.
- Mark has five active draft-pick records and six historical picks.
- Nico Collins player `335`; pick row `105`; overall `17`; round `6.2`;
  WR #1; status `reversed`.
- Correction row `3`: linked to pick `105`, old player `335`, new player null;
  actor Mark. Original pick and removal remain present.
- Last historical pick: 17. Chronological next: 18, Josh, round 6.3;
  Josh then has 19, round 7.1; Mark has 20, round 7.2.
- Important discrepancy with the initial report: the frozen roster has **seven**
  slots (QB 1 / RB 2 / WR 2 / TE 1 / FLEX 1). Mark's active backend roster is
  5/7. WR #1 and QB #0 are open. This fix does not change the snapshot or UI
  roster denominator.
- The new vacancy classifier was evaluated against these existing production
  SELECT results and recognizes the recorded vacancy without any repair.

These observations describe the investigation-time snapshot, not a promise
that other users have made no subsequent changes. All production database
access performed for this task was SELECT-only.

## Existing replacement semantics and narrow fix

This architecture has numbered snake picks plus append-only commissioner
roster corrections. It already supports a standalone roster-add correction
with `pick_id=null`; `DraftOrder` displays it under "Roster corrections" as
"Roster adjustment · added [player] · by [commissioner]".

A commissioner filling a recorded vacancy from the normal NFL draft controls
now uses that existing correction intent, rather than trying to consume the
next snake pick. This is an existing standalone audit event design, not a new
#17 or #18 and not an undocumented rewrite of #17.

The classifier requires initialized history, fewer active players than the
team's numbered historical picks, an explicitly recorded removed pick, and
agreement between the effective pick/correction assignments and the current
active roster. It accounts for previous standalone refills and their removals.
Only one-player additions by an active Group commissioner/super-admin qualify.
Legacy proxy permission alone and client-supplied correction flags do not.
Receiving participation and active membership are checked for this live Draft
path. The normal route lock and roster validation remain in place. The live refill also rejects archived or ended slates, preserving the dedicated historical correction workflow. The RPC
still enforces commissioner permission, scope, expected roster version,
ownership, roster size, position eligibility and the frozen configuration.

The refill records the new active lineup assignment and its audit event in
one existing RPC transaction. No sequential-pick notification is sent.
Once the vacancy is filled, roster/history counts agree and ordinary snake
picks resume at the unchanged cursor. Commissioner corrections retain their
existing permission boundary; ordinary members do not gain correction powers.

This works with already-recorded reversals such as slate 193, requires no
migration/data repair and leaves discard guards intact.

The conflict UI previously set an error banner underneath an open draft
modal. Failed saves now dismiss that modal and refresh draft state while
preserving the error banner, with no automatic retry.

## Origin

The restrictive roster/history consistency check and correction-event model
were introduced by `b6dfe46` (authoritative draft history). Neither
`06d8e08` (participant eligibility) nor `9fe25ee` (guarded discard) introduced
that check. Guarded discard preserves the existing allowed active-to-reversed
pick transition; it does not replace the mutation RPC. This bug is the normal
Draft UI choosing an ordinary pick intent for a vacancy requiring the existing
commissioner roster-add correction intent.

## Regression evidence

`tests/nfl-correction-replacement.test.cjs` runs the real lineup route,
correction route, canonical roster assignment, history reader, and original
SQL migrations in a fresh Unix-socket PostgreSQL cluster. It never loads
`.env` or connects to an external database.

The main regression first drafts 17 picks with three participants and six
slots, removes Nico via the actual correction handler, confirms five active
players, and attempts another eligible player via the actual lineup handler.
Before the application fix this fails with the exact HTTP 409 above. The test
also independently proves the unchanged ordinary RPC still rejects that
state; the fix chooses the correct audited intent instead of disabling guards.

Coverage includes the seven-slot production shape; most-recent and earlier
removals; same/different eligible positions (FLEX); re-drafting the removed
player; removing/refilling a replacement; preserved history; unchanged other
participants; no incorrect next-pick notifications; normal picks resuming;
active ownership rejection; position/capacity/stale-roster rejection;
commissioner-only refill/correction permissions; legacy proxy and forged
correction flag rejection; inactive/opted-out targets; locked, archived and ended completed slates;
and unexplained roster holes/multi-player additions refusing correction intent.

Run with:

```sh
SLATE_DISCARD_TEST_PG_BIN=/path/to/local/postgresql/15/bin node --test tests/nfl-correction-replacement.test.cjs
```

Known baseline failures were separately verified before implementation:
`golf-product-ui.test.cjs`, `nfl-background-scoring.test.cjs`,
`nfl-usability.test.cjs` (one failure each).

## Additional request: commissioner future-slot picks

Entering Mark's future QB at assigned #20 before Josh's #18/#19 is a separate
requirement. The current mutation RPC enforces `max(overall_pick)+1` and
expected-team/round counts; the read model also assumes contiguous chronology.
An application-only correction addition would not accurately create #20.

Supporting that request properly requires a reviewed migration replacing
`mutate_fantasy_draft` slot selection/authorization/consistency checks (and
matching read-model/UI changes). Existing `draft_picks` columns and unique
assigned-slot constraint can support future-slot entries; their `occurred_at`
retains actual entry time. The next unresolved assigned slot would replace the
max-pick cursor. No production-data repair is expected for existing contiguous
history, including slate 193. Ordinary members would retain normal turn
restriction, while commissioners could target an unfilled slot belonging to
that participant. All scope, frozen rules, ownership and audit checks must
remain. No migration for this added requirement has been created or applied;
it needs the user's decision under the explicit migration stop instruction.

## Release validation

- Final focused run: 222 passed, 0 failed, 0 skipped, including real PostgreSQL
  draft/correction and guarded-discard coverage, participant eligibility,
  Draft UI conflict handling, roster status and frozen scoring integration.
- `npx tsc --noEmit`: passed.
- `npm run build`: passed, including its TypeScript check.
- `git diff --check`: passed.
- Final full suite: 1,375 total; 1,339 passed; 3 known baseline failures;
  33 skipped; no new failures. The three failures match the pre-implementation
  baseline named above. Unrelated NFL/NCAA inline Game Center, NBA semantic
  court/favorites, NBA Skins favorites/live and Golf Live tests remain intact.
- Dev smoke: NFL Draft route 200; unauthenticated lineup GET 401, as expected.
- No migration or production-data repair for the released replacement fix.
- No production mutation and no ShotCast worktree operation performed.
