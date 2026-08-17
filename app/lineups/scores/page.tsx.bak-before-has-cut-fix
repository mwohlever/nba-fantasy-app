export const dynamic = "force-dynamic";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import AppNav from "@/components/AppNav";
import LineupBuilder from "@/components/lineups/LineupBuilder";
import { formatSlateDateLabel } from "@/lib/formatSlateLabel";

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type Slate = {
  id: number;
  date: string;
  start_date?: string;
  end_date?: string;
  label?: string;
  is_locked: boolean;
  sport?: string;
};

type SavedLineup = {
  team_id: number;
  player_ids: number[];
  pregame_projected_points: number | null;
};

type SlateTeamConfig = {
  slate_id: number;
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

export default async function ScoresLineupsPage({
  searchParams,
}: {
  searchParams: Promise<{ sport?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const sportParam = Array.isArray(resolvedSearchParams?.sport)
    ? resolvedSearchParams.sport[0]
    : resolvedSearchParams?.sport;
  const sport =
    sportParam === "nfl"
      ? "nfl"
      : sportParam === "golf"
        ? "golf"
        : "nba";

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
        ? "id, display_name, is_active, espn_player_id, country, country_flag_url, headshot_url, owgr_player_id, owgr_rank, owgr_points, owgr_updated_at"
        : "id, name, position_group, is_active, is_playing_today, nba_player_id";

  const statsTable =
    sport === "nfl"
      ? "player_nfl_slate_stats"
      : "player_slate_stats";

  const [
    { data: rawPlayers, error: playersError },
    { data: teams, error: teamsError },
    { data: slates, error: slatesError },
    { data: slateTeams, error: slateTeamsError },
    { data: allPlayerStats, error: allPlayerStatsError },
  ] = await Promise.all([
    supabaseAdmin
      .from(playersTable)
      .select(playersSelect)
      .order(sport === "golf" ? "display_name" : "name", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name").order("name", { ascending: true }),
    supabaseAdmin
      .from("slates")
      .select(
        "id, date, start_date, end_date, is_locked, sport, display_name",
      )
      .eq("sport", sport)
      .order("start_date", { ascending: false })
      .order("end_date", { ascending: false }),
    supabaseAdmin
      .from("slate_teams")
      .select("slate_id, team_id, draft_order, is_participating")
      .order("slate_id", { ascending: true })
      .order("draft_order", { ascending: true }),
    sport === "golf"
      ? supabaseAdmin
          .from("golf_event_players")
          .select("player_id, fantasy_score")
      : supabaseAdmin
          .from(statsTable)
          .select("player_id, fantasy_points"),
  ]);

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
            <h1 className="text-3xl font-bold tracking-tight">Live Scores</h1>
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

  const normalizedPlayers = (rawPlayers ?? []).map((p: any) => {
    if (sport === "nfl") {
      return {
        id: p.id,
        name: p.name,
        position_group: p.position,
        is_active: p.is_active,
        is_playing_today: p.is_playing_this_week,
        nba_player_id: null,
        nfl_player_id: p.nfl_player_id,
      };
    }

    if (sport === "golf") {
      return {
        id: p.id,
        name: p.display_name,
        position_group: "GOLFER",
        is_active: p.is_active,
        is_playing_today: null,
        nba_player_id: null,
        nfl_player_id: null,
        espn_player_id: p.espn_player_id,
        country: p.country,
        country_flag_url: p.country_flag_url,
        headshot_url: p.headshot_url,
        owgr_player_id: p.owgr_player_id,
        owgr_rank:
          p.owgr_rank === null
            ? null
            : Number(p.owgr_rank),
        owgr_points:
          p.owgr_points === null
            ? null
            : Number(p.owgr_points),
        owgr_updated_at: p.owgr_updated_at,
      };
    }

    return {
      id: p.id,
      name: p.name,
      position_group: p.position_group,
      is_active: p.is_active,
      is_playing_today: p.is_playing_today,
      nba_player_id: p.nba_player_id,
      nfl_player_id: null,
    };
  });

  const safeSlates: Slate[] =
    (slates ?? []).map((slate) => {
      const startDate = slate.start_date ?? slate.date;
      const endDate = slate.end_date ?? slate.date;

      return {
        id: slate.id,
        date: slate.date,
        start_date: startDate,
        end_date: endDate,
        label:
          sport === "golf" && (slate as any).display_name
            ? String((slate as any).display_name)
            : formatSlateDateLabel({
                start_date: startDate,
                end_date: endDate,
              }),
        is_locked: slate.is_locked,
        sport: slate.sport ?? "nba",
      };
    }) ?? [];

  const safeSlateTeams = (slateTeams ?? []) as SlateTeamConfig[];

  const safeAllPlayerStats = allPlayerStats ?? [];
  const playerAverageMap = new Map<number, { total: number; count: number }>();

  safeAllPlayerStats.forEach((row) => {
    const playerId = Number(row.player_id);
    const fantasyPoints = Number(
      sport === "golf"
        ? (row as any).fantasy_score ?? 0
        : (row as any).fantasy_points ?? 0,
    );

    if (!Number.isFinite(playerId)) return;
    if (sport === "golf") return;
    if (!Number.isFinite(fantasyPoints) || fantasyPoints <= 0) return;

    const existing = playerAverageMap.get(playerId) ?? { total: 0, count: 0 };
    playerAverageMap.set(playerId, {
      total: existing.total + fantasyPoints,
      count: existing.count + 1,
    });
  });

  const playerAverages = Array.from(playerAverageMap.entries()).map(
    ([player_id, stats]) => ({
      player_id,
      avg_fantasy_points:
        stats.count > 0 ? Number((stats.total / stats.count).toFixed(2)) : 0,
    })
  );

  const latestSlate = safeSlates[0] ?? null;
  const previousSlate = safeSlates[1] ?? null;

  let hasAnyStatsForLatest = false;

  if (latestSlate) {
    const { data: latestStats } =
      sport === "golf"
        ? await supabaseAdmin
            .from("golf_event_players")
            .select("player_id")
            .eq("slate_id", latestSlate.id)
            .limit(1)
        : await supabaseAdmin
            .from(statsTable)
            .select("player_id")
            .eq("slate_id", latestSlate.id)
            .limit(1);

    hasAnyStatsForLatest = (latestStats ?? []).length > 0;
  }

  let selectedSlateId =
    !hasAnyStatsForLatest && previousSlate
      ? previousSlate.id
      : latestSlate?.id ?? null;

  if (!selectedSlateId && safeSlates.length === 0) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
        <div className="mx-auto max-w-[1600px] space-y-6">
          <AppNav />

          <section className="rounded-3xl border border-dashed border-slate-300 bg-white px-5 py-10 text-center shadow-sm">
            <h1 className="text-2xl font-bold tracking-tight">
              No Scores Yet
            </h1>

            <p className="mt-2 text-sm text-slate-600">
              Create a slate before viewing live scores.
            </p>
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

  const { data: rosterSlotsData } = await supabaseAdmin
    .from("roster_slots")
    .select("sport, position, slot_count, display_order")
    .eq("sport", sport)
    .order("display_order", { ascending: true });

  rosterSlots = rosterSlotsData ?? [];

  if (selectedSlateId) {
    const { data: lineupsData } = await supabaseAdmin
      .from("lineups")
      .select(
        `
        id,
        team_id,
        lineup_players (
          player_id,
          projected_fantasy_points
        )
        `
      )
      .eq("slate_id", selectedSlateId);

    savedLineupsForInitialSlate =
      lineupsData?.map((lineup) => {
        const lineupPlayerRows =
          lineup.lineup_players?.map(
            (lp: {
              player_id: number;
              projected_fantasy_points: number | null;
            }) => lp
          ) ?? [];

        const hasCompleteProjectionSnapshot =
          lineupPlayerRows.length > 0 &&
          lineupPlayerRows.every(
            (lp) =>
              lp.projected_fantasy_points !== null &&
              Number.isFinite(Number(lp.projected_fantasy_points))
          );

        return {
          team_id: lineup.team_id,
          player_ids: lineupPlayerRows.map((lp) => lp.player_id),
          pregame_projected_points: hasCompleteProjectionSnapshot
            ? Number(
                lineupPlayerRows
                  .reduce(
                    (sum, lp) =>
                      sum + Number(lp.projected_fantasy_points ?? 0),
                    0
                  )
                  .toFixed(1)
              )
            : null,
        };
      }) ?? [];

    const { data: statsData } =
      sport === "golf"
        ? await supabaseAdmin
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
              tee_time_raw,
              golf_rounds (
                round_number,
                score_to_par,
                score_display,
                strokes,
                holes_completed,
                tee_time,
                tee_time_raw,
                status,
                golf_holes (
                  hole_number,
                  strokes,
                  relative_to_par,
                  score_display
                )
              )
            `,
            )
            .eq("slate_id", selectedSlateId)
        : await supabaseAdmin
            .from(statsTable)
            .select("*")
            .eq("slate_id", selectedSlateId);

    const { data: teamResultsData } = await supabaseAdmin
      .from("team_slate_results")
      .select("*")
      .eq("slate_id", selectedSlateId);

    playerStats =
      sport === "golf"
        ? (statsData ?? []).map((row: any) => ({
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
            rounds: (row.golf_rounds ?? [])
              .map((round: any) => ({
                round_number: Number(round.round_number),
                score_to_par:
                  round.score_to_par === null
                    ? null
                    : Number(round.score_to_par),
                score_display: round.score_display ?? null,
                strokes:
                  round.strokes === null ? null : Number(round.strokes),
                holes_completed: Number(round.holes_completed ?? 0),
                tee_time: round.tee_time ?? null,
                tee_time_raw: round.tee_time_raw ?? null,
                status: round.status ?? "scheduled",
                holes: (round.golf_holes ?? [])
                  .map((hole: any) => ({
                    hole_number: Number(hole.hole_number),
                    strokes:
                      hole.strokes === null ? null : Number(hole.strokes),
                    relative_to_par:
                      hole.relative_to_par === null
                        ? null
                        : Number(hole.relative_to_par),
                    score_display: hole.score_display ?? null,
                  }))
                  .sort(
                    (
                      a: { hole_number: number },
                      b: { hole_number: number },
                    ) => a.hole_number - b.hole_number,
                  ),
              }))
              .sort(
                (
                  a: { round_number: number },
                  b: { round_number: number },
                ) => a.round_number - b.round_number,
              ),
          }))
        : statsData ?? [];
    teamResults = teamResultsData ?? [];
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <AppNav />

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
          defaultViewMode="scoring"
          sport={sport}
        />
      </div>
    </main>
  );
}
