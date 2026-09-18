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
