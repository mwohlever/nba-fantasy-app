"use client";

import { NflFantasyRosterPlayer } from "./NflFantasyGameCenter";

import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import {
  assignPlayersToRosterSlots,
} from "@/lib/rules/leagueRules";
import type {
  Player,
  RosterSlotConfig,
  TargetDraftSlot,
} from "@/components/lineups/types";

type Props = {
  teamId: number | null;
  teamName: string | null;
  players: Player[];
  rosterSlots: RosterSlotConfig[];

  slotAssignments?: Array<{
    player_id: number;
    roster_slot_position: string | null;
    roster_slot_index: number | null;
  }>;

  isLocked: boolean;
  canDraft?: boolean;
  canProxyDraft?: boolean;
  proxyBusy?: boolean;
  setDraftingPlayer: React.Dispatch<React.SetStateAction<Player | null>>;
  setTargetDraftSlot: React.Dispatch<React.SetStateAction<TargetDraftSlot | null>>;
};

type SlotProps = {
  player: Player | null;
  positionGroup: string;
  slotNumber: number;
  disabled: boolean;
  proxyTeamName?: string;
  onPlayerClick: (player: Player) => void;

  onEmptyClick: (
    positionGroup: string,
    slotIndex: number,
  ) => void;
};

function DraftRosterSlot({
  player,
  positionGroup,
  slotNumber,
  disabled,
  proxyTeamName,
  onPlayerClick,
  onEmptyClick,
}: SlotProps) {
  const label = player?.name ?? positionGroup;

  return (
    <NflFantasyRosterPlayer player={player}>
    <button
      type="button"
      data-draft-pull-start="true"
      disabled={!player && disabled}
      onClick={() => {
        if (player) {
          onPlayerClick(player);
          return;
        }

        onEmptyClick(
          positionGroup,
          slotNumber - 1,
        );
      }}
      aria-label={
        player
          ? `View ${player.name}`
          : disabled ? `Empty ${positionGroup} slot ${slotNumber}, read-only` : proxyTeamName ? `Draft for ${proxyTeamName}: ${positionGroup} slot ${slotNumber}` : `Draft ${positionGroup} into slot ${slotNumber}`
      }
      className={`draft-roster-slot ${
        player
          ? "draft-roster-slot--filled"
          : "draft-roster-slot--empty"
      }`}
    >
      <span className="draft-roster-headshot">
        {player ? (
          <PlayerHeadshot
            nbaPlayerId={player.nba_player_id}
            nflPlayerId={player.nfl_player_id}
            espnGolfPlayerId={player.espn_player_id}
            imageUrl={player.headshot_url}
            playerName={player.name}
            size="xl"
            className="draft-roster-player-image"
          />
        ) : (
          <span className="draft-roster-plus" aria-hidden="true">
            +
          </span>
        )}
      </span>

      <span className="draft-roster-player-name">
        {label}
      </span>

      <span className="draft-roster-position">
        {player ? positionGroup : proxyTeamName && !disabled ? `Draft for ${proxyTeamName}` : "Empty"}
      </span>
    </button>
    </NflFantasyRosterPlayer>
  );
}

export default function DraftRosterCourt({
  teamId,
  teamName,
  players,
  rosterSlots,
  slotAssignments = [],
  isLocked,
  canDraft = false,
  canProxyDraft = false,
  proxyBusy = false,
  setDraftingPlayer,
  setTargetDraftSlot,
}: Props) {
  const effectiveSlots =
    rosterSlots;


  const totalSlots = effectiveSlots.reduce(
    (sum, slot) => sum + slot.slot_count,
    0
  );

  const activeSport =
    (
      effectiveSlots[
        0
      ]?.sport ??
      "nba"
    ) as
      | "nba"
      | "nfl"
      | "golf";


  const assignment =
    assignPlayersToRosterSlots({
      sport:
        activeSport,

      playerPositions:
        players.map(
          (player) =>
            player.position_group,
        ),

      rosterSlots:
        effectiveSlots,
    });


  const playerById =
    new Map(
      players.map(
        (player) => [
          player.id,
          player,
        ],
      ),
    );


  const savedPlayerIdBySlot =
    new Map<string, number>();


  const explicitlyAssignedPlayerIds =
    new Set<number>();


  for (
    const savedSlot
    of slotAssignments
  ) {
    if (
      !savedSlot.roster_slot_position ||
      savedSlot.roster_slot_index === null ||
      savedSlot.roster_slot_index === undefined
    ) {
      continue;
    }


    savedPlayerIdBySlot.set(
      `${savedSlot.roster_slot_position}:${savedSlot.roster_slot_index}`,
      savedSlot.player_id,
    );

    explicitlyAssignedPlayerIds.add(
      savedSlot.player_id,
    );
  }


  const completedSlots = Math.min(players.length, totalSlots);


  function openEmptySlot(
    positionGroup: string,
    slotIndex: number,
  ) {
    if ((!canDraft && !canProxyDraft) || proxyBusy || !teamId || !teamName || isLocked) return;

    setTargetDraftSlot({
      teamId,
      teamName,
      positionGroup,
      slotIndex,
    });
  }

  return (
    <section className="draft-roster-court">
      <div className="draft-roster-summary">
        <h2>{teamName ?? "No participating team"}</h2>
        <span>{completedSlots}/{totalSlots} · {canProxyDraft ? "Commissioner" : canDraft ? "Your roster" : "Read-only"}</span>
      </div>

      <div className="draft-roster-formation">
        {effectiveSlots.map(
          (
            slotConfig,
          ) => {
            const matchingSlots =
              assignment.slots.filter(
                (slot) =>
                  slot.position ===
                  slotConfig.position,
              );


            return (
              <div
                key={
                  slotConfig.position
                }
                className="draft-roster-row"
              >
                {matchingSlots.map(
                  (
                    slot,
                    index,
                  ) => {
                    const savedPlayerId =
                      savedPlayerIdBySlot.get(
                        `${slot.position}:${slot.slotIndex}`,
                      );


                    const inferredPlayer =
                      slot.playerIndex >=
                      0
                        ? players[
                            slot.playerIndex
                          ] ??
                          null
                        : null;


                    const player =
                      savedPlayerId !==
                      undefined
                        ? playerById.get(
                            savedPlayerId,
                          ) ??
                          null
                        : inferredPlayer &&
                          !explicitlyAssignedPlayerIds.has(
                            inferredPlayer.id,
                          )
                          ? inferredPlayer
                          : null;


                    return (
                      <DraftRosterSlot
                        key={`${slotConfig.position}-${index}`}
                        player={
                          player
                        }
                        positionGroup={
                          slotConfig.position
                        }
                        slotNumber={
                          index +
                          1
                        }
                        disabled={
                          (!canDraft && !canProxyDraft) || proxyBusy || !teamId ||
                          isLocked
                        }
                        proxyTeamName={canProxyDraft ? teamName ?? undefined : undefined}
                        onPlayerClick={
                          setDraftingPlayer
                        }
                        onEmptyClick={
                          openEmptySlot
                        }
                      />
                    );
                  },
                )}
              </div>
            );
          },
        )}
      </div>

    </section>
  );
}
