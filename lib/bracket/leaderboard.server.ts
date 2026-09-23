import type { AppUser } from "@/lib/auth";
import { getBracketChallengeDetail } from "@/lib/bracket/challenge.server";
import { shouldFreezeBracketEntry } from "@/lib/bracket/lifecycle";
import { bracketTopologyFromRows } from "@/lib/bracket/persistence";
import { bracketResultsFromOfficialGames, bracketScoringRulesFromSnapshot, scoreBracket } from "@/lib/bracket/scoring";
import type { BracketPicks } from "@/lib/bracket/types";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadBracketEntrantAvatars } from "@/lib/bracket/entrantAvatars";
import { bracketInsightVisibility } from "@/lib/bracket/insights";

type Entrant = { id: string; display_name: string; entrant_kind: "account" | "managed"; account_user_id: string | null; managing_user_id: string | null };
type Master = { bracket_number: number; name: string | null };
type ParticipationEntry = { id: number; entrant_id: string; master_bracket_id: string; status: string; locked_at: string | null; bracket_entrants: Entrant | null; bracket_master_brackets: Master | null };
type FrozenEntry = ParticipationEntry & { rules_snapshot: Record<string, unknown> | null; picks_snapshot: BracketPicks | null };

const roundLabel = (key: string) => key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function roundData(games: Array<{ roundKey: string; roundOrder: number }>) {
  return games.map((game) => ({ key: game.roundKey, label: roundLabel(game.roundKey), order: game.roundOrder }))
    .filter((round, index, all) => all.findIndex((other) => other.key === round.key) === index);
}

/**
 * Group-scoped contest read model. Before the public lock boundary it returns
 * only admitted-entry participation metadata. Pick content, tiebreakers, and
 * pick-derived scoring data never cross this server boundary before lock.
 */
