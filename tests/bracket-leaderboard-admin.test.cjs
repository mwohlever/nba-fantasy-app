const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("pre-lock leaderboard returns admitted-entry participation only", () => {
  const source = read("lib/bracket/leaderboard.server.ts");
  assert.match(source, /from\("bracket_entries"\)\.select\(entryFields\)/);
  assert.match(source, /\.eq\("contest_id", contestId\)\.eq\("competition_id", detail\.competition\.id\)/);
  assert.match(source, /const entryFields = picksVisible/);
  assert.match(source, /if \(!picksVisible\) return \{ detail, picksVisible: false/);
  assert.match(source, /picksVisible: false/);
  assert.match(source, /participation/);
  assert.match(source, /bracket_master_picks/);
  assert.match(source, /standings: \[\] as never\[\]/);
  assert.match(source, /: "id, entrant_id, master_bracket_id, status, locked_at, bracket_entrants/);
  assert.doesNotMatch(source, /: "id, entrant_id, master_bracket_id, status, locked_at, [^"]*picks_snapshot/);
});

test("public standings score frozen picks and frozen rules through the authoritative scorer", () => {
  const source = read("lib/bracket/leaderboard.server.ts");
  assert.match(source, /const picks = entry\.picks_snapshot \?\? \{\}/);
  assert.match(source, /scoreBracket\(topology, picks, results, bracketScoringRulesFromSnapshot\(entry\.rules_snapshot, topology\)\)/);
  assert.match(source, /b\.pointsEarned - a\.pointsEarned/);
  assert.match(source, /if \(entry\.pointsEarned !== priorPoints\) rank = index \+ 1/);
});

test("personal pre-lock completion is a real aggregate, not a bracket inventory", () => {
  const source = read("lib/bracket/leaderboard.server.ts");
  const home = read("app/bracket-challenge/[contestId]/page.tsx");
  assert.match(source, /const personal = participation\.filter\(\(entry\) => entry\.isMine\)/);
  assert.match(source, /totalBrackets: personal\.length/);
  assert.match(source, /completeBrackets: personal\.filter/);
  assert.match(home, /completeBrackets.*totalBrackets/s);
  assert.match(home, /data\.participation\.map/);
  assert.doesNotMatch(home, /data\.entries/);
});

test("Bracket Challenge contest navigation has four canonical destinations and no More tab", () => {
  const nav = read("components/AppNav.tsx");
  assert.match(nav, /href: "\/bracket-challenge",\s*label: "Home"/);
  assert.ok(nav.includes("href: `/bracket-challenge/${bracketContestId}`,\n                label: \"Leaderboard\""));
  assert.ok(nav.includes("href: `/bracket-challenge/${bracketContestId}/bracket`,\n                label: \"Bracket\""));
  assert.ok(nav.includes("href: `/bracket-challenge/${bracketContestId}/live`,\n                label: \"Live Scores\""));
  assert.match(nav, /isBracketChallenge\s*\? "grid-cols-4"/);
  assert.match(nav, /!isNcaaPickEm && !isNbaSkins && !isBracketChallenge && mobileMoreOpen/);
  assert.match(nav, /!isNcaaPickEm && !isNbaSkins && !isBracketChallenge \? \(/);
});

test("Bracket Challenge Home keeps the four-cell shell while contest tabs are unavailable", () => {
  const nav = read("components/AppNav.tsx");
  const css = read("app/globals.css");

  assert.match(nav, /label: "Home",\s*icon: "⌂"/);
  assert.match(nav, /label: "Leaderboard",\s*icon: "▦",\s*disabled: true/);
  assert.match(nav, /label: "Bracket",\s*icon: "✎",\s*disabled: true/);
  assert.match(nav, /label: "Live Scores",\s*icon: "◫",\s*disabled: true/);
  assert.match(nav, /link\.disabled \? \(/);
  assert.match(nav, /aria-disabled="true"/);
  assert.doesNotMatch(nav, /isBracketChallenge && !bracketContestId\) \? \(/);
  assert.match(nav, /isBracketChallenge\s*\? "grid-cols-4"/);
  assert.match(nav, /app-bracket-challenge-mobile-nav-row/);
  assert.match(css, /\.app-bracket-challenge-mobile-nav-row\s*\{\s*height: 42px;/);
  assert.match(css, /\.app-bracket-challenge-mobile-nav \.app-mobile-nav-item\s*\{\s*height: 42px;/);
  assert.match(css, /\.app-bracket-challenge-mobile-nav \.app-mobile-nav-label[\s\S]*white-space: nowrap/);
  assert.match(css, /\.app-bracket-challenge-mobile-nav \.app-mobile-nav-label[\s\S]*text-overflow: ellipsis/);
  assert.match(css, /\.app-mobile-nav-disabled\s*\{\s*pointer-events: none;/);
});

test("Bracket Challenge keeps AppNav's established fixed mobile navigation path", () => {
  const nav = read("components/AppNav.tsx");
  const home = read("app/bracket-challenge/page.tsx");
  const leaderboard = read("app/bracket-challenge/[contestId]/page.tsx");
  const bracket = read("app/bracket-challenge/[contestId]/bracket/page.tsx");
  const live = read("app/bracket-challenge/[contestId]/live/page.tsx");

  assert.doesNotMatch(nav, /createPortal|document\.body|mobileNavMounted/);
  assert.match(nav, /app-mobile-bottom-nav fixed bottom-\[-42px\]/);
  assert.match(nav, /app-mobile-nav-shield pointer-events-none fixed bottom-\[-52px\]/);
  for (const page of [home, leaderboard, bracket, live]) {
    assert.match(page, /<AppNav \/>/);
  }
});

test("all Bracket Challenge pages keep AppNav and following page content in the canonical space-y-6 sibling context", () => {
  const home = read("app/bracket-challenge/page.tsx");
  const leaderboard = read("app/bracket-challenge/[contestId]/page.tsx");
  const bracket = read("app/bracket-challenge/[contestId]/bracket/page.tsx");
  const live = read("app/bracket-challenge/[contestId]/live/page.tsx");

  assert.match(home, /mx-auto max-w-5xl space-y-6/);
  assert.match(leaderboard, /mx-auto max-w-5xl space-y-6/);
  assert.match(bracket, /mx-auto max-w-7xl space-y-6/);
  assert.match(live, /mx-auto max-w-5xl space-y-6/);
});

test("contest pages rely on AppNav rather than a duplicate local primary navigation", () => {
  const leaderboard = read("app/bracket-challenge/[contestId]/page.tsx");
  const live = read("app/bracket-challenge/[contestId]/live/page.tsx");
  assert.match(leaderboard, /<AppNav \/>/);
  assert.doesNotMatch(leaderboard, /aria-label="Bracket Challenge"/);
  assert.match(live, /import AppNav from "@\/components\/AppNav"/);
  assert.match(live, /<AppNav \/>/);
});

test("authorized account menus expose contextual Bracket Challenge settings outside participant tabs", () => {
  const desktop = read("components/AppNav.tsx");
  const mobile = read("components/MobileAccountMenu.tsx");
  assert.match(desktop, /isBracketChallenge && bracketContestId/);
  assert.match(desktop, /Bracket Challenge settings/);
  assert.match(mobile, /groupContext\?\.canAdministerGroup/);
  assert.match(mobile, /bracketContestId/);
  assert.match(mobile, /Bracket Challenge settings/);
});

test("commissioner mutations are Group-authorized, validate current rules, and preserve frozen history", () => {
  const source = read("lib/bracket/admin.server.ts");
  assert.match(source, /detail\.canAdministerGroup/);
  assert.match(source, /max < 1/);
  assert.match(source, /Number\.isFinite\(value\) \|\| value < 0 \|\| !Number\.isInteger\(value\)/);
  assert.match(source, /rules_snapshot: nextRules/);
  assert.match(source, /maybeFreezeContestEntry/);
  assert.doesNotMatch(source, /from\("bracket_entries"\)\.update\(\{[^}]*rules_snapshot/s);
});

test("direct frozen-bracket reads enforce the same contest and pre-lock privacy scope", () => {
  const source = read("app/api/bracket-challenge/contests/[contestId]/master-bracket/route.ts");
  assert.match(source, /\.eq\("contest_id", contestId\)\.eq\("competition_id", resolved\.challenge\.competition\.id\)/);
  assert.match(source, /This bracket is private until the contest locks/);
  assert.match(source, /shouldFreezeBracketEntry/);
});
