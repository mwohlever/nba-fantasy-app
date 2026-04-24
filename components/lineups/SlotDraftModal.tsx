"use client";

import { useMemo, useState } from "react";
import type { Player } from "@/components/lineups/types";

type TargetDraftSlot = {
  teamId: number;
  teamName: string;
  positionGroup: "G" | "F/C";
};

type Props = {
  targetDraftSlot: TargetDraftSlot | null;
  setTargetDraftSlot: (slot: TargetDraftSlot | null) => void;
  players: Player[];
  playerAverageMap: Map<number, number>;
  availablePlayerIdSet: Set<number>;
  isAvailabilityLoading: boolean;
  getOwnerTeamForPlayer: (playerId: number) => { id: number; name: string } | null;
  handleAssignPlayerToTeam: (player: Player, teamId: number) => Promise<void>;
  isAssigningPlayer: boolean;
  isSaving: boolean;
};

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(1);
}

export default function SlotDraftModal({
  targetDraftSlot,
  setTargetDraftSlot,
  players,
  playerAverageMap,
  availablePlayerIdSet,
  isAvailabilityLoading,
  getOwnerTeamForPlayer,
  handleAssignPlayerToTeam,
  isAssigningPlayer,
  isSaving,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredPlayers = useMemo(() => {
    if (!targetDraftSlot) return [];

    return players
      .filter((player) => {
        if (player.position_group !== targetDraftSlot.positionGroup) return false;
        if (!isAvailabilityLoading && !availablePlayerIdSet.has(player.id)) return false;
        if (getOwnerTeamForPlayer(player.id)) return false;

        if (
          searchTerm.trim() &&
          !player.name.toLowerCase().includes(searchTerm.trim().toLowerCase())
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const avgA = playerAverageMap.get(a.id);
        const avgB = playerAverageMap.get(b.id);

        if (avgA == null && avgB == null) return a.name.localeCompare(b.name);
        if (avgA == null) return 1;
        if (avgB == null) return -1;

        return avgB - avgA;
      });
  }, [
    targetDraftSlot,
    players,
    playerAverageMap,
    availablePlayerIdSet,
    isAvailabilityLoading,
    getOwnerTeamForPlayer,
    searchTerm,
  ]);

  if (!targetDraftSlot) return null;

  async function draftPlayer(player: Player) {
    if (!targetDraftSlot) return;

    await handleAssignPlayerToTeam(player, targetDraftSlot.teamId);
    setTargetDraftSlot(null);
    setSearchTerm("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 px-3 py-4 sm:items-center"
      onClick={() => setTargetDraftSlot(null)}
    >
      <div
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shrink-0 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                Draft to Roster Spot
              </div>
              <h3 className="mt-1 text-2xl font-bold text-slate-900">
                {targetDraftSlot.teamName} — {targetDraftSlot.positionGroup}
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Choose an available {targetDraftSlot.positionGroup} and they’ll be added directly.
              </p>
            </div>

            <button
              type="button"
              onClick={() => setTargetDraftSlot(null)}
              className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
            >
              Close
            </button>
          </div>

          <div className="mt-4">
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder={`Search ${targetDraftSlot.positionGroup} players...`}
              className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
              autoFocus
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 pb-24">
          {isAvailabilityLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading available players...
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No available {targetDraftSlot.positionGroup} players found.
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredPlayers.map((player) => (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => void draftPlayer(player)}
                  disabled={isAssigningPlayer || isSaving}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left transition hover:border-emerald-300 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <div>
                    <div className="font-semibold text-slate-900">{player.name}</div>
                    <div className="mt-1 text-xs text-slate-500">
                      {player.position_group} • Avg {fmt(playerAverageMap.get(player.id))}
                    </div>
                  </div>

                  <div className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-800">
                    Draft
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
