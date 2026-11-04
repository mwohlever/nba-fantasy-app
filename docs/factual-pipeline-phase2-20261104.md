# Factual pipeline Phase 2 — isolated rehearsal and handoff

Started November 3; completed November 4, 2026. Work remained on `main`, HEAD `d572341fcfa55408dfde13160b0709ffb55b9d6e`. **These are local, unapplied proposals. No production writes or operational pipeline jobs ran. Live drafts, eligibility, Player Center, scoring, catalog flags, mappings, caches and schedules are unchanged.**

Read alongside the [audit](./nba-nfl-factual-pipeline-audit-20261103.md), [controlled phase](./factual-pipeline-controlled-phase-20261103.md), its [validation](./factual-pipeline-controlled-phase-20261103-validation.json), the [dated reconciliation](./nba-roster-reconciliation-plan-20261103.json), and the existing [signed-yard proposal](../supabase/manual/factual-pipeline/nfl-signed-yard-constraints.proposed.sql). New receipts: [validation](./factual-pipeline-phase2-20261104-validation.json), [isolated rehearsal](./factual-pipeline-phase2-20261104-rehearsal.json).

## Outcome and limits

The smallest proposed extension is three additive roster/pool tables, plus two NFL writer bookkeeping tables and two nullable observation receipt columns. Permanent player identity stays in `players.id` and `players_nfl.id`. There is no new permanent identity system, catalog replacement, team-history rewrite or application adapter. All new RPCs are proposals with execution withheld from `anon`, `authenticated` and `service_role`.

The isolated rehearsal passed **23 tests**: 22 PostgreSQL scenarios and one repository-contract scenario. Representative catalogs of 600 NBA and 1,000 NFL entities froze complete fixture pools of 599 and 998 eligible members. A historical-only NBA player and zero-slot NFL K/D/ST entities were intentionally excluded; rostered players without appearances were included. These exclusions used explicit evidence and frozen canonical slots, not appearance counts or current active flags.

**This is fixture-only validation on PostgreSQL 15.19, not a sanitized production restore or PostgreSQL 17.6 validation.** The fixture installs the actual existing observation foundations, NBA current-table/semantic repair, and draft-history migration over minimal fabricated parent tables. It does not reproduce every production column, policy, trigger, load condition or dependent RPC. Production metadata drift, concurrent old writers and existing-row compatibility still require a restored-copy rehearsal. SQL approval settings are deliberate execution guards, not proof of authorization or database isolation; isolation comes from the harness.

## Exact files added

No pre-existing file was edited in Phase 2, including the existing signed-yard proposal.

| File | Purpose |
| --- | --- |
| `supabase/manual/factual-pipeline/phase2/01-rosters-and-pools.proposed.sql` | Add immutable roster evidence, frozen slate headers/membership, protected source/ownership relationships and owner-only proposal RPCs |
| `supabase/manual/factual-pipeline/phase2/02-nfl-semantic-append.proposed.sql` | Reversal-safe chronological NFL append, immutable receipt replay, mutable acquisition high water, controlled legacy uniqueness/grant cutover |
| `supabase/manual/factual-pipeline/phase2/03-unused-only-rollback.proposed.sql` | Transactional rollback of the complete unused proposal set; refuse after use |
| `lib/rosters/storageContracts.ts` | Typed repository/DTO contracts, existing-ID namespace conversion and frozen-pool scope checks; no live adapter/import |
| `tests/helpers/factual-pipeline-phase2-postgres.cjs` | Create, verify and destroy only its own credential-free, private Unix-socket PostgreSQL cluster |
| `tests/fixtures/factual-pipeline/phase2-parents.sql` | Fabricated parent catalogs, scoped slates and saved-score sentinel; no private production records |
| `tests/factual-pipeline-phase2-postgres.test.cjs` | Real SQL installation, rollback, integrity, roster/pool, signed-yard, chronology, concurrency and scale regressions |
| `docs/factual-pipeline-phase2-20261104.md` | This design, results, dependencies and operational handoff |
| `docs/factual-pipeline-phase2-20261104-rehearsal.json` | Sanitized fixture rehearsal results and measured storage |
| `docs/factual-pipeline-phase2-20261104-validation.json` | Commands, test/build evidence, hashes, dated reconciliation analysis and preservation receipt |

The SQL is outside `supabase/migrations`; ordinary migration runners will not install it. Nothing activates it from the application.

