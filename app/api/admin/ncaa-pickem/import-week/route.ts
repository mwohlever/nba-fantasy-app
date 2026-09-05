import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import { getNcaaPickEmAccess } from "@/lib/ncaaPickEm/access";
import {
  getNcaaIncludedEventIds,
  getNcaaLockAt,
  getNewlySelectedCompletedOptionalIds,
  hasExactlyOneNcaaRankedTeam,
  isNcaaRankedVsRanked,
} from "@/lib/ncaaPickEm/gameSelection";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

import {
  fetchNcaaPickEmWeek,
  type NcaaEspnGame,
} from "@/lib/providers/ncaa";

function positiveInteger(
  value: unknown,
): number | null {
  const number =
    Number(value);

  return Number.isInteger(number) &&
    number > 0
    ? number
    : null;
}

function stringArray(
  value: unknown,
): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(
      (entry) =>
        String(
          entry ?? "",
        ).trim(),
    )
    .filter(Boolean);
}

function hasRankedTeam(
  game: NcaaEspnGame,
) {
  return (
    game.awayTeam.rank !== null ||
    game.homeTeam.rank !== null
  );
}

function gameRow(
  weekId: number,
  game: NcaaEspnGame,
  included: boolean,
  commissionerSelected: boolean,
) {
  return {
    week_id:
      weekId,

    espn_event_id:
      game.espnEventId,

    kickoff_at:
      game.kickoffAt,

    away_team_id:
      game.awayTeam.id,

    away_team_name:
      game.awayTeam.displayName,

    away_team_abbreviation:
      game.awayTeam.abbreviation,

    away_team_logo_url:
      game.awayTeam.logo,

    away_rank:
      game.awayTeam.rank,

    away_record:
      game.awayTeam.record,

    away_score:
      game.awayTeam.score,

    home_team_id:
      game.homeTeam.id,

    home_team_name:
      game.homeTeam.displayName,

    home_team_abbreviation:
      game.homeTeam.abbreviation,

    home_team_logo_url:
      game.homeTeam.logo,

    home_rank:
      game.homeTeam.rank,

    home_record:
      game.homeTeam.record,

    home_score:
      game.homeTeam.score,

    status:
      game.status,

    status_detail:
      game.statusDetail,

    winner_team_id:
      game.winnerTeamId,

    ...(game.odds
      ? {
          spread_favorite_team_id:
            game.odds.favoriteTeamId,

          spread:
            game.odds.spread,

          over_under:
            game.odds.overUnder,

          odds_provider:
            game.odds.provider,

          odds_updated_at:
            new Date().toISOString(),
        }
      : {}),

    included,

    commissioner_selected:
      commissionerSelected,

    updated_at:
      new Date().toISOString(),
  };
}

type StoredGame = {
  espn_event_id: string;
  kickoff_at: string;
  included: boolean;
  commissioner_selected: boolean;
  away_team_id: string;
  away_team_name: string;
  away_team_abbreviation: string | null;
  away_team_logo_url: string | null;
  away_rank: number | null;
  away_record: string | null;
  home_team_id: string;
  home_team_name: string;
  home_team_abbreviation: string | null;
  home_team_logo_url: string | null;
  home_rank: number | null;
  home_record: string | null;
  status: string;
  status_detail: string | null;
};

