"use client";

import { useEffect, useMemo, useState } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type {
  OrderedTeam,
  Player,
} from "@/components/lineups/types";

type TeamStats = {
  totalPlayers: number;
  guards: number;
  fcPlayers: number;
};

type AssignmentStatus = {
  canAssign: boolean;
  reason: string;
};

type Profile = {
  player?: {
    id: number;
    name: string;
    position_group: string | null;
  };
  summary: {
    timesDrafted: number;
    wins: number;
    runnerUps: number;
    winRate: number | null;
    draftedMostBy: {
      teamName: string;
      count: number;
    } | null;
    draftedByBreakdown: Array<{
      teamName: string;
      count: number;
    }>;
    averageFantasyPoints: number | null;
    bestFantasyPoints: number | null;
    worstFantasyPoints: number | null;
    averageFinish?: number | null;
  };
  recentHistory: Array<{
    slateLabel: string;
    teamName: string;
    finishPosition: number | null;
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    fantasyPoints: number | null;
  }>;
};

type SharedProps = {
  player: Player | null;
  onClose: () => void;
  playerAverageMap: Map<number, number>;
  playerProjections: Record<number, any>;
};

type ViewProps = SharedProps & {
  mode: "view";
};

type DraftProps = SharedProps & {
  mode: "draft";
  availablePlayerIdSet: Set<number>;
  ownerTeam: OrderedTeam | null;
  isAssigningPlayer: boolean;
  isSaving: boolean;
  isExternalLoading?: boolean;
  orderedTeamsForSlate: OrderedTeam[];
  getTeamStats: (teamId: number) => TeamStats;
  getTeamAssignmentStatus: (
    teamId: number,
    player: Player
  ) => AssignmentStatus;
  getOwnerTeamIdForPlayer: (
    playerId: number
  ) => number | null;
  handleAssignPlayerToTeam: (
    player: Player,
    teamId: number
  ) => Promise<void>;
  targetDraftSlot?: {
    teamId: number;
    teamName: string;
    positionGroup: "G" | "F/C";
  } | null;
  handleDraftToTargetSlot?: (
    player: Player
  ) => Promise<void>;
  handleRemovePlayerFromTeam: (
    player: Player
  ) => Promise<void>;
};

type Props = ViewProps | DraftProps;

function fmt(
  value: number | null | undefined,
  digits = 1
) {
  if (value === null || value === undefined) {
    return "—";
  }

  return Number(value).toFixed(digits);
}

function ordinal(position: number | null) {
  if (!position) return "—";

  const mod100 = position % 100;

  if (mod100 >= 11 && mod100 <= 13) {
    return `${position}th`;
  }

  const suffix =
    position % 10 === 1
      ? "st"
      : position % 10 === 2
        ? "nd"
        : position % 10 === 3
          ? "rd"
          : "th";

  return `${position}${suffix}`;
}

function resultEmoji(position: number | null) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return "";
}

