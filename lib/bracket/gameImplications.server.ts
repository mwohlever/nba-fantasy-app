import "server-only";
import type { AppUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getBracketChallengeDetail } from "./challenge.server";
import { bracketInsightVisibility } from "./insights";
import { bracketContestLockContext, type BracketContestLockContext } from "./lifecycle";
import { bracketTopologyFromRows } from "./persistence";
import { bracketResultsFromOfficialGames, bracketScoringRulesFromSnapshot } from "./scoring";
import { deriveGameImplications, type GameImplications } from "./gameImplications";
import { validateBracketPicks } from "./topology";
import type { BracketPicks } from "./types";

export type ImplicationSubject = {
  contestId: string; competitionId: number; entryId: number | null; masterBracketId: string;
  entrantId: string; bracketNumber: number; label: string; snapshotStatus: "frozen" | "draft" | "pending";
  entrantName: string; isAccountOwner: boolean;
};
export type ImplicationSelection = { entryId?: number; entrantId?: string; bracketNumber?: number };
export type ImplicationsResponse = {
  groupId: string; contestId: string; competitionId: number; subjects: ImplicationSubject[];
  subject: ImplicationSubject | null; poolState: "pre_lock" | "freezing" | "available";
  contestLock: BracketContestLockContext;
  readiness: "selection_required" | "snapshot_pending" | "available";
  game: { gameId: string; bracketGameId: number; providerEventId: string | null; officialStatus: string; officialWinner: string | null } | null;
  analysis: GameImplications | null; teamNames: Record<string, string>;
  freshness: { readAt: string; topologyVersion: number; resultsVersion: string };
};
type Entrant = { id: string; display_name: string; account_user_id: string | null; managing_user_id: string | null; is_active: boolean };
type Master = { id: string; competition_id: number; entrant_id: string; bracket_number: number; name: string | null };
type Entry = { id: number; entrant_id: string; master_bracket_id: string; locked_at: string | null;
  picks_snapshot: BracketPicks | null; rules_snapshot: Record<string, unknown> | null;
  bracket_entrants: Entrant | Entrant[] | null; bracket_master_brackets: Master | Master[] | null };
const one = <T,>(value: T | T[] | null): T | null => Array.isArray(value) ? value[0] ?? null : value;

