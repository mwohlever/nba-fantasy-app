"use client";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type {
  OrderedTeam,
  Player,
  PlayerStat,
  Slate,
} from "@/components/lineups/types";

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

type PlayerBoxScore = {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
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

export default function ScoresDashboard({
  teams,
  selectedSlate,
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

  const guards = players.filter(
    (player) => player.position_group === "G"
  );

  const frontcourt = players.filter(
    (player) => player.position_group === "F/C"
  );

  const rosterRows: Array<{
    slot: "G" | "F/C";
    player: Player | null;
  }> = [
    { slot: "G", player: guards[0] ?? null },
    { slot: "G", player: guards[1] ?? null },
    {
      slot: "F/C",
      player: frontcourt[0] ?? null,
    },
    {
      slot: "F/C",
      player: frontcourt[1] ?? null,
    },
    {
      slot: "F/C",
      player: frontcourt[2] ?? null,
    },
  ];

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
                <div
                  key={`${row.slot}-${index}`}
                  className="scores-player-card scores-player-card--empty"
                >
                  <div className="scores-player-empty-circle">
                    +
                  </div>

                  <div>
                    <strong>
                      Empty {row.slot} slot
                    </strong>
                    <span>No player drafted</span>
                  </div>
                </div>
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
                  <div>
                    <span>PTS</span>
                    <strong>{playerStat.points}</strong>
                  </div>

                  <div>
                    <span>REB</span>
                    <strong>{playerStat.rebounds}</strong>
                  </div>

                  <div>
                    <span>AST</span>
                    <strong>{playerStat.assists}</strong>
                  </div>
                </div>

                <details className="scores-player-more">
                  <summary>
                    <span>More Stats</span>

                    <strong>
                      STL {playerStat.steals}
                      <span aria-hidden="true"> • </span>
                      BLK {playerStat.blocks}
                      <span aria-hidden="true"> • </span>
                      TO {playerStat.turnovers}
                    </strong>
                  </summary>

                  <div className="scores-player-secondary-stats">
                    <div>
                      <span>STL</span>
                      <strong>{playerStat.steals}</strong>
                    </div>

                    <div>
                      <span>BLK</span>
                      <strong>{playerStat.blocks}</strong>
                    </div>

                    <div>
                      <span>TO</span>
                      <strong>{playerStat.turnovers}</strong>
                    </div>

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
            <div>
              <span>PTS</span>
              <strong>{selectedStats.points}</strong>
            </div>

            <div>
              <span>REB</span>
              <strong>
                {selectedStats.rebounds}
              </strong>
            </div>

            <div>
              <span>AST</span>
              <strong>
                {selectedStats.assists}
              </strong>
            </div>

            <div>
              <span>STL</span>
              <strong>
                {selectedStats.steals}
              </strong>
            </div>

            <div>
              <span>BLK</span>
              <strong>
                {selectedStats.blocks}
              </strong>
            </div>

            <div>
              <span>TO</span>
              <strong>
                {selectedStats.turnovers}
              </strong>
            </div>
          </div>
        </details>
      </section>
    </section>
  );
}