## Reused structures and proposed roster contract

Existing `players`/`players_nfl` IDs remain the foreign-key anchors for facts, drafts, lineups and history. NBA keeps its native NBA ID and ESPN crosswalk. NFL keeps direct ESPN athlete IDs, existing PK→K handling and synthetic D/ST IDs. Current catalog synchronization can eventually maintain a current display projection, but it must not replace permanent IDs, rewrite membership history, or remove saved picks.

`professional_player_roster_evidence` stores sport, one sport-specific permanent-player FK, entity kind, professional season, source observation time, database recording time, verification cutoff, confidence, roster state, provider-qualified team/position, source URL/content hash/capture time and optional supersession. NBA seasons use the ending year: 2027 means 2026–27; NFL uses the calendar year.

Two evidence forms are distinct:

- A **snapshot** asserts status at its source observation instant only. It has no invented start/end date.
- A **confirmed interval** has an evidenced start, optional exclusive end, and a verification horizon. It applies only within that interval and no later than `verified_through`. Releases can establish explicit unrostered intervals; re-signings create later rostered intervals. Unknown gaps remain unresolved.

The resolver considers only evidence both observed and actually recorded by the requested knowledge cutoff. Backdated archived source captures therefore cannot authorize an earlier slate cutoff. Supersession appends a new claim linked to the old claim; it does not edit it. It must target the same permanent player and season. Conflicting unsuperseded claims return `conflict`; uncertain or explicitly unresolved claims cannot authorize eligibility. Different team-ID namespaces are not equated by name or abbreviation.

Roster membership is independent of observations. A rostered player can have zero appearances; a historical observation can remain attached to an inactive player with no current roster evidence. The schema intentionally does not turn absence from a roster snapshot into catalog deactivation or an invented release date.

D/ST evidence is a `team_defense` entity referencing its existing NFL catalog row. Rostered D/ST must retain the existing synthetic ESPN team binding and `D/ST` position. K remains an athlete position. Neither becomes supported offensive factual scoring merely because roster storage can represent it.

No second game-team history table is needed: existing NBA/NFL game observations already retain game-specific team assignments. Explicit game evidence stays authoritative; accepted historical intervals can support a separately reviewed fallback. Today's catalog team must never fill a historical gap. The rehearsal preserved pre-trade and post-trade NBA game teams and prior-season facts while adding different roster claims. Existing Player Center source/team regressions also passed.

### Important evidence/coverage gates

The proposal deliberately fails closed if **any catalog entity** lacks a resolved rostered/unrostered state at admission. The universe is bounded to 3,000 catalog IDs per sport, including inactive/historical identities, with a 1,000-claim per-player/season guard. This is a conservative rehearsal gate, not a claim that the current catalog equals the full professional player universe.

Before real admissions, review the full provider/native baseline, missing identities, historical-only dispositions and evidence freshness. The 76 absent NBA catalog rows cannot enter a pool until separately approved identity/catalog work creates their normal existing-model rows. Historical absence alone does not supply a release interval. Provider snapshots taken at different instants do not automatically establish one common effective roster time. A production collector must provide an authoritative common-time snapshot or confirmed intervals covering the chosen eligibility instant; approving a cohort freshness policy is separate work. Do not solve these gaps by relaxing the resolver, assuming GP=0, or extrapolating membership.

## Complete frozen slate pools

`slate_player_pool_snapshots` has one immutable header per slate: Group/league/sport, professional season, eligibility effective time, evidence cutoff, actual frozen time, pool version/hash, catalog-ID hash, full frozen rules, member count and optional On Slate team evidence. `slate_player_eligibility` contains every eligible permanent player, saved position, provider-qualified professional team, entity kind, On Slate boolean and the exact supporting evidence FK.

The admission proposal locks the scoped slate, catalog and roster evidence; resolves the complete bounded catalog; applies the existing `fantasy_slot_eligible` function against `rules_snapshot.roster.slots` using its real `slotCount` field; and writes members plus final header in one transaction. **On Slate is a saved display designation, never a mandatory eligibility restriction.** Members with `on_slate=false` remain in the full pool.

Members are inserted before the final header under the slate lock. The deferred header FK prevents orphan membership at commit; the final header verifies scoped ownership and membership count. Composite evidence FKs bind member/player/sport/kind together. Insert guards reject late members after freezing; update/delete triggers reject rewriting either pool table. Frozen slates cannot change rules, scope, dates, first-game time or NBA team filters. A league cannot change Group/sport ownership while it has frozen pools. Normal slate locking still works. These guards affect only slates/leagues with the proposed new snapshots.

