"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import TeamAvatar from "@/components/ui/TeamAvatar";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import type {
  OrderedTeam,
  Player,
  PlayerStat,
  RosterSlotConfig,
  Slate,
} from "@/components/lineups/types";

type TeamStats = {
  totalPlayers: number;
  total: number;
  games_completed: number;
  games_in_progress: number;
  games_remaining: number;
  finish_position: number | null;
};

type RefreshSummary = {
  gamesFound?: number;
  playerStatsUpserted?: number;
  teamResultsUpserted?: number;
} | null;

type Props = {
  teams: OrderedTeam[];
  selectedSlate: Slate | null;
  rosterSlots?: RosterSlotConfig[];
  lastRefreshSummary: RefreshSummary;
  getPlayersForTeam: (teamId: number) => Player[];
  getTeamStats: (teamId: number) => TeamStats;
  getRawPlayerStat: (playerId: number) => PlayerStat | null;
  controls?: ReactNode;
  setProfilePlayer: (player: Player | null) => void;
};

function formatGolfScore(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return "—";
  if (numeric === 0) return "E";
  return numeric > 0 ? `+${numeric}` : String(numeric);
}

function formatLeaderboardPosition(value: number | null | undefined) {
  if (!value) return "—";
  return `T${value}`;
}

function statusMeta(stat: PlayerStat | null) {
  const status = stat?.status ?? "scheduled";

  if (status === "active") {
    return {
      label: "Live",
      detail: stat?.last_hole
        ? `R${stat.current_round ?? "—"} · Thru ${stat.last_hole}`
        : `Round ${stat?.current_round ?? "—"}`,
      className: "bg-emerald-100 text-emerald-800",
    };
  }

  if (status === "finished") {
    return {
      label: "Final",
      detail: "Tournament complete",
      className: "bg-slate-200 text-slate-700",
    };
  }

  if (status === "cut") {
    return {
      label: "CUT",
      detail: "Missed cut",
      className: "bg-red-100 text-red-800",
    };
  }

  if (status === "withdrawn") {
    return {
      label: "WD",
      detail: "Withdrawn",
      className: "bg-amber-100 text-amber-800",
    };
  }

  if (status === "disqualified") {
    return {
      label: "DQ",
      detail: "Disqualified",
      className: "bg-red-100 text-red-800",
    };
  }

  return {
    label: "Upcoming",
    detail: stat?.tee_time_raw || "Not started",
    className: "bg-sky-100 text-sky-800",
  };
}

function relativeClass(relative: number | null | undefined) {
  if (relative === null || relative === undefined) {
    return "border-slate-200 bg-slate-50 text-slate-400";
  }

  if (relative <= -2) {
    return "border-emerald-700 bg-emerald-700 text-white";
  }

  if (relative === -1) {
    return "border-emerald-300 bg-emerald-100 text-emerald-900";
  }

  if (relative === 0) {
    return "border-slate-200 bg-white text-slate-700";
  }

  if (relative === 1) {
    return "border-red-300 bg-red-100 text-red-900";
  }

  return "border-red-700 bg-red-700 text-white";
}

function relativeLabel(relative: number | null | undefined) {
  if (relative === null || relative === undefined) return "—";
  if (relative === 0) return "E";
  return relative > 0 ? `+${relative}` : String(relative);
}

function medalForPosition(position: number) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return `${position}.`;
}

