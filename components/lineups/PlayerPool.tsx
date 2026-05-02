"use client";

import { useMemo, useState } from "react";
import type { Player, PositionFilter, Team } from "@/components/lineups/types";

type PlayerPoolProps = {
  players: Player[];
  filteredPlayers: Player[];
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  positionFilter: PositionFilter;
  setPositionFilter: React.Dispatch<React.SetStateAction<PositionFilter>>;
  onSlateOnly: boolean;
  setOnSlateOnly: React.Dispatch<React.SetStateAction<boolean>>;
  isAvailabilityLoading: boolean;
  availablePlayerIdsForSlate: number[];
  availablePlayerIdSet: Set<number>;
  playerAverageMap: Map<number, number>;
  playerProjections: Record<number, any>;
  getOwnerTeamForPlayer: (playerId: number) => Team | null;
  setDraftingPlayer: React.Dispatch<React.SetStateAction<Player | null>>;
  isAssigningPlayer: boolean;
  pillBase: string;
  activePill: string;
  inactivePill: string;
};

export default function PlayerPool({
  players,
  filteredPlayers,
  searchTerm,
  setSearchTerm,
  positionFilter,
  setPositionFilter,
  onSlateOnly,
  setOnSlateOnly,
  isAvailabilityLoading,
  availablePlayerIdsForSlate,
  availablePlayerIdSet,
  playerAverageMap,
  playerProjections,
  getOwnerTeamForPlayer,
  setDraftingPlayer,
  isAssigningPlayer,
  pillBase,
  activePill,
  inactivePill,
}: PlayerPoolProps) {
  const [sortBy, setSortBy] = useState<"projection" | "average" | "name">("projection");

  const sortedFilteredPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      if (sortBy === "projection") {
        const aScore = playerProjections?.[a.id]?.projection ?? playerAverageMap.get(a.id) ?? 0;
        const bScore = playerProjections?.[b.id]?.projection ?? playerAverageMap.get(b.id) ?? 0;
        return bScore - aScore;
      }

      if (sortBy === "average") {
        const aScore = playerAverageMap.get(a.id) ?? 0;
        const bScore = playerAverageMap.get(b.id) ?? 0;
        return bScore - aScore;
      }

      return a.name.localeCompare(b.name);
    });
  }, [filteredPlayers, playerAverageMap, playerProjections, sortBy]);

  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4">
        <h2 className="text-2xl font-semibold text-slate-900">Player Pool</h2>
        <p className="text-sm text-slate-600">
            Search a player, click them, then choose which team gets them.
          </p>

          <details className="mt-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <summary className="cursor-pointer font-semibold text-slate-700">
              Mark’s Projection Key
            </summary>
            <div className="mt-2 space-y-1">
              <div><strong>HIGH</strong> = league/app data, 4+ drafted slates</div>
              <div><strong>MEDIUM</strong> = league/app data, 2–3 drafted slates</div>
              <div><strong>LOW</strong> = NBA season-average fallback, usually 0–1 drafted slates</div>
              <div>🔥 = recent drafted games are above season app average</div>
              <div>🧊 = recent drafted games are below season app average</div>
              <div>🏆 = strong average finish when drafted</div>
            </div>
          </details>
      </div>

      <div className="mb-4 flex flex-col gap-3">
        <div>
          <label
            htmlFor="player-search"
            className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
          >
            Search players
          </label>
          <input
            id="player-search"
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by player name"
            className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-sky-300"
          />
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Position
            </label>
            <div className="flex flex-wrap gap-2">
              {(["All", "G", "F/C"] as PositionFilter[]).map((filter) => {
                const isActive = positionFilter === filter;

                return (
                  <button
                    key={filter}
                    type="button"
                    onClick={() => setPositionFilter(filter)}
                    className={`${pillBase} ${isActive ? activePill : inactivePill}`}
                  >
                    {filter}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Sort By
            </label>
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as "projection" | "average" | "name")}
              className="rounded-full border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-300"
            >
              <option value="projection">Mark’s Projection</option>
              <option value="average">Average Score</option>
              <option value="name">Alphabetical</option>
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Availability
            </label>
            <button
              type="button"
              onClick={() => setOnSlateOnly((prev) => !prev)}
              className={`${pillBase} ${
                onSlateOnly
                  ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                  : inactivePill
              }`}
            >
              {onSlateOnly ? "On This Slate" : "All Players"}
            </button>
          </div>
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-500">
        <span>
          Showing {filteredPlayers.length} of {players.length} active players
        </span>
<span>
  On this slate:{" "}
  {isAvailabilityLoading ? "Loading..." : availablePlayerIdSet.size}
</span>
      </div>

      {filteredPlayers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
          No players match your current search/filter.
        </div>
      ) : (
        <div className="max-h-[305px] overflow-y-auto pr-1">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {sortedFilteredPlayers.map((player) => {
              const ownerTeam = getOwnerTeamForPlayer(player.id);
              const isOnSlate = availablePlayerIdSet.has(player.id);
              const projectionMeta = playerProjections?.[player.id];
              const projectionScore =
                projectionMeta?.projection ?? playerAverageMap.get(player.id) ?? 0;

              return (
                <button
                  key={player.id}
                  type="button"
                  onClick={() => setDraftingPlayer(player)}
                  disabled={isAssigningPlayer}
                  className={`rounded-2xl border px-4 py-3 text-left transition ${
                    ownerTeam
                      ? "border-red-200 bg-red-50 hover:border-red-300"
                      : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50"
                  } ${isAssigningPlayer ? "cursor-not-allowed opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-900">
                        {player.name}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                          Proj {projectionScore.toFixed(1)}
                        {projectionMeta && (
                          <span style={{ marginLeft: 6, fontSize: 12 }}>
                            {projectionMeta.badges?.includes("trophy") && "🏆"}
                            {projectionMeta.badges?.includes("hot") && "🔥"}
                            {projectionMeta.badges?.includes("cold") && "🧊"}
                            <span
                              style={{
                                marginLeft: 6,
                                padding: "2px 6px",
                                borderRadius: 6,
                                fontSize: 10,
                                fontWeight: 600,
                                background:
                                  projectionMeta.confidence === "high"
                                    ? "#d1fae5"
                                    : projectionMeta.confidence === "medium"
                                    ? "#fef3c7"
                                    : "#fee2e2",
                                color:
                                  projectionMeta.confidence === "high"
                                    ? "#065f46"
                                    : projectionMeta.confidence === "medium"
                                    ? "#92400e"
                                    : "#991b1b",
                              }}
                            >
                              {projectionMeta.confidence?.toUpperCase()}
                            </span>
                          </span>
                        )}
                        </span>
                        {isOnSlate ? (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">
                            On this slate
                          </span>
                        ) : null}
                        {ownerTeam ? (
                          <span className="text-[11px] text-red-600">
                            Used by {ownerTeam.name}
                          </span>
                        ) : (
                          <span className="text-[11px] text-sky-700">
                            Click to draft
                          </span>
                        )}
                      </div>
                    </div>

                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                      {player.position_group}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