/** Uses the same contest/active Group access boundary as existing insights. All reads; no admission or freezing. */
export async function getBracketGameImplications(user: AppUser, contestId: string, request: ImplicationSelection & { gameId?: string }) {
  const detail = await getBracketChallengeDetail(user, contestId);
  if (!detail) return null;
  if (detail.competition.sportKey !== "college_football" || detail.competition.formatKey !== "cfp")
    return { error: "Game implications are available for CFP only." };
  const game = request.gameId ? detail.games.find((row) => row.gameKey === request.gameId) : null;
  if (request.gameId && !game) return { error: "Game not found in this competition." };
  const lock = { contestStatus: detail.contest.status, contestLockAt: detail.contest.lockAt };
  const evaluatedAt = new Date();
  const contestLock = bracketContestLockContext(lock, evaluatedAt);
  const locked = contestLock.locked;
  const rowsResult = await supabaseAdmin.from("bracket_entries")
    .select("id, entrant_id, master_bracket_id, locked_at, picks_snapshot, rules_snapshot, bracket_entrants(id, display_name, account_user_id, managing_user_id, is_active), bracket_master_brackets(id, competition_id, entrant_id, bracket_number, name)")
    .eq("contest_id", contestId).eq("competition_id", detail.competition.id);
  if (rowsResult.error) throw new Error(`Failed to load implication cohort: ${rowsResult.error.message}`);
  const rows = (rowsResult.data ?? []) as unknown as Entry[];
  const visibility = bracketInsightVisibility(lock, rows.map((row) => ({ id: Number(row.id), entrantId: row.entrant_id,
    lockedAt: row.locked_at, picks: row.picks_snapshot, rulesSnapshot: row.rules_snapshot })), evaluatedAt);
  const owns = (entrant: Entrant | null) => Boolean(entrant && (entrant.account_user_id === user.id || entrant.managing_user_id === user.id));
  const consistent = (row: Entry) => {
    const master = one(row.bracket_master_brackets);
    return master?.id === row.master_bracket_id && master.competition_id === detail.competition.id &&
      master.entrant_id === row.entrant_id && one(row.bracket_entrants)?.id === row.entrant_id;
  };
  const subjectFor = (master: Master, entrant: Entrant, row?: Entry): ImplicationSubject => ({
    contestId, competitionId: detail.competition.id, entryId: row ? Number(row.id) : null,
    masterBracketId: master.id, entrantId: entrant.id, bracketNumber: master.bracket_number,
    label: `${entrant.display_name} · ${master.name || `Bracket ${master.bracket_number}`}`,
    entrantName: entrant.display_name, isAccountOwner: entrant.account_user_id === user.id,
    snapshotStatus: row?.locked_at ? row.picks_snapshot && row.rules_snapshot ? "frozen" : "pending" : locked ? "pending" : "draft",
  });
  const subjects = rows.filter((row) => consistent(row) && (locked || (owns(one(row.bracket_entrants)) && one(row.bracket_entrants)?.is_active)))
    .map((row) => subjectFor(one(row.bracket_master_brackets)!, one(row.bracket_entrants)!, row));
  // Existing private masters are selectable before lock, including managed entrants and unadmitted drafts.
  if (!locked) {
    const entrantsResult = await supabaseAdmin.from("bracket_entrants")
      .select("id, display_name, account_user_id, managing_user_id, is_active")
      .or(`account_user_id.eq.${user.id},managing_user_id.eq.${user.id}`).eq("is_active", true);
    if (entrantsResult.error) throw new Error(`Failed to load owned entrants: ${entrantsResult.error.message}`);
    const entrants = (entrantsResult.data ?? []) as Entrant[];
    if (entrants.length) {
      const mastersResult = await supabaseAdmin.from("bracket_master_brackets")
        .select("id, competition_id, entrant_id, bracket_number, name")
        .eq("competition_id", detail.competition.id).in("entrant_id", entrants.map((entrant) => entrant.id))
        .lte("bracket_number", detail.contest.maxBracketsPerEntrant);
      if (mastersResult.error) throw new Error(`Failed to load owned masters: ${mastersResult.error.message}`);
      for (const master of (mastersResult.data ?? []) as Master[]) {
        if (!subjects.some((subject) => subject.masterBracketId === master.id))
          subjects.push(subjectFor(master, entrants.find((entrant) => entrant.id === master.entrant_id)!));
      }
    }
  }
  const hasSelection = request.entryId !== undefined || request.entrantId !== undefined;
  const subject = request.entryId !== undefined ? subjects.find((row) => row.entryId === request.entryId)
    : request.entrantId ? subjects.find((row) => row.entrantId === request.entrantId && row.bracketNumber === request.bracketNumber) : undefined;
  if (hasSelection && !subject) return { error: "Bracket not found or private in this contest." };
  const result: ImplicationsResponse = {
    groupId: detail.group.id, contestId, competitionId: detail.competition.id, subjects, subject: subject ?? null,
    contestLock, poolState: visibility.pool, readiness: !subject ? "selection_required" : subject.snapshotStatus === "pending" ? "snapshot_pending" : "available",
    game: game ? { gameId: game.gameKey, bracketGameId: game.id, providerEventId: game.providerEventId,
      officialStatus: game.status, officialWinner: game.status === "final" ? game.winnerTeamId : null } : null,
    analysis: null, teamNames: Object.fromEntries(detail.teams.map((team) => [team.providerTeamId, team.displayName])),
    freshness: { readAt: new Date().toISOString(), topologyVersion: detail.competition.topologyVersion,
      resultsVersion: JSON.stringify(detail.games.map((row) => [row.gameKey, row.status, row.winnerTeamId])) },
  };
  if (!subject || !game || subject.snapshotStatus === "pending") return result;
  const topology = bracketTopologyFromRows(detail.games.map((row) => ({ id: row.id, game_key: row.gameKey,
    round_key: row.roundKey, round_order: row.roundOrder, game_order: row.gameOrder,
    source_a_team_id: row.sourceATeamId, source_a_game_id: row.sourceAGameId,
    source_b_team_id: row.sourceBTeamId, source_b_game_id: row.sourceBGameId })));
  const selected = rows.find((row) => Number(row.id) === subject.entryId);
  let picks: BracketPicks = selected?.picks_snapshot ?? {};
  let rules = selected?.rules_snapshot;
  if (subject.snapshotStatus === "draft") {
    const entrant = selected ? one(selected.bracket_entrants) : null;
    if (entrant && (!owns(entrant) || !entrant.is_active)) return { error: "This draft is private." };
    const picksResult = await supabaseAdmin.from("bracket_master_picks").select("game_id, picked_team_id")
      .eq("master_bracket_id", subject.masterBracketId).eq("competition_id", detail.competition.id);
    if (picksResult.error) throw new Error(`Failed to load draft picks: ${picksResult.error.message}`);
    const keys = new Map(detail.games.map((row) => [Number(row.id), row.gameKey]));
    picks = Object.fromEntries((picksResult.data ?? []).flatMap((row) => keys.has(Number(row.game_id)) ? [[keys.get(Number(row.game_id))!, row.picked_team_id]] : []));
    rules = detail.contest.rulesSnapshot;
  }
  const poolReady = visibility.pool === "available" && rows.every((row) => {
    if (!consistent(row)) return false;
    try {
      bracketScoringRulesFromSnapshot(row.rules_snapshot, topology);
      validateBracketPicks(topology, row.picks_snapshot!);
      return true;
    } catch { return false; }
  });
  if (visibility.pool === "available" && !poolReady) result.poolState = "freezing";
  result.analysis = deriveGameImplications({ topology, gameId: game.gameKey,
    results: bracketResultsFromOfficialGames(detail.games.map((row) => ({ gameId: row.gameKey, status: row.status, winnerTeamId: row.winnerTeamId }))),
    subject: { id: subject.entryId, label: subject.label, picks, rules: bracketScoringRulesFromSnapshot(rules, topology) },
    rivals: poolReady ? rows.map((row) => ({ id: Number(row.id), label: subjectFor(one(row.bracket_master_brackets)!, one(row.bracket_entrants)!, row).label,
      picks: row.picks_snapshot!, rules: bracketScoringRulesFromSnapshot(row.rules_snapshot, topology) })) : null,
  });
  return result;
}
