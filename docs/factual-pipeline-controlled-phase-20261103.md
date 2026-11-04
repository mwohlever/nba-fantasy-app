# Controlled factual pipeline phase — November 3, 2026

Local implementation and review handoff following the [read-only audit](./nba-nfl-factual-pipeline-audit-20261103.md) and its [evidence JSON](./nba-nfl-factual-pipeline-audit-20261103.json).

The source parser fixes, deterministic fixtures, regression tests and offline planning tools are implemented. **Roster storage and live draft eligibility remain proposals.** No production database operation, source acquisition job, player sync, identity application, ingestion/backfill, cache publication, schedule change, commit, push, merge, branch/worktree creation or deployment was performed. The existing Dev server was not stopped/restarted. No new live provider/database reads were needed; this phase reused the audit's captured evidence.

The NBA semantic append SQL, fingerprint `9308a04b52fecc6993b7730490cf686a`, current-table repair, workflows, canonical scoring, Group/slate authorization, saved drafts, Game Center and Skins files were preserved. No stored observation or historical team was rewritten.

## Implemented ingestion fixes

### NBA competition classification

`classifyEspnNbaPhase` now requires an exact professional season label and an explicit supported competition label. It no longer treats any string containing “Regular Season” as ordinary regular season.

| Captured/supported label suffix | Existing phase vocabulary |
| --- | --- |
| `Regular Season` | `regular` |
| `Preseason` | `preseason` |
| `Postseason` | `postseason` |
| `Play In Regular Season` | `postseason`, explicitly outside regular GP |
| Cup/exhibition/new/unknown labels or mismatched year | `unknown`, with the existing missing-phase marker |

The reduced captured Curry 2025–26 fixture retains exact event statistics, labels and team context. It produces **43 regular games**, equal to independent regular GP=43. Play-in events **401866756** and **401866759** are separately classified outside regular season. Both the research normalizer and Player Center regular-game parser pass this check.

This uses the application's existing three-phase vocabulary; it does not introduce a separate play-in/round UI or claim that ESPN's independent playoff GP includes play-in games. Any postseason aggregate still needs independent coverage reconciliation. Existing stored regular-phase rows are untouched, so historical observation fallback remains limited until a separately reviewed correction/read strategy is accepted. No backfill may be inferred from this code change.

### NFL fumbles evidence

Research acquisition and Player Center now share `reconcileNflFumbleEvidence` for absence-zero evidence and conflicts:

- A final, exact-team aggregate reporting LOST=0 can establish individual zero, including an omitted/empty athlete category, provided no malformed or contradictory category evidence vetoes it.
- A fully reconciled athlete category can independently establish an absent athlete's zero. A merely present category, empty list, missing totals, nonfinal context, malformed aggregate, or conflicting cells cannot.
- Explicit athlete zeros/positive values remain facts. An explicit log value survives unavailable summary evidence. Conflicting explicit log/summary values or athlete/team totals withhold that player's LOST and report the conflict.
- The research normalizer checks event/team identities, exposes season/phase/finality and athlete-team bindings, and reports conflicting athlete IDs. Acquisition validates these against the requested season, final event and game-specific team.
- Missing groups no longer abort acquisition. A failed/malformed summary withholds affected QB facts and calls `onIncomplete`; independently validated facts elsewhere in the cohort can continue. The existing worker already exits non-green when its incomplete array is nonempty.
- Structural/event-identity errors remain errors at normalization. Acquisition catches source failures by event rather than converting them to zero. A returned summary bound to a different requested event remains a hard identity failure.
- A QB's explicit numeric log LOST can be retained without pretending the log came from a summary: log provenance stays in the game-log fields and summary provenance stays null. No positive/zero value is invented based on position.

Captured Mahomes event 401872945 now uses the same final KC LOST=0 evidence in research and Player Center. Existing Allgeier/Mahomes scoring regressions still reproduce 3.6 and 28.98 default-rule FP. Canonical coefficients and snapshot scoring are unchanged.

