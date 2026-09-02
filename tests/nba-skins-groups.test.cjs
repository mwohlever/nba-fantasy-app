/* eslint-disable @typescript-eslint/no-require-imports */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

require.extensions[".ts"] = function compile(module, filename) {
  module._compile(ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText, filename);
};

const {
  buildNbaSkinsSnakeSlots,
  getNbaSkinsTotalPicks,
  isCompleteNbaSkinsDraft,
  selectNbaSkinsSeasonTeamIds,
  validateNbaSkinsDraftOrder,
} = require("../lib/nbaSkins/policy.ts");
const {
  getDefaultNbaSkinsRules,
  resolveNbaSkinsRules,
} = require("../lib/rules/leagueRules.ts");
const { canAccessOwnedResource } = require("../lib/security/resourcePolicy.ts");
const root = path.resolve(__dirname, "..");
const source = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("season participants remain Group-scoped while preserving referenced historical teams", () => {
  assert.deepEqual(selectNbaSkinsSeasonTeamIds({
    groupTeamIds: [1, 2, 3, 4, 5],
    activeTeamIds: [1, 2, 3, 4],
    referencedTeamIds: [1, 2, 3, 5, 99],
  }), [1, 2, 3, 5]);
  assert.deepEqual(selectNbaSkinsSeasonTeamIds({
    groupTeamIds: [11, 12, 13, 14],
    activeTeamIds: [11, 12, 13, 14],
    referencedTeamIds: [],
  }), [11, 12, 13, 14]);
});

test("NBA Skins rules default to legacy 4 x 7 and resolve independently per league", () => {
  assert.deepEqual(getDefaultNbaSkinsRules(), {
    participantCount: 4,
    nbaTeamsPerParticipant: 7,
  });
  assert.deepEqual(resolveNbaSkinsRules({}), {
    participantCount: 4,
    nbaTeamsPerParticipant: 7,
  });
  assert.deepEqual(resolveNbaSkinsRules({
    draft: { participantCount: 5, nbaTeamsPerParticipant: 6 },
  }), {
    participantCount: 5,
    nbaTeamsPerParticipant: 6,
  });
  assert.deepEqual(resolveNbaSkinsRules({
    draft: { participantCount: 6, nbaTeamsPerParticipant: 5 },
  }), {
    participantCount: 6,
    nbaTeamsPerParticipant: 5,
  });
});

test("draft order validates the configured active participant subset", () => {
  assert.equal(validateNbaSkinsDraftOrder([1, 2, 3, 4], [1, 2, 3, 4, 5, 6], 4), true);
  assert.equal(validateNbaSkinsDraftOrder([1, 2, 3, 4, 5], [1, 2, 3, 4, 5, 6], 5), true);
  assert.equal(validateNbaSkinsDraftOrder([1, 2, 3, 99], [1, 2, 3, 4, 5, 6], 4), false);
  assert.equal(validateNbaSkinsDraftOrder([1, 2, 3, 3], [1, 2, 3, 4, 5, 6], 4), false);
  assert.equal(validateNbaSkinsDraftOrder([1, 2, 3], [1, 2, 3, 4, 5, 6], 4), false);
  assert.equal(validateNbaSkinsDraftOrder([1, 2, 3, 6], [1, 2, 3, 4, 5], 4), false);
});

test("draft totals and completion derive from each season's frozen format", () => {
  assert.equal(getNbaSkinsTotalPicks({ participantCount: 4, nbaTeamsPerParticipant: 7 }), 28);
  assert.equal(getNbaSkinsTotalPicks({ participantCount: 5, nbaTeamsPerParticipant: 6 }), 30);
  assert.equal(getNbaSkinsTotalPicks({ participantCount: 6, nbaTeamsPerParticipant: 5 }), 30);
  assert.equal(isCompleteNbaSkinsDraft({
    pickCount: 28,
    participantCount: 4,
    nbaTeamsPerParticipant: 7,
  }), true);
  assert.equal(isCompleteNbaSkinsDraft({
    pickCount: 28,
    participantCount: 5,
    nbaTeamsPerParticipant: 6,
  }), false);
  assert.equal(isCompleteNbaSkinsDraft({
    pickCount: 30,
    participantCount: 5,
    nbaTeamsPerParticipant: 6,
  }), true);
});