export default function PlayerModal(props: Props) {
  const {
    player,
    onClose,
    playerAverageMap,
    playerProjections,
  } = props;

  const [profile, setProfile] =
    useState<Profile | null>(null);
  const [isProfileLoading, setIsProfileLoading] =
    useState(false);
  const [season, setSeason] =
    useState<string>("2026");

  useEffect(() => {
    if (!player) {
      setProfile(null);
      setIsProfileLoading(false);
      return;
    }

    const currentPlayer = player;
    let active = true;

    async function loadProfile() {
      try {
        setIsProfileLoading(true);

        const response = await fetch(
          `/api/player-league-profile?playerId=${currentPlayer.id}&season=${season}`,
          {
            cache: "no-store",
          }
        );

        const result = await response.json();

        if (!active) return;

        if (!response.ok) {
          console.error(
            result.error ||
              "Failed to load player profile."
          );
          setProfile(null);
          return;
        }

        setProfile(result as Profile);
      } catch (error) {
        console.error(
          "Failed to load player profile",
          error
        );

        if (active) {
          setProfile(null);
        }
      } finally {
        if (active) {
          setIsProfileLoading(false);
        }
      }
    }

    void loadProfile();

    return () => {
      active = false;
    };
  }, [player, season]);

  const draftedByRows = useMemo(() => {
    if (!profile) return [];

    const rows = [
      ...profile.summary.draftedByBreakdown,
    ].sort((a, b) => b.count - a.count);

    const maximum = Math.max(
      ...rows.map((row) => row.count),
      1
    );

    return rows.map((row) => ({
      ...row,
      percentage: (row.count / maximum) * 100,
    }));
  }, [profile]);

  if (!player) return null;

  const projectionMeta =
    playerProjections?.[player.id];

  const projectionScore =
    projectionMeta?.projection ??
    playerAverageMap.get(player.id) ??
    null;

  const projectionBadges =
    projectionMeta?.badges ?? [];

  const projectionConfidence =
    projectionMeta?.confidence ?? null;

  const projectionSource =
    projectionMeta?.source === "league"
      ? "League data"
      : projectionMeta?.source ===
          "nbaSeasonAverage"
        ? "NBA season average"
        : "Fallback";

  const nbaAverage =
    projectionMeta?.nbaSeasonAverage ?? null;

  const isDraftMode = props.mode === "draft";
  const ownerTeam =
    isDraftMode ? props.ownerTeam : null;

  const isOnSlate =
    isDraftMode &&
    props.availablePlayerIdSet.has(player.id);

  const isBusy =
    isDraftMode &&
    (props.isAssigningPlayer || props.isSaving);

  const isLoading =
    isProfileLoading ||
    (isDraftMode &&
      props.isExternalLoading === true);

  return (
    <div
      className="mobile-modal-safe player-modal-overlay fixed inset-0 z-[11000] flex items-end justify-center px-3 py-4 sm:items-center"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-label={`${player.name} player profile`}
        className="mobile-modal-panel-safe player-modal-shell flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden"
      >
        <header className="player-modal-header">
          <button
            type="button"
            onClick={onClose}
            className="player-modal-close"
            aria-label="Close player profile"
          >
            ×
          </button>

          <div className="player-modal-identity">
            <div className="player-modal-headshot-wrap">
              <PlayerHeadshot
                nbaPlayerId={player.nba_player_id}
                playerName={player.name}
                size="xl"
                className="player-modal-headshot"
              />
            </div>

            <div className="min-w-0">
              <div className="player-modal-kicker">
                {isDraftMode
                  ? "Draft decision"
                  : "Player profile"}
              </div>

              <h2>{player.name}</h2>

              <div className="player-modal-subtitle">
                <span>{player.position_group}</span>

                {nbaAverage !== null ? (
                  <>
                    <span aria-hidden="true">•</span>
                    <span>
                      NBA Avg {fmt(nbaAverage)}
                    </span>
                  </>
                ) : null}
              </div>
            </div>
          </div>

          <div className="player-modal-highlight-grid">
            <div className="player-modal-highlight player-modal-highlight--primary">
              <span>Projection</span>

              <strong>
                {fmt(projectionScore)}
                {projectionBadges.includes("trophy")
                  ? " 🏆"
                  : ""}
                {projectionBadges.includes("hot")
                  ? " 🔥"
                  : ""}
                {projectionBadges.includes("cold")
                  ? " 🧊"
                  : ""}
              </strong>

              <small>
                {projectionConfidence
                  ? `${String(
                      projectionConfidence
                    ).toUpperCase()} confidence`
                  : projectionSource}
              </small>
            </div>

            <div className="player-modal-highlight">
              <span>Status</span>

              <strong>
                {ownerTeam
                  ? ownerTeam.name
                  : isOnSlate
                    ? "Available"
                    : isDraftMode
                      ? "Off slate"
                      : "Career"}
              </strong>

              <small>
                {ownerTeam
                  ? "Current roster"
                  : isOnSlate
                    ? "Playing this slate"
                    : isDraftMode
                      ? "Not scheduled"
                      : `${season} view`}
              </small>
            </div>
          </div>
        </header>

        {isDraftMode ? (
          <section className="player-modal-actions">

            {props.targetDraftSlot ? (
              <button
                type="button"
                disabled={isBusy}
                onClick={() => {
                  if (!props.handleDraftToTargetSlot) {
                    return;
                  }

                  void props.handleDraftToTargetSlot(
                    player
                  );
                }}
                className="mb-4 flex w-full items-center justify-center rounded-2xl bg-emerald-600 px-5 py-4 text-base font-bold text-white shadow transition hover:bg-emerald-700 disabled:opacity-60"
              >
                {isBusy
                  ? "Drafting..."
                  : `Draft to ${props.targetDraftSlot.positionGroup} Slot`}
              </button>
            ) : null}
            <div className="player-modal-actions-heading">
              <div>
                <span>Roster action</span>

                <strong>
                  {ownerTeam
                    ? `Currently on ${ownerTeam.name}`
                    : "Choose a lineup"}
                </strong>
              </div>

              {ownerTeam ? (
                <button
                  type="button"
                  onClick={() =>
                    void props.handleRemovePlayerFromTeam(
                      player
                    )
                  }
                  disabled={isBusy}
                  className="player-modal-remove"
                >
                  {isBusy
                    ? "Working…"
                    : `Remove from ${ownerTeam.name}`}
                </button>
              ) : null}
            </div>

            <div className="player-modal-team-strip">
              {props.orderedTeamsForSlate.map(
                (team) => {
                  const teamStats =
                    props.getTeamStats(team.id);

                  const status =
                    props.getTeamAssignmentStatus(
                      team.id,
                      player
                    );

                  const isCurrentOwner =
                    props.getOwnerTeamIdForPlayer(
                      player.id
                    ) === team.id;

                  const isParticipating =
                    team.is_participating !== false;

                  return (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() =>
                        void props.handleAssignPlayerToTeam(
                          player,
                          team.id
                        )
                      }
                      disabled={
                        !status.canAssign ||
                        isBusy ||
                        isCurrentOwner
                      }
                      className={`player-modal-team-action ${
                        isCurrentOwner
                          ? "player-modal-team-action--current"
                          : status.canAssign
                            ? "player-modal-team-action--available"
                            : ""
                      }`}
                    >
                      <TeamAvatar
                        teamName={team.name}
                        size="sm"
                      />

                      <span>
                        <strong>{team.name}</strong>

                        <small>
                          {isCurrentOwner
                            ? "Current lineup"
                            : status.canAssign
                              ? ownerTeam
                                ? "Move here"
                                : "Draft here"
                              : status.reason}
                        </small>
                      </span>

                      <em>
                        {teamStats.totalPlayers}/5
                        {!isParticipating
                          ? " • Out"
                          : ""}
                      </em>
                    </button>
                  );
                }
              )}
            </div>
          </section>
        ) : null}

        <div className="player-modal-body">
          <section className="player-modal-toolbar">
            <div>
              <div className="player-modal-section-kicker">
                Performance résumé
              </div>

              <h3>
                {season === "all"
                  ? "All-Time"
                  : season}{" "}
                Snapshot
              </h3>
            </div>

            <label>
              <span>View</span>

              <select
                value={season}
                onChange={(event) =>
                  setSeason(event.target.value)
                }
              >
                <option value="2026">2026</option>
                <option value="2025">2025</option>
                <option value="2024">2024</option>
                <option value="2023">2023</option>
                <option value="all">
                  All-Time
                </option>
              </select>
            </label>
          </section>

          {isLoading ? (
            <div className="player-modal-empty">
              Loading player profile…
            </div>
          ) : !profile ? (
            <div className="player-modal-empty">
              Player history could not be loaded.
            </div>
          ) : (
            <div className="space-y-5">
              <section className="player-modal-resume">
                <div>
                  <span>Drafted</span>
                  <strong>
                    {profile.summary.timesDrafted}
                  </strong>
                </div>

                <div>
                  <span>Wins</span>
                  <strong>
                    {profile.summary.wins}
                  </strong>
                </div>

                <div>
                  <span>🥈 2nd</span>
                  <strong>
                    {profile.summary.runnerUps}
                  </strong>
                </div>

                <div>
                  <span>Win rate</span>
                  <strong>
                    {fmt(profile.summary.winRate)}%
                  </strong>
                </div>

                <div>
                  <span>Avg FP</span>
                  <strong>
                    {fmt(
                      profile.summary
                        .averageFantasyPoints
                    )}
                  </strong>
                </div>
              </section>

              <details className="player-modal-details">
                <summary>
                  <span>
                    Why this projection?
                  </span>

                  <strong>
                    {fmt(projectionScore)} FP
                  </strong>
                </summary>

                <div className="player-modal-projection-grid">
                  <div>
                    <span>NBA season avg</span>
                    <strong>
                      {fmt(
                        projectionMeta
                          ?.nbaSeasonAverage
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>App season avg</span>
                    <strong>
                      {fmt(
                        projectionMeta?.seasonAvg
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Recent app avg</span>
                    <strong>
                      {fmt(
                        projectionMeta?.recentAvg
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Avg finish</span>
                    <strong>
                      {fmt(
                        projectionMeta?.avgFinish
                      )}
                    </strong>
                  </div>
                </div>

                <p>
                  Projection uses 50% NBA average,
                  30% app season average, 20% recent
                  app average, plus finish and
                  hot/cold adjustments.
                </p>
              </details>

              <section>
                <div className="player-modal-section-heading">
                  <div>
                    <div className="player-modal-section-kicker">
                      Recent form
                    </div>

                    <h3>Recent Drafts</h3>
                  </div>

                  <span>
                    Swipe →
                  </span>
                </div>

                {profile.recentHistory.length ===
                0 ? (
                  <div className="player-modal-empty">
                    No draft history for this view.
                  </div>
                ) : (
                  <div className="player-modal-history-strip">
                    {profile.recentHistory
                      .slice(0, 8)
                      .map((row, index) => (
                        <article
                          key={`${row.slateLabel}-${index}`}
                          className={`player-modal-history-card ${
                            row.finishPosition === 1
                              ? "player-modal-history-card--winner"
                              : ""
                          }`}
                        >
                          <div className="player-modal-history-date">
                            {row.slateLabel}
                          </div>

                          <div className="player-modal-history-score">
                            {fmt(row.fantasyPoints)}
                            <span>FP</span>
                          </div>

                          <div className="player-modal-history-result">
                            <strong>
                              {resultEmoji(
                                row.finishPosition
                              )}{" "}
                              {ordinal(
                                row.finishPosition
                              )}
                            </strong>

                            <span>{row.teamName}</span>
                          </div>

                          <div className="player-modal-history-stats">
                            <span>
                              {row.points} PTS
                            </span>
                            <span>
                              {row.rebounds} REB
                            </span>
                            <span>
                              {row.assists} AST
                            </span>
                          </div>
                        </article>
                      ))}
                  </div>
                )}
              </section>

              <section>
                <div className="player-modal-section-heading">
                  <div>
                    <div className="player-modal-section-kicker">
                      Ownership history
                    </div>

                    <h3>Drafted By</h3>
                  </div>
                </div>

                {draftedByRows.length === 0 ? (
                  <div className="player-modal-empty">
                    No ownership history yet.
                  </div>
                ) : (
                  <div className="player-modal-ownership">
                    {draftedByRows.map((row) => (
                      <div
                        key={row.teamName}
                        className="player-modal-owner-row"
                      >
                        <div className="player-modal-owner-label">
                          <span>
                            {row.teamName}
                          </span>

                          <strong>
                            {row.count}
                          </strong>
                        </div>

                        <div className="player-modal-owner-track">
                          <div
                            style={{
                              width: `${row.percentage}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <details className="player-modal-details">
                <summary>
                  <span>
                    More career numbers
                  </span>

                  <strong>
                    Best{" "}
                    {fmt(
                      profile.summary
                        .bestFantasyPoints
                    )}
                  </strong>
                </summary>

                <div className="player-modal-projection-grid">
                  <div>
                    <span>Average</span>
                    <strong>
                      {fmt(
                        profile.summary
                          .averageFantasyPoints
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Best</span>
                    <strong>
                      {fmt(
                        profile.summary
                          .bestFantasyPoints
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Worst</span>
                    <strong>
                      {fmt(
                        profile.summary
                          .worstFantasyPoints
                      )}
                    </strong>
                  </div>

                  <div>
                    <span>Avg finish</span>
                    <strong>
                      {fmt(
                        profile.summary
                          .averageFinish
                      )}
                    </strong>
                  </div>
                </div>
              </details>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
