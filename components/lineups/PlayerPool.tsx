"use client";

import { useEffect, useMemo, useState } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import type {
  Player,
  PositionFilter,
  RosterSlotConfig,
  Team,
} from "@/components/lineups/types";

type PlayerPoolProps = {
  players: Player[];
  filteredPlayers: Player[];
  searchTerm: string;
  setSearchTerm: React.Dispatch<
    React.SetStateAction<string>
  >;
  positionFilter: PositionFilter;
  setPositionFilter: React.Dispatch<
    React.SetStateAction<PositionFilter>
  >;
  onSlateOnly: boolean;
  setOnSlateOnly: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  isAvailabilityLoading: boolean;
  availablePlayerIdsForSlate: number[];
  availablePlayerIdSet: Set<number>;
  playerAverageMap: Map<number, number>;
  playerProjections: Record<number, any>;
  getOwnerTeamForPlayer: (
    playerId: number
  ) => Team | null;
  setDraftingPlayer: React.Dispatch<
    React.SetStateAction<Player | null>
  >;
  isAssigningPlayer: boolean;
  pillBase: string;
  activePill: string;
  inactivePill: string;
  rosterSlots?: RosterSlotConfig[];
};

type SortOption =
  | "projection"
  | "average"
  | "name";

function formatScore(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number.toFixed(1)
    : "—";
}

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
  rosterSlots = [],
}: PlayerPoolProps) {
  const [sortBy, setSortBy] =
    useState<SortOption>("projection");

  useEffect(() => {
    setOnSlateOnly(true);
  }, [setOnSlateOnly]);

  const sortedFilteredPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      if (sortBy === "projection") {
        const aScore =
          playerProjections?.[a.id]?.projection ??
          playerAverageMap.get(a.id) ??
          0;

        const bScore =
          playerProjections?.[b.id]?.projection ??
          playerAverageMap.get(b.id) ??
          0;

        return Number(bScore) - Number(aScore);
      }

      if (sortBy === "average") {
        const aScore =
          playerAverageMap.get(a.id) ?? 0;

        const bScore =
          playerAverageMap.get(b.id) ?? 0;

        return Number(bScore) - Number(aScore);
      }

      return a.name.localeCompare(b.name);
    });
  }, [
    filteredPlayers,
    playerAverageMap,
    playerProjections,
    sortBy,
  ]);

  return (
    <section className="draft-player-pool">
      <div className="draft-player-toolbar">
        <div className="draft-player-search-row">
          <label className="draft-player-search">
            <span className="sr-only">
              Search players
            </span>

            <span
              className="draft-player-search-icon"
              aria-hidden="true"
            >
              🔎
            </span>

            <input
              type="search"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(event.target.value)
              }
              placeholder="Search players…"
            />

            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="draft-player-search-clear"
                aria-label="Clear player search"
              >
                ×
              </button>
            ) : null}
          </label>

          <details className="draft-projection-key">
            <summary>
              <span aria-hidden="true">ⓘ</span>
              Projection key
            </summary>

            <div>
              <p>
                Mark&apos;s Projection blends NBA
                averages, league performance, recent
                form, and average finish.
              </p>

              <div className="draft-projection-key-items">
                <span>🏆 Strong history</span>
                <span>🔥 Trending up</span>
                <span>🧊 Trending down</span>
              </div>
            </div>
          </details>
        </div>

        <div className="draft-player-filter-row">
          <div
            className="draft-player-segment"
            aria-label="Position filter"
          >
            {(
              rosterSlots.length > 0
                ? ["All", ...rosterSlots.map((slot) => slot.position)]
                : ["All", "G", "F/C"]
            ).map(
              (position) => (
                <button
                  key={position}
                  type="button"
                  onClick={() =>
                    setPositionFilter(position)
                  }
                  className={
                    positionFilter === position
                      ? "draft-player-segment-active"
                      : ""
                  }
                >
                  {position}
                </button>
              )
            )}
          </div>

          <div
            className="draft-player-segment"
            aria-label="Availability filter"
          >
            <button
              type="button"
              onClick={() => setOnSlateOnly(true)}
              className={
                onSlateOnly
                  ? "draft-player-segment-active"
                  : ""
              }
            >
              On Slate
            </button>

            <button
              type="button"
              onClick={() => setOnSlateOnly(false)}
              className={
                !onSlateOnly
                  ? "draft-player-segment-active"
                  : ""
              }
            >
              All Players
            </button>
          </div>
        </div>

        <div className="draft-player-sort-row">
          <label>
            <span>Sort</span>

            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(
                  event.target.value as SortOption
                )
              }
            >
              <option value="projection">
                Projection
              </option>

              <option value="average">
                League Average
              </option>

              <option value="name">
                Player Name
              </option>
            </select>
          </label>

          <div className="draft-player-results-count">
            <strong>
              {sortedFilteredPlayers.length}
            </strong>{" "}
            shown
            <span aria-hidden="true"> • </span>
            {isAvailabilityLoading
              ? "Checking slate…"
              : `${availablePlayerIdsForSlate.length} on slate`}
          </div>
        </div>
      </div>

      {sortedFilteredPlayers.length === 0 ? (
        <div className="draft-player-empty">
          <div aria-hidden="true">🏀</div>

          <strong>No players found</strong>

          <p>
            {onSlateOnly
              ? "No players match these filters on the selected slate. Switch to All Players to browse everyone."
              : "Try another search or position filter."}
          </p>
        </div>
      ) : (
        <div className="draft-player-grid">
          {sortedFilteredPlayers.map((player) => {
            const ownerTeam =
              getOwnerTeamForPlayer(player.id);

            const isOnSlate =
              availablePlayerIdSet.has(player.id);

            const projectionMeta =
              playerProjections?.[player.id];

            const displayScore =
              sortBy === "average"
                ? playerAverageMap.get(player.id) ??
                  0
                : projectionMeta?.projection ??
                  playerAverageMap.get(player.id) ??
                  0;

            const scoreLabel =
              sortBy === "average"
                ? "Avg"
                : "Proj";

            const badges =
              projectionMeta?.badges ?? [];

            return (
              <button
                key={player.id}
                type="button"
                disabled={isAssigningPlayer}
                onClick={() =>
                  setDraftingPlayer(player)
                }
                className={`draft-player-card ${
                  ownerTeam
                    ? "draft-player-card--owned"
                    : ""
                }`}
              >
                <PlayerHeadshot
                  nbaPlayerId={
                    player.nba_player_id
                  }
                  playerName={player.name}
                  size="md"
                  className="draft-player-card-headshot"
                />

                <div className="draft-player-card-main">
                  <div className="draft-player-card-name-row">
                    <strong>{player.name}</strong>

                    <span className="draft-player-position">
                      {player.position_group}
                    </span>
                  </div>

                  <div className="draft-player-card-meta">
                    <span className="draft-player-score">
                      {scoreLabel}{" "}
                      {formatScore(displayScore)}
                    </span>

                    {badges.includes("trophy") ||
                    badges.includes("winner") ? (
                      <span
                        title="Strong league history"
                        aria-label="Strong league history"
                      >
                        🏆
                      </span>
                    ) : null}

                    {badges.includes("hot") ? (
                      <span
                        title="Trending up"
                        aria-label="Trending up"
                      >
                        🔥
                      </span>
                    ) : null}

                    {badges.includes("cold") ? (
                      <span
                        title="Trending down"
                        aria-label="Trending down"
                      >
                        🧊
                      </span>
                    ) : null}

                    {isOnSlate ? (
                      <span className="draft-player-on-slate">
                        On slate
                      </span>
                    ) : null}
                  </div>
                </div>

                <div
                  className={`draft-player-card-action ${
                    ownerTeam
                      ? "draft-player-card-action--owned"
                      : ""
                  }`}
                >
                  {ownerTeam
                    ? `On ${ownerTeam.name}`
                    : "Draft"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="draft-player-pool-footer">
        Browsing {players.length} active players
      </div>
    </section>
  );
}
