"use client";

import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import type { Player } from "@/components/lineups/types";

type TargetDraftSlot = {
  teamId: number;
  teamName: string;
  positionGroup: "G" | "F/C";
};

type Props = {
  teamId: number | null;
  teamName: string | null;
  players: Player[];
  isLocked: boolean;
  setDraftingPlayer: React.Dispatch<React.SetStateAction<Player | null>>;
  setTargetDraftSlot: React.Dispatch<
    React.SetStateAction<TargetDraftSlot | null>
  >;
};

type SlotProps = {
  player: Player | null;
  positionGroup: "G" | "F/C";
  slotNumber: number;
  disabled: boolean;
  onPlayerClick: (player: Player) => void;
  onEmptyClick: (positionGroup: "G" | "F/C") => void;
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

        onEmptyClick(positionGroup);
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
  isLocked,
  setDraftingPlayer,
  setTargetDraftSlot,
}: Props) {
  const guards = players.filter(
    (player) => player.position_group === "G"
  );

  const frontcourt = players.filter(
    (player) => player.position_group === "F/C"
  );

  const guardSlots: Array<Player | null> = [
    guards[0] ?? null,
    guards[1] ?? null,
  ];

  const frontcourtSlots: Array<Player | null> = [
    frontcourt[0] ?? null,
    frontcourt[1] ?? null,
    frontcourt[2] ?? null,
  ];

  const completedSlots = Math.min(players.length, 5);
  const progressPercent = (completedSlots / 5) * 100;

  function openEmptySlot(positionGroup: "G" | "F/C") {
    if (!teamId || !teamName || isLocked) return;

    setTargetDraftSlot({
      teamId,
      teamName,
      positionGroup,
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
          <strong>{completedSlots}/5</strong>
          <span>{completedSlots === 5 ? "Complete" : "Filled"}</span>
        </div>
      </div>

      <div className="draft-roster-progress">
        <div
          className="draft-roster-progress-fill"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      <div className="draft-roster-formation">
        <div className="draft-roster-row draft-roster-row--guards">
          {guardSlots.map((player, index) => (
            <DraftRosterSlot
              key={`guard-${index}`}
              player={player}
              positionGroup="G"
              slotNumber={index + 1}
              disabled={!teamId || isLocked}
              onPlayerClick={setDraftingPlayer}
              onEmptyClick={openEmptySlot}
            />
          ))}
        </div>

        <div className="draft-roster-row draft-roster-row--frontcourt">
          {frontcourtSlots.map((player, index) => (
            <DraftRosterSlot
              key={`frontcourt-${index}`}
              player={player}
              positionGroup="F/C"
              slotNumber={index + 1}
              disabled={!teamId || isLocked}
              onPlayerClick={setDraftingPlayer}
              onEmptyClick={openEmptySlot}
            />
          ))}
        </div>
      </div>

      <div className="draft-roster-footer">
        {isLocked ? (
          <span>🔒 This slate is locked</span>
        ) : completedSlots === 5 ? (
          <span>✅ Lineup complete</span>
        ) : (
          <span>Tap an empty spot to draft a player</span>
        )}
      </div>
    </section>
  );
}