### NFL signed yards: parser fixed, storage explicitly gated

Passing, rushing and receiving yards now preserve signed int32 values in the research log parser, canonical factual validator, normalized wire reader and observation-record conversion. Attempts, receptions, touchdowns, interceptions and LOST remain nonnegative integers. Nonfinite, fractional and out-of-range values are rejected or remain unavailable at the source parser boundary.

The captured Allgeier event **401872958** has two carries and **−1 rushing yard**. Tests show that −1 survives parsing, canonical hashing, wire validation, record conversion and the existing Player Center parser. It is distinct from both null and zero.

The installed SQL foundation still rejects negative values. Therefore this phase deliberately does **not** activate signed-yard ingestion:

1. Acquisition preserves the parsed negative value, then emits `signed_yards_storage_review_required` with the exact signed fields/values and withholds that row. It does not send a null/zero substitute or poison the rest of the cohort.
2. Server persistence independently rejects a signed row with `NFL_SIGNED_YARDS_STORAGE_REVIEW_REQUIRED` before hash lookup/insert. An unexpected caller cannot silently reach incompatible SQL checks.
3. The [guarded SQL proposal](../supabase/manual/factual-pipeline/nfl-signed-yard-constraints.proposed.sql) removes only the three known nonnegative-yard checks after checking explicit schema approval, reviewed integer columns/check definitions, RLS and the immutable-history trigger. All count/TD/LOST constraints, history, hashes, grants and NBA functions remain untouched. Integer types already impose int32 bounds.
4. That SQL was **not executed**, including against a local PostgreSQL cluster. It still requires restored-copy rehearsal and owner review. Even applying it later would not remove the local quarantine: an explicit reviewed writer/storage capability is a separate next step.

This is an intentional deployment boundary, not an end-to-end storage repair claim. The same holds for existing null-yard rows: correcting them requires new validated factual versions through a separately approved writer, never an UPDATE of immutable history.

Signed-yard path inventory:

| Layer | Result in this phase |
| --- | --- |
| `espnNflGameLog.ts` required/optional numeric cells | Signed yards preserved; negative counts unavailable |
| `observationFoundation.ts` canonical validation/hash | Signed int32 only for the three yard fields; existing hash payload/key order and normalizer label unchanged |
| `observationIngestion.ts` wire/record conversion | Signed integer values preserved; QB explicit-log evidence supported |
| `observationAcquisition.ts` | Explicit quarantine/report before an incompatible write |
| `observationPersistence.server.ts` | Defense-in-depth storage-review rejection before hash lookup/insert |
| `observationRepository.server.ts` upsert | Unchanged; signed values cannot reach it through current persistence |
| Original NFL foundation SQL | Unchanged; the existing three nonnegative-yard checks still apply |
| Player Center log/summary parser, cache decoder, canonical scorer | Already support signed yards; regressions retained; no scoring change |
| Retired forecast/research models | Not reactivated or made a factual fallback; their projection constraints are separate |

## Existing identity, roster, slate and historical structures

