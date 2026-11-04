# Player Center local development

Use `/home/markwohlever/nba-fantasy-app` on `main` for ongoing development.
The E1 review candidate and E3A factual-readiness tooling have been reconciled into
this working tree. The recovery and maintenance work remain uncommitted; no PR or
production release has occurred.

Start the normal application from this directory:

```bash
cd /home/markwohlever/nba-fantasy-app
NEXT_PUBLIC_PLAYER_CENTER_ENABLED=true npm run dev -- --hostname 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000` and sign in normally. Do not start a second application
from a review worktree. This command uses the normal repository configuration and
does not copy the old isolated review server's proxy, authentication setup or flags.

`lib/player-center/feature.ts` enables Player Center in development unless
`NEXT_PUBLIC_PLAYER_CENTER_ENABLED=false`. The explicit process-only value above
ensures the enabled development path. Production remains gated by an explicit
build-time `true`; this document does not authorize a production flag change.
Public flags require a fresh development process when changed. No environment file
was modified during consolidation.

`NEXT_PUBLIC_PLAYER_CENTER_READ_ONLY_LOCAL=true` is a separate optional review mode,
not the normal draft workflow. It blocks database writes and RPC calls. Normal
development can reach the database configured by the existing local environment;
starting development does not make draft actions or authentication read-only.

The E1/E3A dated release documents remain historical review evidence. Later E3C
published only the separately authorized Curry NBA 2027 canary. E3D verified its
cache/service/components but could not complete authenticated or visual/mobile
acceptance without an existing session. Cache freshness is time-bound; this document
does not certify today's coverage or authorize another refresh/publication.

The complete main-checkout and E1-candidate backups, Git refs, source hashes, exact
reconciliation patch and validation receipts are in:

`/home/markwohlever/.local/share/111sports-recovery/consolidation-20261101T225930Z`

The original maintenance and review refs remain intact. Local `main` retains its
original commit, with the preserved repair files and reconciled candidate represented
as working-tree changes. No commit, branch-tip advancement, merge or push was needed.
Review these local changes before any future release assembly.

The E1 and older PR review worktrees are cleanup candidates only after their unique
state has been checked against this checkout and the verified backup. Do not remove
them automatically. Preserve the Bracket stash and both ShotCast worktrees. Factual
publication, full-pool acceptance, automatic refresh and production deployment still
require separately authorized steps.
