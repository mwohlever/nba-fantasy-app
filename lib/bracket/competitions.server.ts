import { supabaseAdmin } from "@/lib/supabaseAdmin";

export type BracketCompetitionSummary = {
  contestId: string;
  contestStatus: string;
  contestLockAt: string | null;
  maxBracketsPerEntrant: number;
  rulesVersion: number;
  rulesSnapshot: Record<string, unknown>;

  competition: {
    id: number;
    sportKey: string;
    formatKey: string;
    season: number;
    name: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  };
};

export type BracketCompetitionBrowserItem = {
  competition: BracketCompetitionSummary["competition"] & {
    gameCount: number;
  };
  contest: Omit<BracketCompetitionSummary, "competition"> | null;
  personalSummary: {
    totalBrackets: number;
    completeBrackets: number;
  } | null;
};

type ContestRow = {
  id: string;
  status: string;
  lock_at: string | null;
  max_brackets_per_entrant: number;
  rules_version: number;
  rules_snapshot: Record<string, unknown> | null;
  competition_id: number;
};

type CompetitionRow = {
  id: number;
  sport_key: string;
  format_key: string;
  season: number;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
};

export async function loadBracketChallengeCompetitions(
  leagueId: string,
): Promise<BracketCompetitionSummary[]> {
  const contestsResult = await supabaseAdmin
    .from("bracket_contests")
    .select(
      "id, competition_id, status, lock_at, max_brackets_per_entrant, rules_version, rules_snapshot",
    )
    .eq("league_id", leagueId)
    .order("created_at", { ascending: false });

  if (contestsResult.error) {
    throw new Error(
      `Failed to load Bracket Challenge contests: ${contestsResult.error.message}`,
    );
  }

  const contests =
    (contestsResult.data ?? []) as ContestRow[];

  if (!contests.length) {
    return [];
  }

  const competitionIds = [
    ...new Set(
      contests.map(
        (contest) => contest.competition_id,
      ),
    ),
  ];

  const competitionsResult = await supabaseAdmin
    .from("bracket_competitions")
    .select(
      "id, sport_key, format_key, season, name, status, starts_at, ends_at",
    )
    .in("id", competitionIds);

  if (competitionsResult.error) {
    throw new Error(
      `Failed to load Bracket Challenge competitions: ${competitionsResult.error.message}`,
    );
  }

  const competitions =
    (competitionsResult.data ?? []) as CompetitionRow[];

  const competitionById =
    new Map(
      competitions.map(
        (competition) => [
          competition.id,
          competition,
        ],
      ),
    );

  return contests.flatMap(
    (contest) => {
      const competition =
        competitionById.get(
          contest.competition_id,
        );

      if (!competition) {
        return [];
      }

      return [{
        contestId:
          contest.id,

        contestStatus:
          contest.status,

        contestLockAt:
          contest.lock_at,

        maxBracketsPerEntrant:
          Number(
            contest.max_brackets_per_entrant,
          ),

        rulesVersion:
          Number(
            contest.rules_version,
          ),

        rulesSnapshot:
          contest.rules_snapshot ?? {},

        competition: {
          id:
            competition.id,

          sportKey:
            competition.sport_key,

          formatKey:
            competition.format_key,

          season:
            Number(
              competition.season,
            ),

          name:
            competition.name,

          status:
            competition.status,

          startsAt:
            competition.starts_at,

          endsAt:
            competition.ends_at,
        },
      }];
    },
  );
}

/**
 * Read-only Home model. Global competitions stay visible even when this Group
 * has not created a contest for them; contest and personal-entry data are
 * attached only where they already exist.
 */
