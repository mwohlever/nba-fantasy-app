"use client";

import type { OrderedTeam, Player } from "@/components/lineups/types";

type PlayerStatLine = {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fantasy_points: number;
};

type TeamStats = {
  totalPlayers: number;
  guards: number;
  fcPlayers: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  total: number;
  games_completed: number;
  games_in_progress: number;
  games_remaining: number;
  finish_position: number | null;
};

type DailySummary = {
  leader: {
    teamId: number;
    teamName: string;
    total: number;
    games_completed: number;
    games_in_progress: number;
    games_remaining: number;
    finish_position: number | null;
    is_participating: boolean;
  } | null;
};

type LastRefreshSummary = {
  gamesFound?: number;
  playerStatsUpserted?: number;
  teamResultsUpserted?: number;
} | null;

type ScoringBoardProps = {
  orderedTeamsForSlate: OrderedTeam[];
  compactView: boolean;
  dailySummary: DailySummary;
  lastRefreshSummary: LastRefreshSummary;
  getPlayersForTeam: (teamId: number) => Player[];
  getTeamStats: (teamId: number) => TeamStats;
  getPlayerStat: (playerId: number) => PlayerStatLine;
  scoreTableCellClass: string;
  scoreTableHeaderClass: string;
};

export default function ScoringBoard({
  orderedTeamsForSlate,
  compactView,
  dailySummary,
  lastRefreshSummary,
  getPlayersForTeam,
  getTeamStats,
  getPlayerStat,
  scoreTableCellClass,
  scoreTableHeaderClass,
}: ScoringBoardProps) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Scores</h2>
          <p className="text-sm text-slate-600">
            Lineups and live totals for the selected slate.
          </p>
        </div>

        {dailySummary.leader ? (
          <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-slate-700">
            <div className="text-xs uppercase tracking-wide text-orange-700">
              Leader
            </div>
            <div className="font-semibold text-slate-900">
              {dailySummary.leader.teamName} • {dailySummary.leader.total.toFixed(1)}
            </div>
          </div>
        ) : null}
      </div>

      {lastRefreshSummary ? (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          Refresh complete — Games found: {lastRefreshSummary.gamesFound ?? 0},
          Players updated: {lastRefreshSummary.playerStatsUpserted ?? 0}, Teams
          updated: {lastRefreshSummary.teamResultsUpserted ?? 0}
        </div>
      ) : null}

      <div className="overflow-x-auto -mx-4 px-4">
        <div className={`${compactView ? "min-w-[720px]" : "min-w-[1100px]"} space-y-4`}>
          {orderedTeamsForSlate.map((team) => {
            const teamPlayers = getPlayersForTeam(team.id);
            const stats = getTeamStats(team.id);

            const guards = teamPlayers.filter((p) => p.position_group === "G");
            const fcs = teamPlayers.filter((p) => p.position_group === "F/C");

            const rosterRows: Array<{
              slot: string;
              player: Player | null;
            }> = [
              { slot: "G", player: guards[0] ?? null },
              { slot: "G", player: guards[1] ?? null },
              { slot: "F/C", player: fcs[0] ?? null },
              { slot: "F/C", player: fcs[1] ?? null },
              { slot: "F/C", player: fcs[2] ?? null },
            ];

            const isParticipating = team.is_participating !== false;

            return (
              <div
                key={team.id}
                className={`rounded-2xl border border-slate-200 bg-white ${
                  !isParticipating ? "opacity-70" : ""
                }`}
              >
                <div
                  className={`flex items-center justify-between bg-slate-50 ${
                    compactView ? "px-3 py-2" : "px-4 py-3"
                  }`}
                >
                  <div className={`${compactView ? "text-base" : "text-lg"} font-semibold text-slate-900`}>
                    {team.name}
                    {!isParticipating ? " (Out)" : ""}
                    {team.draft_order ? ` • #${team.draft_order}` : ""}
                  </div>
                  <div className={`${compactView ? "text-xs" : "text-sm"} text-slate-600`}>
                    Total:{" "}
                    {typeof stats.total === "number" ? stats.total.toFixed(1) : "0.0"} • C:{" "}
                    {stats.games_completed} • P: {stats.games_in_progress} • R:{" "}
                    {stats.games_remaining}
                  </div>
                </div>

                <table
                  className={`w-full border-separate border-spacing-0 ${
                    compactView ? "table-fixed text-xs" : "text-sm"
                  }`}
                >
                  <thead className="bg-slate-100 text-slate-700">
                    {compactView ? (
                      <tr className="text-left">
                        <th className={`${scoreTableHeaderClass} sticky left-0 z-30 w-[40px]`}>
                          <div className="w-[40px] min-w-[40px] border-b border-r border-slate-200 bg-slate-100 px-2 py-1 font-semibold">
                            Pos
                          </div>
                        </th>
                        <th className={`${scoreTableHeaderClass} sticky left-[40px] z-30 w-[128px]`}>
                          <div className="w-[128px] min-w-[128px] border-b border-r border-slate-200 bg-slate-100 px-2 py-1 font-semibold">
                            Player
                          </div>
                        </th>
                        <th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>PTS</th>
                        <th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>REB</th>
                        <th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>AST</th>
                        <th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>STL</th>
                        <th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>BLK</th>
                        <th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>TO</th>
                        <th className={`${scoreTableHeaderClass} w-[42px] text-right px-1 py-1`}>TOT</th>
                      </tr>
                    ) : (
                      <tr className="text-left">
                        <th className={scoreTableHeaderClass}>Position</th>
                        <th className={scoreTableHeaderClass}>Player</th>
                        <th className={scoreTableHeaderClass}>Points (1)</th>
                        <th className={scoreTableHeaderClass}>Rebounds (1.2)</th>
                        <th className={scoreTableHeaderClass}>Assists (1.5)</th>
                        <th className={scoreTableHeaderClass}>Steals (2)</th>
                        <th className={scoreTableHeaderClass}>Blocks (2)</th>
                        <th className={scoreTableHeaderClass}>Turnovers (-1)</th>
                        <th className={scoreTableHeaderClass}>Total</th>
                      </tr>
                    )}
                  </thead>

                  <tbody className="text-slate-800">
                    {rosterRows.map((row, index) => {
                      const stat = row.player ? getPlayerStat(row.player.id) : null;

                      return (
                        <tr key={`${team.id}-${index}`} className="border-b border-slate-100">
                          <td className={compactView ? "sticky left-0 z-20 w-[40px] p-0" : scoreTableCellClass}>
                            {compactView ? (
                              <div className="w-[40px] min-w-[40px] border-r border-slate-200 bg-white px-2 py-1">
                                {row.slot}
                              </div>
                            ) : (
                              row.slot
                            )}
                          </td>

                          <td className={compactView ? "sticky left-[40px] z-20 w-[128px] p-0" : scoreTableCellClass}>
                            {compactView ? (
                              <div className="w-[128px] min-w-[128px] border-r border-slate-200 bg-white px-2 py-1">
                                {row.player ? (
                                  <span className="block truncate">{row.player.name}</span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </div>
                            ) : row.player ? (
                              row.player.name
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>

                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stat ? stat.points : 0}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stat ? stat.rebounds : 0}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stat ? stat.assists : 0}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stat ? stat.steals : 0}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stat ? stat.blocks : 0}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stat ? stat.turnovers : 0}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stat ? Number(stat.fantasy_points).toFixed(1) : "0.0"}
                          </td>
                        </tr>
                      );
                    })}

                    <tr className="bg-slate-50 font-semibold text-slate-900">
                      <td className={compactView ? "sticky left-0 z-20 w-[40px] p-0" : scoreTableCellClass}>
                        {compactView ? (
                          <div className="w-[40px] min-w-[40px] border-r border-slate-200 bg-slate-50 px-2 py-1"></div>
                        ) : null}
                      </td>
                      <td className={compactView ? "sticky left-[40px] z-20 w-[128px] p-0" : scoreTableCellClass}>
                        {compactView ? (
                          <div className="w-[128px] min-w-[128px] border-r border-slate-200 bg-slate-50 px-2 py-1">
                            <span className="block truncate">Totals</span>
                          </div>
                        ) : (
                          <span>Totals</span>
                        )}
                      </td>
                      <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                        {stats.points}
                      </td>
                      <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                        {stats.rebounds}
                      </td>
                      <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                        {stats.assists}
                      </td>
                      <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                        {stats.steals}
                      </td>
                      <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                        {stats.blocks}
                      </td>
                      <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                        {stats.turnovers}
                      </td>
                      <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                        {typeof stats.total === "number" ? stats.total.toFixed(1) : "0.0"}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