| Existing structure | Reuse | Current limitation |
| --- | --- | --- |
| `players.id`, `players_nfl.id` | Permanent sport-namespaced internal identities for every season/team | `is_active`, team, position and current-week/day flags are mutable current metadata, not history |
| `players.nba_player_id` | Stable native NBA person ID | Must not be replaced because a player changes teams; never equal it to ESPN athlete ID by assumption |
| `nba_player_provider_identities` | Existing reviewed/locked ESPN crosswalk | Resolve current evidence gaps; a current roster absence does not invalidate historical identity |
| `players_nfl.nfl_player_id` | Existing ESPN athlete identity, K Core/PK mapping, synthetic defense identity | No second identity table is necessary for current single-provider NFL athletes; preserve `100000000 + ESPN team ID` for D/ST |
| Observation versions/current views | Season participation evidence and the exact team/opponent represented in each observed game | An observation proves an appearance/stat context, not current roster membership; a missing observation proves neither zero GP nor absence |
| `player_center_season_cache` | Per-player/professional-season raw games, game-specific team fields and provider season tables | Not a roster history ledger or eligibility snapshot |
| `slates` / `rules_snapshot` / `rules_version` | Existing Group/league/sport scope, dates, frozen scoring/roster rules and lock state | No frozen complete NBA/NFL eligible-player pool |
| `slate_nba_games`, `nba_team_abbreviations` | Existing saved NBA game/team universe for On Slate | Freezes games/teams, not which permanent players were eligible |
| `fantasy_drafts` | Draft order, participants, slots, rules snapshot and concurrency metadata | Initialized at draft mutation/first-pick time; not a record of the full pool at slate creation |
| `draft_picks` / `draft_corrections` | Permanent IDs plus saved name/position/team-of-fantasy-manager and correction trail | Preserve pick history, but cannot reconstruct unpicked players in an old full pool; `team_id` here is the fantasy team, not professional team history |
| `lineup_players`, saved slate stats/results | Saved assignments and Group/slate outcomes | Do not remove or relabel these after a real-world transaction |
| Golf roster periods/event players | Reuse the design lessons only | Golf-specific player FKs, rounds/periods and league/event semantics do not represent NBA/NFL professional team tenure |

The saved audit schema and repository SQL show **no existing NBA/NFL professional membership interval/transaction table**. There is no reason to replace the permanent player tables, crosswalk, observation store, draft history or Group architecture.

Current consumer behavior, unchanged here:

- `app/lineups/draft/page.tsx` loads current active NBA/NFL catalog rows. `loadNflPlayers` provides complete pagination.
- NBA `/api/slate-availability` uses saved slate team codes against the current active/team catalog. NFL `loadNflSlateAvailability` reads the selected slate's schedule, then current active/team catalog; it does not rely on the current-week flag.
- `mutate_fantasy_draft` and the lineup API enforce current player activity plus canonical slot rules, with explicit correction paths. Current roster changes can therefore affect an older unlocked draft or hide an inactive saved player in its displayed pool. This gap is **not fixed in live code** by the planning module.
- Player Center catalog reads include inactive players for direct historical profiles, but comparisons still select current-active players. Historical comparison universes need a reviewed season-aware reader, not a blanket change to `is_active`.
- NBA/NFL game-log observations and Player Center games already carry game-specific teams. The regression presents two games before/after a synthetic trade through the existing Player Center parser and presentation code and retains both correct teams. There is no current-roster fallback in those test inputs.
- Some live score/slate status readers still use current catalog team metadata for schedule matching. Future historical reads must prefer saved game/team context or accepted intervals; they were not changed here.

## Minimal proposed roster/eligibility storage

This is a **design proposal**, not an installed schema or a partially connected draft feature. No roster DDL or new live repository is shipped. The offline types/functions specify and test the intended semantics.

### 1. One professional roster evidence table

Proposed `professional_player_roster_evidence`:

| Fields | Contract |
| --- | --- |
| `id`, `sport`, `nba_player_id` / `nfl_player_id`, `entity_kind` | Exactly one restrictive FK to the existing permanent player row matching sport. D/ST is a separate team-defense kind, never an ordinary athlete. |
| `season` | NBA ending year; NFL starting year, including January games in that NFL season |
| `evidence_type` | `interval` or `snapshot` |
| `effective_from`, `effective_to` | Confirmed half-open `[from,to)` period; nullable end. A point snapshot has neither bound. |
| `observed_at`, `verified_through` | When the system captured the evidence and how far the membership is actually supported. No future/unbounded continuity claim merely because a period is open. |
| `roster_status`, professional team provider/ID, team abbreviation, position | Rostered/unrostered fact for that season/period; rostered without appearances is valid. Professional team IDs remain provider-namespaced. |
| `confidence`, source URLs/hashes, operator/source provenance | Uncertain evidence stays unresolved; names alone never establish a permanent identity |
| `supersedes_id` if correction support is adopted | Append reviewed evidence corrections; require same permanent player/sport/season and acyclic ordering. Resolve only accepted non-superseded claims as of the knowledge cutoff. Do not UPDATE old evidence silently. |

