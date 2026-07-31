"use client";

import { useMemo, useState } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import type { Player,
  TargetDraftSlot,
} from "@/components/lineups/types";

type Props = {
  targetDraftSlot: TargetDraftSlot | null;
  setTargetDraftSlot: (
    slot: TargetDraftSlot | null
  ) => void;
  players: Player[];
  playerAverageMap: Map<number, number>;
  playerProjections: Record<number, any>;
  availablePlayerIdSet: Set<number>;
  isAvailabilityLoading: boolean;
  getOwnerTeamForPlayer: (
    playerId: number
  ) => { id: number; name: string } | null;
  handleAssignPlayerToTeam: (
    player: Player,
    teamId: number
  ) => Promise<void>;
  onInspectPlayer: (player: Player) => void;
  hidden?: boolean;
  isAssigningPlayer: boolean;
  isSaving: boolean;
};

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined) {
    return "—";
  }

  return Number(value).toFixed(1);
}

export default function SlotDraftModal({
  targetDraftSlot,
  setTargetDraftSlot,
  players,
  playerAverageMap,
  playerProjections,
  availablePlayerIdSet,
  isAvailabilityLoading,
  getOwnerTeamForPlayer,
  handleAssignPlayerToTeam,
  onInspectPlayer,
  hidden = false,
  isAssigningPlayer,
  isSaving,
}: Props) {
  const [searchTerm, setSearchTerm] = useState("");
  const [showAllPlayers, setShowAllPlayers] = useState(false);

  const filteredPlayers = useMemo(() => {
    if (!targetDraftSlot) return [];

    return players
      .filter((player) => {
        if (
          player.position_group !==
          targetDraftSlot.positionGroup
        ) {
          return false;
        }

        if (
          !showAllPlayers &&
          !isAvailabilityLoading &&
          !availablePlayerIdSet.has(player.id)
        ) {
          return false;
        }

        if (getOwnerTeamForPlayer(player.id)) {
          return false;
        }

        if (
          searchTerm.trim() &&
          !player.name
            .toLowerCase()
            .includes(
              searchTerm.trim().toLowerCase()
            )
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const avgA =
          playerProjections?.[a.id]?.projection ??
          playerAverageMap.get(a.id);

        const avgB =
          playerProjections?.[b.id]?.projection ??
          playerAverageMap.get(b.id);

        if (avgA == null && avgB == null) {
          return a.name.localeCompare(b.name);
        }

        if (avgA == null) return 1;
        if (avgB == null) return -1;

        return avgB - avgA;
      });
  }, [
    targetDraftSlot,
    players,
    playerAverageMap,
    playerProjections,
    availablePlayerIdSet,
    isAvailabilityLoading,
    getOwnerTeamForPlayer,
    searchTerm,
    showAllPlayers,
  ]);

  if (!targetDraftSlot) return null;

  async function draftPlayer(player: Player) {
    if (!targetDraftSlot) return;

    await handleAssignPlayerToTeam(
      player,
      targetDraftSlot.teamId
    );

    setTargetDraftSlot(null);
    setSearchTerm("");
  }

  return (
    <div
      className={`mobile-modal-safe slot-draft-overlay fixed inset-0 z-50 flex items-end justify-center bg-slate-950/70 px-3 py-4 backdrop-blur-sm sm:items-center ${
        hidden
          ? "slot-draft-overlay--hidden"
          : ""
      }`}
      aria-hidden={hidden}
      onClick={() => {
        if (!hidden) {
          setTargetDraftSlot(null);
        }
      }}
    >
      <section
        className="mobile-modal-panel-safe slot-draft-modal flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-hidden rounded-3xl border shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="slot-draft-header">
          <div className="min-w-0">
            <div className="slot-draft-kicker">
              Draft to roster spot
            </div>

            <h2>
              {targetDraftSlot.teamName}
              <span>
                {targetDraftSlot.positionGroup}
              </span>
            </h2>

            <p>
              Choose an available{" "}
              {targetDraftSlot.positionGroup}.
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              setTargetDraftSlot(null)
            }
            className="slot-draft-close"
            aria-label="Close draft modal"
          >
            ×
          </button>
        </header>

        <div className="slot-draft-search">
          <div className="slot-draft-search-heading">
            <label htmlFor="slot-player-search">
              Search players
            </label>

            <div
              className="inline-flex shrink-0 rounded-full border border-slate-300 bg-slate-100 p-1 dark:border-slate-600 dark:bg-slate-800"
              role="group"
              aria-label="Player availability"
            >
              <button
                type="button"
                onClick={() => setShowAllPlayers(false)}
                aria-pressed={!showAllPlayers}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  !showAllPlayers
                    ? "bg-sky-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                On This Slate
              </button>

              <button
                type="button"
                onClick={() => setShowAllPlayers(true)}
                aria-pressed={showAllPlayers}
                className={`rounded-full px-3 py-1.5 text-xs font-bold transition ${
                  showAllPlayers
                    ? "bg-sky-600 text-white shadow-sm"
                    : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
                }`}
              >
                All Players
              </button>
            </div>
          </div>

          <input
            id="slot-player-search"
            type="text"
            value={searchTerm}
            onChange={(event) =>
              setSearchTerm(event.target.value)
            }
            placeholder={`Search ${targetDraftSlot.positionGroup} players...`}
            autoFocus
          />
        </div>

        <div className="slot-draft-results min-h-0 flex-1 overflow-y-auto p-4 pb-24 sm:p-5">
          {isAvailabilityLoading ? (
            <div className="slot-draft-empty">
              <div aria-hidden="true">🏀</div>
              <strong>
                Loading available players
              </strong>
              <p>
                Checking which players are scheduled
                for this slate.
              </p>
            </div>
          ) : filteredPlayers.length === 0 ? (
            <div className="slot-draft-empty">
              <div aria-hidden="true">📅</div>
              <strong>
                No players available yet
              </strong>
              <p>
                {showAllPlayers
                  ? `No undrafted ${targetDraftSlot.positionGroup} players match your search.`
                  : `No ${targetDraftSlot.positionGroup} players are currently scheduled for this slate. Switch to All Players above for testing.`}
              </p>
            </div>
          ) : (
            <div className="slot-draft-player-list">
              {filteredPlayers.map((player) => {
                const projection =
                  playerProjections?.[player.id]
                    ?.projection ??
                  playerAverageMap.get(player.id);

                return (
                  <article
                    key={player.id}
                    className="slot-draft-player"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        onInspectPlayer(player)
                      }
                      className="slot-draft-player-inspect"
                      aria-label={`View stats for ${player.name}`}
                    >
                      <PlayerHeadshot
                        nbaPlayerId={
                          player.nba_player_id
                        }
                        nflPlayerId={
                          player.nfl_player_id
                        }
                        playerName={player.name}
                        size="md"
                      />

                      <div className="min-w-0">
                        <div className="truncate font-bold">
                          {player.name}
                        </div>

                        <div className="mt-1 text-xs">
                          {player.position_group} • Proj{" "}
                          {fmt(projection)}
                        </div>

                        <div className="slot-draft-player-view-label">
                          View player stats
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        void draftPlayer(player)
                      }
                      disabled={
                        isAssigningPlayer || isSaving
                      }
                      className="slot-draft-player-action"
                      aria-label={`Draft ${player.name} to ${targetDraftSlot.teamName}`}
                    >
                      {isAssigningPlayer || isSaving
                        ? "Saving…"
                        : "Draft"}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
