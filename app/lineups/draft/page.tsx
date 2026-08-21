export const dynamic = "force-dynamic";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import AppNav from "@/components/AppNav";
import LineupBuilder from "@/components/lineups/LineupBuilder";
import RefreshPlayersButton from "@/components/lineups/RefreshPlayersButton";
import { formatSlateDateLabel } from "@/lib/formatSlateLabel";
import { getCurrentUser } from "@/lib/auth";
import {
  getActiveLeagueForSport,
} from "@/lib/groups/context";

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type Sport = "nba" | "nfl" | "golf";

type Slate = {
  id: number;
  date: string;
  start_date?: string;
  end_date?: string;
  label?: string;
  is_locked: boolean;
  sport?: string;
  display_name?: string | null;
};

type SavedLineup = {
  team_id: number;
  player_ids: number[];
};

type SlateTeamConfig = {
  slate_id: number;
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

function resolveSport(value: string | undefined): Sport {
  if (value === "nfl") return "nfl";
  if (value === "golf") return "golf";
  return "nba";
}

export default async function DraftLineupsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;

  const sportParam = Array.isArray(resolvedSearchParams?.sport)
    ? resolvedSearchParams.sport[0]
    : resolvedSearchParams?.sport;

  const sport = resolveSport(sportParam);

  const currentUser =
    await getCurrentUser();

  const activeLeague =
    currentUser
      ? await getActiveLeagueForSport(
          currentUser,
          sport,
        )
      : null;

  const activeGroupId =
    activeLeague?.context.group.id ??
    "__no_active_group__";

  const activeLeagueId =
    activeLeague?.league.id ??
    "__no_active_league__";

  const today = getTodayDateString();

  const playersTable =
    sport === "nfl"
      ? "players_nfl"
      : sport === "golf"
        ? "golf_players"
        : "players";

  const playersSelect =
    sport === "nfl"
      ? "id, name, position, is_active, is_playing_this_week, nfl_player_id"
      : sport === "golf"
        ? "id, display_name, short_name, is_active, espn_player_id, country, country_flag_url, headshot_url, owgr_player_id, owgr_rank, owgr_points, owgr_updated_at"
        : "id, name, position_group, is_active, is_playing_today, nba_player_id";

  const playerOrderColumn =
    sport === "golf" ? "display_name" : "name";

  const [
    { data: rawPlayers, error: playersError },
    { data: rawTeams, error: teamsError },
    { data: slates, error: slatesError },
    { data: slateTeams, error: slateTeamsError },
    allPlayerStatsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from(playersTable)
      .select(playersSelect)
      .eq("is_active", true)
      .order(playerOrderColumn, { ascending: true }),

    supabaseAdmin
      .from("teams")
      .select("id, name")
      .eq(
        "group_id",
        activeGroupId,
      )
      .order("name", { ascending: true }),

    supabaseAdmin
      .from("slates")
      .select(
        "id, date, start_date, end_date, is_locked, sport, display_name",
      )
      .eq("sport", sport)
      .eq(
        "league_id",
        activeLeagueId,
      )
      .order("start_date", { ascending: false })
      .order("end_date", { ascending: false }),

    supabaseAdmin
      .from("slate_teams")
      .select("slate_id, team_id, draft_order, is_participating")
      .order("slate_id", { ascending: true })
      .order("draft_order", { ascending: true }),

    sport === "nba"
      ? supabaseAdmin
          .from("player_slate_stats")
          .select("player_id, fantasy_points")
      : sport === "nfl"
        ? supabaseAdmin
            .from("player_nfl_slate_stats")
            .select("player_id, fantasy_points")
        : Promise.resolve({
            data: [] as Array<{
              player_id: number;
              fantasy_points: number | null;
            }>,
            error: null,
          }),
  ]);

  const allPlayerStats = allPlayerStatsResult.data;
  const allPlayerStatsError = allPlayerStatsResult.error;

  if (
    playersError ||
    teamsError ||
    slatesError ||
    slateTeamsError ||
    allPlayerStatsError
  ) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <AppNav />

          <section className="rounded-3xl border border-red-200 bg-red-50 px-5 py-6 shadow-sm">
            <h1 className="text-3xl font-bold tracking-tight">Draft</h1>

            <div className="mt-4 rounded-2xl border border-red-200 bg-white px-4 py-4 text-red-700">
              Failed to load page data.

              <div className="mt-2 text-sm text-red-600">
                {playersError?.message ||
                  teamsError?.message ||
                  slatesError?.message ||
                  slateTeamsError?.message ||
                  allPlayerStatsError?.message}
              </div>
            </div>
          </section>
        </div>
      </main>
    );
  }

  const normalizedPlayers = (rawPlayers ?? []).map((player: any) => {
    if (sport === "nfl") {
      return {
        id: Number(player.id),
        name: player.name,
        position_group: player.position,
        is_active: Boolean(player.is_active),
        is_playing_today: player.is_playing_this_week,
        nba_player_id: null,
        nfl_player_id: player.nfl_player_id,
        espn_player_id: null,
      };
    }

    if (sport === "golf") {
      return {
        id: Number(player.id),
        name: player.display_name,
        position_group: "GOLFER",
        is_active: Boolean(player.is_active),
        is_playing_today: null,
        nba_player_id: null,
        nfl_player_id: null,
        espn_player_id: player.espn_player_id,
        country: player.country,
        country_flag_url: player.country_flag_url,
        headshot_url: player.headshot_url,
        owgr_player_id: player.owgr_player_id,
        owgr_rank:
          player.owgr_rank === null
            ? null
            : Number(player.owgr_rank),
        owgr_points:
          player.owgr_points === null
            ? null
            : Number(player.owgr_points),
        owgr_updated_at: player.owgr_updated_at,
      };
    }

    return {
      id: Number(player.id),
      name: player.name,
      position_group: player.position_group,
      is_active: Boolean(player.is_active),
      is_playing_today: player.is_playing_today,
      nba_player_id: player.nba_player_id,
      nfl_player_id: null,
      espn_player_id: null,
    };
  });

  const safeSlates: Slate[] = (slates ?? []).map((slate: any) => {
    const startDate = slate.start_date ?? slate.date;
    const endDate = slate.end_date ?? slate.date;

    return {
      id: Number(slate.id),
      date: slate.date,
      start_date: startDate,
      end_date: endDate,
      label:
        sport === "golf" && slate.display_name
          ? String(slate.display_name)
          : formatSlateDateLabel({
              start_date: startDate,
              end_date: endDate,
            }),
      is_locked: Boolean(slate.is_locked),
      sport: slate.sport ?? sport,
      display_name: slate.display_name ?? null,
    };
  });

  const safeSlateTeams = (slateTeams ?? []) as SlateTeamConfig[];

  const playerAverageAccumulator = new Map<
    number,
    { total: number; count: number }
  >();

  if (sport !== "golf") {
    (allPlayerStats ?? []).forEach((row: any) => {
      const playerId = Number(row.player_id);
      const fantasyPoints = Number(row.fantasy_points ?? 0);

      if (!Number.isFinite(playerId)) return;
      if (!Number.isFinite(fantasyPoints) || fantasyPoints <= 0) return;

      const existing = playerAverageAccumulator.get(playerId) ?? {
        total: 0,
        count: 0,
      };

      playerAverageAccumulator.set(playerId, {
        total: existing.total + fantasyPoints,
        count: existing.count + 1,
      });
    });
  }

  const playerAverages = Array.from(
    playerAverageAccumulator.entries(),
  ).map(([player_id, stats]) => ({
    player_id,
    avg_fantasy_points:
      stats.count > 0
        ? Number((stats.total / stats.count).toFixed(2))
        : 0,
  }));

  let selectedSlateId =
    safeSlates.find((slate) => {
      const startDate = slate.start_date ?? slate.date;
      const endDate = slate.end_date ?? slate.date;

      return startDate <= today && endDate >= today;
    })?.id ??
    safeSlates[0]?.id ??
    null;

  const selectedSlateParticipantTeamIds =
    new Set(
      safeSlateTeams
        .filter(
          (row) =>
            Number(row.slate_id) ===
              Number(selectedSlateId) &&
            row.is_participating !== false,
        )
        .map(
          (row) =>
            Number(row.team_id),
        ),
    );

  /*
   * Group membership alone does not mean a team belongs
   * in this slate. Removed/historical teams remain stored
   * for history, so Draft only receives teams configured
   * as participants in the selected slate.
   */
  const teams =
    (rawTeams ?? []).filter(
      (team: any) =>
        selectedSlateParticipantTeamIds.has(
          Number(team.id),
        ),
    );

  if (!selectedSlateId && safeSlates.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <AppNav />

          <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-3xl font-bold tracking-tight">Draft</h1>

                <p className="mt-2 text-sm text-slate-600">
                  Draft players and build your lineup for the current slate.
                </p>
              </div>

              {sport !== "golf" ? <RefreshPlayersButton /> : null}
            </div>

            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No {sport === "golf" ? "Golf " : ""}slates exist yet. Create one
              first.
            </div>
          </section>
        </div>
      </main>
    );
  }

  let savedLineupsForInitialSlate: SavedLineup[] = [];
  let playerStats: any[] = [];
  let teamResults: any[] = [];

  let rosterSlots: Array<{
    sport: string;
    position: string;
    slot_count: number;
    display_order: number | null;
  }> = [];

  const { data: rosterSlotsData, error: rosterSlotsError } =
    await supabaseAdmin
      .from("roster_slots")
      .select("sport, position, slot_count, display_order")
      .eq("sport", sport)
      .order("display_order", { ascending: true });

  if (rosterSlotsError) {
    console.error(
      "Failed to load roster slots:",
      rosterSlotsError.message,
    );
  }

  rosterSlots = rosterSlotsData ?? [];

  if (selectedSlateId) {
    const { data: lineupsData, error: lineupsError } =
      await supabaseAdmin
        .from("lineups")
        .select(
          `
          id,
          team_id,
          lineup_players (
            player_id
          )
          `,
        )
        .eq("slate_id", selectedSlateId);

    if (lineupsError) {
      console.error("Failed to load initial lineups:", lineupsError.message);
    }

    savedLineupsForInitialSlate =
      lineupsData?.map((lineup: any) => ({
        team_id: Number(lineup.team_id),
        player_ids:
          lineup.lineup_players?.map(
            (lineupPlayer: { player_id: number }) =>
              Number(lineupPlayer.player_id),
          ) ?? [],
      })) ?? [];

    if (sport === "golf") {
      const { data: statsData, error: statsError } =
        await supabaseAdmin
          .from("golf_event_players")
          .select(
            `
            player_id,
            leaderboard_order,
            official_score_to_par,
            official_score_display,
            penalty_strokes,
            fantasy_score,
            rounds_completed,
            holes_completed,
            current_round,
            last_hole,
            status,
            tee_time,
            tee_time_raw
            `,
          )
          .eq("slate_id", selectedSlateId);

      if (statsError) {
        console.error(
          "Failed to load initial Golf stats:",
          statsError.message,
        );
      }

      playerStats = (statsData ?? []).map((row: any) => ({
        player_id: Number(row.player_id),
        leaderboard_order:
          row.leaderboard_order === null
            ? null
            : Number(row.leaderboard_order),
        official_score_to_par:
          row.official_score_to_par === null
            ? null
            : Number(row.official_score_to_par),
        official_score_display: row.official_score_display ?? null,
        penalty_strokes: Number(row.penalty_strokes ?? 0),
        fantasy_points:
          row.fantasy_score === null
            ? null
            : Number(row.fantasy_score),
        rounds_completed: Number(row.rounds_completed ?? 0),
        holes_completed: Number(row.holes_completed ?? 0),
        current_round:
          row.current_round === null
            ? null
            : Number(row.current_round),
        last_hole:
          row.last_hole === null ? null : Number(row.last_hole),
        status: row.status ?? "scheduled",
        tee_time: row.tee_time ?? null,
        tee_time_raw: row.tee_time_raw ?? null,
      }));
    } else {
      const statsTable =
        sport === "nfl"
          ? "player_nfl_slate_stats"
          : "player_slate_stats";

      const { data: statsData, error: statsError } =
        await supabaseAdmin
          .from(statsTable)
          .select("*")
          .eq("slate_id", selectedSlateId);

      if (statsError) {
        console.error(
          "Failed to load initial player stats:",
          statsError.message,
        );
      }

      playerStats = statsData ?? [];
    }

    const { data: teamResultsData, error: teamResultsError } =
      await supabaseAdmin
        .from("team_slate_results")
        .select("*")
        .eq("slate_id", selectedSlateId);

    if (teamResultsError) {
      console.error(
        "Failed to load initial team results:",
        teamResultsError.message,
      );
    }

    teamResults = teamResultsData ?? [];
  }

  const rosterSize =
    rosterSlots.reduce(
      (sum, slot) => sum + Number(slot.slot_count ?? 0),
      0,
    ) || (sport === "golf" ? 4 : sport === "nfl" ? 6 : 5);

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <AppNav />

        <section className="draft-page-intro">
          <div>
            <div className="draft-page-intro-kicker">111 Sports</div>

            <h1>Draft</h1>

            <p>
              Build your {rosterSize}-player{" "}
              {sport === "golf" ? "Golf " : ""}lineup.
            </p>
          </div>

          {sport !== "golf" ? <RefreshPlayersButton /> : null}
        </section>

        <LineupBuilder
          players={normalizedPlayers}
          teams={teams ?? []}
          slates={safeSlates}
          slateTeamConfigs={safeSlateTeams}
          playerAverages={playerAverages}
          initialSelectedSlateId={selectedSlateId}
          savedLineupsForInitialSlate={savedLineupsForInitialSlate}
          playerStats={playerStats}
          teamResults={teamResults}
          rosterSlots={rosterSlots}
          defaultViewMode="draft"
          sport={sport}
        />
      </div>
    </main>
  );
}