export default function GolfScoresDashboard({
  teams,
  selectedSlate,
  rosterSlots,
  lastRefreshSummary,
  getPlayersForTeam,
  getTeamStats,
  getRawPlayerStat,
  controls,
  setProfilePlayer,
}: Props) {
  const participatingTeams = useMemo(
    () => teams.filter((team) => team.is_participating !== false),
    [teams],
  );

  const leaderboard = useMemo(
    () =>
      participatingTeams
        .map((team) => {
          const teamPlayers = getPlayersForTeam(team.id);
          const playerStatuses = teamPlayers.map(
            (player) => getRawPlayerStat(player.id)?.status ?? "scheduled",
          );

          const terminalStatuses = new Set([
            "finished",
            "cut",
            "withdrawn",
            "disqualified",
          ]);

          const completed = playerStatuses.filter((status) =>
            terminalStatuses.has(status),
          ).length;

          const live = playerStatuses.filter(
            (status) => status === "active",
          ).length;

          const upcoming = playerStatuses.filter((status) =>
            ["scheduled", "did_not_start"].includes(status),
          ).length;

          return {
            team,
            stats: getTeamStats(team.id),
            rosterStatus: {
              completed,
              live,
              upcoming,
              filled: teamPlayers.length,
            },
          };
        })
        .sort(
          (a, b) =>
            Number(a.stats.total ?? 0) - Number(b.stats.total ?? 0),
        ),
    [
      participatingTeams,
      getPlayersForTeam,
      getRawPlayerStat,
      getTeamStats,
    ],
  );

  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(
    leaderboard[0]?.team.id ?? null,
  );

  useEffect(() => {
    if (
      selectedTeamId === null ||
      !participatingTeams.some((team) => team.id === selectedTeamId)
    ) {
      setSelectedTeamId(leaderboard[0]?.team.id ?? null);
    }
  }, [leaderboard, participatingTeams, selectedTeamId]);

  const selectedTeam =
    participatingTeams.find((team) => team.id === selectedTeamId) ??
    leaderboard[0]?.team ??
    null;

  if (!selectedTeam) {
    return (
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        No participating teams are available.
      </section>
    );
  }

  const selectedStats = getTeamStats(selectedTeam.id);
  const selectedRank =
    leaderboard.findIndex((row) => row.team.id === selectedTeam.id) + 1;

  const players = getPlayersForTeam(selectedTeam.id);

  const totalSlots =
    rosterSlots && rosterSlots.length > 0
      ? rosterSlots.reduce((sum, slot) => sum + slot.slot_count, 0)
      : 4;

  const rosterRows: Array<Player | null> = [
    ...players,
    ...Array.from(
      { length: Math.max(0, totalSlots - players.length) },
      () => null,
    ),
  ];

  const allRosterPlayers = participatingTeams.flatMap((team) =>
    getPlayersForTeam(team.id),
  );

  const allRosterStatuses = allRosterPlayers.map(
    (player) => getRawPlayerStat(player.id)?.status ?? "scheduled",
  );

  const tournamentHasActivity = allRosterStatuses.some(
    (status) => status === "active",
  );

  const terminalStatuses = new Set([
    "finished",
    "cut",
    "withdrawn",
    "disqualified",
  ]);

  const tournamentIsComplete =
    allRosterStatuses.length > 0 &&
    allRosterStatuses.every((status) =>
      terminalStatuses.has(status),
    );

  return (
    <section className="space-y-6">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 bg-gradient-to-br from-emerald-950 via-emerald-900 to-slate-950 px-5 py-6 text-white sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
              Fantasy Golf scoreboard
            </div>

            <h2 className="mt-2 text-3xl font-black">
              {selectedSlate?.label ?? "Golf Scores"}
            </h2>

            <p className="mt-2 max-w-2xl text-sm text-emerald-50/80">
              Lower fantasy scores are better. Select a golfer to view the
              complete round-by-round scorecard.
            </p>
          </div>

          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-center backdrop-blur">
            <span className="block text-xs font-bold uppercase text-emerald-200">
              Tournament
            </span>

            <strong className="mt-1 block text-xl">
              {selectedSlate?.is_locked || tournamentIsComplete
                ? "Final"
                : tournamentHasActivity
                  ? "Live"
                  : "Upcoming"}
            </strong>
          </div>
        </div>

        {controls ? (
          <div className="border-t border-slate-200 bg-white p-4">
            {controls}
          </div>
        ) : null}
      </section>

      {lastRefreshSummary ? (
        <details className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <summary className="cursor-pointer font-bold">
            ✓ Latest Golf refresh complete
          </summary>

          <div className="mt-2">
            Golfers updated:{" "}
            {lastRefreshSummary.playerStatsUpserted ?? 0}
            <span aria-hidden="true"> · </span>
            Fantasy teams updated:{" "}
            {lastRefreshSummary.teamResultsUpserted ?? 0}
          </div>
        </details>
      ) : null}

      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="mb-4">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
            League standings
          </span>
          <h3 className="mt-1 text-xl font-black text-slate-950">
            Live Leaderboard
          </h3>
        </div>

        <div className="flex gap-3 overflow-x-auto pb-2">
          {leaderboard.map((row, index) => {
            const selected = row.team.id === selectedTeam.id;

            return (
              <button
                key={row.team.id}
                type="button"
                onClick={() => setSelectedTeamId(row.team.id)}
                className={`min-w-[180px] rounded-2xl border p-4 text-left transition ${
                  selected
                    ? "border-emerald-500 bg-emerald-50 shadow-md"
                    : "border-slate-200 bg-slate-50 hover:border-emerald-300"
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-lg">
                    {medalForPosition(index + 1)}
                  </span>

                  <TeamAvatar teamName={row.team.name} size="xs" />

                  <strong className="truncate text-sm text-slate-950">
                    {row.team.name}
                  </strong>
                </div>

                <div className="mt-4 text-3xl font-black text-slate-950">
                  {formatGolfScore(row.stats.total)}
                </div>

                <div className="mt-1 text-xs font-bold uppercase text-slate-500">
                  Score
                </div>

                <div className="mt-3 text-xs text-slate-500">
                  {row.rosterStatus.completed} final ·{" "}
                  {row.rosterStatus.live} live ·{" "}
                  {row.rosterStatus.upcoming} upcoming ·{" "}
                  {row.rosterStatus.filled}/{totalSlots} filled
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <header className="flex flex-col gap-4 border-b border-slate-200 bg-slate-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <TeamAvatar teamName={selectedTeam.name} size="lg" />

            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                {selectedRank === 1
                  ? "Current leader"
                  : `Ranked #${selectedRank}`}
              </span>

              <h3 className="mt-1 text-2xl font-black text-slate-950">
                {selectedTeam.name}
              </h3>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <span className="text-xs font-bold uppercase text-slate-500">
              Score
            </span>

            <strong className="mt-1 block text-4xl font-black text-slate-950">
              {formatGolfScore(selectedStats.total)}
            </strong>
          </div>
        </header>

        <div className="space-y-4 p-4 sm:p-5">
          {rosterRows.map((player, index) => {
            if (!player) {
              return (
                <article
                  key={`empty-${index}`}
                  className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-7 text-center text-sm text-slate-500"
                >
                  Empty golfer slot
                </article>
              );
            }

            const stat = getRawPlayerStat(player.id);
            const status = statusMeta(stat);

            const rounds = [...(stat?.rounds ?? [])].sort(
              (a, b) => a.round_number - b.round_number,
            );

            const activeRound =
              rounds.find(
                (round) => round.round_number === stat?.current_round,
              ) ??
              rounds.filter((round) => round.holes_completed > 0).at(-1) ??
              null;

            const holesByNumber = new Map(
              (activeRound?.holes ?? []).map((hole) => [
                hole.hole_number,
                hole,
              ]),
            );

            return (
              <button
                key={player.id}
                type="button"
                onClick={() => setProfilePlayer(player)}
                className="block w-full overflow-hidden rounded-2xl border border-slate-200 bg-white text-left shadow-sm transition hover:border-emerald-300 hover:bg-slate-50"
                aria-label={`Open ${player.name} full Golf scorecard`}
              >
                <div className="flex w-full items-center justify-between gap-4 px-4 py-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <PlayerHeadshot
                      espnGolfPlayerId={player.espn_player_id}
                      imageUrl={player.headshot_url}
                      playerName={player.name}
                      size="md"
                    />

                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong className="truncate text-lg text-slate-950">
                        {player.name}
                      </strong>

                      <span
                        className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>

                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span>{status.detail}</span>
                      <span>
                        Position{" "}
                        {formatLeaderboardPosition(
                          stat?.leaderboard_order,
                        )}
                      </span>
                    </div>
                  </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="block text-[10px] font-bold uppercase text-emerald-700">
                      Score
                    </span>

                    <strong className="mt-1 block text-2xl font-black text-slate-950">
                      {formatGolfScore(stat?.fantasy_points)}
                    </strong>
                  </div>
                </div>

                {Number(stat?.penalty_strokes ?? 0) > 0 ? (
                  <div className="border-t border-amber-200 bg-amber-50 px-4 py-2 text-xs font-semibold text-amber-800">
                    {status.label}: +{stat?.penalty_strokes} added across
                    unplayed rounds.
                  </div>
                ) : null}

                <div className="border-t border-slate-200 bg-slate-50 px-4 py-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                        Hole-by-hole
                      </span>

                      <strong className="ml-2 text-sm text-slate-700">
                        {activeRound
                          ? `Round ${activeRound.round_number}`
                          : "Not started"}
                      </strong>
                    </div>

                    {activeRound ? (
                      <span className="text-sm font-black text-slate-950">
                        {formatGolfScore(activeRound.score_to_par)}
                      </span>
                    ) : null}
                  </div>

                  <div className="overflow-x-auto pb-1">
                    <div className="grid min-w-[680px] grid-cols-18 gap-1">
                      {Array.from(
                        { length: 18 },
                        (_, holeIndex) => holeIndex + 1,
                      ).map((holeNumber) => (
                        <div
                          key={`number-${holeNumber}`}
                          className="text-center text-[9px] font-bold text-slate-400"
                        >
                          {holeNumber}
                        </div>
                      ))}

                      {Array.from(
                        { length: 18 },
                        (_, holeIndex) => holeIndex + 1,
                      ).map((holeNumber) => {
                        const hole = holesByNumber.get(holeNumber);

                        return (
                          <div
                            key={`hole-${holeNumber}`}
                            className={`flex h-8 items-center justify-center rounded-md border text-[11px] font-black ${relativeClass(
                              hole?.relative_to_par,
                            )}`}
                            title={
                              hole?.strokes
                                ? `Hole ${holeNumber}: ${hole.strokes} strokes`
                                : `Hole ${holeNumber}: not played`
                            }
                          >
                            {relativeLabel(hole?.relative_to_par)}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="mt-3 text-right text-xs font-semibold text-emerald-700">
                    View full scorecard →
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}