Admission replay returns the original header for the exact same parameters, without re-reading today's roster. A different request fails. Both unlocked and locked snapshots survive later trades. A roster sync cannot silently remove a previously admitted player, change their saved position/team, or insert a replacement member. A materially changed slate needs a newly admitted slate.

### Legacy compatibility

Header absence is `legacy_requires_review`, not an empty pool and not permission to synthesize history. Locked slates and slates with draft configuration or saved lineup players cannot be admitted by the proposal. Their existing picks, correction history, lineup IDs and scoring/rules snapshots remain authoritative. Never infer their unpicked historical pool from saved picks or the current catalog.

Future release policy must explicitly preserve a legacy reader/writer branch or make further drafting on an unverified legacy slate read-only pending review. Commissioner correction semantics need their own reviewed compatibility behavior; they are unchanged here. An unlocked, unused legacy slate can be explicitly reviewed/admitted with a new documented effective time/cutoff. That is a new admission, not reconstruction of its original pool. Preserve legacy rules fallbacks for existing historical readers; new admission requires an actual reviewed rules snapshot.

### Future atomic reader/writer switch — not implemented

1. Prepare a versioned trusted-server reader and authoritative draft writer together, plus atomic create-and-admit SQL. Both consume the same frozen header/hash, member positions/team and canonical frozen rules. Retain the existing Group authorization and roster-position rules. No fallback to current `is_active`/team for a frozen slate.
2. Deploy supporting application code behind a disabled capability, then drain/quiesce NBA/NFL slate creation/admission and draft mutations for the cutover. Handle old in-flight clients/servers explicitly.
3. In **one reviewed database transaction**, install the new read/write/admission entry points, capability/version check and guards on the old authoritative RPCs. Old readers/writers must reject frozen-pool slates with an explicit upgrade requirement. A client must not read one pool while an old writer validates against current catalog flags. Do not grant a new writer without its matching reader/legacy behavior.
4. Enable the coordinated capability only after scoped read/pick/replay/correction tests pass, then resume mutations. New slate creation/admission must freeze the pool in its own creation transaction, before its first draft read; first-pick freezing is too late. Existing frozen pools never rebuild. Mismatched hashes, scope or versions fail and require a fresh read.

No existing `read_fantasy_draft`, `mutate_fantasy_draft`, slate availability API, catalog reader or Player Center route was changed in this phase.

## NFL signed yards and immutable transitions

The existing signed-yard proposal ran unchanged. It dropped **only** the three nonnegative checks on integer passing/rushing/receiving yards. Other checks, grants on the table/view/sequence, view definition and immutable trigger remained identical at that step. Positive/zero legacy rows stayed byte-equivalent. The captured Allgeier event `401872958` preserved two rushing attempts and **−1 rushing yard** through the real parser, canonical normalization, hash conversion and isolated SQL storage. Negative passing and receiving yards also persisted. Negative attempts, receptions, targets, completions, TDs, interceptions and LOST were rejected.

**The acquisition and server signed-yard quarantine remains unchanged and active.** A schema-only change would not authorize accepting those values through the live writer. No existing row was repaired or backfilled.

The semantic append proposal makes the following explicit, separately reviewed writer change:

- Preserve existing version IDs, immutable rows and content-hash meaning. Replace the full lifetime `(provider, player, event, hash)` uniqueness constraint with a partial uniqueness index over legacy rows. Add nullable semantic receipt/ordinal columns with a paired-value check, a receipt FK and unique receipt/ordinal membership. This permits a later return to the original factual hash.
- Add immutable receipt metadata: UUID, exact canonical JSON payload digest, accepted/appended counts and recording time. An exact receipt replay returns zero additional appends; changed payload under the same receipt fails.
- Acquire receipt and sorted player/event advisory transaction locks. Compare typed factual fields with the latest state, excluding fetch timestamps, source URLs, hashes and normalizer labels from semantic equality. A→B→A preserves three transitions; repeated identical facts, including label-only changes, append none.
- Track acquisition/knowledge high water even for unchanged polls, including separate game-log and fumble-summary horizons. Reject regressions, stale source components and ambiguous same-time conflicting facts. An older payload cannot slip in merely because a newer identical poll did not create a version. Exact receipt replay is checked before this stale-input policy. Out-of-order historical acquisition requires a different reviewed import path; it is not silently appended or reordered against already accepted history.
- Commit receipt, transitions and head changes atomically. Invalid late rows roll back the whole batch. Concurrency creates one transition per accepted change. Existing latest-view and actual `selectNflAsOfObservationVersions` reads returned A, B and A at the expected cutoffs.

