import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { DEFAULT_SPORT } from "@/lib/sports";
import { getCurrentUser } from "@/lib/auth";
import { getActiveLeagueForSport } from "@/lib/groups/context";

type TeamRow = {
  id: number;
  name: string;
};

type SlateRow = {
  id: number;
  start_date: string;
  is_locked: boolean;
  sport: string | null;
};

type TeamSlateResultRow = {
  slate_id: number;
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
};

type SlateTeamRow = {
  slate_id: number;
  team_id: number;
  draft_order: number | null;
  is_participating: boolean | null;
};

type StandingRow = {
  season: number | "all";
  team_id: number;
  name: string;
  wins: number;
  runner_ups: number;
  avg_finish: number | null;
  avg_score: number | null;
  high_score: number | null;
  low_score: number | null;
  slates_played: number;
};

function getSeasonFromDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`).getFullYear();
}

function roundTo(value: number, digits = 2) {
  return Number(value.toFixed(digits));
}

export async function GET(request: NextRequest) {
  try {
    const seasonParam = request.nextUrl.searchParams.get("season");

    const sport =
      request.nextUrl.searchParams.get("sport") ??
      DEFAULT_SPORT;

    const normalizedSport:
      | "nba"
      | "nfl"
      | "golf" =
      sport === "nfl"
        ? "nfl"
        : sport === "golf"
          ? "golf"
          : "nba";

    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error: "Login required.",
        },
        {
          status: 401,
        },
      );
    }

    const activeLeague =
      await getActiveLeagueForSport(
        user,
        normalizedSport,
      );

    if (!activeLeague) {
      return NextResponse.json(
        {
          error:
            "This League is not enabled for the active Group.",
        },
        {
          status: 404,
        },
      );
    }

    const {
      context,
      league,
    } = activeLeague;

    const [
      { data: teams, error: teamsError },
      {
        data: activeMemberships,
        error: activeMembershipsError,
      },
      { data: slates, error: slatesError },
    ] = await Promise.all([
      supabaseAdmin
        .from("teams")
        .select("id, name, user_id")
        .eq(
          "group_id",
          context.group.id,
        )
        .order(
          "name",
          {
            ascending: true,
          },
        ),

      supabaseAdmin
        .from("group_memberships")
        .select("user_id")
        .eq(
          "group_id",
          context.group.id,
        )
        .eq(
          "is_active",
          true,
        ),

      supabaseAdmin
        .from("slates")
        .select(
          "id, start_date, is_locked, sport, league_id",
        )
        .eq(
          "league_id",
          league.id,
        )
        .eq(
          "is_locked",
          true,
        )
        .order(
          "start_date",
          {
            ascending: true,
          },
        ),
    ]);

    if (
      teamsError ||
      activeMembershipsError ||
      slatesError
    ) {
      return NextResponse.json(
        {
          error:
            teamsError?.message ||
            activeMembershipsError?.message ||
            slatesError?.message ||
            "Failed to load standings data.",
        },
        {
          status: 500,
        },
      );
    }

    const safeSlates =
      (slates ?? []) as SlateRow[];

    const relevantSlateIds =
      safeSlates.map(
        (slate) =>
          Number(
            slate.id,
          ),
      );

    const [
      {
        data:
          teamSlateResults,
        error:
          teamSlateResultsError,
      },
      {
        data:
          slateTeams,
        error:
          slateTeamsError,
      },
    ] =
      relevantSlateIds.length >
      0
        ? await Promise.all([
            supabaseAdmin
              .from(
                "team_slate_results",
              )
              .select(
                "slate_id, team_id, fantasy_points, finish_position",
              )
              .in(
                "slate_id",
                relevantSlateIds,
              ),

            supabaseAdmin
              .from(
                "slate_teams",
              )
              .select(
                "slate_id, team_id, draft_order, is_participating",
              )
              .in(
                "slate_id",
                relevantSlateIds,
              ),
          ])
        : [
            {
              data: [],
              error: null,
            },
            {
              data: [],
              error: null,
            },
          ];

    if (
      teamSlateResultsError ||
      slateTeamsError
    ) {
      return NextResponse.json(
        {
          error:
            teamSlateResultsError?.message ||
            slateTeamsError?.message ||
            "Failed to load standings data.",
        },
        { status: 500 }
      );
    }

    const activeGroupUserIds =
      new Set(
        (activeMemberships ?? []).map(
          (membership: any) =>
            String(
              membership.user_id,
            ),
        ),
      );

    const safeTeams =
      (
        (teams ?? []) as Array<
          TeamRow & {
            user_id:
              string | null;
          }
        >
      ).filter(
        (team) =>
          team.user_id &&
          activeGroupUserIds.has(
            String(team.user_id),
          ),
      );

    const safeResults =
      (
        teamSlateResults ??
        []
      ) as TeamSlateResultRow[];
    const safeSlateTeams = (slateTeams ?? []) as SlateTeamRow[];

    // Only slates matching the requested sport ended up in safeSlates
    // (filtered at the query level above), so this map only contains
    // sport-relevant slate ids.
    const slateSeasonMap = new Map<number, number>();
    safeSlates.forEach((slate) => {
      slateSeasonMap.set(slate.id, getSeasonFromDate(slate.start_date));
    });

    const relevantSlateIdSet =
      new Set(
        safeSlates.map(
          (slate) =>
            slate.id,
        ),
      );

    const availableSeasons = Array.from(
      new Set(
        safeSlates
          .map((slate) => getSeasonFromDate(slate.start_date))
          .filter((season) => Number.isFinite(season))
      )
    ).sort((a, b) => b - a);

    const isAllTime = seasonParam === "all";

    const selectedSeason =
      isAllTime
        ? "all"
        : seasonParam && Number.isFinite(Number(seasonParam))
          ? Number(seasonParam)
          : availableSeasons[0] ?? null;

    const seasonResults = safeResults.filter((row) => {
      if (!relevantSlateIdSet.has(row.slate_id)) return false;

      const slateSeason = slateSeasonMap.get(row.slate_id);

      if (!slateSeason) return false;
      if (isAllTime) return true;

      return slateSeason === selectedSeason;
    });

    const slateTeamBySlateTeamId = new Map<string, SlateTeamRow>();

    safeSlateTeams.forEach((row) => {
      if (!relevantSlateIdSet.has(row.slate_id)) return;
      slateTeamBySlateTeamId.set(`${row.slate_id}:${row.team_id}`, row);
    });

    const draftPositionMap = new Map<number, { draft_order: number; wins: number; runner_ups: number; total_finish: number; total_score: number; slates_played: number; }>();

    seasonResults.forEach((result) => {
      const slateTeam = slateTeamBySlateTeamId.get(
        `${result.slate_id}:${result.team_id}`
      );

      if (
        !slateTeam ||
        slateTeam.is_participating === false ||
        !slateTeam.draft_order
      ) {
        return;
      }

      const draftOrder = Number(slateTeam.draft_order);

      const current =
        draftPositionMap.get(draftOrder) ?? {
          draft_order: draftOrder,
          wins: 0,
          runner_ups: 0,
          total_finish: 0,
          total_score: 0,
          slates_played: 0,
        };

      current.slates_played += 1;
      current.total_finish += Number(result.finish_position ?? 0);
      current.total_score += Number(result.fantasy_points ?? 0);

      if (result.finish_position === 1) current.wins += 1;
      if (result.finish_position === 2) current.runner_ups += 1;

      draftPositionMap.set(draftOrder, current);
    });

    const draftPositionResults = Array.from(draftPositionMap.values())
      .map((row) => ({
        draft_order: row.draft_order,
        wins: row.wins,
        runner_ups: row.runner_ups,
        avg_finish:
          row.slates_played > 0
            ? roundTo(row.total_finish / row.slates_played, 2)
            : null,
        avg_score:
          row.slates_played > 0
            ? roundTo(row.total_score / row.slates_played, 2)
            : null,
        slates_played: row.slates_played,
      }))
      .sort((a, b) => a.draft_order - b.draft_order);

    /*
     * Teams are Group-specific, but old/inactive team identities
     * are intentionally retained for history. Only include a team
     * in standings if it actually participated in a relevant slate
     * for the selected season.
     */
    const standingsSlateIds =
      new Set(
        safeSlates
          .filter((slate) => {
            if (isAllTime) {
              return true;
            }

            return (
              getSeasonFromDate(
                slate.start_date,
              ) === selectedSeason
            );
          })
          .map(
            (slate) =>
              Number(slate.id),
          ),
      );

    const standingsParticipantTeamIds =
      new Set(
        safeSlateTeams
          .filter(
            (row) =>
              standingsSlateIds.has(
                Number(row.slate_id),
              ) &&
              row.is_participating !== false,
          )
          .map(
            (row) =>
              Number(row.team_id),
          ),
      );

    const standingsTeams =
      safeTeams.filter(
        (team) =>
          standingsParticipantTeamIds.has(
            Number(team.id),
          ),
      );

    const standings: StandingRow[] = standingsTeams
      .map((team) => {
        const teamRows = seasonResults.filter((row) => row.team_id === team.id);

      const playedRows = teamRows.filter((row) => (row.fantasy_points ?? 0) > 0);
      const scores = playedRows.map((row) => Number(row.fantasy_points ?? 0));
      const finishes = playedRows
        .map((row) => row.finish_position)
        .filter((value): value is number => value !== null && value !== undefined);

      const wins = playedRows.filter((row) => row.finish_position === 1).length;
      const runnerUps = playedRows.filter((row) => row.finish_position === 2).length;
      const slatesPlayed = playedRows.length;

        return {
          season:
            isAllTime
              ? ("all" as const)
              : selectedSeason ?? 0,
          team_id: team.id,
          name: team.name,
          wins,
          runner_ups: runnerUps,
          avg_finish:
            finishes.length > 0
              ? roundTo(
                  finishes.reduce((sum, value) => sum + value, 0) /
                    finishes.length,
                  2,
                )
              : null,
          avg_score:
            scores.length > 0
              ? roundTo(
                  scores.reduce((sum, value) => sum + value, 0) /
                    scores.length,
                  2,
                )
              : null,
          high_score:
            scores.length > 0
              ? roundTo(Math.max(...scores), 2)
              : null,
          low_score:
            scores.length > 0
              ? roundTo(Math.min(...scores), 2)
              : null,
          slates_played: slatesPlayed,
        };
      })
      .filter(
        (row) =>
          row.slates_played > 0,
      );

    return NextResponse.json({
      success: true,
      sport: normalizedSport,
      group: {
        id:
          context.group.id,
        name:
          context.group.name,
        slug:
          context.group.slug,
      },
      league: {
        id:
          league.id,
        name:
          league.name,
        slug:
          league.slug,
      },
      selectedSeason,
      availableSeasons,
      standings,
      draftPositionResults,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading standings." },
      { status: 500 }
    );
  }
}
