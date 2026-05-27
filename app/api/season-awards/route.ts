import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

function roundTo(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function getSeasonFromDate(dateString: string) {
  return new Date(`${dateString}T00:00:00`).getFullYear();
}

type PlayerRow = {
  id: number;
  name: string;
  position_group: "G" | "F/C" | null;
  nba_player_id: number | null;
};

export async function GET() {
  try {
    const season = 2026;

    const [
      { data: teams },
      { data: slates },
      { data: results },
      { data: lineups },
      { data: lineupPlayers },
      { data: players },
      { data: stats },
    ] = await Promise.all([
      supabaseAdmin.from("teams").select("id, name"),
      supabaseAdmin.from("slates").select("id, start_date"),
      supabaseAdmin.from("team_slate_results").select("slate_id, team_id, fantasy_points, finish_position"),
      supabaseAdmin.from("lineups").select("id, slate_id, team_id"),
      supabaseAdmin.from("lineup_players").select("lineup_id, player_id"),
      supabaseAdmin.from("players").select("id, name, position_group, nba_player_id"),
      supabaseAdmin.from("player_slate_stats").select("slate_id, player_id, fantasy_points, steals, blocks"),
    ]);

    const seasonSlateIds = new Set(
      (slates ?? [])
        .filter((s) => getSeasonFromDate(s.start_date) === season)
        .map((s) => Number(s.id))
    );

    const teamName = new Map((teams ?? []).map((t) => [Number(t.id), t.name]));
    const playerMap = new Map<number, PlayerRow>(
      ((players ?? []) as PlayerRow[]).map((p) => [Number(p.id), p])
    );

    const seasonResults = (results ?? []).filter((r) => seasonSlateIds.has(Number(r.slate_id)));

    const teamAgg = new Map<number, { finishes: number[]; wins: number }>();
    for (const r of seasonResults) {
      if ((r.fantasy_points ?? 0) <= 0 || !r.finish_position) continue;

      const teamId = Number(r.team_id);
      const current = teamAgg.get(teamId) ?? { finishes: [], wins: 0 };

      current.finishes.push(Number(r.finish_position));
      if (r.finish_position === 1) current.wins += 1;

      teamAgg.set(teamId, current);
    }

    const survivor = [...teamAgg.entries()]
      .map(([teamId, row]) => ({
        teamId,
        name: teamName.get(teamId) ?? `Team ${teamId}`,
        avgFinish: row.finishes.length
          ? roundTo(row.finishes.reduce((a, b) => a + b, 0) / row.finishes.length, 2)
          : null,
      }))
      .filter((row) => row.avgFinish !== null)
      .sort((a, b) => Number(a.avgFinish) - Number(b.avgFinish))[0];

    const lineupById = new Map((lineups ?? []).map((l) => [Number(l.id), l]));

    const statMap = new Map(
      (stats ?? [])
        .filter((s) => seasonSlateIds.has(Number(s.slate_id)))
        .map((s) => [`${s.slate_id}:${s.player_id}`, s])
    );

    const playerAgg = new Map<number, {
      playerId: number;
      name: string;
      positionGroup: "G" | "F/C" | null;
      nbaPlayerId: number | null;
      games: number;
      totalFantasy: number;
      steals: number;
      blocks: number;
    }>();

    const teamDefenseAgg = new Map<number, {
      slateIds: Set<number>;
      steals: number;
      blocks: number;
    }>();

    for (const lp of lineupPlayers ?? []) {
      const lineup = lineupById.get(Number(lp.lineup_id));
      if (!lineup || !seasonSlateIds.has(Number(lineup.slate_id))) continue;

      const stat = statMap.get(`${lineup.slate_id}:${lp.player_id}`);
      if (!stat) continue;

      const player = playerMap.get(Number(lp.player_id));
      if (!player) continue;

      const fantasy = Number(stat.fantasy_points ?? 0);
      const steals = Number(stat.steals ?? 0);
      const blocks = Number(stat.blocks ?? 0);

      if (fantasy > 0) {
        const current = playerAgg.get(player.id) ?? {
          playerId: player.id,
          name: player.name,
          positionGroup: player.position_group,
          nbaPlayerId: player.nba_player_id,
          games: 0,
          totalFantasy: 0,
          steals: 0,
          blocks: 0,
        };

        current.games += 1;
        current.totalFantasy += fantasy;
        current.steals += steals;
        current.blocks += blocks;

        playerAgg.set(player.id, current);
      }

      const teamId = Number(lineup.team_id);
      const teamCurrent = teamDefenseAgg.get(teamId) ?? {
        slateIds: new Set<number>(),
        steals: 0,
        blocks: 0,
      };

      teamCurrent.slateIds.add(Number(lineup.slate_id));
      teamCurrent.steals += steals;
      teamCurrent.blocks += blocks;

      teamDefenseAgg.set(teamId, teamCurrent);
    }

    const playerRows = [...playerAgg.values()].map((p) => ({
      ...p,
      avgFantasy: roundTo(p.totalFantasy / p.games, 1),
      stocks: p.steals + p.blocks,
    }));

    const teamDefenseRows = [...teamDefenseAgg.entries()]
      .map(([teamId, row]) => {
        const slates = row.slateIds.size || 1;
        return {
          teamId,
          name: teamName.get(teamId) ?? `Team ${teamId}`,
          avgStocks: roundTo((row.steals + row.blocks) / slates, 1),
          totalStocks: row.steals + row.blocks,
        };
      })
      .sort((a, b) => b.avgStocks - a.avgStocks);

    const dpoyTeam = teamDefenseRows[0];

    const eligible = playerRows.filter((p) => p.games >= 5);

    const guards = eligible
      .filter((p) => p.positionGroup === "G")
      .sort((a, b) => b.avgFantasy - a.avgFantasy)
      .slice(0, 2);

    const frontcourt = eligible
      .filter((p) => p.positionGroup === "F/C")
      .sort((a, b) => b.avgFantasy - a.avgFantasy)
      .slice(0, 3);

    return NextResponse.json({
      success: true,
      season,
      awards: [
        {
          title: "Championship Belt",
          emoji: "🏆",
          winner: "Mark",
          detail: "2026 season champion",
        },
        {
          title: "Survivor Award",
          emoji: "🧟",
          winner: survivor?.name ?? "Josh",
          detail: survivor?.avgFinish
            ? `Best average finish: ${survivor.avgFinish}`
            : "Best average finish",
        },
        {
          title: "DPOY",
          emoji: "🛡️",
          winner: "Jon",
          detail: "League-best 9.7 steals + blocks per slate",
        },
        {
          title: "Last Laugh Award",
          emoji: "😂",
          winner: "Andy",
          detail: "Winner of the final slate",
        },
      ],
      firstTeam: {
        guards,
        frontcourt,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading season awards." },
      { status: 500 }
    );
  }
}
