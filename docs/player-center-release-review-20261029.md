# Player Center factual refresh: scoped release review

Prepared October 29, 2026 against production `main` at `cf462aa865fb1dfa85ca1bd67f0ea878652f7169`. This is a local review patch, not a commit, deployment, SQL installation, mapping approval or refresh authorization. No production database query or mutation was made for this review. GitHub and public NBA/ESPN requests were read-only.

## Release boundaries

The release includes the existing NBA/NFL Player Center foundation, UI, stored comparisons and authorized Group/frozen-slate scoring integration; the new NBA factual acquisition/status/cache pipeline; and the existing coherent NBA/NFL forecast retirement. Golf behavior, live factual scoring, NFL observation acquisition and saved historical results/forecast columns are preserved. The old forecast-only APIs return 410, forecast generators cannot run, and the NBA legacy writer cannot bypass transactional factual publication. NBA/NFL forecast displays and future forecast-snapshot creation are retired together with their producers. Old forecast research modules can remain as inert historical research.

The replacement NBA workflow is manual-only, defaults to dry-run and has no cron. GitHub workflow 359561686 was independently read on October 29 and remained `disabled_manually`. No workflow setting changed. The NFL factual observation workflow is unchanged; the NFL forecast-only workflow is made inert as part of the approved existing retirement work.

Release validation uses the existing private validation directory, exported from the exact base Git tree plus a dedicated alternate index. There is no new worktree, branch, npm install or commit. Every exported Git-index file is checked byte-for-byte. The real working tree/index and unrelated changes are preserved. The reviewed release-only polish removes three unused bindings left by retirement (`lineupPlayer`, `draftGroupId` and a test-only forecast validator import); it changes no behavior and does not overwrite local WIP.

Included groups:

- Application: Player Center APIs, NBA machine-only factual refresh API, shared profile/research/draft components and styles, cache/status readers, provider parsers, identity and comparison contracts, local preview isolation.
- Retirement: NBA/NFL forecast-only routes/generators/jobs, draft/home/score/history consumers and future forecast snapshots; original factual/scoring workflows remain separate.
- Operations: bounded/restartable NBA worker, offline evidence review and existing read-only preparation tooling; no credentials are packaged.
- SQL: `factual-refresh-v1.sql` and its verification query are the only new active installation instructions. The installation gate remains `REVIEW_ONLY`; the existing semantic append migration is unchanged. Other `supabase/manual/player-center` files are dated, guarded bootstrap/rollback evidence used by regression tests. They are **not** the current mapping/population procedure and must not be executed from this release review.
- Tests/evidence/docs: focused unit/API/real PostgreSQL/browser regressions, raw public-data fixtures, dated bootstrap fixtures, storage benchmark and identity review artifacts.

Excluded: NBA recovery/cleanup/compaction tooling, observation cleanup proposals, unrelated `vercel.json`, unrelated Groups/NFL catalog changes, preexisting fixes already on main, credentials and private execution reports. No automatic database migration is added or changed. The protected append RPC's source MD5 remains `9308a04b52fecc6993b7730490cf686a`.

The exact patch, base SHA, SHA-256 file manifest, per-file inventory and validation logs are in the private `~/.local/share/111sports-recovery/factual-refresh-release-20261029/` directory. The patch is not staged in the real index. Use that manifest rather than a blanket `git add` against the development checkout.

## Fresh identity evidence

The full 530-player review is in [JSON](../data/player-center/nba-identity-release-review-20261029.json) and [CSV](../data/player-center/nba-identity-release-review-20261029.csv). Raw response receipts are preserved privately with URL, acquisition time and SHA-256. Provider requests made today: 93 GETs, 92 successful; one initial incorrectly formed ESPN Core URL returned 404 and was replaced with the correct endpoint. No acquisition error was interpreted as a zero appearance.

**Freshness boundary:** NBA/ESPN evidence is fresh October 29; the player catalog and stored mapping baseline are the frozen October 23 snapshot. No production SQL or database API read was used to refresh those database rows. Counts below describe that fixed pool against today's provider evidence. A fresh, owner-run database drift check remains mandatory before any mapping proposal is released. Fresh provider evidence alone is not current production mapping verification.

| Cohort | Review result |
| --- | --- |
| Original 98 candidates | All 98 retain unique exact-name/current-team agreement between the native NBA ID and ESPN rosters. |
| Original 65 unresolved | Two now have strict current-roster matches (Micah Peavy, local 406; Sean Pedulla, local 407); Bobby Portis, local 422, has corroborated explicit suffix evidence; nine have corroborated historical biographies; 53 remain unresolved. |
| Original 30 existing mappings needing review | Two now pass current-roster checks (Enrique Freeman, local 170; Dalton Knecht, local 296); 28 still lack current-roster evidence. |
| Other existing mappings | Kevin McCullar Jr., local 348, newly lacks current-roster evidence. The other 338 existing mappings are currently corroborated. |

