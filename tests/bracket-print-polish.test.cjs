const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const page = read("app/bracket-challenge/[contestId]/bracket/page.tsx");
const makePicks = read("components/bracket/BracketMakePicks.tsx");
const topology = read("components/bracket/BracketTopologyPreview.tsx");
const route = read("app/api/bracket-challenge/contests/[contestId]/master-bracket/route.ts");
const css = read("app/globals.css");

test("editable Championship Total is part of the Championship game and retains the page save path", () => {
  assert.match(makePicks, /game\.roundKey === "championship"/);
  assert.match(makePicks, /Championship Total Points/);
  assert.match(makePicks, /Combined points scored by both teams\./);
  assert.match(makePicks, /championshipTiebreaker\.onSave/);
  assert.match(page, /value: tiebreakerValue/);
  assert.match(page, /onSave: \(\) => void handleTiebreakerSave\(\)/);
  assert.doesNotMatch(page, /mt-6 rounded-2xl border border-slate-700 bg-slate-900\/80 p-4/);
});

test("read-only Championship display uses the loaded bracket tiebreaker and omits missing values", () => {
  assert.match(topology, /game\.roundKey === "championship" && tiebreakerValue !== null/);
  assert.match(topology, /Tiebreaker:.*total points/s);
  assert.match(page, /tiebreakerValue=\{printingBlankBracket \|\| tiebreakerValue === "" \? null : Number\(tiebreakerValue\)\}/);
  assert.match(route, /picks: entry\.picks_snapshot \?\? \{\}/);
  assert.match(route, /tiebreakerValue: entry\.tiebreaker_value/);
});

test("Bracket View offers native Print / Save PDF without a PDF dependency", () => {
  assert.match(page, /Print \/ Save PDF/);
  assert.match(page, /Print Blank Bracket/);
  assert.match(page, /window\.print\(\)/);
  const packageJson = JSON.parse(read("package.json"));
  const dependencies = { ...packageJson.dependencies, ...packageJson.devDependencies };
  assert.ok(!Object.keys(dependencies).some((name) => /pdf/i.test(name)));
});

test("Bracket page retains the canonical direct AppNav sibling shell", () => {
  const home = read("app/bracket-challenge/page.tsx");
  const leaderboard = read("app/bracket-challenge/[contestId]/page.tsx");
  const live = read("app/bracket-challenge/[contestId]/live/page.tsx");
  for (const source of [home, leaderboard, live, page]) {
    assert.match(source, /<div className="mx-auto max-w-(?:5|7)xl space-y-6">\s*<AppNav \/>/);
  }
  assert.doesNotMatch(page, /bracket-screen-only"><AppNav/);
});

test("print styling uses a compact contiguous light print flow without topology-level pagination avoidance", () => {
  assert.match(css, /@media print/);
  assert.match(css, /@page \{ size: landscape; margin: 0\.5in; \}/);
  assert.match(page, /\/logos\/logo_all_sports\.png/);
  assert.match(page, /viewedEntrantName.*loadedBracketNumber/s);
  assert.match(css, /\.bracket-screen-only, \.bracket-screen-only \* \{ display: none !important; \}/);
  assert.match(css, /\.bracket-print-page \{ min-height: 0 !important; padding: 0 !important; background: #fff !important;/);
  assert.match(css, /\.bracket-print-shell \{ min-height: 0 !important;/);
  assert.match(css, /\.bracket-print-page \.app-desktop-nav, \.bracket-print-page \.app-mobile-nav-shield, \.bracket-print-page \.app-mobile-bottom-nav/);
  assert.match(css, /\.bracket-print-header \{ display: block; width: 92%; max-width: 9\.2in; margin: 0 auto 0\.08in;/);
  assert.match(css, /\.bracket-topology-preview \{ overflow: visible !important; width: 92% !important; max-width: 9\.2in;/);
  assert.match(css, /\.bracket-topology-preview > div \{ min-width: 0 !important; width: 100% !important;/);
  assert.doesNotMatch(css, /\.bracket-topology-preview \{[^}]*break-inside: avoid/s);
  assert.doesNotMatch(css, /\.bracket-topology-preview > div \{[^}]*break-inside: avoid/s);
  assert.match(css, /\.bracket-topology-preview article \{ break-inside: avoid; page-break-inside: avoid;/);
  assert.match(css, /\.bracket-topology-preview > div \{ height: 4\.7in; \}/);
  assert.match(css, /\.bracket-topology-preview \.bracket-round-games \{ position: relative; display: block !important;/);
  assert.match(css, /\.bracket-topology-preview \.bracket-round-games > article \{ position: absolute; top: calc\(var\(--bracket-position\) \* 100%\);/);
  assert.match(css, /\.bracket-topology-preview \.min-h-11 \{ min-height: 0\.38in !important;/);
  assert.match(css, /\.bracket-topology-preview button \{ border: 0 !important;/);
  assert.match(topology, /grid-cols-4/);
  assert.doesNotMatch(css, /\.bracket-print-header \{[^}]*break-after/s);
  assert.match(topology, /sourceAGameId, game\.sourceBGameId/);
  assert.match(topology, /feederPositions\.reduce/);
  assert.match(topology, /--bracket-position/);
  assert.match(topology, /bracket-round-games/);
});

test("blank printing reuses the topology with only the initial field and empty dependent rows", () => {
  assert.match(page, /const \[printMode, setPrintMode\] =/);
  assert.match(page, /handlePrint\("blank"\)/);
  assert.match(page, /picks=\{printingBlankBracket \? \{\} : picks\}/);
  assert.match(page, /<BracketTopologyPreview[\s\S]*picks=\{printingBlankBracket \? \{\} : picks\}/);
  assert.match(page, /tiebreakerValue=\{printingBlankBracket \|\| tiebreakerValue === "" \? null/);
  assert.match(page, /printingBlankBracket \? "Blank Bracket"/);
  assert.match(page, /window\.addEventListener\("afterprint", restorePrintMode\)/);
  assert.match(topology, /blankPrint\?: boolean/);
  assert.match(topology, /if \(blankPrint\)/);
  assert.match(topology, /label: "",/);
  assert.doesNotMatch(topology, /Write-in winner/);
  assert.match(topology, /if \(teamId\)/);
  assert.match(topology, /✓/);
  assert.doesNotMatch(topology, /insert\(|update\(|delete\(|fetch\(/);
});

test("selected managed and numbered brackets retain their loaded identity, including frozen history", () => {
  assert.match(page, /entrantId: selectedEntrantId/);
  assert.match(page, /bracketNumber: String\(bracketNumber\)/);
  assert.match(page, /loadedBracketNumber/);
  assert.match(page, /loadedEntrantName/);
  assert.match(route, /bracket_master_brackets\(bracket_number\)/);
  assert.match(route, /entrantName: entrant\?\.display_name \?\? null/);
  assert.match(route, /picks: entry\.picks_snapshot \?\? \{\}/);
});

test("printing relies on the existing authorized bracket response and does not alter lifecycle, scoring, or providers", () => {
  assert.match(route, /This bracket is private until the contest locks\./);
  assert.match(route, /shouldFreezeBracketEntry/);
  assert.doesNotMatch(page, /provider_event_id|result sync|scoreBracket|supabase/i);
  assert.doesNotMatch(topology, /fetch\(|window\.open/);
});
