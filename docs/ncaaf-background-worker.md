# NCAAF Pick'em audit and unattended rollout

This work does not apply Supabase SQL, install schedules, change production data, deploy, commit, push or merge. The audit began on a clean `main` at `248fd0c` (the completed Golf worker). Implementation is on `feature/ncaaf-background-worker`. NFL, Golf, Bracket, NBA, NBA Skins, March Madness and ShotCast implementations are unchanged.

## Audit of the checkout before implementation

1. **Existing background behavior:** `GET /api/cron/refresh-ncaa` queried every non-final `ncaa_pickem_weeks` row, newest first, without an item limit. It called `POST /api/refresh-stats-ncaa` internally for each ID. Individual failures produced a 207 response. There was no NCAAF lease, retry state or worker run table/RPC. The endpoint was callable unattended, but was not equivalent to the durable workers.
2. **Browser dependencies:** `components/AppHeartbeat.tsx` mounts, runs immediately and every five minutes while visible, and runs on visibility changes. Its authenticated `/api/app-heartbeat` server route calls both NCAAF cron handlers. `app/ncaa-pickem/page.tsx` also posts a refresh once per selected week per mount. Without an external trigger, persisted results, pick grades, stored lock/final status and reminders depended on these calls. The Scores page reads ESPN through `/api/ncaa-pickem/scores`; it does not persist grades. Game/player detail routes are display reads.
3. **Existing cron routes:** `/api/cron/refresh-ncaa` refreshed/scored all non-final weeks. `/api/cron/ncaa-pickem-reminders` independently scanned open weeks with locks in the next 168 hours, then applied each league's configured reminder window. Both were GET-only Node routes with 60-second maximum duration and `GOLF_CRON_SECRET` bearer authorization. No third NCAAF cron handler or NCAAF scheduler installation was found.
4. **Unattended suitability:** both handlers could run without session cookies using their secret, but lacked bounded durable work, concurrency exclusion and retry history. Reminder notification history provided event deduplication, distinct from worker durability.
5. **Independent responsibilities:** provider ingestion, grading completed included games, and open → locked → final lifecycle advancement belong together. Reminder checking is independent of ESPN/scoring and must keep running when the provider fails. Standings are computed on read from `is_correct`; there is no standings materialization or recomputation job to schedule.
6. **Database infrastructure:** checked-in foundation, Group scope and odds migrations define weeks, games and picks. League ownership is mandatory, with `(league_id, season, week_number)` and `(week_id, espn_event_id)` uniqueness. Picks are unique by `(game_id, team_id)`. Shared notification history exists; the unique event-key constraint expected by `sendLoggedNotification` is not defined by checked-in migrations. Production schema was not inspected. No NCAAF worker infrastructure was found before this work.
7. **Concurrency/idempotency:** old grading skips identical `is_correct` values. Browser heartbeat excludes overlapping calls only within that browser instance. No database guard excluded other browsers, manual calls or cron. `sendLoggedNotification` inserts history before sending and suppresses a `23505` duplicate. Failed/pending/skipped historical reminder events are not resent under the existing event policy.
8. **Secrets:** both old NCAAF cron routes used `GOLF_CRON_SECRET`. Manual refresh uses `authorizeNcaaWeekResource(..., { allowInternal: true })`; its existing server-internal bypass also uses `GOLF_CRON_SECRET`. Supabase service-role credentials stay server-side. ESPN's public CFB APIs do not need a provider secret.
9. **Scheduling evidence:** no `vercel.json` or NCAAF `cron.schedule` installation was found. Heartbeat calls are repository evidence of a browser trigger. Supabase's actual `cron.job`/Vault configuration is external and was not queried. The user independently production-validated Bracket/NFL/Golf schedules at offsets 0/2/4; this audit does not revalidate or modify them. Older repository documentation is not proof of current production scheduler state.
10. **Adding another trigger without coordination:** it would duplicate provider requests across browser/cron/manual callers and allow older refreshes to overwrite newer results, race grading/lifecycle writes, and repeat reminder attempts. A single new schedule per responsibility should replace any old NCAAF external trigger, using these same URLs. The browser heartbeat remains supported and now shares durable guards.

Scoring remains straight-up winner matching, not spread scoring. Only imported games update; only included completed games with a winner grade picks. Active membership, active account and Group team identity define participants. Odds freeze at the weekly lock or either known kickoff. Normal pick saving directly rejects deadlines and locked/final status even if stored lifecycle status has not caught up. Commissioner correction, week-control and import routes remain available. Existing final weeks stay final during explicit refresh. No draft, result or finalization notifications are added.