test("snake draft slots support variable participant and round counts", () => {
  const fourBySeven = buildNbaSkinsSnakeSlots([1, 2, 3, 4], 7);
  assert.equal(fourBySeven.length, 28);
  assert.deepEqual(fourBySeven.slice(0, 8).map((slot) => slot.teamId), [1, 2, 3, 4, 4, 3, 2, 1]);

  const fiveBySix = buildNbaSkinsSnakeSlots([11, 12, 13, 14, 15], 6);
  assert.equal(fiveBySix.length, 30);
  assert.deepEqual(fiveBySix.slice(0, 10).map((slot) => slot.teamId), [
    11, 12, 13, 14, 15, 15, 14, 13, 12, 11,
  ]);
  assert.equal(fiveBySix.at(-1).round, 6);
});

test("commissioner season mutations are target-Group scoped and Super Admin remains broader", () => {
  const base = {
    isSuperAdmin: false,
    activeGroupId: "group-a",
    targetGroupId: "group-a",
    canAdministerActiveGroup: true,
    requireCommissioner: true,
    activeLeagueIds: ["skins-a"],
    targetLeagueId: "skins-a",
  };
  assert.equal(canAccessOwnedResource(base), true);
  assert.equal(canAccessOwnedResource({ ...base, targetGroupId: "group-b", targetLeagueId: "skins-b" }), false);
  assert.equal(canAccessOwnedResource({ ...base, isSuperAdmin: true, targetGroupId: "group-b", targetLeagueId: "skins-b" }), true);
});

test("standings, draft, and admin resolve league-owned seasons without hardcoded owners", () => {
  for (const file of [
    "app/api/nba-skins/standings/route.ts",
    "app/api/nba-skins/draft/route.ts",
    "app/api/admin/nba-skins/route.ts",
  ]) {
    const contents = source(file);
    assert.match(contents, /league_id/);
    assert.doesNotMatch(contents, /OWNER_NAMES/);
    assert.doesNotMatch(contents, /currentUser\.teamId/);
  }
  assert.match(source("app/api/nba-skins/standings/route.ts"), /getNbaSkinsAccess/);
  assert.match(source("app/api/nba-skins/draft/route.ts"), /authorizeNbaSkinsSeasonResource/);
  assert.match(source("app/api/admin/nba-skins/route.ts"), /league_id:\s*auth\.access\.league\.id/);
});

