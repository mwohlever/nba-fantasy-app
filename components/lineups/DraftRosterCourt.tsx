"use client";

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
  setDraftingPlayer: React.Dispatch<React.SetStateAction<Player | null>>;
  setTargetDraftSlot: React.Dispatch<React.SetStateAction<TargetDraftSlot | null>>;
};

type SlotProps = {
  player: Player | null;
  positionGroup: string;
  slotNumber: number;
  disabled: boolean;
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
  onPlayerClick,
  onEmptyClick,
}: SlotProps) {
  const label = player?.name ?? positionGroup;

  return (
    <button
      type="button"
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
          : `Draft ${positionGroup} into slot ${slotNumber}`
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
        {player ? positionGroup : "Empty"}
      </span>
    </button>
  );
}

export default function DraftRosterCourt({
  teamId,
  teamName,
  players,
  rosterSlots,
  slotAssignments = [],
  isLocked,
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
  const progressPercent = totalSlots > 0 ? (completedSlots / totalSlots) * 100 : 0;

  function openEmptySlot(
    positionGroup: string,
    slotIndex: number,
  ) {
    if (!teamId || !teamName || isLocked) return;

    setTargetDraftSlot({
      teamId,
      teamName,
      positionGroup,
      slotIndex,
    });
  }

  return (
    <section className="draft-roster-court">
      <div className="draft-roster-header">
        <div>
          <div className="draft-roster-kicker">
            Your lineup
          </div>

          <h2 className="draft-roster-title">
            {teamName ?? "Loading your team..."}
          </h2>
        </div>

        <div className="draft-roster-count">
          <strong>{completedSlots}/{totalSlots}</strong>
          <span>{completedSlots === totalSlots ? "Complete" : "Filled"}</span>
        </div>
      </div>

      <div className="draft-roster-progress">
        <div
          className="draft-roster-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
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
                          !teamId ||
                          isLocked
                        }
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

      <div className="draft-roster-footer">
        {isLocked ? (
          <span>🔒 This slate is locked</span>
        ) : completedSlots === totalSlots ? (
          <span>✅ Lineup complete</span>
        ) : (
          <span>Tap an empty spot to draft a player</span>
        )}
      </div>
    </section>
  );
}