The proposal keeps table RLS/immutability, enables RLS on bookkeeping, grants service read-only bookkeeping access, **revokes service direct INSERT into versions**, and withholds execution on the new writer. That direct-INSERT revocation is intentional and is a production cutover blocker, not an unrelated grant change. The old `ON CONFLICT` target is no longer compatible with the partial index. The legacy lifetime-hash lookup must also be removed from the future append path. Do not install this SQL while old writers can run or as an isolated production schema patch. Owner-only proposals are for rehearsal, not an operational writer installation.

NFL null fumbles remain null; explicit zero and positive LOST remain distinct. The prior evidence-based fumbles parser/cohort fixes and signed-yard quarantine tests passed unchanged. This phase does not certify a complete NFL cache, missing statistical inputs, K/D/ST scoring, or full-player factual coverage.

## Rehearsal and verification evidence

The harness creates its own fresh temporary cluster, disables TCP, uses a private socket directory, verifies `data_directory`/server address, allowlists subprocess environment variables, uses an empty private password file and never loads `.env` or accepts a database URL. It destroys only its own cluster. No restored private records or credentials enter fixtures/reports.

The 23 phase-specific tests cover one/two same-season trades; release/re-sign gaps; season rollover; rostered/no-appearance and historical-only players; conflicting/uncertain and unknown-date evidence; supersession/knowledge cutoffs/replay; retained pre/post-trade game teams; locked/unlocked frozen pools; optional On Slate; legacy review; source/pool concurrency; scope/FKs/uniqueness/RLS/grants; atomic rollback; signed yard/count constraints; NFL A→B→A, replay, no-change, stale/tied inputs and concurrency; unused rollback and used-storage refusal; and bounded representative catalogs. Receipt-row and history mutations remain forbidden. Sequence gaps after aborted writes are normal; no IDs are reset or renumbered in operational SQL.

| Check | Result |
| --- | --- |
| Phase 2 SQL/contracts suite | **23 passed, 0 failed/skipped** |
| Broader regression run, 26 files | **280 passed, 0 failed; 20 PostgreSQL tests skipped** for a missing binary-path environment setting |
| Separate run of those 20 database tests with `NBA_REFRESH_PG_BIN` | **20 passed, 0 failed/skipped**; all previously skipped cases exercised |
| Combined distinct cases | **323 passed** |
| TypeScript `tsc --noEmit --incremental false` | Exit 0 |
| Scoped ESLint on the new TS/CJS files | Exit 0, no diagnostics |
| Next.js 16.2.4 `npm run build -- --webpack` | Log shows successful compilation, TypeScript, 113/113 static pages and complete route manifest. Process exit handle was lost in the routing timeout; no exit code is asserted in the receipt |
| Diff/whitespace | Checked, including new files |
| Dated offline roster plan replay | Exactly equal to the existing saved plan |

The build used a nonprivileged service-key placeholder, disabled telemetry and a temporary external guard blocking mutating HTTP requests and RPC/refresh paths. No app environment/config file changed. Build wall time included the interrupted host period and is not a useful performance measurement. No interactive production behavior changed or required browser validation.

Preservation checks compare all **1,115** files present at the phase baseline: all unchanged. HEAD, stash list and worktree registrations also remain unchanged. The installed repair was not contacted or modified; the exact checked-in NBA repair installed into the fixture still reports normalized fingerprint **`9308a04b52fecc6993b7730490cf686a`**. Existing fixture player rows, saved drafts/picks, scoring sentinel, NBA history/current rows, legacy NFL rows/IDs and draft RPC definitions stayed identical. This proves preservation in the fixture and repository, not a new production integrity audit.

## Dated NBA reconciliation readiness

These counts come from the November 3 plan. The plan was replayed offline; there was **no fresh live roster fetch or catalog apply**. Categories overlap and must not be added into a count of unique actions.