export async function loadBracketChallengeCompetitionBrowser(
  leagueId: string,
  userId: string,
): Promise<BracketCompetitionBrowserItem[]> {
  const [competitionsResult, contestsResult] = await Promise.all([
    supabaseAdmin
      .from("bracket_competitions")
      .select("id, sport_key, format_key, season, name, status, starts_at, ends_at")
      .order("season", { ascending: false })
      .order("starts_at", { ascending: false, nullsFirst: false }),
    supabaseAdmin
      .from("bracket_contests")
      .select("id, competition_id, status, lock_at, max_brackets_per_entrant, rules_version, rules_snapshot")
      .eq("league_id", leagueId),
  ]);

  if (competitionsResult.error) {
    throw new Error(`Failed to load Bracket Challenge competitions: ${competitionsResult.error.message}`);
  }
  if (contestsResult.error) {
    throw new Error(`Failed to load Bracket Challenge contests: ${contestsResult.error.message}`);
  }

  const competitions = (competitionsResult.data ?? []) as CompetitionRow[];
  const contests = (contestsResult.data ?? []) as ContestRow[];
  const competitionIds = competitions.map((competition) => competition.id);
  const contestByCompetitionId = new Map(contests.map((contest) => [contest.competition_id, contest]));

  const [gamesResult, entrantsResult] = await Promise.all([
    competitionIds.length
      ? supabaseAdmin.from("bracket_games").select("competition_id").in("competition_id", competitionIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin.from("bracket_entrants").select("id").or(`account_user_id.eq.${userId},managing_user_id.eq.${userId}`).eq("is_active", true),
  ]);
  if (gamesResult.error) throw new Error(`Failed to load bracket game counts: ${gamesResult.error.message}`);
  if (entrantsResult.error) throw new Error(`Failed to load bracket entrants: ${entrantsResult.error.message}`);

  const gameCountByCompetition = new Map<number, number>();
  for (const game of gamesResult.data ?? []) {
    const competitionId = Number(game.competition_id);
    gameCountByCompetition.set(competitionId, (gameCountByCompetition.get(competitionId) ?? 0) + 1);
  }

  const ownedEntrantIds = (entrantsResult.data ?? []).map((entrant) => String(entrant.id));
  const contestIds = contests.map((contest) => contest.id);
  const entriesResult = ownedEntrantIds.length && contestIds.length
    ? await supabaseAdmin.from("bracket_entries").select("contest_id, competition_id, master_bracket_id, locked_at").in("entrant_id", ownedEntrantIds).in("contest_id", contestIds)
    : { data: [], error: null };
  if (entriesResult.error) throw new Error(`Failed to load Bracket Challenge participation: ${entriesResult.error.message}`);

  const entries = entriesResult.data ?? [];
  const masterIds = [...new Set(entries.map((entry) => String(entry.master_bracket_id)))];
  const picksResult = masterIds.length
    ? await supabaseAdmin.from("bracket_master_picks").select("master_bracket_id").in("master_bracket_id", masterIds)
    : { data: [], error: null };
  if (picksResult.error) throw new Error(`Failed to load Bracket Challenge pick progress: ${picksResult.error.message}`);

  const pickCountByMaster = new Map<string, number>();
  for (const pick of picksResult.data ?? []) {
    const masterId = String(pick.master_bracket_id);
    pickCountByMaster.set(masterId, (pickCountByMaster.get(masterId) ?? 0) + 1);
  }

  return competitions.map((competition) => {
    const contest = contestByCompetitionId.get(competition.id) ?? null;
    const gameCount = gameCountByCompetition.get(competition.id) ?? 0;
    const personalEntries = contest
      ? entries.filter((entry) => entry.contest_id === contest.id)
      : [];
    return {
      competition: {
        id: competition.id, sportKey: competition.sport_key, formatKey: competition.format_key,
        season: Number(competition.season), name: competition.name, status: competition.status,
        startsAt: competition.starts_at, endsAt: competition.ends_at, gameCount,
      },
      contest: contest ? {
        contestId: contest.id, contestStatus: contest.status, contestLockAt: contest.lock_at,
        maxBracketsPerEntrant: Number(contest.max_brackets_per_entrant), rulesVersion: Number(contest.rules_version),
        rulesSnapshot: contest.rules_snapshot ?? {},
      } : null,
      personalSummary: contest ? {
        totalBrackets: personalEntries.length,
        completeBrackets: personalEntries.filter((entry) => Boolean(entry.locked_at) || (gameCount > 0 && (pickCountByMaster.get(String(entry.master_bracket_id)) ?? 0) === gameCount)).length,
      } : null,
    };
  });
}