Use B-tree indexes on sport/local-player/season and observation/effective instants. Validate exact provider ID bindings, event/source scope, interval order, temporal certainty and position/kind compatibility before accepting evidence. Conflicting raw evidence can be retained for review without authorizing eligibility. The planner consumes an already selected reviewed evidence set; it does not implement a production acceptance/supersession writer.

No separate permanent-player or compulsory player-season master table is needed. A season-participation read can union explicit season-linked roster evidence with existing observed games, retaining which evidence exists. This supplies historical addressability and a rostered/no-appearance distinction **without inferring roster status from game counts**. If later product requirements need contract-level season statuses beyond that union, review them separately.

Current roster snapshots must **not** be converted into membership from season start. If a player is seen with Team B today and previously with Team A, this proves two dated points, not a trade date or uninterrupted tenure. Keep point evidence until an authoritative transaction or bounded historical interval is available. Releases/signings with reliable instants produce separate rostered/unrostered intervals; re-signing opens a new interval for the same permanent ID.

NBA source availability differs from NFL: this audit has NBA.com person/roster and ESPN current rosters, not an accepted complete transaction feed. NFL team rosters/Core kicker paths and synthetic franchise records do not automatically provide historical contracts either. The model stores evidence; it does not assume a missing feed exists.

### 2. Reuse `slates` as pool header; add frozen pool membership

Proposed additions to `slates`: professional season, eligibility effective instant, evidence knowledge cutoff, pool captured instant/hash/version, and a state distinguishing `legacy_unfrozen`, `needs_review` and `frozen`. Existing Group/league/sport and rule snapshot remain authoritative.

Proposed `slate_player_eligibility` rows: restrictive slate FK; sport; exactly one restrictive NBA/NFL player FK; saved position, kind, professional team provider/ID, **On Slate flag**, and supporting evidence IDs. Unique membership per slate/permanent sport-namespaced player. An empty accepted pool must be distinguishable from absent/unreviewed pool data.

The complete eligible pool is frozen at **slate creation/admission before catalog reconciliation can change it**, not reconstructed from picks after the draft begins. On Slate remains the existing optional display filter; it does not become a new prohibition on otherwise eligible picks. Canonical configured position/slot rules remain unchanged. Saved positions/team context must be used for that pool, while displayed current metadata can remain separately labeled.

Creating a new eligible pool must be atomic with the scoped slate/rule state and must reject incomplete/uncertain identity or membership evidence. Readers and the authoritative draft RPC must switch together under a reviewed version/capability. Locking must freeze membership and header metadata. Commissioner amendments, if permitted, require an audited explicit workflow; a background roster sync cannot change an already-created pool.

For legacy created/locked slates, saved picks/assignments remain authoritative for their own records. They are insufficient proof of the original complete unpicked pool. Preserve them, label missing snapshot state and require an owner decision for continued legacy behavior or an explicitly reviewed reconstruction. Do not auto-create a supposedly historical pool from today's roster. No source-level activity change is authorized until this path is reviewed.

`lib/rosters/planning.ts` tests this contract without any live imports:

