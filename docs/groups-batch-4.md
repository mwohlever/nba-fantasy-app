# Groups Batch 4 implementation and manual rollout

Base: fetched `origin/main` at `05e3ad0`. Work branch: `feature/groups-batch-4`.
No database/schema writes, migrations, commits, pushes, or production build were executed.

## Findings and changes

1. **Golf event identity.** The user-verified live schema already contains `slates_league_sport_external_event_id_unique`: `UNIQUE (league_id, sport, external_event_id) WHERE external_event_id IS NOT NULL`. There is no global slate event index or corresponding uniqueness constraint. Migration 1 verifies the scoped index's exact definition and leaves it unchanged. The original draft incorrectly relied on `supabase/golf-foundation.sql` (introduced in `3b517a7`) and the Groups foundation (`cad9405`), which recorded/retained global uniqueness. Searches of available repository migration history found no committed introduction of the live scoped index, so the timing/mechanism of that applied change cannot be established from the repository. The live database is the verified starting point. Slate ownership is `slates.league_id -> leagues.group_id`; current creation supplies the league, and refresh/import uses authorized slate IDs. No new null-league slate index is needed: the prior data check found no unowned external-event slates, the Groups foundation backfills legacy ownership and provides `assign_legacy_111_slate_league` for legacy inserts, and current application creation supplies `league_id`. No supported flow was found that requires an unowned event namespace. Leaving PostgreSQL's existing NULL-distinct behavior intact avoids imposing an unneeded historical-data restriction. Provider IDs, scoring, and frozen rules are unchanged.
2. **Golf resource access.** `refresh-config` checked login but not resource ownership; `hole-replay` lacked authorization. Both now use existing slate-resource authorization. The Golf branches of shared player-stats and slate-availability now authorize their slate as well. Golf player-league-profile previously ran before authentication and loaded every Golf slate; it now authenticates, scopes slates to the active Golf league and team names to its Group, and retains cross-season history without membership filtering. The saved manifest reader now also authorizes a required `slateId`. The existing `shotcast_manifests` cache is globally keyed by tournament while commissioner imports store a slate owner in it, allowing another Group's import to replace that association. An additive `golf_slate_shotcast_manifests` table uses `(slate_id, tournament_id)` and preserves the old table. Commissioner reads/imports and the replay manifest caller use the scoped table. Refresh, field import, commissioner configuration, Golf home/profile/history, and standings were traced; their existing scoped behavior is retained. Public provider schedules and global golfer rankings are provider data, not Group records; rankings remain super-admin-only. Cron retains intentional internal authorization across leagues.
3. **Team names.** Teams belong to Groups, not individual sport leagues. `teams_name_key` and Group creation/invite name checks were global. Exact, case-sensitive uniqueness now belongs to `(group_id, name)`; null-Group legacy names retain their own unique namespace. `(group_id, user_id)` uniqueness is unchanged. Both setup checks include Group ID. Existing same-Group naming/suffix behavior remains. No team names or historical relationships are rewritten.
4. **Legacy teams endpoint.** `/api/teams` returned every team through the service role without authentication. Its only application caller was the login page, including one-time account linking. The route now requires login and returns `{ success, groupId, teams: [{id, name}] }` for the current authorized Group; no Group means 403, no login means 401. Members, commissioners, and super-admins all receive the selected Group's list, including historical teams. There is no platform-list override. Login now accepts Group slug (default `111`) + exact team name + PIN. The server resolves the Group team owner by ID and verifies credentials. Both normal PIN and one-time linking support this contract; existing `teamId` / `legacyTeamId` clients remain supported. Modern sign-in is unchanged. No remaining application caller fetches `/api/teams`.

## Read-only compatibility inspection

Observed through SELECT-only Supabase client calls during implementation:

- 81 slates, five with external event IDs; zero missing league IDs among these, zero duplicate proposed scoped event keys.
- Six teams; zero missing Group IDs, zero duplicate `(group_id, name)` keys.
- Four legacy manifests; all have slate IDs. The copy migration rechecks valid Golf ownership and content and aborts on invalid records.

The user subsequently ran the live catalog and duplicate preflight manually. Confirmed starting schema:

- `slates_league_sport_external_event_id_unique` is a unique index on `(league_id, sport, external_event_id) WHERE external_event_id IS NOT NULL`; the obsolete global index does not exist.
- `teams_name_key` is exactly `UNIQUE (name)`; `teams_group_user_unique` already protects `(group_id, user_id)` for non-null ownership.
- `shotcast_manifests_pkey` is `UNIQUE (tournament_id)` and `shotcast_manifests_slate_id_idx` indexes `slate_id`.
- Both supplied duplicate queries returned zero rows, including the slate query that groups NULL league IDs together.

