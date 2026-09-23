const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const bracket = read("app/bracket-challenge/[contestId]/bracket/page.tsx");
const leaderboard = read("app/bracket-challenge/[contestId]/page.tsx");
const dialog = read("components/ui/TextEntryDialog.tsx");
const edit = read("components/ui/EditNameButton.tsx");

test("bracket naming and managed entrant creation share a styled form dialog", () => {
  assert.doesNotMatch(bracket, /window\.prompt\(/);
  assert.match(bracket, /nameDialog === "rename" \? <TextEntryDialog/);
  assert.match(bracket, /nameDialog === "entrant" \? <TextEntryDialog/);
  assert.match(bracket, /onSubmit=\{handleRename\}/);
  assert.match(bracket, /onSubmit=\{handleAddManagedEntrant\}/);
  assert.match(bracket, /emptyError="Enter an entrant name\."/);
  assert.match(bracket, /bracketNumber: loadedBracketNumber/);
});

test("edit controls remain tied to the server-authorized viewed bracket and owned participation rows", () => {
  assert.match(bracket, /masterBracketId && canRename \? <EditNameButton/);
  assert.match(leaderboard, /entry\.isMine \? <EditNameButton/);
  assert.match(leaderboard, /entry\.entryId === renameEntry\.entryId/);
  assert.match(edit, /aria-label=\{`Rename \$\{label\}`\}/);
  assert.match(edit, /h-8 w-8 shrink-0/);
});

test("dialog supports clearing, validation, safe mobile focus, and inline save errors", () => {
  assert.match(dialog, /dialog\.showModal\(\)/);
  assert.match(dialog, /maxLength = 80/);
  assert.match(dialog, /const next = value\.trim\(\)/);
  assert.match(dialog, /if \(!next && emptyError\)/);
  assert.match(dialog, /await onSubmit\(next\)/);
  assert.match(dialog, /catch \(reason\)/);
  assert.match(dialog, /window\.matchMedia\("\(pointer: fine\)"\)/);
  assert.match(dialog, /autoFocus onClick=\{onClose\}/);
  assert.match(dialog, /w-\[calc\(100%-2rem\)\]/);
  assert.match(dialog, /max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(bracket, /flex max-w-full flex-wrap items-center gap-2/);
});