- Permanent identity is `(sport, local player ID, kind)`; no new ID on trade, release/re-sign or season rollover.
- Confirmed intervals resolve by effective time and supported verification horizon. Snapshot evidence applies at its observed point only. Conflicting claims resolve to conflict, not an arbitrary team.
- Draft planning filters evidence by `evidenceAsOf`; later-acquired evidence cannot authorize an earlier knowledge cutoff.
- Explicit game evidence resolves actual historical team independently of today's roster. Conflicting game claims remain unresolved; accepted historical intervals are a fallback only when game evidence is absent. Different provider namespaces are never equated by equal numeric ID or a present-day abbreviation.
- Existing frozen pool members, positions, team and On Slate evidence are copied unchanged after transactions. Group, league, sport, season, slate and cutoff bindings must match. A locked legacy slate without a snapshot returns `requires_review`.
- NFL D/ST is a team entity; kicker eligibility does not imply configured K fantasy scoring.

## Read-only NBA reconciliation

[Saved dry-run plan](./nba-roster-reconciliation-plan-20261103.json), built from [the reduced audit snapshot](../tests/fixtures/factual-pipeline/nba-roster-audit-20261103.json). It is explicitly **dated November 3 audit evidence**, not a new live sync or approval to apply old counts later.

| Classification | Count | Proposed handling |
| --- | ---: | --- |
| Current roster additions/reactivations | **82** | Review identity/season membership only |
| Entirely missing native identities | **76** | Propose review of a permanent identity; emit no new local ID and never merge by name |
| Existing inactive identities currently rostered | **6** | Preserve existing local IDs; review season membership/legacy activity separately |
| Catalog-active current roster absences | **89** | Review absence; no inferred release date or automatic deactivation |
| Different stored versus native current team | **112** | Record dated team difference, unknown transaction type/date; do not overwrite historical teams |
| Unresolved active NBA mappings | **163** | Existing native IDs and corroboration required; current evidence is only a review candidate |
| Existing mappings needing current evidence review | **29** | Preserve historical identity while reviewing current proof |
| Historical-statistics players without current native roster evidence | **28** | Retain permanent identities, historical observations and every saved record |
| Catalog players with no current-season stored observations | **312** | All catalog rows, including inactive; no inferred GP=0 |
| Currently rostered catalog players without stored current appearances | **164** | Roster participation and observations remain separate; independent GP unknown |

The 312 count is across all 595 catalog rows; the audit's **247** active-catalog players without observations is the narrower active-only denominator. Neither is a missing-game count. The 76 new identities do not acquire an invented observation/GP status by being proposed additions.

The tool preserves every one of the **595** existing local IDs in its preservation list. Per-player historical draft references were not exported in the audit snapshot, so the report marks them unverified and preserves all IDs rather than guessing which are unused. Dated captured observation counts establish historical statistics, not draft participation or current eligibility.

The CLI has no dotenv loader, network client, database client, SQL generation or apply mode. It caps input bytes/row arrays, rejects incomplete scope and native/provider collisions, uses `wx` to refuse overwrite, and records the input SHA-256. Names may help prepare uniquely corroborated review candidates, but a same-name/different-native-ID case is explicitly uncertain and never merged. Existing IDs and source teams are not mutated.

Offline reproduction into a **new** output path:

```sh
node scripts/plan-nba-roster-reconciliation.cjs \
  tests/fixtures/factual-pipeline/nba-roster-audit-20261103.json \
  /tmp/new-nba-roster-review.json
```

No tool here interprets that plan as approval or creates a historical interval from a roster difference.

## NFL correction/reversal proposal — unchanged behavior

The existing persistence contract hashes facts and normalizer version, excluding fetch/known timestamps, with a lifetime unique `(provider, player, event, observation_hash)` key. This avoids timestamp churn but suppresses a return to A after A→B. A deterministic in-memory repository test explicitly reproduces A→B→A ending with B; it is a recorded known limitation, **not a passing repair test**.

A safe future resolution should retain all current rows/hashes and introduce a reviewed chronological append mechanism:

1. Serialize each provider/player/event in stable lock order, as the NBA repair already demonstrates; avoid direct-insert fallbacks.
2. Compare incoming typed/null-safe facts with the latest accepted chronological version. Identical polling appends zero; B after A appends once; a later A after B must append a new immutable transition.
3. Keep the existing factual hash as content identity. Introduce a distinct acquisition/transition identity and uniqueness definition that supports correction reversals and exact receipt replay; do not replace it with arbitrary per-poll timestamps that restore churn. Review how the old unique key is preserved/replaced before writing anything.
4. Preserve all prior version IDs and first-known times; keep existing as-of readers' recorded-history meaning. Out-of-order archived imports need a separate explicit policy and cannot silently enter the current writer.
5. Coordinate the writer, dedupe lookup, latest/as-of selection, grants and retry receipts. Require restored-copy concurrency, A→B→A, replay, stale-acquisition, failure rollback and immutable-history tests before installation.

No NFL hash layout, uniqueness constraint, stored version, current view, or production history semantics was changed in this phase. No new NFL append RPC was installed. NBA's installed function/fingerprint was not copied over or modified.

## Files changed in this phase

| Path | Exact purpose |
| --- | --- |
| `lib/analytics/providers/espnNbaGameLog.ts` | Exact supported season/competition classification; play-in excluded from regular |
| `lib/analytics/providers/espnNflGameLog.ts` | Signed-yard parsing with integer/range/count validation |
| `lib/analytics/providers/nflFumbleEvidence.ts` (new) | Shared final team/category absence-zero and conflict reconciliation |
| `lib/analytics/providers/espnNflEventFumbles.ts` | Research use of shared evidence, final/season/team bindings and conflict metadata |
| `lib/player-center/espn.ts` | Reuse shared fumble evidence; retain explicit log facts and withhold actual conflicts |
| `lib/analytics/nfl/observationFoundation.ts` | Signed-yard canonical validation and signed-field detection; unchanged hash contract |
| `lib/analytics/nfl/observationIngestion.ts` | Explicit QB log LOST versus summary evidence/provenance and conflict checks |
| `lib/analytics/nfl/observationAcquisition.ts` | Per-event incomplete handling, identity/context checks and signed-yard quarantine |
| `lib/analytics/nfl/observationPersistence.server.ts` | Explicit pre-insert signed-storage review gate |
| `lib/rosters/planning.ts` (new) | Offline tested interval, game-team and frozen eligibility contracts; no live consumers |
| `lib/rosters/nbaReconciliation.ts` (new) | Pure dated catalog reconciliation/planning without writes or inferred dates |
| `scripts/plan-nba-roster-reconciliation.cjs` (new) | Offline bounded CLI with no apply mode and no-overwrite output |
| `tests/factual-pipeline-parsers.test.cjs` (new) | Captured phase/signed-yard/fumbles regressions, quarantine, documented reversal limitation |
| `tests/season-roster-planning.test.cjs` (new) | Trades, releases/re-signings, season changes, no appearances, historical-only players, locked snapshots, actual Player Center game teams, ambiguity and CLI safety |
| `tests/nfl-fumbles-readiness.test.cjs` | Existing tests distinguish truly missing evidence from independently verified team zero |
| `tests/nfl-observation-acquisition.test.cjs` | Existing cohort test expects explicit incomplete reporting instead of a whole-run summary failure |
| `tests/nfl-research-dataset.test.cjs` | Existing missing-group case verifies unknown evidence rather than a fatal cohort assumption |
| `tests/fixtures/factual-pipeline/nba-curry-2026-phases.json` (new) | Reduced captured exact Curry regular/play-in/preseason rows with source hash |
| `tests/fixtures/factual-pipeline/nba-curry-2026-season.json` (new) | Captured independent GP=43/season statistics |
| `tests/fixtures/factual-pipeline/nfl-allgeier-negative-yards.json` (new) | Reduced captured event 401872958, original −1 field and source hash |
| `tests/fixtures/factual-pipeline/nba-roster-audit-20261103.json` (new) | Reduced public-player audit snapshot and source receipts; no new live reads |
| `supabase/manual/factual-pipeline/nfl-signed-yard-constraints.proposed.sql` (new) | Guarded, unapplied, separately authorized SQL proposal only |
| `docs/nba-roster-reconciliation-plan-20261103.json` (new) | Deterministic review-only reconciliation output and input hash |
| This document (new) | Architecture reuse, boundaries, model, migrations, risks, verification and next steps |
| `docs/factual-pipeline-controlled-phase-20261103-validation.json` (new) | Test/build receipts, exact file delta hashes and preservation verification |