export async function getBracketContestLeaderboard(user: AppUser, contestId: string) {
  const detail = await getBracketChallengeDetail(user, contestId);
  if (!detail) return null;
  const contestLocked = shouldFreezeBracketEntry({ contestStatus: detail.contest.status, contestLockAt: detail.contest.lockAt });
  const entryFields = contestLocked
    ? "id, entrant_id, master_bracket_id, status, locked_at, rules_snapshot, picks_snapshot, bracket_entrants(id, display_name, entrant_kind, account_user_id, managing_user_id), bracket_master_brackets(bracket_number, name)"
    : "id, entrant_id, master_bracket_id, status, locked_at, bracket_entrants(id, display_name, entrant_kind, account_user_id, managing_user_id), bracket_master_brackets(bracket_number, name)";
  const entriesResult = await supabaseAdmin.from("bracket_entries").select(entryFields)
    .eq("contest_id", contestId).eq("competition_id", detail.competition.id).order("created_at");
  if (entriesResult.error) throw new Error(`Failed to load contest entries: ${entriesResult.error.message}`);
  const entries = (entriesResult.data ?? []) as unknown as ParticipationEntry[];
  const insightVisibility = bracketInsightVisibility(
    { contestStatus: detail.contest.status, contestLockAt: detail.contest.lockAt },
    contestLocked ? (entries as FrozenEntry[]).map((entry) => ({
      id: entry.id, entrantId: entry.entrant_id, lockedAt: entry.locked_at,
      picks: entry.picks_snapshot, rulesSnapshot: entry.rules_snapshot,
    })) : [],
  );
  const picksVisible = insightVisibility.pool === "available";
  const entrantAvatars = await loadBracketEntrantAvatars(
    supabaseAdmin,
    [...new Map(entries.flatMap((entry) => entry.bracket_entrants
      ? [[entry.entrant_id, { ...entry.bracket_entrants, id: entry.entrant_id }] as const]
      : [],
    )).values()],
  );
  const masterIds = entries.map((entry) => entry.master_bracket_id);
  const picksResult = masterIds.length
    ? await supabaseAdmin.from("bracket_master_picks").select("master_bracket_id").eq("competition_id", detail.competition.id).in("master_bracket_id", masterIds)
    : { data: [], error: null };
  if (picksResult.error) throw new Error(`Failed to load bracket completion: ${picksResult.error.message}`);
  const pickCountByMaster = new Map<string, number>();
  for (const pick of picksResult.data ?? []) pickCountByMaster.set(pick.master_bracket_id, (pickCountByMaster.get(pick.master_bracket_id) ?? 0) + 1);
  const complete = (entry: ParticipationEntry) => (pickCountByMaster.get(entry.master_bracket_id) ?? 0) === detail.games.length;
  const participation = entries.map((entry) => ({
    entryId: entry.id,
    entrantId: entry.entrant_id,
    entrantName: entry.bracket_entrants?.display_name ?? "Entrant",
    entrantKind: entry.bracket_entrants?.entrant_kind ?? "account",
    avatarUrl: entrantAvatars.get(entry.entrant_id) ?? null,
    bracketNumber: entry.bracket_master_brackets?.bracket_number ?? 1,
    bracketName: entry.bracket_master_brackets?.name ?? null,
    completionState: entry.locked_at ? "locked" : complete(entry) ? "complete" : "in_progress",
    isMine: entry.bracket_entrants?.account_user_id === user.id || entry.bracket_entrants?.managing_user_id === user.id,
  }));
  const personal = participation.filter((entry) => entry.isMine);
  const personalSummary = { totalBrackets: personal.length, completeBrackets: personal.filter((entry) => entry.completionState === "complete" || entry.completionState === "locked").length };
  if (!picksVisible) return { detail, picksVisible: false, poolVisibility: insightVisibility.pool, rounds: roundData(detail.games), participation, personalSummary, standings: [] as never[] };

  const topology = bracketTopologyFromRows(detail.games.map((game) => ({ id: game.id, game_key: game.gameKey, round_key: game.roundKey, round_order: game.roundOrder, game_order: game.gameOrder, source_a_team_id: game.sourceATeamId, source_a_game_id: game.sourceAGameId, source_b_team_id: game.sourceBTeamId, source_b_game_id: game.sourceBGameId })));
  const results = bracketResultsFromOfficialGames(detail.games.map((game) => ({ gameId: game.gameKey, status: game.status, winnerTeamId: game.winnerTeamId })));
  const teamNameById = new Map(detail.teams.map((team) => [team.providerTeamId, team.displayName]));
  const championGame = [...topology.games].sort((a, b) => b.roundOrder - a.roundOrder || b.gameOrder - a.gameOrder)[0];
  const standings = (entries as FrozenEntry[]).map((entry, index) => {
    const picks = entry.picks_snapshot ?? {};
    const score = scoreBracket(topology, picks, results, bracketScoringRulesFromSnapshot(entry.rules_snapshot, topology));
    return { ...participation[index], pointsEarned: score.pointsEarned, maxPossibleScore: score.maxPossibleScore, correctPicks: score.correctPicks, incorrectPicks: score.incorrectPicks, pendingPicks: score.pendingPicks, eliminatedPicks: score.eliminatedPicks, unmadePicks: score.unmadePicks, championPick: championGame && picks[championGame.id] ? teamNameById.get(picks[championGame.id]!) ?? picks[championGame.id] : null, canViewBracket: Boolean(entry.locked_at) };
  }).sort((a, b) => b.pointsEarned - a.pointsEarned || a.entrantName.localeCompare(b.entrantName) || a.bracketNumber - b.bracketNumber);
  let priorPoints: number | null = null;
  let rank = 0;
  return { detail, picksVisible: true, poolVisibility: insightVisibility.pool, rounds: roundData(detail.games), participation: [] as never[], personalSummary, standings: standings.map((entry, index) => { if (entry.pointsEarned !== priorPoints) rank = index + 1; priorPoints = entry.pointsEarned; return { ...entry, rank }; }) };
}
