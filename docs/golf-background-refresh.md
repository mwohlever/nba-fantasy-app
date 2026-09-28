# Golf unattended refresh

Implemented on `feature/golf-background-refresh`, based on the independent Bracket and NFL workers. No universal scheduler or Golf scoring changes are introduced. This document describes code and manual rollout; it does not assert that a production schedule is installed.

## Repository audit

Bracket uses `lib/bracket/backgroundSync.server.ts`, `/api/cron/bracket-results`, `CRON_SECRET`, competition-scoped `bracket_sync_state`/`bracket_sync_runs`, and atomic claim/finish RPCs. It supports CFP, men's NCAA basketball and women's NCAA basketball competition formats. Discovery considers competition/game/contest lifecycle, unresolved winners and pending scoring. Its manual Group-authorized route shares the competition lease. It starts at most three competitions within a 30-second start budget on a 60-second endpoint.

NFL uses `lib/nfl/backgroundScoring.server.ts`, `/api/cron/refresh-nfl`, **`NFL_CRON_SECRET`**, slate-scoped `nfl_sync_state`/`nfl_sync_runs`, and atomic claim/finish/ownership RPCs. It discovers unlocked, unarchived slates, resolves drafted teams' games, applies kickoff/live/final eligibility and sparse correction polling, and calls the same scoring function as manual refresh. It starts at most four slates within a 30-second start budget on a 60-second endpoint. Provider acquisition is cached within the invocation across overlapping Groups.

Both use service-role-only infrastructure with RLS, five-minute recoverable leases, token-fenced completion, failures isolated by work item, exponential retry delay starting at two minutes and capped at six hours, bounded summaries/errors, and pruning of at most 100 run records older than 60 days. Their migrations deliberately do **not** install recurring jobs. Bracket's route comment identifies Vault-backed Supabase pg_net invocation; NFL's migration says to configure pg_cron separately. No existing schedule installation SQL, Vault-name convention or `vercel.json` exists in this checkout.

The other current game paths are:

| Game | Dedicated unattended worker | Protected cron route | Worker DB run/state/lease | Recurring schedule installed in repo |
| --- | --- | --- | --- | --- |
| Bracket Challenge | Yes: separate worker | `/api/cron/bracket-results` (`CRON_SECRET`) | Yes | No |
| NFL Fantasy | Yes: separate worker | `/api/cron/refresh-nfl` (`NFL_CRON_SECRET`) | Yes | No |
| NBA Fantasy | No; manual `/api/refresh-stats` and browser polling | No | No | No |
| NBA Skins | No; legacy cron handler discovers non-final, completely drafted seasons and updates records/projections | `/api/cron/refresh-nba-skins` (`GOLF_CRON_SECRET`) | No | No |
| NCAA/NCAAF Pick'em | No; legacy cron handler discovers non-final weeks; separate game-reminder handler | `/api/cron/refresh-ncaa`, `/api/cron/ncaa-pickem-reminders` (`GOLF_CRON_SECRET`) | No | No |
| Golf, after this change | Yes: separate worker | `/api/cron/refresh-golf` (`CRON_SECRET`) | Yes, after applying new migration | No; manual setup below |

`AppHeartbeat` calls NCAA refresh, NCAA reminders and NBA Skins while a logged-in browser is open, every five minutes. It does not call Golf, NFL, NBA Fantasy or Bracket. Browser score pages also have existing refresh triggers. A server handler that can be called unattended is distinct from proof that an external recurring trigger is enabled. External EasyCron/Supabase/Vercel configuration was not inspected or changed.

## Historical Golf and preservation

Previously `/api/cron/refresh-golf` accepted `GOLF_CRON_SECRET`, found unlocked Golf slates from eight days before their start through two days after their end, and invoked `/api/refresh-stats-golf` sequentially. It treated unpublished ESPN fields as an expected waiting state. It had no lease, durable run history, retry state, archive filter or per-run work limit. No separate EasyCron implementation or schedule configuration is tracked in the current repository; EasyCron was an external caller of this route, if still enabled.

