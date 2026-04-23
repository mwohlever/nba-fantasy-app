export const dynamic = "force-dynamic";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import AppNav from "@/components/AppNav";
import LineupBuilder from "@/components/lineups/LineupBuilder";
import RefreshPlayersButton from "@/components/lineups/RefreshPlayersButton";

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSlateLabel(startDate: string, endDate: string) {
  return startDate === endDate ? startDate : `${startDate} - ${endDate}`;
}

type Slate = {
  id: number;
  date: string;
  start_date?: string;
  end_date?: string;
  label?: string;
  is_locked: boolean;
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

export default async function DraftLineupsPage() {
  const today = getTodayDateString();

  const [
    { data: players, error: playersError },
    { data: teams, error: teamsError },
    { data: slates, error: slatesError },
    { data: slateTeams, error: slateTeamsError },
    { data: allPlayerStats, error: allPlayerStatsError },
  ] = await Promise.all([
    supabaseAdmin
      .from("players")
      .select("id, name, position_group, is_active, is_playing_today")
      .eq("is_active", true)
      .order("name", { ascending: true }),
    supabaseAdmin.from("teams").select("id, name").order("name", { ascending: true }),
    supabaseAdmin
      .from("slates")
      .select("id, date, start_date, end_date, is_locked")
      .order("start_date", { ascending: false })
      .order("end_date", { ascending: false }),
    supabaseAdmin
      .from("slate_teams")
      .select("slate_id, team_id, draft_order, is_participating")
      .order("slate_id", { ascending: true })
      .order("draft_order", { ascending: true }),
    supabaseAdmin.from("player_slate_stats").select("player_id, fantasy_points"),
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

  const safeSlates: Slate[] =
    (slates ?? []).map((slate) => {
      const startDate = slate.start_date ?? slate.date;
      const endDate = slate.end_date ?? slate.date;

      return {
        id: slate.id,
        date: slate.date,
        start_date: startDate,
        end_date: endDate,
        label: formatSlateLabel(startDate, endDate),
        is_locked: slate.is_locked,
      };
    }) ?? [];

  const safeSlateTeams = (slateTeams ?? []) as SlateTeamConfig[];

  const safeAllPlayerStats = allPlayerStats ?? [];
  const playerAverageMap = new Map<number, { total: number; count: number }>();

  safeAllPlayerStats.forEach((row) => {
    const playerId = Number(row.player_id);
    const fantasyPoints = Number(row.fantasy_points ?? 0);

    if (!Number.isFinite(playerId)) return;
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

  let selectedSlateId =
    safeSlates.find((slate) => slate.date === today)?.id ?? safeSlates[0]?.id ?? null;

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
                  Draft players fast without the score-tracking clutter.
                </p>
              </div>

              <RefreshPlayersButton />
            </div>

            <div className="mt-6 rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No slates exist yet. Create one first.
            </div>
          </section>
        </div>
      </main>
    );
  }

  let savedLineupsForInitialSlate: SavedLineup[] = [];
  let playerStats: any[] = [];
  let teamResults: any[] = [];

  if (selectedSlateId) {
    const { data: lineupsData } = await supabaseAdmin
      .from("lineups")
      .select(
        `
        id,
        team_id,
        lineup_players (
          player_id
        )
        `
      )
      .eq("slate_id", selectedSlateId);

    savedLineupsForInitialSlate =
      lineupsData?.map((lineup) => ({
        team_id: lineup.team_id,
        player_ids:
          lineup.lineup_players?.map((lp: { player_id: number }) => lp.player_id) ?? [],
      })) ?? [];

    const { data: statsData } = await supabaseAdmin
      .from("player_slate_stats")
      .select("*")
      .eq("slate_id", selectedSlateId);

    const { data: teamResultsData } = await supabaseAdmin
      .from("team_slate_results")
      .select("*")
      .eq("slate_id", selectedSlateId);

    playerStats = statsData ?? [];
    teamResults = teamResultsData ?? [];
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Draft</h1>
              <p className="mt-2 text-sm text-slate-600">
                Draft players fast without the score-tracking clutter.
              </p>
            </div>

            <RefreshPlayersButton />
          </div>
        </section>

        <LineupBuilder
          players={players ?? []}
          teams={teams ?? []}
          slates={safeSlates}
          slateTeamConfigs={safeSlateTeams}
          playerAverages={playerAverages}
          initialSelectedSlateId={selectedSlateId}
          savedLineupsForInitialSlate={savedLineupsForInitialSlate}
          playerStats={playerStats}
          teamResults={teamResults}
          defaultViewMode="draft"
        />
      </div>
    </main>
  );
}
