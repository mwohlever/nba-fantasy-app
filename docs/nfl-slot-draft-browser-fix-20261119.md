# NFL circular slot-selection browser consistency

Branch: `fix/nfl-slot-draft-player-browser`, based on production `c79949c`.

The circular empty roster-slot control in `DraftRosterCourt` sets `targetDraftSlot`. `LineupBuilder` then opens `SlotDraftModal`, which already renders the same `PlayerPool` → `DraftPlayerCenter` → `ResearchBrowser` used by the main Draft list. The modal had its own All Players default and supplied `All` as its position even for fixed NFL slots.

The fix changes two application files:

- `SlotDraftModal.tsx`: NFL starts On Slate, consumes the parent's scoped availability-readiness flag, and passes the actual fixed roster-slot position to the shared browser. Ownership, canonical slot compatibility, search, profile round-trip state, explicit slot assignment and NBA defaults are preserved. The shared browser supplies season FP/game descending, numeric ordering, missing-last behavior, alternatives, K/DST limitations and comparisons; no sorting/data implementation was duplicated.
- `LineupBuilder.tsx`: passes its existing validated `nflDraftAvailabilityReady` state into the slot modal. The modal uses existing authoritative slate IDs rather than deriving schedules. All Players remains available; the actual draft eligibility/assignment logic is unchanged.

The slot picker intentionally remains restricted to unowned players compatible with the chosen slot. Its position is fixed by the slot rather than letting a filter change the intended assignment.

Validation:

- 208 focused tests pass, including six new modal tests for defaults, All Players/search, unavailable/scoped availability, refresh loading, K/DST position context, failure/success callbacks and unchanged NBA defaults.
- New actual circular-control browser test passes at 360/390px: main-list parity, owner/slot exclusions, FP/game descending, numerical ascending/descending with unknown-last, All Players, alternative sort, search, profile close/restore, frozen selected-slate scoring and explicit QB index-0 assignment. Assignment POSTs are intercepted by the isolated browser fixture; no production requests or writes occur.
- Four existing actual Draft/Player Center browser regressions pass, including NBA/NFL at 360/390/1280px and historical Draft contexts. Mobile screenshot inspected.
- TypeScript, production build and `git diff --check` pass. New tests have clean ESLint results. No new app lint findings: SlotDraftModal retains one baseline explicit-any error and removes its missing-rosterSlots dependency warning; LineupBuilder retains its baseline 22 errors/16 warnings.

Only the two application files, two focused test files and this note are included. Existing untracked diagnostic reports and the WIP stash are preserved. No database, migration, canonical scoring, ingestion, draft-history, push, merge or deployment changes.
