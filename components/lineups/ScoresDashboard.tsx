"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import GolfScoresDashboard from "@/components/lineups/GolfScoresDashboard";
import TeamAvatar from "@/components/ui/TeamAvatar";
import { getStatColumns } from "@/lib/statColumns";
import type {
  OrderedTeam,
  Player,
  PlayerStat,
  RosterSlotConfig,
  Slate,
} from "@/components/lineups/types";

type TeamStats = {
  totalPlayers: number;
  guards: number;
  fcPlayers: number;
  statTotals?: Record<string, number>;
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

type PlayerBoxScore = Record<string, number> & {
  fantasy_points: number;
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
  getPlayerStat: (playerId: number) => PlayerBoxScore;
  getRawPlayerStat: (playerId: number) => PlayerStat | null;
  getLiveProjectedTeamTotal: (teamId: number) => number;
  getPregameProjectedTeamTotal: (teamId: number) => number | null;
  liveWinPctMap: Map<number, number>;
  playerProjections: Record<number, any>;
  controls?: ReactNode;
  setProfilePlayer: (player: Player | null) => void;
};

const FALLBACK_ROSTER_SLOTS: RosterSlotConfig[] = [
  { sport: "nba", position: "G", slot_count: 2, display_order: 1 },
  { sport: "nba", position: "F/C", slot_count: 3, display_order: 2 },
];

function formatScore(value: number | null | undefined) {
  const numeric = Number(value ?? 0);

  return Number.isFinite(numeric)
    ? numeric.toFixed(1)
    : "0.0";
}

function getPlayerGameStatus(stat: PlayerStat | null) {
  if (!stat) {
    return {
      label: "Upcoming",
      tone: "upcoming",
      detail: "Not started",
    };
  }

  if (
    stat.game_status === 3 ||
    /final/i.test(stat.game_status_text ?? "")
  ) {
    return {
      label: "Final",
      tone: "final",
      detail: "Game complete",
    };
  }

  if (stat.game_status === 2) {
    const periodLabel = stat.period
      ? `Q${stat.period}`
      : "Live";

    const clock =
      stat.game_clock
        ?.replace(/^PT/, "")
        .replace("M", ":")
        .replace(/S$/, "")
        .replace(/\.0$/, "") ?? "";

    return {
      label: "Live",
      tone: "live",
      detail: [periodLabel, clock]
        .filter(Boolean)
        .join(" "),
    };
  }

  return {
    label: "Upcoming",
    tone: "upcoming",
    detail:
      stat.game_status_text?.trim() ||
      "Not started",
  };
}

function medalForPosition(position: number) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return `${position}.`;
}