| Dated category | Treatment with the proposed model |
| --- | --- |
| 82 additions/reactivations | 74 absent catalog identities plus six existing inactive rows have corroborated review candidates; two other absent identities remain uncertain. Verify current native IDs/provider evidence first. Create normal catalog rows only for the separately approved 76 absent IDs; reuse the six existing internal IDs. Store dated evidence independently of active-flag policy |
| 89 current roster absences | Append a source snapshot/review finding if justified. Do not automatically deactivate, delete, assert release dates, or remove a player from any existing slate |
| 112 team differences | 111 corroborated review candidates, one uncertain. Store verified present-team evidence; require transaction sources for historical boundaries. Never rewrite historical game teams or frozen membership |
| 163 unresolved ESPN mappings | 101 corroborated current-roster candidates; 61 absent from the current native roster; one native-name discrepancy. Dated name/team corroboration is a candidate, not a durable native↔provider mapping authorization |
| 29 existing mappings needing evidence | Separate review; retain old mappings/history while resolving missing corroboration. No automatic replacement of locked crosswalks |
| 28 historical-only identities / 164 currently rostered without stored appearances | Preserve all historical IDs and statistics. Do not infer current membership or inactivity from observation counts |

Safe future automation can append verified provider-ID-bound source evidence and detect changes/replay using durable receipts. It can resolve eligibility only from reviewed evidence covering the effective instant. Name-only joins, conflicting/missing provider IDs, stale proof, uncertain transactions, new permanent catalog rows, mapping replacement and destructive/active-flag changes require their own reviewed process. Even the 80 corroborated addition candidates are not automatic production changes approved by this report.

## Ordering, backup, rollback and failure recovery

1. **Before any production approval:** obtain encrypted backup/PITR recovery points, capture actual definitions/constraints/indexes/RLS/grants/row counts/sequence state, enumerate every NFL writer and dependent conflict target, and rehearse the exact production schema on PostgreSQL 17.6 or an equivalent restored environment. Verify the NBA fingerprint/integrity without reinstalling it. Test restore, not merely backup creation.
2. `01-rosters-and-pools` depends on existing catalogs, Groups/leagues/slates, draft history and canonical SQL slot eligibility. It is otherwise independent of NFL append. Installing it alone grants no new live writer capability and creates no snapshots. The signed-yard proposal depends on the exact reviewed NFL foundation, RLS and immutable trigger. It must precede `02-nfl-semantic-append`, which checks those prerequisites and legacy writer capability. No NBA migration or cache publication is a dependency.
3. Each proposal has one transaction and explicit lock/statement timeouts. Review lock ordering with future catalog writers: slate → catalog → roster evidence. The semantic proposal serializes receipt then sorted event keys. Retry serialization/deadlock/lock-timeout failures from a fresh transaction with bounded backoff and the same durable receipt; never bypass locks or retry changed evidence under an old receipt.
4. The complete unused set can be rolled back with `03-unused-only-rollback` under its separate guard. The rehearsal restored exact original NFL constraints/grants and preserved all original rows/IDs, then successfully reapplied the proposals. A simulated DDL failure rolled back table/function creation atomically. This rollback file expects all three proposal components installed; it is not a universal partial-install or disaster-recovery runner.
5. If an intermediate component fails, its transaction aborts; previous independent components can remain inert while the failure is reviewed. Do not run the complete rollback against a partial installation. Prepare a state-specific reviewed rollback or retry the failed component after metadata inspection. A signed-yard-only schema does not disable the app quarantine.
6. Once roster evidence, pools, append receipts/heads, semantic versions or negative-yard rows exist, rollback **refuses**. Do not delete evidence/history or coerce negative yards to make rollback pass. Stop the new writer/capability through a separately authorized operational procedure, preserve new data, and forward-fix. Restore old app code only behind compatibility gates; it cannot use the old NFL conflict/INSERT path after semantic cutover. PITR/full restoration is a separately approved last resort with its own loss/restore plan.

Required production work is therefore more than running SQL: source/identity review, coherent writer capability, compatible reader/writer deployment, measured maintenance windows and explicit legacy policy remain open. No production command is recommended for execution from this report as-is.

## Storage and recurring impact

Measurements are fixture evidence, not production forecasts. They exclude WAL, replicas, backups, vacuum bloat and private production indexes. Tuple bytes alone omit page/index/TOAST overhead; tiny receipt/history tables have disproportionate minimum-page overhead.