test("profile history remains active-league scoped and pre-2026 draft rounds remain guarded", () => {
  const profile = source("app/api/nba-skins/profile/route.ts");
  const profilePage = source("app/nba-skins/profile/page.tsx");
  const standings = source("app/api/nba-skins/standings/route.ts");
  assert.match(profile, /getActiveLeagueForSport/);
  assert.match(profile, /\.eq\(\s*"league_id",\s*activeLeague\.league\.id/);
  assert.match(profile, /teamBelongsToGroup/);
  assert.match(profilePage, /me\.groupContext\?\.team\?\.id/);
  assert.doesNotMatch(profilePage, /: currentUser\.teamId/);
  assert.match(standings, /selectedSeason\.season >= 2026 \? pick\.draft_round : null/);
});

test("projection refresh updates every complete current-year Group season by season ID", () => {
  const cron = source("app/api/cron/refresh-nba-skins/route.ts");
  assert.match(cron, /findRefreshSeasons/);
  assert.match(cron, /seasons\.flatMap/);
  assert.match(cron, /season_id:\s*targetSeason\.id/);
  assert.match(cron, /\.in\(\s*"season_id"/);
  assert.match(cron, /season\.participant_count/);
  assert.match(cron, /season\.nba_teams_per_participant/);
  assert.doesNotMatch(cron, /count\s*===\s*28/);
});

test("phased migration adds scoped uniqueness before removing global uniqueness", () => {
  const phaseA = source("supabase/migrations/20260903_nba_skins_group_scope_phase_a.sql");
  const phaseB = source("supabase/migrations/20260906_nba_skins_group_scope_phase_b.sql");
  assert.match(phaseA, /unique \(league_id, season\)/i);
  assert.doesNotMatch(phaseA, /drop constraint.*season_key/is);
  assert.match(phaseB, /where league_id is null/i);
  assert.match(phaseB, /alter column league_id set not null/i);
  assert.match(phaseB, /drop constraint if exists nba_skins_seasons_season_key/i);
});

test("season creation snapshots league rules and validates Group-owned active participants", () => {
  const admin = source("app/api/admin/nba-skins/route.ts");
  assert.match(admin, /resolveNbaSkinsRules\(auth\.access\.league\.settings\)/);
  assert.match(admin, /participant_count:\s*rules\.participantCount/);
  assert.match(admin, /nba_teams_per_participant:\s*rules\.nbaTeamsPerParticipant/);
  assert.match(admin, /validateNbaSkinsDraftOrder\([\s\S]*auth\.access\.participants/);
  assert.match(admin, /participantTeamIds\.map/);
  assert.match(admin, /Season participants are frozen when the season is created/);
});

test("league rule updates are Group- and league-scoped", () => {
  const groupsAdmin = source("app/api/admin/groups/route.ts");
  assert.match(groupsAdmin, /action === "update_nba_skins_rules"/);
  assert.match(groupsAdmin, /requireGroupAdmin\(user, groupId\)/);
  assert.match(groupsAdmin, /\.eq\("id", leagueId\)\.eq\("group_id", groupId\)/);
  assert.match(groupsAdmin, /sport_key !== "nba_skins"/);
  assert.match(groupsAdmin, /participantCount \* nbaTeamsPerParticipant/);
});

test("active NBA Skins runtime uses season configuration instead of fixed draft sizes", () => {
  for (const file of [
    "app/api/admin/nba-skins/route.ts",
    "app/api/nba-skins/draft/route.ts",
    "app/api/nba-skins/standings/route.ts",
    "app/api/cron/refresh-nba-skins/route.ts",
    "app/nba-skins/draft/page.tsx",
  ]) {
    const contents = source(file);
    assert.doesNotMatch(contents, /count\s*===\s*28/, file);
    assert.doesNotMatch(contents, /length\s*===\s*4/, file);
    assert.doesNotMatch(contents, /length\s*!==\s*4/, file);
  }
  const draft = source("app/api/nba-skins/draft/route.ts");
  assert.match(draft, /buildSnakeOwners\(orderedTeams, Number\(selectedSeason\.nba_teams_per_participant\)\)/);
  assert.match(draft, /buildNbaSkinsSnakeSlots/);
  assert.match(draft, /getNbaSkinsTotalPicks/);
});

test("NBA Skins Home subtitle uses season or league configuration instead of a hardcoded seven", () => {
  const standings = source("app/api/nba-skins/standings/route.ts");
  const home = source("app/nba-skins/page.tsx");
  assert.match(standings, /resolveNbaSkinsRules\(access\.league\.settings\)/);
  assert.match(standings, /selectedSeason:\s*null,[\s\S]*rules/);
  assert.match(home, /season\?\.nbaTeamsPerParticipant\s*\?\?/);
  assert.match(home, /data\?\.rules\.nbaTeamsPerParticipant/);
  assert.match(home, /\$\{teamsPerParticipant\} Wins \/ Losses selections/);
  assert.doesNotMatch(home, /nbaTeamsPerParticipant \?\? 7/);
});

test("NBA Skins admin handles an enabled Group with no season", () => {
  const admin = source("app/admin/nba-skins/page.tsx");
  assert.match(admin, /if \(!nextSeason\) \{\s*setOrder\(\[\]\)/);
  assert.match(admin, /selectedSeason \? \(/);
  assert.match(admin, /New NBA Skins Year/);
  assert.match(admin, /active Group \{data\.teams\.length === 1 \? "member is" : "members are"\} available/);
});

test("config migration freezes legacy seasons at 4 x 7 and removes fixed draft bounds", () => {
  const migration = source("supabase/migrations/20260905_nba_skins_configurable_drafts.sql");
  assert.match(migration, /participant_count = coalesce\(participant_count, 4\)/i);
  assert.match(migration, /nba_teams_per_participant = coalesce\(nba_teams_per_participant, 7\)/i);
  assert.match(migration, /participant_count \* nba_teams_per_participant <= 30/i);
  assert.match(migration, /check \(draft_position >= 1\)/i);
  assert.match(migration, /check \(draft_round is null or draft_round >= 1\)/i);
});

test("NBA Skins routes introduce no notification workflow", () => {
  for (const file of [
    "app/api/nba-skins/standings/route.ts",
    "app/api/nba-skins/draft/route.ts",
    "app/api/admin/nba-skins/route.ts",
    "app/api/cron/refresh-nba-skins/route.ts",
  ]) {
    assert.doesNotMatch(source(file), /notification|sendPush|draft_turn/i, file);
  }
});