The same URL is now the **new worker endpoint**. The historical direct-processing loop is superseded. There is no additional Golf cron endpoint or second ingestion path. The route now accepts only `CRON_SECRET` and uses timing-safe bearer comparison. Old callers using a distinct `GOLF_CRON_SECRET` receive 401; do not repoint EasyCron and enable pg_cron simultaneously.

The authoritative former refresh handler is extracted into `lib/golf/refreshSlate.server.ts`. Provider normalization, ESPN Edge proxy use on Vercel, PGA tee-sheet reconciliation, projected/official cut handling, player status, accepted hole/scorecard reconciliation, Group/slate ownership and scoring remain there. PGA scorecard supplementation is retained without changing ShotCast 3D code. `reconcileGolf` still consumes the slate rules snapshot and the existing roster/scoring implementation for standard/Best Ball, full tournament and opening R1/R2 versus weekend R3/R4 periods. The scheduler never opens roster periods, invents cut eligibility, or substitutes current league settings for frozen rules.

`/api/refresh-stats-golf` still authorizes the requested Group/slate before acquiring the same lease as the worker. Browser-supplied compact ESPN payloads and observation timestamps are preserved. Manual refresh bypasses cadence/backoff, but cannot bypass an active lease; contention returns 409. The explicit locked-final lifecycle reconciliation path remains available for manual requests and requires the same final payload validation as before.

## Eligibility, cadence and safety

Discovery requires sport `golf`, unlocked, unarchived, nonempty external event ID and valid ordered dates, within the retained eight-day upcoming/two-day post-end calendar window. It includes slates without drafted rosters because tournament field/status/tee times are needed before acquisition. Locked/completed, archived and clearly historical/far-future slates are not refreshed. A delayed tournament can continue refreshing through the two-day post-end window; beyond it, inspect the event dates rather than silently polling indefinitely.

The recommended external trigger is every five minutes, matching the existing app heartbeat cadence and NFL's four-minute minimum. Successful state records schedule the next eligible attempt:

- Live rounds, cut transitions, finalization and tournament-day status: four-minute minimum, normally once per five-minute trigger.
- Scheduled tournaments more than one calendar day away: six hours.
- Scheduled tournaments starting tomorrow: one hour.
- ESPN tournament found but field not published: one hour, recorded as `waiting_for_field` with `refreshed=false`.
- Errors: two-minute exponential backoff, capped at six hours; the next trigger after that deadline can retry.

Two slates at most are started per invocation, within a 30-second start budget, leaving time for the last refresh on the existing 60-second route. Unattempted/oldest-attempted slates are ordered first to distribute work across Groups. Discovery is bounded at 100 recent candidates, matching NFL's bounded query convention. Larger installations should monitor deferred work and candidate counts.

`claim_golf_sync` atomically locks the slate state row; a five-minute token lease excludes browser/cron overlap. An expired lease is recoverable. The ingestion checks ownership before mutation phases and notifications; finish only updates the matching token. Accepted-score reconciliation still uses atomic revision/lifecycle RPCs and rejects stale evidence. No scheduler state replaces accepted scoring state. A killed invocation may leave a running run/lease until lease expiry; later runs recover it, as with NFL/Bracket.

Round notifications retain `player_finished:<slate>:<player>:round-<round>`; final notifications retain `slate_complete:<slate>:<team>`. Existing `notification_history` unique event-key handling suppresses repeated sends. Final notification exceptions leave the slate open for retry, as before. Existing notification delivery semantics are unchanged: round notification exceptions are caught, and a logged failed push is not a new event on retry. These pre-existing delivery rules are distinct from worker retry safety.

`golf_sync_state` records last attempt/success, next attempt, failures, last error, summary and lease. `golf_sync_runs` records idle/success/partial/failure runs, considered/eligible/processed counts, leases/backoff/deferred work, slate/event IDs, outcomes, refresh flags, revision/row counts, provider supplemental failures and notification failure counts. Errors are credential-redacted and bounded; full payloads are not retained. Details beyond 20 skips are summarized, and every processed item is retained.