Existing uncommitted content in edited files was retained; no unrelated user file was reset or replaced. The original audit reports/receipts are unchanged. A final preservation manifest checks permitted deltas and protected paths separately from the existing broader dirty working tree.

## Verification

- **283 focused/regression tests passed, zero failed/skipped**, across 24 test files covering the new cases plus existing NBA analytics/infrastructure/factual refresh, NFL acquisition/foundation/fumbles/research, Player Center/scoring/comparison/canary/integrity/local safety, draft history/context, catalog/status and projection retirement. No PostgreSQL migration harness or live worker was run.
- The final planning-only change retained the optional On Slate display filter; its **15-test** suite passed again afterward. It does not alter the live draft pool.
- `tsc --noEmit --incremental false`: passed. Scoped ESLint across all 17 changed/new code/test paths: passed with no diagnostics. `git diff --check`: passed.
- One local Next.js 16.2.4 Webpack production build **passed** with `npm run build -- --webpack`, following installed documentation. The build process had no usable service-role credential, telemetry disabled, and an external temporary network guard rejecting mutating requests/RPC/refresh paths. No application environment/config file was changed. The completion receipt records the build/test results.
- No interactive UI controls were changed. Existing Player Center team presentation was exercised directly through parser/presentation regression tests; previous local Chrome UI acceptance was not repeated or treated as production data certification.
- SQL is deliberately **unapplied and not certified by an isolated PostgreSQL execution**. Unit tests verify the functional storage gate; restored-copy SQL validation is required before owner approval.

## Risks and next controlled authorization

1. **Stored NBA phase errors remain.** New parsing is correct, but old immutable regular rows still include the documented play-in games. Plan a scoped historical read/correction strategy with exact IDs and coverage evidence; do not update/delete history or change the semantic repair.
2. **Signed NFL facts remain quarantined.** This run prevents data loss and incompatible inserts but cannot complete persistent negative-yard statistics without reviewed SQL, a capability-aware writer, and reversal-safe handling. Expect non-green incomplete reports if a future authorized worker is run before that work.
3. **Fumbles correctness can expose more incomplete rows.** Conflicting/unverified zeros now remain unknown; never compensate by inventing zeros or hiding players from coverage. Provider errors preserve independently known facts and identify the affected player/event.
4. **Current activity/team fields still drive live pools.** Do not apply catalog activity changes or rewire the new planner before the frozen-pool and authoritative RPC/reader changes are reviewed together. Saved picks and original rules must remain unchanged. The new planner is a proposal, not proof that production historical pools are frozen.
5. **Current rosters do not establish historical transactions.** The reconciliation's additions/removals/team differences are dated review findings. Confirm identities and transaction sources/dates; preserve all original IDs and all historical links. NFL roster/transaction data needs its own evidence collection, not NBA assumptions.
6. **Historical comparison universes require review.** Current-active filtering is not a season eligibility model. Direct historical profiles remain addressable; do not falsely certify old full pools from current membership or appearance absence.

Recommended next phase: **owner review of the contracts and a restored-copy storage/eligibility rehearsal**, before production data work. Explicit authorization is required for any schema installation, a new NFL append/capability writer, scoped historical factual correction, catalog/mapping change, accepted roster evidence publication, frozen slate pool creation, live draft/API integration, full acquisition/backfill, cache publication, schedule change or deployment. Keep the retired NBA workflow disabled. No such authorization is presumed by this local handoff.

**Stop after local code, tests and this plan. No production operations were performed.**
