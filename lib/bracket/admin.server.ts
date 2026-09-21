import type { AppUser } from "@/lib/auth";
import { getBracketChallengeDetail } from "@/lib/bracket/challenge.server";
import { maybeFreezeContestEntry } from "@/lib/bracket/masterBracket.server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const VALID_STATUSES = new Set(["setup", "open", "locked", "in_progress", "final"]);
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const labelRound = (key: string) => key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function defaultRoundPoints(roundKeys: string[]) {
  const cfp = ["first_round", "quarterfinal", "semifinal", "championship"];
  return Object.fromEntries(roundKeys.map((key, index) => [key, cfp.indexOf(key) >= 0 ? [10, 20, 40, 80][cfp.indexOf(key)] : 0]));
}

function currentRoundPoints(snapshot: Record<string, unknown>, roundKeys: string[]) {
  const scoring = isRecord(snapshot.scoring) ? snapshot.scoring : {};
  const source = isRecord(scoring.roundPoints) ? scoring.roundPoints : isRecord(scoring.round_points) ? scoring.round_points : scoring;
  const defaults = defaultRoundPoints(roundKeys);
  return Object.fromEntries(roundKeys.map((key) => [key, typeof source[key] === "number" && Number.isFinite(source[key]) && source[key] >= 0 ? source[key] : defaults[key]]));
}

export async function requireBracketContestAdmin(user: AppUser, contestId: string) {
  const detail = await getBracketChallengeDetail(user, contestId);
  if (!detail) return { error: "Bracket Challenge not found for the active Group.", status: 404 as const };
  if (!detail.canAdministerGroup) return { error: "Group admin access required.", status: 403 as const };
  return { detail };
}

export async function getBracketContestAdmin(user: AppUser, contestId: string) {
  const access = await requireBracketContestAdmin(user, contestId);
  if ("error" in access) return access;
  const { detail } = access;
  const entries = await supabaseAdmin.from("bracket_entries").select("id, entrant_id, locked_at, picks_snapshot, bracket_entrants(entrant_kind)")
    .eq("contest_id", contestId).eq("competition_id", detail.competition.id);
  if (entries.error) throw new Error(`Failed to load contest summary: ${entries.error.message}`);
  const rows = entries.data ?? [];
  const gameCount = detail.games.length;
  const roundKeys = [...new Map(detail.games.sort((a, b) => a.roundOrder - b.roundOrder).map((game) => [game.roundKey, game.roundKey])).keys()];
  return { detail, settings: { status: detail.contest.status, lockAt: detail.contest.lockAt, maxBracketsPerEntrant: detail.contest.maxBracketsPerEntrant, managedEntrantsAllowed: detail.contest.managedEntrantsAllowed,
    roundPoints: currentRoundPoints(detail.contest.rulesSnapshot, roundKeys) }, rounds: roundKeys.map((key) => ({ key, label: labelRound(key) })),
    summary: { entrants: new Set(rows.map((row: any) => row.entrant_id)).size, entries: rows.length, frozen: rows.filter((row: any) => row.locked_at).length,
      complete: rows.filter((row: any) => Object.keys(row.picks_snapshot ?? {}).length === gameCount).length,
      incomplete: rows.filter((row: any) => Object.keys(row.picks_snapshot ?? {}).length < gameCount).length,
      managedEntrants: rows.filter((row: any) => row.bracket_entrants?.entrant_kind === "managed").length },
  };
}

export async function updateBracketContest(user: AppUser, contestId: string, input: unknown) {
  const access = await requireBracketContestAdmin(user, contestId);
  if ("error" in access) return access;
  if (!isRecord(input)) throw new Error("Invalid contest settings.");
  const { detail } = access;
  const roundKeys = [...new Set(detail.games.map((game) => game.roundKey))];
  const max = input.maxBracketsPerEntrant === undefined ? detail.contest.maxBracketsPerEntrant : Number(input.maxBracketsPerEntrant);
  if (!Number.isInteger(max) || max < 1) throw new Error("Max brackets per entrant must be a whole number of at least 1.");
  const managed = input.managedEntrantsAllowed === undefined ? detail.contest.managedEntrantsAllowed : input.managedEntrantsAllowed;
  if (typeof managed !== "boolean") throw new Error("Managed entrants setting must be true or false.");
  const status = input.status === undefined ? detail.contest.status : input.status;
  if (typeof status !== "string" || !VALID_STATUSES.has(status)) throw new Error("Invalid contest status.");
  const lockAt = input.lockAt === undefined ? detail.contest.lockAt : input.lockAt;
  if (lockAt !== null && (typeof lockAt !== "string" || Number.isNaN(new Date(lockAt).getTime()))) throw new Error("Lock time must be a valid date or empty.");
  const points = input.roundPoints === undefined ? currentRoundPoints(detail.contest.rulesSnapshot, roundKeys) : input.roundPoints;
  if (!isRecord(points)) throw new Error("Round scoring is required.");
  const roundPoints: Record<string, number> = {};
  for (const key of roundKeys) { const value = points[key]; if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) throw new Error(`${labelRound(key)} scoring must be a non-negative whole number.`); roundPoints[key] = value; }
  const currentLocked = ["locked", "in_progress", "final"].includes(detail.contest.status) || Boolean(detail.contest.lockAt && new Date(detail.contest.lockAt).getTime() <= Date.now());
  const nextLocked = ["locked", "in_progress", "final"].includes(status) || Boolean(lockAt && new Date(lockAt).getTime() <= Date.now());
  const entersLock = !currentLocked && nextLocked;
  if (entersLock && input.confirmLock !== true) throw new Error("Confirm the full contest lock before freezing admitted entries.");
  const existingScoring = isRecord(detail.contest.rulesSnapshot.scoring) ? detail.contest.rulesSnapshot.scoring : {};
  const nextRules = { ...detail.contest.rulesSnapshot, scoring: { ...existingScoring, roundPoints } };
  const update = await supabaseAdmin.from("bracket_contests").update({ status, lock_at: lockAt, max_brackets_per_entrant: max, managed_entrants_allowed: managed,
    rules_snapshot: nextRules, rules_version: detail.contest.rulesVersion + 1, updated_at: new Date().toISOString() }).eq("id", contestId).eq("league_id", detail.league.id);
  if (update.error) throw new Error(`Failed to update contest settings: ${update.error.message}`);
  if (entersLock) {
    const entries = await supabaseAdmin.from("bracket_entries").select("id").eq("contest_id", contestId).is("locked_at", null);
    if (entries.error) throw new Error(`Contest was updated but existing entries could not be frozen: ${entries.error.message}`);
    await Promise.all((entries.data ?? []).map((entry) => maybeFreezeContestEntry({ entryId: Number(entry.id), contestStatus: status, contestLockAt: lockAt })));
  }
  return getBracketContestAdmin(user, contestId);
}