These are point-in-time observations. Revised Migration 1 verifies the scoped slate index's full definition, validity, readiness, key columns, and predicate, rejects the obsolete named global index if unexpectedly present, verifies `teams_name_key`, and checks owned-slate/team duplicates transactionally. It creates only the two team-name indexes and drops only `teams_name_key`. NULL-league slate duplicates are not a migration error because no new restriction on that namespace is being introduced. Neither revised migration was executed by Codex, including on a temporary database. Migration 2 is unchanged.

## Exact manual SQL order

Do not deploy the new application before both migrations succeed. Avoid commissioner ShotCast imports between copying manifests and deploying the new code, so an old-code import does not update only the old cache.

1. **The required read-only preflight has already been completed by the user.** Its verified results are listed above; no repeat is required unless the schema/data changes before execution. The queries are retained below for reference. The expected slate index is `slates_league_sport_external_event_id_unique` on `(league_id, sport, external_event_id)` with the predicate **only** `external_event_id IS NOT NULL`; it must not be replaced with a predicate adding `league_id IS NOT NULL`. `teams_name_key` must be `UNIQUE (name)`. If the migration's verification detects unexpected schema or required duplicates, stop rather than deleting data or bypassing checks.

```sql
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('slates', 'teams', 'shotcast_manifests')
order by tablename, indexname;

select conrelid::regclass as table_name, conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid in ('public.slates'::regclass, 'public.teams'::regclass,
                  'public.shotcast_manifests'::regclass)
order by table_name, conname;

select league_id, sport, external_event_id, count(*)
from public.slates where external_event_id is not null
 group by league_id, sport, external_event_id having count(*) > 1;
select group_id, name, count(*)
from public.teams where name is not null
 group by group_id, name having count(*) > 1;
```

2. Run the **entire file** `supabase/migrations/20260910000100_groups_batch4_scoped_uniqueness.sql` once. Use the reconciled file, not the original draft. Execute the complete file, including `begin;`, the lock, `do language plpgsql $batch4_checks$`, its matching `end;` / `$batch4_checks$;`, the DDL, and `commit;`. The procedural `IF` statements must not be submitted separately as top-level SQL. The reported attempt failed with a syntax error and applied no schema changes; the current local file had a DO wrapper, so the exact difference in submitted text is unconfirmed. The wrapper is now explicitly delimited and checked by the static test. It locks the two tables for transactional verification, leaves every slate index unchanged, checks required duplicates, creates `teams_group_name_unique` on `(group_id, name) WHERE group_id IS NOT NULL` and `teams_legacy_name_unique` on `(name) WHERE group_id IS NULL`, then drops only the verified `teams_name_key` constraint. It deletes/rewrites no historical rows.
3. Only after step 2 succeeds, run the **entire file** `supabase/migrations/20260910000200_groups_batch4_golf_manifests.sql` once. It creates the scoped manifest table with RLS/service-role-only access, checks legacy records, and copies existing records under their existing slate IDs. It leaves `shotcast_manifests` unchanged. Existing invalid JSON/timestamps, orphan owners, duplicates, or unexpected schema types cause a rollback rather than record deletion.
4. Deploy/use the Batch 4 code after both complete. These are one-time SQL-editor scripts, not idempotent rerun scripts. If a statement fails, roll back the failed transaction before retrying a corrected script. If step 2 succeeds and step 3 fails, do not deploy yet; the old application can still operate with the scoped uniqueness rules.

The original manifest cache remains for history/rollback. It does not receive new imports from Batch 4. No other historical migration is edited.

## Files changed

- `app/api/player-league-profile/route.ts`
- `app/api/player-stats/route.ts`
- `app/api/slate-availability/route.ts`
- `app/api/golf/refresh-config/route.ts`
- `app/api/golf/hole-replay/route.ts`
- `app/api/golf/shotcast-manifest/route.ts`
- `app/api/admin/golf/shotcast/route.ts`
- `components/lineups/GolfHoleReplayPanel.tsx`
- `app/api/admin/groups/route.ts`
- `app/api/group-invites/[token]/route.ts`
- `app/api/teams/route.ts`
- `app/api/auth/login/route.ts`
- `app/api/auth/bridge/route.ts`
- `app/login/page.tsx`
- `lib/security/pinIdentity.ts`
- The two new migration files listed above
- `tests/groups-batch-4.test.cjs`
- This report

## Automated validation

