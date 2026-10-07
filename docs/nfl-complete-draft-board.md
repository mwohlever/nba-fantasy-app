# Complete NFL draft board

Starting local/remote main and verified Vercel Production SHA:
`3a924f389be9c9d4abb4b519e7f42dc2d781ecec`.
Branch: `feature/nfl-complete-draft-board`.

## Investigation and scope

This is a presentation-only change with a small, additive NFL read-payload
field. No migration, RPC definition, mutation intent, cursor logic, historical
pick, production record, scoring code or ownership constraint changes.

The existing `read_fantasy_draft` RPC already returns `participant_ids`,
`roster_slots`, the slate `rules_snapshot`, all historical picks, corrections,
active roster counts and lock status. Once initialized, order and roster slots
come from immutable `fantasy_drafts` configuration. Before the first pick,
order comes from the slate's participating teams ordered by `draft_order`,
and roster size uses the existing canonical snapshot resolver. The first pick
continues freezing this configuration through the unchanged mutation RPC.

Previously, `readDraftHistory` consumed order and roster size to resolve the
cursor but did not expose them to the browser. It now adds optional NFL-only
`history.board = {participantIds, rosterSize}` using those same values.
Populated uninitialized legacy drafts and unsupported formats retain their
existing review/history view. Missing, invalid or inconsistent configuration
also falls back to recorded history, preserving every record rather than
inventing future slots or hiding anomalous historical picks.

The complete sequence was not previously held in client state. It can safely
be derived from the authoritative order and roster size. `buildDraftBoard`
generates `participantCount × rosterSize` positions, reversing participant
order on alternate rounds. It maps existing picks by `overall_pick` and checks
their team/round/round-position against the configuration. Reversed picks
still map as real historical picks; status never makes their row empty.

`getDraftTurn` and the PostgreSQL cursor remain unchanged. The generated board
does not compute or control who can draft. The client still uses the existing
scoped `history.turn` and permission gates for its one action.

## UI behavior

Only NFL opts into the complete board in `LineupBuilder`. The shared component
retains the existing NBA view; Golf has no Draft Order tab.

- Completed rows retain player, position, Proxy and correction metadata.
- Corrected/reversed rows keep the existing `effectiveDraftPick` rendering,
  original-player disclosure and linked correction trail.
- Standalone commissioner replacement additions remain separate in the
  existing Roster corrections audit. They are never folded into a numbered
  historical slot. Thus #17 remains Removed / Corrected / reversed /
  Originally Nico Collins; an actual #20 remains Matthew Stafford.
- The authoritative current row is highlighted and labeled Current pick.
  Its existing authorized action is placed inside that row, removing the
  duplicate placement below the table for full NFL boards.
- Future rows show the predetermined participant and subtle em dashes.
  They have no draft button or click handler.
- Locked, complete and review states never gain an action. After a pick,
  the existing refresh replaces the placeholder with the actual historical
  record and reflects the unchanged authoritative cursor/completion state.

For slate 193's three participants and seven frozen roster slots (including
FLEX), there are 21 normal positions. There is no six/seven-round constant.

## Validation

`nfl-draft-board.test.cjs` covers empty/full boards, exact snake order, variable
participant/roster counts, mapping unordered historical input, correction
metadata and separate replacement audit, current-only permissions, cursor
progression/final completion, immutable rendering, safe legacy fallback,
NFL-only read metadata and unchanged NBA presentation.

`nfl-draft-board-browser.test.cjs` uses actual Draft workspace and AppNav
components in Chromium with every request intercepted. No production or
external write is possible. It exercises commissioner and normal-player views
at 360, 390, 486 and 1024 pixels, empty and recorded boards, correction
disclosures/edit controls, single current action, existing final-pick flow,
completion, future-action absence, cell/document overflow and bottom navigation.
Screenshots are saved outside the repository when requested.

The existing real PostgreSQL correction/replacement and guarded-discard tests
remain part of focused validation, alongside lineup API, participant eligibility
and draft workspace tests. No ShotCast worktree is accessed or changed.

Final checks:

- Focused draft/lineup/correction/participant/discard run: 217 passed, no failures
  or skips; includes the actual PostgreSQL correction and discard RPCs.
- Chromium board QA: passed all eight viewport/role combinations, including
  initial board and final-pick completion. Browser test also passed in full suite.
- `npx tsc --noEmit`: passed.
- Full suite: 1,383 tests; 1,347 passed; 3 known baseline failures; 33 skipped.
  Baseline failures remain `golf-product-ui`, `nfl-background-scoring` and
  `nfl-usability`, matching the previously verified production baseline.
- No migration, database/RPC/cursor change, production-data repair or ShotCast
  operation was needed.
- `npm run build`: passed, including its TypeScript check.
- `git diff --check`: passed; final diff reviewed before commit.
