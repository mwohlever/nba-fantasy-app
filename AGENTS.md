# 111 Sports — Codex Repository Instructions

## Project

111 Sports is a mobile-first fantasy sports web application built with:

- Next.js / App Router / TypeScript
- Supabase / Postgres
- Vercel
- ESPN and other sport-specific external data sources

Supported or developing game areas include:

- NBA Fantasy
- NFL Fantasy
- Golf
- NCAA Pick'em
- NBA Skins
- Multi-group / league support

The current launch priority is completing the Groups platform.

## Next.js Version

This is not necessarily the Next.js version represented by model training data.

This version has breaking changes — APIs, conventions, and file structure may differ from older Next.js versions.

Before writing or changing code that depends on Next.js APIs, conventions, routing, configuration, or framework behavior:

- read the relevant guide in `node_modules/next/dist/docs/`
- follow the locally installed documentation over assumptions from prior Next.js versions
- heed deprecation notices in the installed documentation and existing codebase

---


## Git / Branch Safety

- Primary development branch for current Groups work:
  `feature/groups-platform`
- Do not push, merge, rebase, or modify `main` unless explicitly instructed.
- Do not create additional worktrees unless explicitly instructed.
- Do not create duplicate npm installs or unnecessary repository copies.
- Preserve unrelated local changes.
- Before editing, inspect the current branch and working tree.
- Do not commit unless explicitly instructed.
- Do not push unless explicitly instructed.
- Never discard or overwrite user changes simply to obtain a clean working tree.

---

## Development Workflow

Preferred workflow:

1. Inspect the relevant existing implementation.
2. Explain the intended change when appropriate.
3. Make the smallest coherent change.
4. Test the affected behavior in Dev first when interactive testing is relevant.
5. Run broader TypeScript/build checks after Dev behavior is verified.
6. Review the diff.
7. Commit/push only when explicitly instructed.

Do not automatically run expensive builds after every small edit.

When a task is primarily investigative, do not modify files until explicitly asked to implement.

---

## Groups Architecture

111 Sports supports multiple Groups/leagues.

Group scope is a core architectural boundary.

Preserve:

- active Group identity
- league/group-specific memberships
- league/group-specific teams
- enabled sports/games
- group-scoped settings
- group-scoped notification settings/history
- group-aware navigation
- group-specific Commissioner behavior

Do not accidentally fall back to global user/team identity where Group-specific identity is required.

New members are generally enrolled into enabled games through the Groups architecture unless the existing implementation says otherwise.

Multiple commissioners/admins may exist within a Group.

---

## League Rules

Canonical league rules live in:

`lib/rules/leagueRules.ts`

Use the canonical rule resolver rather than introducing duplicate default-rule definitions.

Current default roster structures include:

### NBA

- G: 2
- F/C: 3
- UTIL may be configured

### NFL

- QB: 1
- RB: 2
- WR: 2
- TE: 1
- K: 0
- FLEX: 0
- SF: 0
- D/ST: 0

Supported NFL roster slot types include:

- QB
- RB
- WR
- TE
- K
- FLEX
- SF
- D/ST

### Golf

- GOLFER: 4 by default
- Golfer count may be configured per league/slate.

Do not change Golf's normal 4-round / 72-hole tournament assumptions merely because golfer roster count is configurable.

---

## Immutable Slate Rule Snapshots

This is a critical invariant.

When a fantasy slate is created, the applicable league rules are frozen into the slate's `rules_snapshot`.

Existing slates must continue using their frozen rules even if Commissioner league settings change later.

New slates inherit the Group's current rules.

Do not replace snapshot-based behavior with current league settings for an existing slate.

Relevant fields include:

- `rules_snapshot`
- `rules_version`

Roster construction, scoring, and other rule-dependent slate behavior should consume the frozen snapshot where appropriate.

Legacy slates may not have a snapshot. Preserve intentional legacy fallback behavior.

---

## Scoring

Canonical scoring defaults belong with the league rules architecture.

### NBA defaults

- Points: 1
- Rebounds: 1.2
- Assists: 1.5
- Steals: 2
- Blocks: 2
- Turnovers: -1

### NFL offensive defaults

- Passing yards: 0.04
- Passing TD: 4
- Passing interception: -2
- Rushing yards: 0.1
- Rushing TD: 6
- Receiving yards: 0.1
- Receiving TD: 6
- Reception: 1
- Fumble lost: -2

NFL scoring is configurable at the Group level and frozen into each new slate's rules snapshot.