function TraditionalScoresDashboard({
  teams,
  selectedSlate,
  rosterSlots,
  lastRefreshSummary,
  getPlayersForTeam,
  getTeamStats,
  getPlayerStat,
  getRawPlayerStat,
  getLiveProjectedTeamTotal,
  getPregameProjectedTeamTotal,
  liveWinPctMap,
  playerProjections,
  controls,
  setProfilePlayer,
}: Props) {
  const sport = selectedSlate?.sport ?? "nba";
  const statColumns = getStatColumns(sport);

  const effectiveRosterSlots =
    rosterSlots && rosterSlots.length > 0
      ? rosterSlots
      : FALLBACK_ROSTER_SLOTS;

  const totalRosterSlots = effectiveRosterSlots.reduce(
    (sum, slot) => sum + slot.slot_count,
    0
  );

  const participatingTeams = useMemo(
    () =>
      teams.filter(
        (team) => team.is_participating !== false
      ),
    [teams]
  );

  const leaderboard = useMemo(() => {
    return participatingTeams
      .map((team) => {
        const stats = getTeamStats(team.id);

        return {
          team,
          stats,
          score: Number(stats.total ?? 0),
          projected:
            getLiveProjectedTeamTotal(team.id),
          winPct:
            liveWinPctMap.get(team.id) ?? 0,
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [
    participatingTeams,
    getTeamStats,
    getLiveProjectedTeamTotal,
    liveWinPctMap,
  ]);

  const [selectedTeamId, setSelectedTeamId] =
    useState<number | null>(
      leaderboard[0]?.team.id ?? null
    );

  useEffect(() => {
    const selectedStillExists =
      participatingTeams.some(
        (team) => team.id === selectedTeamId
      );

    if (!selectedStillExists) {
      setSelectedTeamId(
        leaderboard[0]?.team.id ?? null
      );
    }
  }, [
    leaderboard,
    participatingTeams,
    selectedTeamId,
  ]);

  const selectedTeam =
    participatingTeams.find(
      (team) => team.id === selectedTeamId
    ) ??
    leaderboard[0]?.team ??
    null;

  if (!selectedTeam) {
    return (
      <section className="scores-dashboard-shell">
        <div className="scores-dashboard-empty">
          No participating teams are available.
        </div>
      </section>
    );
  }

  const selectedStats =
    getTeamStats(selectedTeam.id);

  const selectedProjection =
    getLiveProjectedTeamTotal(selectedTeam.id);

  const selectedPregameProjection =
    getPregameProjectedTeamTotal(selectedTeam.id);

  const selectedWinPct =
    liveWinPctMap.get(selectedTeam.id) ?? 0;

  const selectedRank =
    leaderboard.findIndex(
      (row) => row.team.id === selectedTeam.id
    ) + 1;

  const players = getPlayersForTeam(
    selectedTeam.id
  );

  const playersByPosition = new Map<string, Player[]>();
  players.forEach((player) => {
    const existing =
      playersByPosition.get(player.position_group) ?? [];
    existing.push(player);
    playersByPosition.set(player.position_group, existing);
  });

  const rosterRows: Array<{
    slot: string;
    player: Player | null;
  }> = [];

  effectiveRosterSlots.forEach((slotConfig) => {
    const positionPlayers =
      playersByPosition.get(slotConfig.position) ?? [];

    for (let i = 0; i < slotConfig.slot_count; i += 1) {
      rosterRows.push({
        slot: slotConfig.position,
        player: positionPlayers[i] ?? null,
      });
    }
  });

  const progressTotal =
    selectedStats.games_completed +
    selectedStats.games_in_progress +
    selectedStats.games_remaining;

  const progressComplete =
    progressTotal > 0
      ? (selectedStats.games_completed /
          progressTotal) *
        100
      : 0;

  const progressLive =
    progressTotal > 0
      ? (selectedStats.games_in_progress /
          progressTotal) *
        100
      : 0;

  const isFinal =
    selectedSlate?.is_locked === true ||
    (selectedStats.games_completed > 0 &&
      selectedStats.games_in_progress === 0 &&
      selectedStats.games_remaining === 0);

  const hasLiveGames =
    selectedStats.games_in_progress > 0;

  const hasStarted =
    selectedStats.games_completed > 0 ||
    hasLiveGames;

  const projectionDifference =
    selectedPregameProjection !== null
      ? Number(
          (
            Number(selectedStats.total ?? 0) -
            selectedPregameProjection
          ).toFixed(1)
        )
      : null;

  const projectionDifferenceIsNeutral =
    projectionDifference !== null &&
    Math.abs(projectionDifference) <= 1;

  const projectionDifferenceIsPositive =
    projectionDifference !== null &&
    projectionDifference > 1;

  const projectionDifferenceDisplay =
    projectionDifference === null
      ? "—"
      : projectionDifference > 0
        ? `+${projectionDifference.toFixed(1)}`
        : projectionDifference.toFixed(1);

  const gameStatusParts = [
    selectedStats.games_completed > 0
      ? `${selectedStats.games_completed} Final`
      : null,
    selectedStats.games_in_progress > 0
      ? `${selectedStats.games_in_progress} Live`
      : null,
    selectedStats.games_remaining > 0
      ? `${selectedStats.games_remaining} Left`
      : null,
  ].filter(Boolean);

  return (
    <section className="scores-dashboard-shell">
      <div className="scores-dashboard-heading">
        <div>
          <div className="scores-dashboard-kicker">
            Fantasy scoreboard
          </div>

          <h2>Scores</h2>

          <p>
            Live totals, projections, and player
            box scores.
          </p>
        </div>

        {selectedSlate?.is_locked ? (
          <span className="scores-dashboard-status scores-dashboard-status--final">
            Final
          </span>
        ) : (
          <span className="scores-dashboard-status scores-dashboard-status--live">
            Live
          </span>
        )}
      </div>

      {controls ? (
        <div className="scores-dashboard-controls">
          {controls}
        </div>
      ) : null}

      {lastRefreshSummary ? (
        <details className="scores-refresh-summary">
          <summary>
            ✓ Latest refresh complete
          </summary>

          <div>
            Games found:{" "}
            {lastRefreshSummary.gamesFound ?? 0}
            <span aria-hidden="true"> • </span>
            Players updated:{" "}
            {lastRefreshSummary.playerStatsUpserted ??
              0}
            <span aria-hidden="true"> • </span>
            Teams updated:{" "}
            {lastRefreshSummary.teamResultsUpserted ??
              0}
          </div>
        </details>
      ) : null}

      <section className="scores-leaderboard-section">
        <div className="scores-section-heading">
          <div>
            <span>League standings</span>
            <h3>Live Leaderboard</h3>
          </div>

          <small>Swipe →</small>
        </div>

        <div className="scores-leaderboard-strip">
          {leaderboard.map((row, index) => {
            const isSelected =
              row.team.id === selectedTeam.id;

            const projectedDifference =
              row.projected - row.score;

            return (
              <button
                key={row.team.id}
                type="button"
                onClick={() =>
                  setSelectedTeamId(row.team.id)
                }
                className={`scores-leaderboard-card ${
                  isSelected
                    ? "scores-leaderboard-card--selected"
                    : ""
                } ${
                  index === 0
                    ? "scores-leaderboard-card--leader"
                    : ""
                }`}
              >
                <div className="scores-leaderboard-card-top">
                  <span className="scores-leaderboard-rank">
                    {medalForPosition(index + 1)}
                  </span>

                  <TeamAvatar
                    teamName={row.team.name}
                    size="sm"
                  />

                  <strong>{row.team.name}</strong>
                </div>

                <div className="scores-leaderboard-score">
                  {formatScore(row.score)}
                  <span>FP</span>
                </div>

                <div className="scores-leaderboard-meta">
                  <span>
                    Proj{" "}
                    {formatScore(row.projected)}
                  </span>

                  <span>
                    {row.winPct.toFixed(0)}% win
                  </span>
                </div>

                <div className="scores-leaderboard-progress">
                  <div
                    style={{
                      width: `${Math.max(
                        4,
                        Math.min(row.winPct, 100)
                      )}%`,
                    }}
                  />
                </div>

                <div className="scores-leaderboard-footer">
                  <span>
                    {row.stats.games_completed} final
                  </span>

                  <span>
                    {row.stats.games_in_progress} live
                  </span>

                  <span>
                    {row.stats.games_remaining} left
                  </span>

                  {projectedDifference > 0.05 ? (
                    <em>
                      +{projectedDifference.toFixed(1)}
                    </em>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="scores-team-selector-section">
        <div className="scores-section-heading">
          <div>
            <span>Lineup view</span>
            <h3>Select Team</h3>
          </div>
        </div>

        <div className="scores-team-selector">
          {participatingTeams.map((team) => (
            <button
              key={team.id}
              type="button"
              onClick={() =>
                setSelectedTeamId(team.id)
              }
              className={
                team.id === selectedTeam.id
                  ? "scores-team-selector-active"
                  : ""
              }
            >
              <TeamAvatar
                teamName={team.name}
                size="xs"
              />

              <span>{team.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="scores-selected-team">
        <header className="scores-selected-team-header">
          <div className="scores-selected-team-identity">
            <TeamAvatar
              teamName={selectedTeam.name}
              size="lg"
            />

            <div>
              <div className="scores-selected-team-rank">
                {selectedRank === 1
                  ? "Current leader"
                  : `Ranked #${selectedRank}`}
              </div>

              <h3>{selectedTeam.name}</h3>
            </div>
          </div>

          <div className="scores-selected-team-total">
            <span>Fantasy score</span>
            <strong>
              {formatScore(selectedStats.total)}
            </strong>
            <small>FP</small>
          </div>
        </header>

        <div className="scores-selected-team-status-bar">
          {isFinal ? (
            <div className="scores-selected-team-status-item">
              <span>vs projection</span>

              <strong
                className={`scores-team-projection-delta ${
                  projectionDifference === null ||
                  projectionDifferenceIsNeutral
                    ? "scores-team-projection-delta--neutral"
                    : projectionDifferenceIsPositive
                      ? "scores-team-projection-delta--positive"
                      : "scores-team-projection-delta--negative"
                }`}
                title={
                  selectedPregameProjection !== null
                    ? `Pregame projection: ${formatScore(
                        selectedPregameProjection
                      )}`
                    : "No saved pregame projection"
                }
              >
                {projectionDifference === null
                  ? "—"
                  : `${
                      projectionDifferenceIsNeutral
                        ? "—"
                        : projectionDifferenceIsPositive
                          ? "▲"
                          : "▼"
                    } ${projectionDifferenceDisplay}`}
              </strong>
            </div>
          ) : (
            <>
              <div className="scores-selected-team-status-item">
                <span>
                  {hasStarted
                    ? "Projected final"
                    : "Pregame projection"}
                </span>

                <strong>
                  {hasStarted
                    ? formatScore(selectedProjection)
                    : selectedPregameProjection !== null
                      ? formatScore(selectedPregameProjection)
                      : formatScore(selectedProjection)}
                </strong>
              </div>

              <div className="scores-selected-team-status-divider" aria-hidden="true" />

              <div className="scores-selected-team-status-item">
                <span>Win chance</span>
                <strong>{selectedWinPct.toFixed(0)}%</strong>
              </div>
            </>
          )}

          {gameStatusParts.length > 0 ? (
            <>
              <div className="scores-selected-team-status-divider" aria-hidden="true" />

              <div className="scores-selected-team-game-status">
                {gameStatusParts.map((part, index) => (
                  <span key={String(part)}>
                    {index > 0 ? (
                      <i aria-hidden="true">•</i>
                    ) : null}
                    {part}
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>

        <div className="scores-game-progress">
          <div
            className="scores-game-progress-final"
            style={{
              width: `${progressComplete}%`,
            }}
          />

          <div
            className="scores-game-progress-live"
            style={{
              width: `${progressLive}%`,
            }}
          />
        </div>

        <div className="scores-player-list">
          {rosterRows.map((row, index) => {
            if (!row.player) {
              return (
                <article
                  key={`${row.slot}-${index}`}
                  className="scores-player-card scores-player-card--empty"
                >
                  <div className="scores-player-card-main">
                    <div className="scores-player-identity">
                      <div className="scores-player-empty-circle">
                        +
                      </div>

                      <div className="min-w-0">
                        <div className="scores-player-name-row">
                          <strong>
                            Empty {row.slot} slot
                          </strong>
                        </div>
                        <span className="scores-player-empty-subtext">
                          No player drafted
                        </span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            }

            const playerStat = getPlayerStat(
              row.player.id
            );

            const rawStat = getRawPlayerStat(
              row.player.id
            );

            const gameStatus =
              getPlayerGameStatus(rawStat);

            const playerProjection =
              Number(
                playerProjections?.[row.player.id]
                  ?.projection ?? 0
              );

            const projectionDifference =
              Number(playerStat.fantasy_points ?? 0) -
              playerProjection;

            const hasProjection =
              Number.isFinite(playerProjection) &&
              playerProjection > 0;

            const primaryColumns = statColumns.slice(0, 3);
            const secondaryColumns = statColumns.slice(3);

            return (
              <article
                key={row.player.id}
                className="scores-player-card"
              >
                <button
                  type="button"
                  onClick={() =>
                    setProfilePlayer(row.player)
                  }
                  className="scores-player-card-main"
                >
                  <div className="scores-player-identity">
                    <PlayerHeadshot
                      nbaPlayerId={
                        row.player.nba_player_id
                      }
                      playerName={row.player.name}
                      size="md"
                    />

                    <div className="min-w-0">
                      <div className="scores-player-name-row">
                        <strong>
                          {row.player.name}
                        </strong>

                        <span>{row.slot}</span>
                      </div>

                      <div
                        className={`scores-player-game-status scores-player-game-status--${gameStatus.tone}`}
                      >
                        <span aria-hidden="true" />

                        <strong>
                          {gameStatus.label}
                        </strong>

                        <em>{gameStatus.detail}</em>
                      </div>
                    </div>
                  </div>

                  <div className="scores-player-fantasy-score">
                    <strong>
                      {formatScore(
                        playerStat.fantasy_points
                      )}
                    </strong>

                    <span>FP</span>

                    {hasProjection ? (
                      <small
                        className={
                          projectionDifference >= 0
                            ? "scores-player-projection-difference scores-player-projection-difference--positive"
                            : "scores-player-projection-difference scores-player-projection-difference--negative"
                        }
                      >
                        {projectionDifference >= 0
                          ? "▲"
                          : "▼"}{" "}
                        {projectionDifference >= 0
                          ? "+"
                          : ""}
                        {projectionDifference.toFixed(1)} vs proj
                      </small>
                    ) : null}
                  </div>
                </button>

                <div className="scores-player-primary-stats">
                  {primaryColumns.map((column) => (
                    <div key={column.key}>
                      <span>{column.label}</span>
                      <strong>{playerStat[column.key] ?? 0}</strong>
                    </div>
                  ))}
                </div>

                {secondaryColumns.length > 0 ? (
                  <details className="scores-player-more">
                    <summary>
                      <span>More Stats</span>

                      <strong>
                        {secondaryColumns.map((column, i) => (
                          <span key={column.key}>
                            {i > 0 ? (
                              <span aria-hidden="true"> • </span>
                            ) : null}
                            {column.label} {playerStat[column.key] ?? 0}
                          </span>
                        ))}
                      </strong>
                    </summary>

                    <div className="scores-player-secondary-stats">
                      {secondaryColumns.map((column) => (
                        <div key={column.key}>
                          <span>{column.label}</span>
                          <strong>{playerStat[column.key] ?? 0}</strong>
                        </div>
                      ))}

                      <div>
                        <span>Projected</span>
                        <strong>
                          {hasProjection
                            ? formatScore(playerProjection)
                            : "—"}
                        </strong>
                      </div>
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>

        <details className="scores-team-totals">
          <summary>
            <span>Team Box Score Totals</span>

            <strong>
              {formatScore(selectedStats.total)} FP
            </strong>
          </summary>

          <div>
            {statColumns.map((column) => (
              <div key={column.key}>
                <span>{column.label}</span>
                <strong>
                  {selectedStats.statTotals?.[column.key] ?? 0}
                </strong>
              </div>
            ))}
          </div>
        </details>
      </section>
    </section>
  );
}


export default function ScoresDashboard(props: Props) {
  const sport = props.selectedSlate?.sport ?? "nba";

  if (sport === "golf") {
    return (
      <GolfScoresDashboard
        teams={props.teams}
        selectedSlate={props.selectedSlate}
        rosterSlots={props.rosterSlots}
        lastRefreshSummary={props.lastRefreshSummary}
        getPlayersForTeam={props.getPlayersForTeam}
        getTeamStats={props.getTeamStats}
        getRawPlayerStat={props.getRawPlayerStat}
        controls={props.controls}
        setProfilePlayer={props.setProfilePlayer}
      />
    );
  }

  return <TraditionalScoresDashboard {...props} />;
}
