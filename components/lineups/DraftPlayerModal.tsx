"use client";

import type { OrderedTeam, Player, PlayerHistoryDetailRow } from "@/components/lineups/types";

type TeamStats = {
  totalPlayers: number;
  guards: number;
  fcPlayers: number;
};

type AssignmentStatus = {
  canAssign: boolean;
  reason: string;
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

export default function DraftPlayerModal({
  draftingPlayer,
  setDraftingPlayer,
  playerAverageMap,
  availablePlayerIdSet,
  ownerTeamForDraftingPlayer,
  isAssigningPlayer,
  isSaving,
  handleRemovePlayerFromTeam,
  draftingPlayerHistory,
  isDraftingPlayerHistoryLoading,
  orderedTeamsForSlate,
  getTeamStats,
  getTeamAssignmentStatus,
  getOwnerTeamIdForPlayer,
  handleAssignPlayerToTeam,
}: DraftPlayerModalProps) {
  if (!draftingPlayer) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-2xl font-semibold text-slate-900">
              {draftingPlayer.name}
            </h3>
            <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-600">
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                {draftingPlayer.position_group}
              </span>
              <span className="rounded-full bg-slate-100 px-2.5 py-1">
                Avg {(playerAverageMap.get(draftingPlayer.id) ?? 0).toFixed(1)}
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
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            Close
          </button>
        </div>

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

        <div className="mb-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-2 text-sm font-medium text-slate-700">
            Recent slate history
          </div>

          {isDraftingPlayerHistoryLoading ? (
            <div className="text-sm text-slate-500">Loading history...</div>
          ) : draftingPlayerHistory.length === 0 ? (
            <div className="text-sm text-slate-500">No saved slate history yet.</div>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white">
              <div className="divide-y divide-slate-100">
                {draftingPlayerHistory.map((item) => (
<div
  key={`${item.slateId}-${item.playerId}`}
  className="flex items-start justify-between gap-3 px-3 py-2 text-sm"
>
  <div className="min-w-0">
    <div className="font-medium text-slate-900">
      {item.date ?? "Unknown date"}
    </div>

    {item.points !== 0 ||
    item.rebounds !== 0 ||
    item.assists !== 0 ||
    item.steals !== 0 ||
    item.blocks !== 0 ||
    item.turnovers !== 0 ? (
      <div className="mt-0.5 text-xs text-slate-500">
        PTS {item.points} • REB {item.rebounds} • AST {item.assists} • STL {item.steals} • BLK {item.blocks} • TO {item.turnovers}
      </div>
    ) : null}
  </div>

  <div className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
    {Number(item.fantasyPoints).toFixed(1)}
  </div>
</div>
                ))}
              </div>
            </div>
          )}
        </div>

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
                    <div className="font-semibold text-slate-900">{team.name}</div>
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
                    onClick={() => handleAssignPlayerToTeam(draftingPlayer, team.id)}
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
  );
}