Do not hard-code configurable scoring values in refresh/scoring pipelines when snapshot rules should be used.

---

## NFL D/ST — Next Planned Rules Work

The next substantive Part 7 task is configurable NFL D/ST scoring with frozen snapshot consumption.

Planned standard defaults:

- Sack: +1
- Interception: +2
- Fumble recovery: +2
- Safety: +2
- Defensive/ST touchdown: +6

Points allowed:

- 0: +10
- 1–6: +7
- 7–13: +4
- 14–20: +1
- 21–27: 0
- 28–34: -1
- 35+: -4

Yards allowed:

- under 100: +5
- 100–199: +3
- 200–299: +2
- 300–349: 0
- 350–399: -1
- 400–449: -3
- 450+: -5

These values should ultimately be Commissioner-configurable and frozen into new slate snapshots.

Do not implement this merely because it is documented here. Implement only when specifically tasked.

---

## Sport-Specific Notification Rules

These are intentional product rules:

### NCAA Pick'em

- No draft notifications.
- The game has no draft.

### NBA Skins

- No draft notifications.
- No game notification workflows.
- The group conducts the annual draft together separately.

Do not introduce generic fantasy notification behavior into these game types.

---

## NBA Skins Historical Data

Do not treat draft order/draft position before the 2026 season as authoritative.

2026 is the first season where NBA Skins draft order / overall pick is intentionally tracked.

---

## Golf Scope

Do not implement alternative Golf scoring/game modes yet.

Alternative Golf scoring is intentionally deferred until AFTER the Groups platform ships.

Current Groups-launch work should not expand into Best Ball, betting-odds pricing, or other alternative Golf game formats unless explicitly requested.

Do not mix Groups/Part 7 work with unrelated Golf production fixes.

---

## Groups Launch Priority

The current priority is finishing and shipping Groups.

Part 8 is the Groups launch/completion pass.

Likely launch areas include:

- main 111 Sports landing page
- Group landing pages
- available/enabled sports and games
- Group descriptions/presentation
- Commissioner Group creation/management
- invites
- memberships
- Group-specific teams
- automatic participation behavior
- Group switching/navigation
- Group-scoped settings
- Group-scoped notifications/history
- custom rules applied to new fantasy slates
- frozen rules retained by existing slates
- group team identity
- desktop/mobile sanity
- launch-blocking regression fixes

Prefer launch-blocking work over speculative enhancements.

---

## UI Direction

The desired UI is:

- mobile-first
- compact
- clean
- sleek
- low on unnecessary card/box chrome
- low on dead space

Commissioner interfaces should generally favor compact, spreadsheet-like controls where appropriate.

Preserve existing navigation behavior and route context when switching Groups or sports unless the task specifically changes that behavior.

---

## Data / Supabase Safety

Be conservative with production data.

- Do not delete users, teams, memberships, slates, or historical records merely to fix UI behavior.
- Prefer fixing filtering/identity logic over destructive cleanup.
- Do not execute destructive SQL unless explicitly requested.
- When schema changes are necessary, clearly identify required SQL/migration work.
- Preserve historical team and membership relationships where intentional.

A known example is an inactive historical Group membership whose team record must remain for history; inactive membership should be filtered appropriately rather than deleting the user/team.

---

## External Sports Data

Be careful when modifying ESPN/PGA/NBA integrations.

Existing provider mappings and synthetic identifiers may be intentional.

For NFL:

- normal player sources cover QB/RB/WR/TE
- ESPN Core team athletes may provide PK -> K
- D/ST uses synthetic team/player representation

Do not casually replace provider IDs, synthetic IDs, or historical mappings without tracing their consumers.

---

## Testing

For relevant changes:

- inspect existing tests first
- add/update focused tests where useful
- verify TypeScript types
- use `git diff --check`
- run `npm run build` before declaring a substantial implementation ready for commit unless instructed otherwise

Interactive Dev verification may occur before the full build.

Do not repeatedly ask the user to rerun tests they have already completed successfully unless a subsequent change could invalidate those results.

---

## Working Style

Prefer evidence over speculation.

Before changing unfamiliar behavior:

- trace the current implementation
- identify the actual data flow
- identify relevant consumers
- inspect existing types/tests
- avoid guessing based only on UI symptoms

Make targeted changes rather than broad rewrites unless a broader refactor is clearly necessary.

If evidence is insufficient, report what is known and what still needs investigation rather than inventing a fix.

When asked only to investigate or review, remain read-only.
