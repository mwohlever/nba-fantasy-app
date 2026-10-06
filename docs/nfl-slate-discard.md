# Discard an abandoned NFL slate

Discard permanently removes a future, unplayed NFL slate attempt, including its
initialized draft and picks. Archive continues to preserve history while hiding
normal selection. Normal corrections retain audited chronology. Neither archive
nor correction is a substitute for discard.

## Deployment and review

Review and manually apply
`supabase/migrations/20261006000100_guarded_nfl_slate_discard.sql` as the existing
fantasy-protection function owner, then deploy the matching app. The migration
changes no existing slate/data and does not run a discard. Before it is applied,
Slate Admin hides Discard and DELETE fails closed with 503.

The migration verifies actual deployed immediate, validated slate foreign keys,
the lineup-player FK, nullable notification slate references, enabled existing
protection triggers/function owners, and the absence of direct service-role
history write grants. An unexpected schema stops the migration transaction.
Do not work around a failed preflight by disabling protections. Review the
reported difference first. A full Supabase schema dump is not present in this
repository; isolated tests use representative base tables and the actual draft,
NFL sync, and discard migrations.

This implementation was tested locally. No production migration or discard was
performed. In particular, production slate 191 was not changed. The current Week
5 equivalent (unlocked, future start day, four frozen participants, Josh/Gibbs
pick and roster, no scoring/state/results) is covered by the integration fixture.

## API and authorization

Commissioner-authorized `GET /api/admin/slates/:id` includes a read-only `discard`
eligibility result from `inspect_nfl_slate_discard`. Only eligible NFL slates show
the separate **Discard Slate** action. Confirmation identifies the slate and
states that the slate and draft are permanently removed and cannot be restored.

`DELETE /api/admin/slates/:id` requires JSON:

```json
{"action":"discard","confirmedSlateId":191}
```

The example illustrates the request shape; do not run it against production
without a separate, explicit decision to discard the target.

The handler authorizes the target commissioner before calling
`discard_abandoned_nfl_slate`. Group, league and actor parameters come from
server authorization/session data, never request-body ownership claims. The DB
resolves ownership again and requires an active account and an active Group
admin membership in that target Group/enabled league, or the existing explicit
super-admin exception. Wrong Group/league, ordinary members, revoked membership
and inactive accounts fail closed. Browser roles cannot call either RPC; only
the trusted server service role receives EXECUTE.

DELETE's old multi-request cleanup is replaced entirely. NBA and Golf requests
are rejected before mutation. NCAA Pick'em and NBA Skins use separate workflows
and are unchanged.

## Eligibility

The database requires all of the following at the destructive transaction:

- NFL slate and NFL league ownership match the authorized target.
- `is_locked` is exactly false.
- Start and end dates exist and are consistent.
- Start date is strictly after today's Eastern calendar date. Same-day,
  past and uncertain schedules are rejected, even if unlocked. A known
  `first_game_start_time` in the past also rejects discard.
- No `team_slate_results`, `player_slate_stats` or `player_nfl_slate_stats` rows.
  Row existence matters, including zero-valued rows.
- No `nfl_sync_state` row, including idle, failed or expired states. This is
  deliberately conservative evidence of scoring setup/activity.
- No verified historical/backfilled picks or inconsistent dependency ownership.
- No populated dependency outside the reviewed graph. Catalog-driven inspection
  includes cascade children, preventing silent deletion of unrelated Golf/NBA
  records or new history tables.

No provider parsing/scoring change is required: normal NFL creation already uses
validated week dates. NFL has no reliably persisted first-kickoff timestamp on
new slates, so the initial implementation rejects the entire start day. It does
not claim to support same-day resets. Missing dates never become a fallback to
`is_locked=false`.

## Transaction, protections and concurrency

The RPC locks the slate `FOR UPDATE`, the same first lock as authoritative draft
and correction mutations. It holds authorization/ownership rows with share
locks and locks existing descendants before examining additional FK children.
It then rechecks eligibility. Immediate validated child FKs acquire parent
`KEY SHARE` locks, fencing concurrent scoring-state/result inserts:

- A committed pick that wins the lock is included in the discarded graph.
- A pick after discard waits and then rejects the missing slate.
- A scoring claim/result insert that wins first causes discard to wait and then
  reject the committed state/row.
- A scoring insert after discard waits and fails its FK or resolves the missing
  slate as ineligible; it cannot leave orphan state/results.