function storedAdminGame(game: StoredGame) {
  return {
    espnEventId: String(game.espn_event_id),
    kickoffAt: game.kickoff_at,
    included: game.included === true,
    commissionerSelected: game.commissioner_selected === true,
    automatic: game.away_rank !== null && game.home_rank !== null,
    away: {
      id: String(game.away_team_id),
      name: game.away_team_name,
      abbreviation: game.away_team_abbreviation,
      logo: game.away_team_logo_url,
      rank: game.away_rank,
      record: game.away_record,
    },
    home: {
      id: String(game.home_team_id),
      name: game.home_team_name,
      abbreviation: game.home_team_abbreviation,
      logo: game.home_team_logo_url,
      rank: game.home_rank,
      record: game.home_record,
    },
    status: game.status,
    statusDetail: game.status_detail,
  };
}

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Login required." }, { status: 401 });
    }

    const access = await getNcaaPickEmAccess(user);
    if (!access) {
      return NextResponse.json(
        { error: "NCAA Pick 'Em is not enabled for this Group." },
        { status: 404 },
      );
    }
    if (!access.context.canAdministerGroup) {
      return NextResponse.json(
        { error: "Group admin access required." },
        { status: 403 },
      );
    }

    const searchParams = new URL(request.url).searchParams;
    const season = positiveInteger(searchParams.get("season"));
    const week = positiveInteger(searchParams.get("week"));
    if (!season || !week) {
      return NextResponse.json(
        { error: "Valid season and week are required." },
        { status: 400 },
      );
    }

    const { data: storedWeek, error: weekError } = await supabaseAdmin
      .from("ncaa_pickem_weeks")
      .select("id, season, week_number, label, lock_at, analysis, show_analysis")
      .eq("league_id", access.league.id)
      .eq("season", season)
      .eq("week_number", week)
      .maybeSingle();

    if (weekError) throw new Error(weekError.message);
    if (!storedWeek) {
      return NextResponse.json(
        { error: "NCAA Pick 'Em week has not been imported." },
        { status: 404 },
      );
    }

    const { data: storedGames, error: gamesError } = await supabaseAdmin
      .from("ncaa_pickem_games")
      .select("espn_event_id, kickoff_at, included, commissioner_selected, away_team_id, away_team_name, away_team_abbreviation, away_team_logo_url, away_rank, away_record, home_team_id, home_team_name, home_team_abbreviation, home_team_logo_url, home_rank, home_record, status, status_detail")
      .eq("week_id", storedWeek.id)
      .order("kickoff_at", { ascending: true });

    if (gamesError) throw new Error(gamesError.message);

    const allGames = (storedGames ?? []) as StoredGame[];
    const rankedGames = allGames
      .filter((game) => game.away_rank !== null || game.home_rank !== null)
      .map(storedAdminGame);
    const automaticGames = rankedGames.filter((game) => game.automatic);
    const rankedTeamIds = new Set<string>();
    for (const game of allGames) {
      if (game.away_rank !== null) rankedTeamIds.add(String(game.away_team_id));
      if (game.home_rank !== null) rankedTeamIds.add(String(game.home_team_id));
    }

    return NextResponse.json({
      success: true,
      season: Number(storedWeek.season),
      week: Number(storedWeek.week_number),
      weekId: Number(storedWeek.id),
      label: storedWeek.label,
      lockAt: storedWeek.lock_at,
      analysis: storedWeek.analysis ?? null,
      showAnalysis: storedWeek.show_analysis === true,
      importedGames: allGames.filter((game) => game.included).length,
      normalEligibleGames: automaticGames.length,
      optionalGames: rankedGames.length - automaticGames.length,
      diagnostics: {
        totalEvents: allGames.length,
        mappedEvents: allGames.length,
        rankedVsRankedEvents: automaticGames.length,
        rankedTeamGames: rankedGames.length,
        rankingPoll: "AP Top 25",
        rankingPollType: "ap",
        rankedTeams: rankedTeamIds.size,
      },
      games: rankedGames,
    });
  } catch (error) {
    console.error("Failed to load persisted NCAA Pick 'Em week", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load NCAA Pick 'Em week.",
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Login required." }, { status: 401 });
    }
    const access = await getNcaaPickEmAccess(user);
    if (!access) {
      return NextResponse.json({ error: "NCAA Pick 'Em is not enabled for this Group." }, { status: 404 });
    }
    if (!access.context.canAdministerGroup) {
      return NextResponse.json(
        {
          error: "Group admin access required.",
        },
        { status: 403 },
      );
    }

    const body =
      await request.json();

    const season =
      positiveInteger(
        body?.season,
      );

    const week =
      positiveInteger(
        body?.week,
      );

    const hasExplicitSelection =
      Array.isArray(
        body?.includedEventIds,
      );

    const explicitSelection =
      new Set(
        stringArray(
          body?.includedEventIds,
        ),
      );

    if (!season || !week) {
      return NextResponse.json(
        {
          error:
            "Valid season and week are required.",
        },
        { status: 400 },
      );
    }

    const espnWeek =
      await fetchNcaaPickEmWeek({
        season,
        week,
      });

    const {
      data: existingWeek,
      error: existingWeekError,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_weeks",
        )
        .select(
          "id, season, week_number, label, lock_at, status, analysis, show_analysis",
        )
        .eq(
          "league_id",
          access.league.id,
        )
        .eq(
          "season",
          season,
        )
        .eq(
          "week_number",
          week,
        )
        .maybeSingle();

    if (existingWeekError) {
      return NextResponse.json(
        {
          error:
            existingWeekError.message,
        },
        { status: 500 },
      );
    }

    let weekId: number;

    let preservedStatus:
      | "open"
      | "locked"
      | "final" =
      "open";

    let preservedAnalysis:
      string | null =
      null;

    let preservedShowAnalysis =
      false;

    if (existingWeek) {
      weekId =
        Number(
          existingWeek.id,
        );

      preservedStatus =
        existingWeek.status ===
          "locked" ||
        existingWeek.status ===
          "final"
          ? existingWeek.status
          : "open";

      preservedAnalysis =
        existingWeek.analysis ??
        null;

      preservedShowAnalysis =
        existingWeek.show_analysis ===
        true;
    } else {
      const {
        data: createdWeek,
        error: createWeekError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_weeks",
          )
          .insert({
            league_id:
              access.league.id,

            season,
            week_number:
              week,
            label:
              espnWeek.label,
            status:
              "open",
          })
          .select(
            "id, status",
          )
          .single();

      if (
        createWeekError ||
        !createdWeek
      ) {
        return NextResponse.json(
          {
            error:
              createWeekError
                ?.message ??
              "Failed to create NCAA Pick 'Em week.",
          },
          { status: 500 },
        );
      }

      weekId =
        Number(
          createdWeek.id,
        );
    }

    /*
     * Preserve commissioner-added games during a normal
     * ESPN refresh. This is the important difference from
     * the previous importer, which cleared every included
     * game before rebuilding the card.
     */
    const {
      data: existingGames,
      error: existingGamesError,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_games",
        )
        .select(
          "espn_event_id, included, commissioner_selected",
        )
        .eq(
          "week_id",
          weekId,
        );

    if (existingGamesError) {
      return NextResponse.json(
        {
          error:
            existingGamesError.message,
        },
        { status: 500 },
      );
    }

    const previouslyCommissionerSelected =
      new Set(
        (
          existingGames ??
          []
        )
          .filter(
            (game) =>
              game.commissioner_selected ===
              true,
          )
          .map(
            (game) =>
              String(
                game.espn_event_id,
              ),
          ),
      );

    const commissionerSelectedIds = new Set<string>();
    const requestedIds = hasExplicitSelection ? explicitSelection : previouslyCommissionerSelected;
    for (const game of espnWeek.scheduleGames) {
      if (
        requestedIds.has(game.espnEventId) &&
        (hasExactlyOneNcaaRankedTeam(game) || previouslyCommissionerSelected.has(game.espnEventId))
      ) commissionerSelectedIds.add(game.espnEventId);
    }
    const completedSelections = getNewlySelectedCompletedOptionalIds({
      games: espnWeek.scheduleGames,
      requestedIncludedEventIds: commissionerSelectedIds,
      previouslyCommissionerSelectedEventIds: previouslyCommissionerSelected,
    });
    if (completedSelections.length) {
      return NextResponse.json({ error: "Completed optional games cannot be newly selected." }, { status: 409 });
    }
    const includedIds = getNcaaIncludedEventIds(espnWeek.scheduleGames, commissionerSelectedIds);

    /*
     * Upsert every ESPN schedule game. That gives the
     * commissioner a persistent local copy of the whole
     * weekly schedule while `included` controls which
     * games appear on the actual Pick 'Em card.
     */
    const rows =
      espnWeek.scheduleGames.map(
        (game) =>
          gameRow(
            weekId,
            game,
            includedIds.has(
              game.espnEventId,
            ),
            commissionerSelectedIds.has(game.espnEventId),
          ),
      );

    if (rows.length > 0) {
      const {
        error: gamesError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_games",
          )
          .upsert(
            rows,
            {
              onConflict:
                "week_id,espn_event_id",
            },
          );

      if (gamesError) {
        return NextResponse.json(
          {
            error:
              gamesError.message,
          },
          { status: 500 },
        );
      }
    }

    const selectedGames =
      espnWeek.scheduleGames
        .filter(
          (game) =>
            includedIds.has(
              game.espnEventId,
            ),
        )
        .sort(
          (a, b) =>
            new Date(
              a.kickoffAt,
            ).getTime() -
            new Date(
              b.kickoffAt,
            ).getTime(),
        );

    /*
     * Weekly lock follows the earliest INCLUDED game,
     * not simply the first ESPN event of the week.
     */
    const lockAt = getNcaaLockAt(espnWeek.scheduleGames, includedIds);

    const {
      error: weekUpdateError,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_weeks",
        )
        .update({
          label:
            espnWeek.label,

          lock_at:
            lockAt,

          status:
            preservedStatus,

          updated_at:
            new Date()
              .toISOString(),
        })
        .eq(
          "id",
          weekId,
        );

    if (weekUpdateError) {
      return NextResponse.json(
        {
          error:
            weekUpdateError.message,
        },
        { status: 500 },
      );
    }

    const candidateGames =
      espnWeek.scheduleGames
        .filter(
          hasRankedTeam,
        )
        .map(
          (game) => ({
            espnEventId:
              game.espnEventId,

            kickoffAt:
              game.kickoffAt,

            included:
              includedIds.has(
                game.espnEventId,
              ),

            commissionerSelected:
              commissionerSelectedIds.has(
                game.espnEventId,
              ),

            automatic:
              isNcaaRankedVsRanked(
                game,
              ),

            away: {
              id:
                game.awayTeam.id,

              name:
                game.awayTeam
                  .displayName,

              abbreviation:
                game.awayTeam
                  .abbreviation,

              logo:
                game.awayTeam.logo,

              rank:
                game.awayTeam.rank,

              record:
                game.awayTeam.record,
            },

            home: {
              id:
                game.homeTeam.id,

              name:
                game.homeTeam
                  .displayName,

              abbreviation:
                game.homeTeam
                  .abbreviation,

              logo:
                game.homeTeam.logo,

              rank:
                game.homeTeam.rank,

              record:
                game.homeTeam.record,
            },

            status:
              game.status,

            statusDetail:
              game.statusDetail,
          }),
        );

    return NextResponse.json({
      success: true,

      season,
      week,
      weekId,

      label:
        espnWeek.label,

      lockAt,

      analysis:
        preservedAnalysis,

      showAnalysis:
        preservedShowAnalysis,

      importedGames:
        selectedGames.length,

      normalEligibleGames:
        espnWeek
          .eligibleGames
          .length,

      optionalGames:
        candidateGames.filter(
          (game) =>
            !game.automatic,
        ).length,

      diagnostics:
        espnWeek.diagnostics,

      games:
        candidateGames,
    });
  } catch (error) {
    console.error(
      "Failed to import NCAA Pick 'Em week",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to import NCAA Pick 'Em week.",
      },
      { status: 500 },
    );
  }
}
