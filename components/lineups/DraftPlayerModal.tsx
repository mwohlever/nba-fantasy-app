"use client";

import { useEffect, useState } from "react";
import type {
  OrderedTeam,
  Player,
  PlayerHistoryDetailRow,
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
  summary: {
    timesDrafted: number;
    wins: number;
    runnerUps: number;
    winRate: number | null;
    draftedMostBy: { teamName: string; count: number } | null;
    draftedByBreakdown: Array<{ teamName: string; count: number }>;
    averageFantasyPoints: number | null;
    bestFantasyPoints: number | null;
    worstFantasyPoints: number | null;
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

type DraftPlayerModalProps = {
  draftingPlayer: Player | null;
  setDraftingPlayer: React.Dispatch<React.SetStateAction<Player | null>>;
  playerAverageMap: Map<number, number>;
  availablePlayerIdSet: Set<number>;
  ownerTeamForDraftingPlayer: OrderedTeam | null;
  isAssigningPlayer: boolean;
  isSaving: boolean;
  handleRemovePlayerFromTeam: (player: Player) => Promise<void>;
  draftingPlayerHistory: PlayerHistoryDetailRow[];
  isDraftingPlayerHistoryLoading: boolean;
  orderedTeamsForSlate: OrderedTeam[];
  getTeamStats: (teamId: number) => TeamStats;
  getTeamAssignmentStatus: (teamId: number, player: Player) => AssignmentStatus;
  getOwnerTeamIdForPlayer: (playerId: number) => number | null;
  handleAssignPlayerToTeam: (player: Player, teamId: number) => Promise<void>;
};

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(1);
}

export default function DraftPlayerModal({
  draftingPlayer,
  setDraftingPlayer,
  playerAverageMap,
  availablePlayerIdSet,
  ownerTeamForDraftingPlayer,
  isAssigningPlayer,
  isSaving,
  handleRemovePlayerFromTeam,
  isDraftingPlayerHistoryLoading,
  orderedTeamsForSlate,
  getTeamStats,
  getTeamAssignmentStatus,
  getOwnerTeamIdForPlayer,
  handleAssignPlayerToTeam,
}: DraftPlayerModalProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  useEffect(() => {
    if (!draftingPlayer) {
      setProfile(null);
      setIsProfileLoading(false);
      return;
    }

    const currentPlayer = draftingPlayer;
    let isActive = true;

    async function loadProfile() {
      try {
        setIsProfileLoading(true);

        const response = await fetch(
          `/api/player-league-profile?playerId=${currentPlayer.id}`,
          { cache: "no-store" }
        );

        const result = await response.json();

        if (!isActive) return;

        if (!response.ok) {
          console.error(result.error || "Failed to load player profile.");
          setProfile(null);
          return;
        }

        setProfile(result);
      } catch (error) {
        console.error(error);
        if (isActive) setProfile(null);
      } finally {
        if (isActive) setIsProfileLoading(false);
      }
    }

    void loadProfile();

    return () => {
      isActive = false;
    };
  }, [draftingPlayer]);

  if (!draftingPlayer) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 px-3 py-4 sm:items-center"
      onClick={() => setDraftingPlayer(null)}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              Draft Player
            </div>

            <h3 className="mt-1 text-2xl font-bold text-slate-900">
              {draftingPlayer.name}
            </h3>

            <div className="mt-2 flex flex-wrap gap-2 text-sm text-slate-600">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                {draftingPlayer.position_group}
              </span>

              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                Season avg {fmt(playerAverageMap.get(draftingPlayer.id))}
              </span>

              {availablePlayerIdSet.has(draftingPlayer.id) ? (
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">
                  On this slate
                </span>
              ) : null}

              {ownerTeamForDraftingPlayer ? (
                <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">
                  Currently on {ownerTeamForDraftingPlayer.name}
                </span>
              ) : (
                <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700">
                  Not drafted yet
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDraftingPlayer(null)}
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-28">
          {ownerTeamForDraftingPlayer ? (
            <div className="mb-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleRemovePlayerFromTeam(draftingPlayer)}
                disabled={isAssigningPlayer || isSaving}
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAssigningPlayer
                  ? "Working..."
                  : `Remove from ${ownerTeamForDraftingPlayer.name}`}
              </button>
            </div>
          ) : null}

          {isProfileLoading || isDraftingPlayerHistoryLoading || !profile ? (
            <div className="mb-5 rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading player profile...
            </div>
          ) : (
            <div className="mb-6 space-y-5">
              <div className="grid gap-3 sm:grid-cols-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase text-slate-500">Drafted</div>
                  <div className="mt-2 text-2xl font-bold">
                    {profile.summary.timesDrafted}
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-xs uppercase text-emerald-700">Wins</div>
                  <div className="mt-2 text-2xl font-bold">
                    {profile.summary.wins}
                  </div>
                </div>

                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                  <div className="text-xs uppercase text-sky-700">Win Rate</div>
                  <div className="mt-2 text-2xl font-bold">
                    {fmt(profile.summary.winRate)}%
                  </div>
                </div>

                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <div className="text-xs uppercase text-orange-700">
                    Runner-ups
                  </div>
                  <div className="mt-2 text-2xl font-bold">
                    {profile.summary.runnerUps}
                  </div>
                </div>

                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                  <div className="text-xs uppercase text-indigo-700">
                    Drafted Most By
                  </div>
                  <div className="mt-2 text-lg font-bold">
                    {profile.summary.draftedMostBy
                      ? `${profile.summary.draftedMostBy.teamName} (${profile.summary.draftedMostBy.count})`
                      : "—"}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase text-slate-500">
                    Avg When Drafted
                  </div>
                  <div className="mt-2 text-xl font-semibold">
                    {fmt(profile.summary.averageFantasyPoints)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase text-slate-500">Best</div>
                  <div className="mt-2 text-xl font-semibold">
                    {fmt(profile.summary.bestFantasyPoints)}
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase text-slate-500">Worst</div>
                  <div className="mt-2 text-xl font-semibold">
                    {fmt(profile.summary.worstFantasyPoints)}
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-lg font-semibold text-slate-900">
                  Drafted By Breakdown
                </h3>

                {profile.summary.draftedByBreakdown.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    No draft history yet.
                  </p>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    {profile.summary.draftedByBreakdown.map((row) => (
                      <div
                        key={row.teamName}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="font-semibold text-slate-900">
                          {row.teamName}
                        </div>
                        <div className="text-sm text-slate-500">
                          {row.count} draft(s)
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Recent Box Scores
                </h3>

                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr className="text-left">
                          <th className="px-3 py-2">Slate</th>
                          <th className="px-3 py-2">Team</th>
                          <th className="px-3 py-2">Finish</th>
                          <th className="px-3 py-2 text-right">PTS</th>
                          <th className="px-3 py-2 text-right">REB</th>
                          <th className="px-3 py-2 text-right">AST</th>
                          <th className="px-3 py-2 text-right">STL</th>
                          <th className="px-3 py-2 text-right">BLK</th>
                          <th className="px-3 py-2 text-right">TO</th>
                          <th className="px-3 py-2 text-right">FP</th>
                        </tr>
                      </thead>

                      <tbody>
                        {profile.recentHistory.map((row, index) => (
                          <tr
                            key={`${row.slateLabel}-${index}`}
                            className="border-t border-slate-100"
                          >
                            <td className="px-3 py-2">{row.slateLabel}</td>
                            <td className="px-3 py-2">{row.teamName}</td>
                            <td className="px-3 py-2">
                              {row.finishPosition ? `#${row.finishPosition}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-right">{row.points}</td>
                            <td className="px-3 py-2 text-right">{row.rebounds}</td>
                            <td className="px-3 py-2 text-right">{row.assists}</td>
                            <td className="px-3 py-2 text-right">{row.steals}</td>
                            <td className="px-3 py-2 text-right">{row.blocks}</td>
                            <td className="px-3 py-2 text-right">
                              {row.turnovers}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">
                              {fmt(row.fantasyPoints)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="mb-2 text-sm font-medium text-slate-700">
            Choose lineup
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {orderedTeamsForSlate.map((team) => {
              const stats = getTeamStats(team.id);
              const status = getTeamAssignmentStatus(team.id, draftingPlayer);
              const isCurrentOwner =
                getOwnerTeamIdForPlayer(draftingPlayer.id) === team.id;
              const isParticipating = team.is_participating !== false;

              return (
                <div
                  key={team.id}
                  className={`rounded-2xl border p-4 ${
                    isCurrentOwner
                      ? "border-sky-300 bg-sky-50"
                      : "border-slate-200 bg-white"
                  } ${!isParticipating ? "opacity-70" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-semibold text-slate-900">
                        {team.name}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">
                        {team.draft_order ? `Order #${team.draft_order}` : ""}
                        {!isParticipating ? " • Out" : ""}
                      </div>
                    </div>

                    <div className="text-right text-xs text-slate-600">
                      <div>{stats.totalPlayers}/5</div>
                      <div>G {stats.guards}/2</div>
                      <div>F/C {stats.fcPlayers}/3</div>
                    </div>
                  </div>

                  <div className="mt-3">
                    <button
                      type="button"
                      onClick={() =>
                        handleAssignPlayerToTeam(draftingPlayer, team.id)
                      }
                      disabled={!status.canAssign || isAssigningPlayer || isSaving}
                      className={`w-full rounded-xl border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                        status.canAssign
                          ? "border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                          : "border-slate-200 bg-slate-100 text-slate-500"
                      }`}
                    >
                      {isCurrentOwner
                        ? "Already here"
                        : status.canAssign
                          ? "Assign to this team"
                          : status.reason}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