This yields **110 high-confidence new identity proposals**, none applied: **100 current-roster matches**, **one explicit suffix exception**, and **nine historical matches**. Bobby Portis's native ID 1626171 and ESPN 3064482 agree on ISO birth date 1995-02-10, 2015 round 1 pick 22, Arkansas and current MIA team; the NBA display includes “Jr.”. This is an explicit reviewed identity exception, not a new fuzzy runtime rule.

The nine historical proposals are Johni Broome, JD Davison, Gary Harris, Andre Jackson Jr., Trey Jemison III, Dillon Jones, John Konchar, D'Angelo Russell and Jeremy Sochan. Every proposal has matching unique native identity/name and ISO birth date across NBA and ESPN; all seven drafted players also agree on year/round/pick. The two undrafted players do not gain a fabricated draft attestation. These nine are absent from today's native-current/ESPN-current rosters; identity confidence does **not** establish current-season participation or GP=0.

All **29 existing mappings without current-roster evidence** have matching historical native names and ESPN athlete profiles. No replacement/deactivation is proposed. Their current availability/coverage remains unknown. All 62 absent-from-native-current cases were found by native ID in NBA's historical roster; absence is not proof of retirement, a wrong ID or no historical data. The 53 without sufficient ESPN identity evidence remain explicitly unresolved. Conditional identity coverage after separately approving all 110 proposals would be 477/530 (90%), not complete coverage and not production state.

No player mapping, draft eligibility, active flag, historical player record or original 98/65 frozen fixture was modified. No mapping SQL was generated for this new 110-row proposal. The 45 known filters-only log cases retain the existing conservative treatment: no explicit exact-season GP proof means acquisition failure/unknown, not zero appearances. Those game logs were not reacquired in this identity-only review.

## Validation and readiness

Validation receipts are local only. The exact assembled application passed the 357-test unit/API/PostgreSQL/data/scoring/draft regression run, seven mocked Chromium cases, TypeScript and a production build with dummy credentials. A further 227 regression executions passed after the unused-binding polish, including reruns of 63 cases from the first suite. Across the runs, **528 distinct named cases passed, zero failed/skipped**. Final TypeScript and the production build passed. ESLint checked all 108 changed code/test files: **zero introduced diagnostics**, with 207 remaining legacy diagnostics versus 222 on the exact production base; 89 changed files are clean. This is not a globally clean lint claim. The patch applies cleanly to the base and produces the independently exported/validated tree. No actual production database, provider ingestion or saved pick was used by the tests.

Readiness blockers/checkpoints:

1. **Scope approval:** approve the exact manifest/patch before any commit, PR or push. Recheck base main if it moves.
2. **Mapping approval:** obtain a fresh manual catalog/mapping drift receipt, then review exact conditional mapping changes separately. Keep the 53 unresolved and 29 current-availability cases visible; do not alter eligibility to shrink the ranking pool.
3. **Database installation:** owner reviews/releases the SQL gate and executes installation manually; verify owner, SECURITY DEFINER path, RLS, SELECT-only service table grants, service-only RPC execution, original append hash and all existing triggers/references/indexes. Confirm successful installation before deploying a writer that requires it.
4. **Deployment approval:** ship the coherent factual/retirement frontend and backend scope, initially with Player Center activation gated and the workflow disabled/manual-only. No retired generator should be restored implicitly.
5. **Controlled data approval:** obtain fresh database/disk/WAL and metrics-availability evidence, approve a write-free dry run, then a bounded publication canary and full-pool run. The worker currently processes the full catalog; a canary must use a separately reviewed bounded publication request, not claim the full worker has a canary CLI option. Inspect actual failed/incomplete/blocked arrays, receipts, accepted/appended counts, first-known history and allocation growth.
6. **Coverage/activation approval:** current-season GP/log/summary completeness remains unverified for the expanded pool. Missing identities or unknown games must keep full-pool rankings unavailable. NFL full-pool durable coverage is also not certified by this NBA refresh work. Individual factual profiles and honest alphabetical/missing states can be accepted separately from complete ranking readiness.
7. **Schedule approval:** only after canary/full-run/coverage acceptance, approve factual cadence and activation independently. No cron or schedule enabling occurs in this patch.

Storage policy remains a 64 MiB combined cache/status cap, 400 MB database warning, stop before 450 MB, and 256 MiB free-disk reserve plus a 64 MiB WAL/concurrent-write allowance and payload budget. The local synthetic 530-player benchmark is 3.51 MiB initially / 5.30 MiB after repeated check metadata / 15.44 MiB after additional forced rewrites. Actual production compression, normal autovacuum behavior and metric freshness still require controlled measurement; missing/stale metrics must stop writes. No cleanup or physical maintenance is part of rollout.