- `git diff --check`: passed.
- `npx tsc --noEmit --pretty false`: passed.
- `node tests/groups-batch-4.test.cjs`: 18/18 passed. Tests use in-memory database/provider/session mocks, including captured mutations. Coverage includes historical same-event slate isolation, member/commissioner/super-admin/internal access, rejected cross-Group handlers before providers/writes, per-slate refresh mutations, per-slate commissioner manifest imports, Group team lists, scoped naming, old/new PIN contracts, and account linking.
- Existing `groups-batch-3b`, `groups-security`, `golf-correctness`, and `create-slate-sport` suites: passed.
- Existing `corrections-scoping`: 5/6 passed. The pre-existing failure at line 100 expects the `resolveLeagueRules` call on one line; the unchanged source uses a multiline call. Both test and implementation are unchanged from HEAD. Left untouched as outside Batch 4.
- The migration reconciliation reran `git diff --check`, TypeScript, and all 18 Batch 4 tests successfully. Static assertions now require the verified existing slate definition, prohibit slate index creation/removal, and check both replacement team namespaces. There is no separate Batch 4 static migration test file.
- Migrations have static regression assertions and reviewed transactional preflight; they have **not** been executed or verified by PostgreSQL.
- No production build requested/run. No authenticated Dev requests run because session handling writes `last_used_at`; Golf UI may also initiate refresh writes.

## Practical manual Dev QA

Use the shared/live database carefully. Start with existing **locked historical** Golf slates, not active slates that auto-refresh. Do not click import, refresh/rebuild, create slate, or save configuration merely to exercise QA. Normal sign-in can write session metadata; the checks below do not require creating or deleting competitive records.

1. After both manual migrations, open Dev `/login` in a signed-out/private browser. The page must load without a team-directory request or error banner. Open `/api/teams`: expect 401 and no teams.
2. Using your existing PIN account, enter Group `111`, your exact existing Group team name, and your PIN. Confirm sign-in works. Check an incorrect PIN fails. Modern sign-in should still work as usual. Do not unlink/relink an existing account just for testing; one-time linking is covered by mocks and can be checked when a legitimate unlinked account next needs it.
3. In 111 Sports, open an existing locked Golf tournament, standings, and a historical team profile. Confirm existing results/lineups and earlier seasons remain visible. View a hole replay and its saved manifest; use a tournament with an existing manifest, and do not trigger an import.
4. In browser DevTools, inspect/read `GET /api/golf/refresh-config?slateId=<existing-own-Golf-slate-id>`: expect its event ID/year. After switching to Test Group (only if enabled and accessible), repeat with its own existing slate if available. An ordinary member's GET using a 111 slate ID while Test Group is selected must return 404. Repeat the own/other-Group checks with `GET /api/player-stats?slateId=<id>` and `GET /api/slate-availability?slateId=<id>`. Open `GET /api/player-league-profile?sport=golf&playerId=<existing-golfer-id>&season=all` in each Group and confirm only that league's draft history appears; signed-out access must return 401. Repeat with `GET /api/golf/shotcast-manifest?slateId=<id>&tournamentId=<existing-PGA-id>`; omitting slateId returns 400. An authorized slate without a saved manifest returns 404, not a different Group's manifest.
5. As commissioner, open existing Golf commissioner pages and read saved ShotCast configuration. An unrelated Group's `GET /api/admin/golf/shotcast?slateId=<id>` must return 404. As super-admin, intentional target-resource access remains allowed. Mutation rejection and isolated writes are covered by mocks; do not submit live POSTs to prove rejection.
6. While signed in, open `/api/teams` in each existing accessible Group. Check `groupId` changes and IDs/names belong only to that Group. Repeat with commissioner/super-admin accounts if available; neither receives a platform-wide roster. Historical teams may appear intentionally. No remaining in-app dropdown calls this endpoint; PIN login now uses identity entry.
7. Switch between 111 and Test Group through existing navigation on desktop/mobile. Confirm sport/Group navigation remains normal and Golf data follows the selected Group. If Test Group has no Golf data or Golf is disabled, mark those tournament checks not applicable; do not create records for QA.
8. Verify new indexes with the read-only `pg_indexes` query. Cross-Group duplicate-event/name behavior is covered by mocks plus the intended SQL definitions. Only exercise actual duplicate-name/event creation during a planned, legitimate Test Group setup after migration, using existing permitted Test Group data; do not rename historical teams or create/delete arbitrary records for this check. Same-Group exact names remain unique; cross-Group exact names are permitted.

## Intentionally deferred

Batch 5/read-only hardening, Golf scorecard/ShotCast refresh lag, scoring/rules changes, global provider redesign, notification changes, Live Scores, NCAA Pick'em, March Madness, NBA Skins application changes, Group switching behavior, PWA resume behavior, and removal of the old manifest cache. No broad Groups audit was performed.