- Simultaneous discards yield one success and one clean not-found.

A private `nfl_slate_discard_context` row identifies the exact backend,
transaction and slate. Only the RPC owner can create it. The two existing guard
functions admit **DELETE only** when that capability matches. No user-settable
GUC enables history deletion; no service-role history DML grants are added.
The capability is removed before success and rolls back on failure. Ordinary
history updates/deletes, roster direct writes, participant freeze and rules
freeze remain protected. Existing audited reversals retain their exact allowed
fields. Table-specific dispatch in the history trigger avoids accessing a
`status` field on configuration/correction records, without relaxing protection.

Deletion order is corrections, picks, roster players, lineups, frozen draft
configuration, participant rows, notification detachment, then slate. Results
and sync tables must already be empty; they are never erased to make a scored
slate eligible. Retained lineup/player IDs allow cleanup verification even if a
trigger suppresses a cascading roster delete. All dependencies are checked after
cleanup, and the slate deletion must return the target ID.

The cleanup is a PL/pgSQL exception subtransaction. Any FK, trigger, permission
or incomplete-cleanup error rolls back every deletion, notification update and
capability insert. API/UI receive a structured failure (`dependency_failure`)
and no partial cleanup. Transport errors instruct the commissioner to reload
rather than assuming a failed response means the transaction did not commit.

## Delivery audit

`notification_history` is the existing operational delivery ledger, not fantasy
draft chronology. Rows survive with `slate_id = NULL`, existing league/recipient,
content, outcome and metadata, plus `metadata.discardedSlate` containing the old
ID/label, actor and discard time. No broken FK remains. Already delivered pushes
cannot be recalled. Draft/pick/roster records are removed completely; these
retained audit rows do not feed standings, player draft counts or reseeding.
Aggregate background-run audit records are not competitive slate dependencies
and are not rewritten.

## Recreation and manual QA

Use a non-production fixture first. On mobile and desktop, confirm:

1. A future started NFL slate offers Discard while participants remain frozen.
2. Cancel sends no delete. Confirm permanently removes the attempt.
3. A stale eligible screen rejects discard if a zero result/scoring row appears.
4. Completed/scored/past NFL slates offer no Discard action.
5. Create the same season/week through the normal creation form.
6. Only Josh/Jon/Mark/Andy are available; inactive Mark YMCA is absent.
7. Uncheck Jon, create/save, and verify Jon's Group membership remains active.
8. Reseed from legitimate Week 4: Josh, Mark, Andy participating; Jon unchecked.
9. No old draft, pick or lineup is inherited; manually draft Gibbs as a new pick.
10. Switching Groups cannot discard another Group's target.

NFL duplicate detection, active-member creation and reseed behavior are unchanged.
Removing the old slate makes normal same-week creation possible. The fresh slate
gets new IDs, current rules and new participant configuration; old chronology is
not copied. NBA is intentionally unsupported in this first release because its
pin/schedule and worker lifecycle need separate validation. Golf's additional
lifecycle/roster/salary history remains unsupported and protected.

## Tests

No test reads `.env` or accepts a production DB URL. PostgreSQL tests create and
destroy a fresh Unix-socket-only cluster. Supply an existing PostgreSQL 15 binary
installation, whose matching share/libs directories are available:

```sh
SLATE_DISCARD_TEST_PG_BIN=/path/to/postgresql/15/bin \
  node --test tests/slate-discard-postgres.test.cjs
node --test tests/slate-discard.test.cjs
```

Actual React Slate Admin/Create Slate pages and actual API handlers are exercised
in Chromium; the destructive RPC uses the isolated PostgreSQL instance. Every
browser request is intercepted, so it cannot reach production or ESPN:

```sh
SLATE_DISCARD_TEST_PG_BIN=/path/to/postgresql/15/bin \
FOOTBALL_BROWSER_MODULE=/path/to/playwright \
SLATE_DISCARD_SCREENSHOT_DIR=/tmp/slate-discard-qa \
  node --test tests/slate-discard-browser.test.cjs
```

Coverage includes normal immutability/corrections, authorization, empty and
started attempts, correction dependencies, audit detachment, real rollback,
silent trigger suppression, unknown cascade children, capability isolation,
schema preflight, fresh chronology, current membership, previous-week reseed,
zero scoring, lifecycle uncertainty, all sync states and two-sided SQL races.