| Fixture measurement | Result |
| --- | ---: |
| Roster evidence, 1,600 claims | 418 B average tuple; 1,089,536 B total including indexes |
| Frozen membership, 1,597 members | 100.6 B average tuple; 286,720 B total including index/pages |
| Two frozen headers | 614 B average tuple; 49,152 B allocated including indexes/pages |
| NFL history, 17 retained versions | 319.3 B average tuple; 114,688 B allocated with existing/new indexes |
| NFL append receipts, 25 batches | 127.9 B average tuple; 32,768 B allocated |
| NFL heads, eight player/event keys | 79.6 B average tuple; 32,768 B allocated |

The final isolated admission measurements, including `psql` overhead, were about **0.38 seconds for 600 NBA entities** and **0.82 seconds for 1,000 NFL entities**. These are small-fixture results, not production latency or lock guarantees.

Use explicit volumes to budget growth:

- Roster evidence grew about 0.68 KB per claim at this fixture density. At an illustrative 1,600 entities, one new per-player snapshot daily is 584,000 claims/year, about **398 MB/year decimal**, before WAL/backups/bloat. Verified transaction/interval evidence plus necessary freshness checkpoints may reduce that; do not claim indefinite validity from unchanged snapshots. Larger provenance arrays increase cost. Stable source receipts prevent replay duplication; generating new UUIDs on every retry would still bloat roster evidence and is forbidden in the future collector contract.
- Frozen membership was about 180 B/member allocated in this fixture. A 600-player pool is roughly 108 KB plus header/index amortization; a 1,000-player pool about 180 KB. At 1,000 slates/year, approximately **108–180 MB/year** of membership, with per-slate metadata additional. Growth is per admitted slate/Group, not just once per professional season. Sharing identical pools is a possible later measured optimization, not implemented here.
- NFL semantic history grows with **factual transitions**, not identical polls. Budget the existing row size/index cost per corrected/new game; a reversal adds one genuine transition. Heads are one row per accepted player/event, updated on no-change polls. Receipts grow once per new durable batch even if all facts are unchanged: 50 batches/day is 18,250 receipt rows/year, about 2.34 MB/year of raw receipt tuples plus indexes/pages. Avoid one receipt per player/game when batching is possible. State updates still create WAL/dead tuples requiring normal autovacuum.
- At installation, the existing NFL lifetime unique index is rebuilt as a partial legacy index; receipt-row uniqueness adds another index. Nullable columns preserve existing rows logically without backfilling history, but index rebuild time/temporary disk and production dependencies must be measured on the restored copy. No production size query, factual acquisition job or deliberate sports-provider request ran in this phase. The build guard allowed read requests, which were not metered, so total external HTTP usage is not asserted as zero. Future source-call budgets remain those of a separately designed bounded collector, not the fixture SQL benchmark.

## Next controlled phase and separate approvals

The recommended next step is **production-schema restored-copy validation plus a disabled writer/eligibility integration candidate**, not full-pool ingestion. Obtain reviewed native/provider identity proof and a roster evidence freshness/interval policy first. Then test the proposed NFL writer adapter end-to-end against the exact schema, including removal of lifetime-hash suppression, metadata/capability checks and quarantine release only after a signed-storage capability is explicitly installed. Prepare the scoped frozen-pool reader, authoritative writer, atomic admission and legacy policy together behind a disabled capability.

Require separate explicit approval for any production schema/index/trigger/constraint/grant/function change; access to/restoration of private backups; catalog additions/reactivations/deactivations/team changes; identity mapping application; roster synchronization/evidence import; observation correction/backfill or acquisition; signed-yard writer capability/quarantine removal; NFL writer cutover; live slate admission/eligibility or legacy policy changes; cache publication; deployment; job activation, disabling or schedule changes. Source acquisition and mapping approval are distinct from schema approval.

Before enabling automatic acquisition, require reviewed identity coverage, complete canonical scoring fields or explicit incomplete status, actual game-team evidence, zero semantic churn on repeated polls, replay/concurrency success, bounded database/API budgets and observable freshness/failure receipts. Use incremental completed-event/recent-correction windows, bounded cohorts, durable retry IDs, capped exponential backoff and stale/partial alerts. Do not acquire every historical player-game on every refresh. NBA semantic append remains unchanged; the retired NBA workflow remains disabled. NFL K/D/ST factual support and missing fumbles inputs remain explicit separate coverage work.

**Stop point reached: local proposals, isolated tests and this handoff only. No production schema, live eligibility, identities, rosters, observations, caches, deployment or automation was changed.**
