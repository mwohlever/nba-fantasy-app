"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import TeamAvatar from "@/components/ui/TeamAvatar";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import GolfLeagueView from "@/components/lineups/GolfLeagueView";
import GolfTournamentView from "@/components/lineups/GolfTournamentView";
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

type GolfScoresView =
  | "fantasy"
  | "league"
  | "tournament";

type Props = {
  players: Player[];
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

function formatGolfTeeTime(
  value: string | null | undefined,
) {
  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function statusMeta(
  stat: PlayerStat | null,
  playingRound: NonNullable<PlayerStat["rounds"]>[number] | null,
  upcomingRound: NonNullable<PlayerStat["rounds"]>[number] | null,
  mostRecentRound: NonNullable<PlayerStat["rounds"]>[number] | null,
) {
  const status = stat?.status ?? "scheduled";

  if (playingRound) {
    return {
      label: "🟢 Playing",
      detail:
        `R${playingRound.round_number} · ` +
        `Thru ${playingRound.holes_completed}`,
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

  if (upcomingRound) {
    return {
      label: "⏰ Upcoming",
      detail:
        `Round ${upcomingRound.round_number}` +
        `${
          formatGolfTeeTime(
            upcomingRound.tee_time ??
              upcomingRound.tee_time_raw,
          )
            ? ` · ${formatGolfTeeTime(
                upcomingRound.tee_time ??
                  upcomingRound.tee_time_raw,
              )}`
            : ""
        }`,
      className: "bg-sky-100 text-sky-800",
    };
  }

  if (mostRecentRound?.holes_completed === 18) {
    return {
      label: "✓ Round complete",
      detail: `Round ${mostRecentRound.round_number} complete`,
      className: "bg-slate-200 text-slate-700",
    };
  }

  return {
    label: "⏰ Upcoming",
    detail:
      formatGolfTeeTime(
        stat?.tee_time ?? stat?.tee_time_raw,
      ) ?? "Not started",
    className: "bg-sky-100 text-sky-800",
  };
}

function holePar(hole: {
  par?: number | null;
  strokes: number | null;
  relative_to_par: number | null;
} | null | undefined) {
  if (
    hole?.par !== null &&
    hole?.par !== undefined &&
    Number.isFinite(Number(hole.par))
  ) {
    return Number(hole.par);
  }

  if (
    hole?.strokes === null ||
    hole?.strokes === undefined ||
    hole.relative_to_par === null ||
    hole.relative_to_par === undefined
  ) {
    return null;
  }

  const par =
    Number(hole.strokes) -
    Number(hole.relative_to_par);

  return Number.isFinite(par) ? par : null;
}

function holeTooltip(
  holeNumber: number,
  hole: {
    par?: number | null;
    yards?: number | null;
    strokes: number | null;
    relative_to_par: number | null;
  } | null | undefined,
) {
  const par = holePar(hole);

  const yardage =
    hole?.yards === null ||
    hole?.yards === undefined
      ? null
      : Number(hole.yards);

  const courseDetail = [
    `Hole ${holeNumber}`,
    par === null ? null : `Par ${par}`,
    yardage === null ? null : `${yardage} yards`,
  ]
    .filter(Boolean)
    .join(" · ");

  if (
    hole?.strokes === null ||
    hole?.strokes === undefined
  ) {
    return `${courseDetail} · Not played`;
  }

  return `${courseDetail} · ${hole.strokes} strokes (${relativeLabel(
    hole.relative_to_par,
  )})`;
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

function holeResultName(
  relative: number | null | undefined,
) {
  if (relative === null || relative === undefined) {
    return "Not played";
  }

  if (relative <= -3) return "Albatross or better";
  if (relative === -2) return "Eagle";
  if (relative === -1) return "Birdie";
  if (relative === 0) return "Par";
  if (relative === 1) return "Bogey";
  if (relative === 2) return "Double bogey";
  return `+${relative}`;
}

function medalForPosition(position: number) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return `${position}.`;
}

type GolfTieMetrics = {
  bestTeamRound: number;
  bestIndividualRound: number;
  birdiesOrBetter: number;
  bogeysOrWorse: number;
  draftOrder: number;
};

function buildGolfTieMetrics(
  players: Player[],
  getRawPlayerStat: (playerId: number) => PlayerStat | null,
  draftOrder: number | null | undefined,
): GolfTieMetrics {
  const stats = players
    .map((player) => getRawPlayerStat(player.id))
    .filter(
      (stat): stat is PlayerStat =>
        stat !== null,
    );

  const completedRounds = stats.flatMap(
    (stat) =>
      (stat.rounds ?? [])
        .filter(
          (round) =>
            Number(round.holes_completed ?? 0) >= 18 &&
            round.score_to_par !== null &&
            round.score_to_par !== undefined,
        )
        .map((round) => ({
          roundNumber: Number(round.round_number),
          score: Number(round.score_to_par),
        })),
  );

  const bestIndividualRound =
    completedRounds.length > 0
      ? Math.min(
          ...completedRounds.map(
            (round) => round.score,
          ),
        )
      : Number.POSITIVE_INFINITY;

  const teamRoundScores: number[] = [];

  for (const roundNumber of [1, 2, 3, 4]) {
    const scores = stats
      .map((stat) =>
        (stat.rounds ?? []).find(
          (round) =>
            Number(round.round_number) === roundNumber &&
            Number(round.holes_completed ?? 0) >= 18 &&
            round.score_to_par !== null &&
            round.score_to_par !== undefined,
        ),
      )
      .filter(Boolean)
      .map((round) =>
        Number(round?.score_to_par),
      );

    if (
      stats.length > 0 &&
      scores.length === stats.length
    ) {
      teamRoundScores.push(
        scores.reduce(
          (sum, score) => sum + score,
          0,
        ),
      );
    }
  }

  const holes = stats.flatMap((stat) =>
    (stat.rounds ?? []).flatMap(
      (round) => round.holes ?? [],
    ),
  );

  return {
    bestTeamRound:
      teamRoundScores.length > 0
        ? Math.min(...teamRoundScores)
        : Number.POSITIVE_INFINITY,

    bestIndividualRound,

    birdiesOrBetter: holes.filter(
      (hole) =>
        hole.relative_to_par !== null &&
        hole.relative_to_par !== undefined &&
        Number(hole.relative_to_par) <= -1,
    ).length,

    bogeysOrWorse: holes.filter(
      (hole) =>
        hole.relative_to_par !== null &&
        hole.relative_to_par !== undefined &&
        Number(hole.relative_to_par) >= 1,
    ).length,

    draftOrder:
      Number.isFinite(Number(draftOrder))
        ? Number(draftOrder)
        : 999,
  };
}

function compareGolfTieMetrics(
  a: GolfTieMetrics,
  b: GolfTieMetrics,
) {
  if (a.bestTeamRound !== b.bestTeamRound) {
    return a.bestTeamRound - b.bestTeamRound;
  }

  if (
    a.bestIndividualRound !==
    b.bestIndividualRound
  ) {
    return (
      a.bestIndividualRound -
      b.bestIndividualRound
    );
  }

  if (
    a.birdiesOrBetter !==
    b.birdiesOrBetter
  ) {
    return (
      b.birdiesOrBetter -
      a.birdiesOrBetter
    );
  }

  if (
    a.bogeysOrWorse !==
    b.bogeysOrWorse
  ) {
    return (
      a.bogeysOrWorse -
      b.bogeysOrWorse
    );
  }

  return a.draftOrder - b.draftOrder;
}

function golfTiebreakLabel(
  winner: GolfTieMetrics,
  loser: GolfTieMetrics,
) {
  if (
    winner.bestTeamRound !== loser.bestTeamRound &&
    Number.isFinite(winner.bestTeamRound)
  ) {
    return `Tiebreak: team round ${formatGolfScore(
      winner.bestTeamRound,
    )}`;
  }

  if (
    winner.bestIndividualRound !==
      loser.bestIndividualRound &&
    Number.isFinite(
      winner.bestIndividualRound,
    )
  ) {
    return `Tiebreak: golfer round ${formatGolfScore(
      winner.bestIndividualRound,
    )}`;
  }

  if (
    winner.birdiesOrBetter !==
    loser.birdiesOrBetter
  ) {
    return `Tiebreak: ${winner.birdiesOrBetter} birdies+`;
  }

  if (
    winner.bogeysOrWorse !==
    loser.bogeysOrWorse
  ) {
    return `Tiebreak: ${winner.bogeysOrWorse} bogeys+`;
  }

  return `Tiebreak: draft position ${winner.draftOrder}`;
}

export default function GolfScoresDashboard({
  players: allPlayers,
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
            tieMetrics: buildGolfTieMetrics(
              teamPlayers,
              getRawPlayerStat,
              team.draft_order,
            ),
            rosterStatus: {
              completed,
              live,
              upcoming,
              filled: teamPlayers.length,
            },
          };
        })
        .sort((a, b) => {
          const scoreDifference =
            Number(a.stats.total ?? 0) -
            Number(b.stats.total ?? 0);

          if (scoreDifference !== 0) {
            return scoreDifference;
          }

          const tieDifference =
            compareGolfTieMetrics(
              a.tieMetrics,
              b.tieMetrics,
            );

          if (tieDifference !== 0) {
            return tieDifference;
          }

          return a.team.id - b.team.id;
        }),
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

  const [selectedHoleKey, setSelectedHoleKey] =
    useState<string | null>(null);

  const [activeView, setActiveView] =
    useState<GolfScoresView>("fantasy");

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
        <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-emerald-950 via-emerald-900 to-slate-950 px-5 py-5 text-white">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-300">
              Fantasy Golf scoreboard
            </div>

            <h2 className="mt-1 text-2xl font-black sm:text-3xl">
              {selectedSlate?.label ?? "Golf Scores"}
            </h2>

            <p className="mt-1 hidden max-w-2xl text-sm text-emerald-50/80 sm:block">
              Lower fantasy scores are better. Select a golfer to view the
              complete round-by-round scorecard.
            </p>
          </div>

          <div className="shrink-0 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-center backdrop-blur">
            <span className="hidden text-[9px] font-bold uppercase text-emerald-200 sm:block">
              Tournament
            </span>

            <strong className="block text-sm sm:mt-0.5 sm:text-base">
              {selectedSlate?.is_locked || tournamentIsComplete
                ? "Final"
                : tournamentHasActivity
                  ? "Live"
                  : "Upcoming"}
            </strong>
          </div>
        </div>

        {controls ? (
          <div className="border-t border-slate-200 bg-white p-3">
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

      <nav
        className="rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm"
        aria-label="Golf score views"
      >
        <div className="grid grid-cols-3 gap-1.5">
          {(
            [
              {
                key: "fantasy",
                label: "Fantasy",
                shortDescription: "Teams",
              },
              {
                key: "league",
                label: "League",
                shortDescription: "Drafted golfers",
              },
              {
                key: "tournament",
                label: "Tournament",
                shortDescription: "Full field",
              },
            ] satisfies Array<{
              key: GolfScoresView;
              label: string;
              shortDescription: string;
            }>
          ).map((view) => {
            const isActive =
              activeView === view.key;

            return (
              <button
                key={view.key}
                type="button"
                onClick={() => {
                  setActiveView(view.key);
                  setSelectedHoleKey(null);
                }}
                aria-pressed={isActive}
                className={`rounded-xl px-2 py-2.5 text-center transition sm:px-4 ${
                  isActive
                    ? "bg-emerald-700 text-white shadow-sm"
                    : "text-slate-600 hover:bg-emerald-50 hover:text-emerald-800"
                }`}
              >
                <span className="block text-sm font-black">
                  {view.label}
                </span>

                <span
                  className={`mt-0.5 hidden text-[10px] font-semibold sm:block ${
                    isActive
                      ? "text-emerald-100"
                      : "text-slate-400"
                  }`}
                >
                  {view.shortDescription}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      {activeView === "fantasy" ? (
        <>
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
            const selected =
              row.team.id === selectedTeam.id;

            const nextTiedTeam =
              leaderboard
                .slice(index + 1)
                .find(
                  (candidate) =>
                    Number(
                      candidate.stats.total ?? 0,
                    ) ===
                    Number(row.stats.total ?? 0),
                ) ?? null;

            const previousTiedTeam =
              [...leaderboard]
                .slice(0, index)
                .reverse()
                .find(
                  (candidate) =>
                    Number(
                      candidate.stats.total ?? 0,
                    ) ===
                    Number(row.stats.total ?? 0),
                ) ?? null;

            const tiebreakLabel =
              nextTiedTeam
                ? golfTiebreakLabel(
                    row.tieMetrics,
                    nextTiedTeam.tieMetrics,
                  )
                : previousTiedTeam
                  ? `Lost ${golfTiebreakLabel(
                      previousTiedTeam.tieMetrics,
                      row.tieMetrics,
                    ).toLowerCase()}`
                  : null;

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

                {tiebreakLabel ? (
                  <div
                    className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-[10px] font-bold text-amber-900"
                    title={tiebreakLabel}
                  >
                    {tiebreakLabel}
                  </div>
                ) : null}

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

            const rounds = [...(stat?.rounds ?? [])].sort(
              (a, b) => a.round_number - b.round_number,
            );

            const playingRound =
              rounds
                .filter(
                  (round) =>
                    round.holes_completed > 0 &&
                    round.holes_completed < 18,
                )
                .at(-1) ?? null;

            const upcomingRound =
              rounds.find(
                (round) =>
                  round.holes_completed === 0 &&
                  round.strokes === null &&
                  Boolean(
                    round.tee_time ||
                      round.tee_time_raw,
                  ),
              ) ?? null;

            const mostRecentRound =
              rounds
                .filter(
                  (round) =>
                    round.holes_completed > 0 ||
                    round.strokes !== null,
                )
                .at(-1) ?? null;

            const displayRound =
              playingRound ??
              mostRecentRound ??
              upcomingRound ??
              rounds[0] ??
              null;

            const status = statusMeta(
              stat,
              playingRound,
              upcomingRound,
              mostRecentRound,
            );

            const scorecardContext = playingRound
              ? "Current round"
              : mostRecentRound
                ? "Most recent round"
                : upcomingRound
                  ? "Upcoming round"
                  : "Round";

            const holesByNumber = new Map(
              (displayRound?.holes ?? []).map((hole) => [
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
                        {displayRound
                          ? `${scorecardContext} · Round ${displayRound.round_number}`
                          : "Not started"}
                      </strong>
                    </div>

                    {displayRound ? (
                      <span className="text-sm font-black text-slate-950">
                        {formatGolfScore(displayRound.score_to_par)}
                      </span>
                    ) : null}
                  </div>

                  <div
                    className={`overflow-x-auto ${
                      selectedHoleKey?.startsWith(
                        `${player.id}:${displayRound?.round_number ?? 0}:`,
                      )
                        ? "pb-28"
                        : "pb-1"
                    }`}
                  >
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
                        const hole =
                          holesByNumber.get(holeNumber);

                        return (
                          <div
                            key={`par-${holeNumber}`}
                            className={
                              holeNumber === 1
                                ? "relative text-center text-[8px] font-bold text-slate-500 before:absolute before:right-full before:mr-1.5 before:content-['Par']"
                                : "text-center text-[8px] font-bold text-slate-500"
                            }
                          >
                            {holePar(hole) ?? "—"}
                          </div>
                        );
                      })}

                      {Array.from(
                        { length: 18 },
                        (_, holeIndex) => holeIndex + 1,
                      ).map((holeNumber) => {
                        const hole =
                          holesByNumber.get(holeNumber);

                        const holeKey =
                          `${player.id}:` +
                          `${displayRound?.round_number ?? 0}:` +
                          `${holeNumber}`;

                        const isSelected =
                          selectedHoleKey === holeKey;

                        const par = holePar(hole);

                        const yardage =
                          hole?.yards === null ||
                          hole?.yards === undefined
                            ? null
                            : Number(hole.yards);

                        return (
                          <div
                            key={`hole-${holeNumber}`}
                            className="relative"
                            role="button"
                            tabIndex={0}
                            title={holeTooltip(
                              holeNumber,
                              hole,
                            )}
                            aria-label={holeTooltip(
                              holeNumber,
                              hole,
                            )}
                            aria-expanded={isSelected}
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();

                              setSelectedHoleKey(
                                isSelected
                                  ? null
                                  : holeKey,
                              );
                            }}
                            onKeyDown={(event) => {
                              if (
                                event.key !== "Enter" &&
                                event.key !== " "
                              ) {
                                return;
                              }

                              event.preventDefault();
                              event.stopPropagation();

                              setSelectedHoleKey(
                                isSelected
                                  ? null
                                  : holeKey,
                              );
                            }}
                            onBlur={() =>
                              setSelectedHoleKey(
                                (current) =>
                                  current === holeKey
                                    ? null
                                    : current,
                              )
                            }
                          >
                            <div
                              className={`flex h-8 items-center justify-center rounded-md border text-[11px] font-black ${relativeClass(
                                hole?.relative_to_par,
                              )}`}
                            >
                              {relativeLabel(
                                hole?.relative_to_par,
                              )}
                            </div>

                            {isSelected ? (
                              <div
                                role="tooltip"
                                className="absolute left-1/2 top-full z-30 mt-2 w-44 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-left text-white shadow-xl"
                              >
                                <div className="text-xs font-black">
                                  Hole {holeNumber}
                                </div>

                                <div className="mt-1 text-[11px] text-slate-300">
                                  {par === null
                                    ? "Par —"
                                    : `Par ${par}`}

                                  {yardage !== null
                                    ? ` · ${yardage} yards`
                                    : ""}
                                </div>

                                <div className="mt-1 text-[11px] font-bold text-emerald-300">
                                  {hole?.strokes === null ||
                                  hole?.strokes === undefined
                                    ? "Not played"
                                    : `${hole.strokes} strokes · ${holeResultName(
                                        hole.relative_to_par,
                                      )} (${relativeLabel(
                                        hole.relative_to_par,
                                      )})`}
                                </div>

                                <span
                                  aria-hidden="true"
                                  className="absolute bottom-full left-1/2 -translate-x-1/2 border-x-8 border-b-8 border-x-transparent border-b-slate-950"
                                />
                              </div>
                            ) : null}
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
        </>
      ) : activeView === "league" ? (
        <GolfLeagueView
          teams={participatingTeams}
          getPlayersForTeam={getPlayersForTeam}
          getRawPlayerStat={getRawPlayerStat}
          setProfilePlayer={setProfilePlayer}
        />
      ) : (
        <GolfTournamentView
          players={allPlayers}
          teams={participatingTeams}
          getPlayersForTeam={getPlayersForTeam}
          getRawPlayerStat={getRawPlayerStat}
          setProfilePlayer={setProfilePlayer}
        />
      )}
    </section>
  );
}