## Manual rollout and single-scheduler handoff

Nothing in this work applies production SQL, changes secrets, installs a job or deploys code.

1. Identify and disable the old EasyCron Golf job (and any other external/Vercel/Supabase Golf trigger). Check Supabase `cron.job` names/schedules and external dashboards. There is no tracked evidence proving whether EasyCron is currently active. Wait for an already-running old request to finish before activating the new deployment.
2. Apply `supabase/migrations/20261001000100_golf_background_refresh.sql` before deploying this code. The browser refresh now requires its RPCs too. Preserve all existing Golf data and notification event-key uniqueness. No Golf-only backfill is required.
3. In Vercel production, ensure `CRON_SECRET` is configured for this endpoint (reuse the existing Bracket secret if already configured). Retain **`GOLF_CRON_SECRET`**: ESPN Golf Edge proxy and legacy NCAA/Skins/internal authorization still require it. Retain the existing Supabase server credentials and proxy base URL settings.
4. Deploy separately when authorized. Do not enable the new trigger while old code is still deployed; old code would reject the new secret or run its historical unleased loop.
5. Enable Supabase `pg_cron`, `pg_net` and Vault if needed. Store the production app base URL and matching `CRON_SECRET` in Vault. The names below are proposed for this runbook, not discovered production names; reuse your existing names where applicable. Do not store a secret literal in the job command.
6. Invoke the new endpoint with the matching bearer secret and check the durable run/state rows. Then install **one** job, using the template below. Leave EasyCron disabled. If using EasyCron temporarily instead, update its authorization to `CRON_SECRET` and do not install pg_cron until the handoff.
7. Observe a scheduled field update, live round/cut transition and finalization without opening the app. Check duration, deferred work and retries; local mocks cannot validate production ESPN/Vercel transport or installed SQL concurrency.

Scheduling template (manual SQL only, after the above steps):

```sql
-- Vault entries populated via the Supabase dashboard:
-- 111_sports_app_url = https://<production-domain> (no trailing slash)
-- 111_sports_cron_secret = the Vercel CRON_SECRET value
select cron.schedule(
  'golf-background-refresh',
  '*/5 * * * *',
  $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets
              where name = '111_sports_app_url') || '/api/cron/refresh-golf',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' ||
          (select decrypted_secret from vault.decrypted_secrets
           where name = '111_sports_cron_secret')),
      timeout_milliseconds := 65000
    );
  $job$
);
```

Validate both Vault entries exist before installation. The job runs as its database owner; protect Vault access accordingly. Supabase documents [Cron setup](https://supabase.com/docs/guides/cron/quickstart), [Vault](https://supabase.com/docs/guides/database/vault), and the [pg_net HTTP API](https://supabase.com/docs/guides/database/extensions/pg_net). The HTTP request timeout allows the 60-second route plus network overhead.

Useful read-only checks:

```sql
select jobid, jobname, schedule, active from cron.job;
select started_at, finished_at, status, considered, eligible, processed,
       succeeded, failed, budget_stopped, details
from public.golf_sync_runs order by started_at desc limit 20;
select slate_id, status, last_attempt_at, last_success_at, next_attempt_at,
       consecutive_failures, last_error, last_summary, lease_expires_at
from public.golf_sync_state order by updated_at desc limit 50;
```

For rollback, disable the new job before reverting routes. Keep the additive state/run tables for history. Only restore an old external trigger after the old route is restored and the new trigger is disabled.

## Remaining game coverage

Golf's worker implementation is available after this change; production completion still requires the migration, deployment, single-scheduler handoff and unattended observation. Bracket/NFL also need their external schedule configuration verified; repository code alone cannot prove they are running. NBA Fantasy still needs automatic slate discovery, cron route and durable worker infrastructure. NCAA/NCAAF Pick'em and NBA Skins need their legacy handlers brought up to the lease/run-state/retry pattern and externally scheduled; preserve NCAA's no-draft rules and Skins' no-game-notifications rules. NCAA game reminders need their own unattended trigger verification as part of that work.
