import type { AppUser } from "@/lib/auth";
import { getBracketChallengeAccess } from "@/lib/bracket/access";
import { deriveBracketProfile, type BracketProfileEntry, type BracketProfileGame } from "@/lib/bracket/profile";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadBracketEntrantAvatars } from "@/lib/bracket/entrantAvatars";
import { resolveAuthorizedBracketContestId } from "@/lib/bracket/navigation";

export async function getBracketProfile(user: AppUser, requestedEntrantId: string | null, requestedContestId: string | null = null) {
  const access = await getBracketChallengeAccess(user);
  if (!access) return null;
  const entrantResult = requestedEntrantId
    ? await supabaseAdmin.from("bracket_entrants").select("id, display_name, entrant_kind, account_user_id, managing_user_id, claimed_at").eq("id", requestedEntrantId).maybeSingle()
    : await supabaseAdmin.from("bracket_entrants").select("id, display_name, entrant_kind, account_user_id, managing_user_id, claimed_at").eq("account_user_id", user.id).maybeSingle();
  if (entrantResult.error) throw new Error(`Failed to load bracket entrant: ${entrantResult.error.message}`);
  const entrant = entrantResult.data;
  if (!entrant) return { entrant: null, summary: null, history: [], achievements: null };
  const contestsResult = await supabaseAdmin.from("bracket_contests").select("id").eq("league_id", access.league.id);
  if (contestsResult.error) throw new Error(`Failed to load Group contests: ${contestsResult.error.message}`);
  const contestIds = (contestsResult.data ?? []).map((contest) => String(contest.id));
  if (!contestIds.length) return { entrant: null, summary: null, history: [], achievements: null };
  // The requested contest is navigation context only. It never narrows the
  // entrant's active-Group history or authorizes a contest in another Group.
  const navigationContestId = resolveAuthorizedBracketContestId(requestedContestId, contestIds);
  const participationResult = await supabaseAdmin.from("bracket_entries").select("id").in("contest_id", contestIds).eq("entrant_id", entrant.id).limit(1);
  if (participationResult.error) throw new Error(`Failed to load bracket participation: ${participationResult.error.message}`);
  if (!(participationResult.data ?? []).length) return { entrant: null, summary: null, history: [], achievements: null };
  const entriesResult = await supabaseAdmin.from("bracket_entries").select("id, entrant_id, contest_id, competition_id, locked_at, rules_snapshot, picks_snapshot, bracket_contests!inner(status), bracket_competitions!inner(season, name, status), bracket_master_brackets!inner(bracket_number, name)").in("contest_id", contestIds).not("locked_at", "is", null);
  if (entriesResult.error) throw new Error(`Failed to load bracket entries: ${entriesResult.error.message}`);
  const entryRows = (entriesResult.data ?? []) as any[];
  const finalRows = entryRows.filter((entry) => entry.locked_at && entry.bracket_contests?.status === "final" && entry.bracket_competitions?.status === "final");
  const competitionIds = [...new Set(finalRows.map((entry) => Number(entry.competition_id)))];
  const gamesResult = competitionIds.length
    ? await supabaseAdmin.from("bracket_games").select("id, competition_id, game_key, round_key, round_order, game_order, source_a_team_id, source_a_game_id, source_b_team_id, source_b_game_id, status, winner_team_id").in("competition_id", competitionIds)
    : { data: [], error: null };
  if (gamesResult.error) throw new Error(`Failed to load bracket games: ${gamesResult.error.message}`);
  const entries: BracketProfileEntry[] = finalRows.map((entry) => ({ id: Number(entry.id), entrantId: String(entry.entrant_id), contestId: String(entry.contest_id), competitionId: Number(entry.competition_id), bracketNumber: Number(entry.bracket_master_brackets?.bracket_number ?? 1), bracketName: entry.bracket_master_brackets?.name ?? null, season: Number(entry.bracket_competitions?.season), competitionName: String(entry.bracket_competitions?.name ?? "Bracket Challenge"), competitionStatus: String(entry.bracket_competitions?.status), contestStatus: String(entry.bracket_contests?.status), lockedAt: entry.locked_at, rulesSnapshot: entry.rules_snapshot, picks: entry.picks_snapshot }));
  const games: BracketProfileGame[] = (gamesResult.data ?? []).map((game: any) => ({ competitionId: Number(game.competition_id), id: Number(game.id), gameKey: game.game_key, roundKey: game.round_key, roundOrder: Number(game.round_order), gameOrder: Number(game.game_order), sourceATeamId: game.source_a_team_id, sourceAGameId: game.source_a_game_id === null ? null : Number(game.source_a_game_id), sourceBTeamId: game.source_b_team_id, sourceBGameId: game.source_b_game_id === null ? null : Number(game.source_b_game_id), status: game.status, winnerTeamId: game.winner_team_id }));
  const avatars = await loadBracketEntrantAvatars(supabaseAdmin, [{ id: entrant.id, entrant_kind: entrant.entrant_kind, account_user_id: entrant.account_user_id }]);
  return { entrant: { id: entrant.id, displayName: entrant.display_name, kind: entrant.entrant_kind, claimedAt: entrant.claimed_at, avatarUrl: avatars.get(entrant.id) ?? null }, navigationContestId, ...deriveBracketProfile(entries, games, entrant.id) };
}