The provider path remains `fetchNcaaPickEmWeek`: ESPN college-football scoreboard with `dates=<season>`, `seasontype=2`, `week=<week>`, `limit=200`, `groups=80`, plus AP rankings for that season/week. Event/team IDs, ranking selection, game selection and odds mapping are unchanged. Regular-season behavior is preserved; this work does not extend Pick'em to postseason or Bracket competition providers.

References inspected read-only: `lib/nfl/backgroundScoring.server.ts`, its refresh/provider/policy and migration; `lib/bracket/backgroundSync.server.ts`, its competition worker/cron/migration; `lib/golf/backgroundRefresh.server.ts`, policy, authoritative refresh and migration. These establish recoverable five-minute leases, due-time retry suppression, bounded work and service-only run history.

## Changes and boundaries

The existing routes now call one server-only NCAAF worker. State is keyed by **week ID and task**, so Groups sharing a season/week or ESPN event remain separate. Results and reminders have separate leases/backoff and separate run histories. Manual refresh uses the same results lease, bypasses due times but cannot bypass an active lease, and retains explicit refresh of historical final weeks. Authorization precedes worker access.

Claims use a state-row lock, a random token and a five-minute expiry. Expired leases can be replaced. Results are applied and current picks graded inside a single SQL transaction that holds the matching state row and checks the live lease. Stale tokens cannot mutate or finish another claim. The transaction preserves current commissioner inclusion, current locked odds and administrator-final status. It grades current `picked_team_id`, avoiding grades derived from a stale pre-correction read.

One safety correction accompanies the transaction: finalization requires all **locally included** games in the provider batch to be completed. The old code could finalize from a returned subset. A wholly empty mapped response for an imported week fails and retries. Partial responses update available games without prematurely finalizing. Completed games without a winner retain the existing lifecycle behavior (complete for finalization; no pick grading until a winner exists).

Each invocation discovers at most 100 due weeks, ordered by oldest/unattempted work before applying the limit. It processes at most two weeks and stops starting work after 30 seconds. Provider calls share a 15-second AbortSignal deadline for scoreboard/rankings. Reminder passes start at most 25 new recipient events per week and stop starting sends after 15 seconds; existing reservations do not consume the recipient count, so later recipients progress on another pass. Endpoints retain the 60-second runtime bound.

Failures start retry delay at two minutes, double with consecutive failures, and cap at six hours. A successful result refresh uses four minutes during live games/near kickoff or lock, hourly shortly before games and six-hour polling early in the week or for old unresolved weeks. Locked/postponed weeks are not silently dropped. Background final weeks are excluded. Reminders use four-minute due suppression and independent discovery within the existing seven-day maximum horizon, then their own league window (24 hours by default).

`ncaa_pickem_reminder_events` atomically reserves the unchanged `ncaa_pickem_lock_reminder:<weekId>:<userId>` key. It checks historical notification keys, current membership, missing picks, preferences and deadline before reserving. This protects new callers even if shared event-key uniqueness is absent, without modifying shared notification infrastructure. The existing user templates, names, URLs, tags and league identity remain. Delivery stays **at most once per event**, not guaranteed delivery: a failed push or interrupted reservation is not resent. Worker failures remain visible and retry checks; event reservations are never pruned to force redelivery.

Runs include manual/background source, task, timestamps, counts, skips, recovered leases, budget deferral, compact outcomes and redacted errors. Every invocation records history, including idle and discovery failure runs. An invocation killed by the platform can remain `running`; its lease is recoverable. Retention removes at most 100 runs older than 60 days per invocation. State and notification reservations are retained. RLS and explicit permissions restrict new tables/RPCs to service role.

Changed existing files:

- `app/api/cron/refresh-ncaa/route.ts`
- `app/api/cron/ncaa-pickem-reminders/route.ts`
- `app/api/refresh-stats-ncaa/route.ts`
- `lib/providers/ncaa.ts` (optional AbortSignal on Pick'em fetches only)

New files:

- `lib/ncaaPickEm/backgroundPolicy.ts`
- `lib/ncaaPickEm/backgroundSafety.ts`
- `lib/ncaaPickEm/backgroundWorker.server.ts`
- `lib/ncaaPickEm/refreshWeek.server.ts`
- `lib/ncaaPickEm/reminders.server.ts`
- `supabase/migrations/20261002000100_ncaa_pickem_background_worker.sql`
- `tests/ncaa-background-worker.test.cjs`
- `tests/ncaa-background-worker-postgres.test.cjs`
- `docs/ncaaf-background-worker.md`

## Recommended production scheduling

Use separate five-minute triggers:

| Responsibility | Endpoint | Recommended Supabase cron expression |
| --- | --- | --- |
| Results/grades/lifecycle | `GET /api/cron/refresh-ncaa` | `1-59/5 * * * *` |
| Missing-pick reminders | `GET /api/cron/ncaa-pickem-reminders` | `3-59/5 * * * *` |

Offsets 1 and 3 fill the two unused offsets alongside existing Bracket 0, NFL 2 and Golf 4. Reminders require no ESPN calls. Five-minute game polling matches the requested durable-worker pattern and bounds ordinary result/grade lag during game action; there is no documented ESPN provider SLA or mandated polling cadence in this checkout. Stored due times suppress unnecessary early/stale-week provider calls. Five-minute reminders normally enter the configured window within five minutes; unusually narrow windows or many Groups need capacity observation.

Both endpoints expect `Authorization: Bearer <CRON_SECRET>` for new Vault jobs. They also accept the existing `GOLF_CRON_SECRET` for backward-compatible server heartbeat/legacy callers. Missing/incorrect secrets fail closed. Keep both existing environment values; do not change Golf or other jobs. No new provider credential is required.

## Exact manual rollout order

1. Review code and migration. Confirm deployed schema includes existing weeks/games/picks, mandatory league ownership, Group teams/memberships/accounts, odds columns, `notification_history.event_key`, and notification preference columns. Local SQL tests use an isolated fixture, not the actual production schema.
2. Inspect Supabase `cron.job` and any external dashboards for **NCAAF only**. Disable any existing external NCAAF results/reminder triggers before scheduler handoff. Leave all Bracket, NFL and Golf jobs unchanged. Allow old requests to drain during deployment; old and new versions must not process simultaneously because old code has no lease.
3. Manually apply **only** `supabase/migrations/20261002000100_ncaa_pickem_background_worker.sql`. It is additive and installs no schedules. Keep historical data and shared notification constraints intact. Reload PostgREST schema if needed: `notify pgrst, 'reload schema';`. Browser/manual routes depend on these RPCs too, so migration must precede code activation.
4. Ensure Vercel `CRON_SECRET` is configured; reuse the already-established server secret. Retain `GOLF_CRON_SECRET`, Supabase URL and service-role credentials. In Vault, reuse the existing URL/cron-secret entries after checking names; the names below are proposed placeholders, not discovered production names. Never expose decrypted values in query output or put a literal secret in a cron command.
5. Deploy the reviewed branch separately when authorized. This task performs no deployment. Ensure old invocations have finished.
6. Confirm unauthorized requests return 401. Manually call each new endpoint with the matching secret and inspect NCAAF run/state rows. An idle response is valid when no week qualifies. Confirm a browser/manual refresh shares the lease and can still refresh the intended active Group.
7. With reviewed deployment and verified RPC access, install **one** Vault-backed job for each responsibility using the templates below. Do not retain a second legacy NCAAF external trigger. Browser heartbeat can remain enabled because it uses the same guarded workers.
8. Observe scheduled results, pick grades, lock/final transitions and missing-pick reminders with the app closed. Compare standings and event-key counts, and watch request duration/budget deferral. Do not declare production verified from local tests alone.

## Future Vault-backed SQL — manual only, not executed

The established pg_cron/pg_net/Vault extensions are reused. See Supabase's [Cron setup](https://supabase.com/docs/guides/cron/quickstart), [Vault](https://supabase.com/docs/guides/database/vault), and [pg_net HTTP API](https://supabase.com/docs/guides/database/extensions/pg_net). Confirm installed extension versions/signatures before installation. `net.http_get` returns a request ID; the network request starts after transaction commit. A successful cron SQL run does not by itself prove a successful HTTP worker response.

```sql
-- READ ONLY: inventory NCAAF triggers and proposed Vault entry names without exposing secrets.
select jobid, jobname, schedule, active from cron.job
where command like '%/api/cron/refresh-ncaa%'
   or command like '%/api/cron/ncaa-pickem-reminders%';
select name, count(*) from vault.decrypted_secrets
where name in ('111_sports_app_url', '111_sports_cron_secret') group by name;

-- INSTALL ONLY AFTER the manual rollout steps above.
-- Vault URL must have no trailing slash; secret value must match Vercel CRON_SECRET.
select cron.schedule(
  'ncaaf-pickem-results', '1-59/5 * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = '111_sports_app_url')
        || '/api/cron/refresh-ncaa',
      headers := jsonb_build_object('Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = '111_sports_cron_secret')),
      timeout_milliseconds := 65000
    );
  $job$
);
select cron.schedule(
  'ncaaf-pickem-reminders', '3-59/5 * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = '111_sports_app_url')
        || '/api/cron/ncaa-pickem-reminders',
      headers := jsonb_build_object('Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = '111_sports_cron_secret')),
      timeout_milliseconds := 65000
    );
  $job$
);
```

## Production verification — read-only queries

```sql
select started_at, finished_at, task, source, status, considered, eligible,
       processed, succeeded, failed, lease_skipped, backoff_skipped,
       recovered, budget_stopped, duration_ms, details
from public.ncaa_pickem_sync_runs order by started_at desc limit 30;

select s.week_id, w.league_id, w.season, w.week_number, w.status as week_status,
       s.task, s.status, s.last_attempt_at, s.last_success_at, s.next_attempt_at,
       s.consecutive_failures, s.last_error, s.last_summary, s.lease_expires_at
from public.ncaa_pickem_sync_state s join public.ncaa_pickem_weeks w on w.id = s.week_id
order by s.updated_at desc limit 50;

select event_key, count(*) from public.notification_history
where notification_type = 'ncaa_pickem_lock_reminder'
group by event_key having count(*) > 1;
select week_id, count(*) as reserved_events, max(reserved_at) as latest
from public.ncaa_pickem_reminder_events group by week_id order by week_id desc limit 20;

-- HTTP results are transient; correlate timestamps with durable application runs.
select id, status_code, timed_out, error_msg, created
from net._http_response order by created desc limit 30;
select j.jobname, d.status, d.start_time, d.end_time, d.return_message
from cron.job_run_details d join cron.job j on j.jobid = d.jobid
where j.jobname in ('ncaaf-pickem-results', 'ncaaf-pickem-reminders')
order by d.start_time desc limit 30;
```

For the selected Group/week, compare included completed games with stored winners and `is_correct`, then check standings. A second refresh should not regrade unchanged picks or create another reminder event. Use two Groups sharing an ESPN event to verify independent week state and team identity. Confirm locked weeks continue scoring and final weeks leave automatic discovery. Reminder checks should respect narrower league windows, preferences and completed cards. Failures should show a future due time; later runs should recover expired leases. Idle runs should finish successfully.

Rollback: disable only the new NCAAF jobs before reverting code. Retain additive worker/event tables. Reactivate an old NCAAF trigger only after old code is restored and the new jobs are disabled. Do not remove reminder reservations to force redelivery.

## Validation and remaining limits

Final validation: **62 JS tests and 8 real PostgreSQL tests passed**, with no skips. Dev requests confirmed 401 for both unauthorized cron endpoints and 400 for invalid manual refresh. `npx tsc --noEmit`, `git diff --check` and `npm run build` passed. Focused lint passed for the routes, worker modules and new tests. Including the existing provider file reports eight `@typescript-eslint/no-explicit-any` errors; its messages are identical to the clean starting commit and were left unchanged. The build emits the existing Next.js edge-runtime/static-generation notice.

The PostgreSQL suite always starts a temporary local cluster using `NCAAF_TEST_PG_BIN`; it never accepts a Supabase URL or production credentials. Validation used PostgreSQL 15.19 binaries extracted under `/tmp`, without installing repository packages or changing system services. It tests actual migration/RPC SQL, including concurrent claims, stale-token fencing, grades, odds, membership, reservations, retention and service-role/anonymous permissions. The JS suite tests actual server orchestration/provider mapping/reminder logic with deterministic dependencies.

Reproduction commands:

```bash
node --test tests/ncaa-background-worker.test.cjs tests/ncaa-pickem.test.cjs \
  tests/ncaa-pickem-setup.test.cjs tests/ncaa-pickem-corrections.test.cjs \
  tests/ncaa-provider.test.cjs tests/groups-security.test.cjs tests/groups-batch-3b.test.cjs
NCAAF_TEST_PG_BIN=/path/to/postgresql/15/bin \
  node --test tests/ncaa-background-worker-postgres.test.cjs
npx tsc --noEmit
npx eslint app/api/cron/refresh-ncaa/route.ts app/api/cron/ncaa-pickem-reminders/route.ts \
  app/api/refresh-stats-ncaa/route.ts lib/ncaaPickEm/*.ts tests/ncaa-background-worker*.test.cjs
git diff --check
npm run build
```

Production schema compatibility, actual scheduler inventory, ESPN transport, Vercel execution and push delivery still require the rollout checks. A killed notification reservation can remain unsent, matching the existing at-most-once event policy; this is not a push outbox/reliable delivery redesign. The shared push transport has its existing per-device behavior and no new transport timeout; bounded send starts and recoverable leases do not guarantee every pass finishes before the platform limit. Two weeks per invocation and 25 new reminders per week/pass are conservative; monitor deferred work and increase reviewed capacity if production Group volume requires it. Regular-season-only provider scope is unchanged. No UI functionality or non-NCAAF worker was modified.
