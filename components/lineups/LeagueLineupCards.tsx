"use client";

import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import TeamAvatar from "@/components/ui/TeamAvatar";
import {
  assignPlayersToRosterSlots,
} from "@/lib/rules/leagueRules";
import type {
  OrderedTeam,
  Player,
  RosterSlotConfig,
  TargetDraftSlot,
} from "@/components/lineups/types";

type Props = {
  teams: OrderedTeam[];
  currentTeamId: number | null;
  getPlayersForTeam: (teamId: number) => Player[];
  getPlayerProjectionScore: (playerId: number) => number;
  getDraftNeeds: (teamId: number) => string;
  rosterSlots: RosterSlotConfig[];
  setResearchPlayer: React.Dispatch<React.SetStateAction<Player | null>>;
  setTargetDraftSlot: React.Dispatch<React.SetStateAction<TargetDraftSlot | null>>;
  isLocked: boolean;
};

type MiniSlotProps = {
  player: Player | null;
  positionGroup: string;
  slotIndex: number;
  team: OrderedTeam;
  isLocked: boolean;
  setResearchPlayer: React.Dispatch<React.SetStateAction<Player | null>>;
  setTargetDraftSlot: React.Dispatch<React.SetStateAction<TargetDraftSlot | null>>;
};

function MiniSlot({
  player,
  positionGroup,
  slotIndex,
  team,
  isLocked,
  setResearchPlayer,
  setTargetDraftSlot,
}: MiniSlotProps) {
  return (
    <button
      type="button"
      disabled={!player && isLocked}
      onClick={() => {
        if (player) {
          setResearchPlayer(player);
          return;
        }

        if (isLocked) return;

        setTargetDraftSlot({
          teamId: team.id,
          teamName: team.name,
          positionGroup,
          slotIndex,
        });
      }}
      className={`league-lineup-mini-slot ${
        player
          ? "league-lineup-mini-slot--filled"
          : "league-lineup-mini-slot--empty"
      }`}
      aria-label={
        player
          ? `View ${player.name}`
          : `Draft ${positionGroup} for ${team.name}`
      }
    >
      {player ? (
        <PlayerHeadshot
          nbaPlayerId={player.nba_player_id}
          playerName={player.name}
          imageUrl={player.headshot_url}
          size="sm"
          className="league-lineup-mini-headshot"
        />
      ) : (
        <span aria-hidden="true">+</span>
      )}
    </button>
  );
}

export default function LeagueLineupCards({
  teams,
  currentTeamId,
  getPlayersForTeam,
  getPlayerProjectionScore,
  getDraftNeeds,
  rosterSlots,
  setResearchPlayer,
  setTargetDraftSlot,
  isLocked,
}: Props) {
  const otherTeams = teams.filter(
    (team) => team.id !== currentTeamId
  );

  if (otherTeams.length === 0) {
    return null;
  }

  const effectiveSlots =
    rosterSlots;

  const totalSlots = effectiveSlots.reduce(
    (sum, slot) => sum + slot.slot_count,
    0
  );

  return (
    <section className="league-lineups-shell">
      <div className="league-lineups-heading">
        <div>
          <div className="league-lineups-kicker">
            Around the league
          </div>

          <h2>League Lineups</h2>

          <p>
            Swipe to compare rosters and remaining needs.
          </p>
        </div>

        <div className="league-lineups-swipe-note">
          Swipe →
        </div>
      </div>

      <div className="league-lineups-strip">
        {otherTeams.map((team) => {
          const rosterPlayers = getPlayersForTeam(team.id);

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


          const rosterAssignment =
            assignPlayersToRosterSlots({
              sport:
                activeSport,

              playerPositions:
                rosterPlayers.map(
                  (player) =>
                    player.position_group,
                ),

              rosterSlots:
                effectiveSlots,
            });


          const projectedTotal = rosterPlayers.reduce(
            (sum, player) =>
              sum + getPlayerProjectionScore(player.id),
            0
          );

          const rosterCount = rosterPlayers.length;
          const isComplete = rosterCount === totalSlots;
          const isParticipating =
            team.is_participating !== false;

          return (
            <article
              key={team.id}
              className={`league-lineup-card ${
                !isParticipating
                  ? "league-lineup-card--inactive"
                  : ""
              }`}
            >
              <div className="league-lineup-card-header">
                <div className="flex min-w-0 items-center gap-3">
                  <TeamAvatar
                    teamName={team.name}
                    size="lg"
                  />

                  <div className="min-w-0">
                    <h3>{team.name}</h3>

                    <div className="league-lineup-draft-order">
                      Draft position #
                      {team.draft_order ?? "—"}
                      {!isParticipating ? " • Out" : ""}
                    </div>
                  </div>
                </div>

                <div
                  className={`league-lineup-count ${
                    isComplete
                      ? "league-lineup-count--complete"
                      : ""
                  }`}
                >
                  {rosterCount}/{totalSlots}
                </div>
              </div>

              <div className="league-lineup-formation">
                {effectiveSlots.map(
                  (
                    slotConfig,
                  ) => {
                    const matchingSlots =
                      rosterAssignment.slots.filter(
                        (slot) =>
                          slot.position ===
                          slotConfig.position,
                      );


                    return (
                      <div
                        key={
                          slotConfig.position
                        }
                        className="league-lineup-row"
                      >
                        {matchingSlots.map(
                          (
                            slot,
                            index,
                          ) => {
                            const player =
                              slot.playerIndex >=
                              0
                                ? rosterPlayers[
                                    slot.playerIndex
                                  ] ??
                                  null
                                : null;


                            return (
                              <MiniSlot
                                key={`${slotConfig.position}-${team.id}-${index}`}
                                player={
                                  player
                                }
                                positionGroup={
                                  slotConfig.position
                                }
                                slotIndex={
                                  slot.slotIndex
                                }
                                team={
                                  team
                                }
                                isLocked={
                                  isLocked
                                }
                                setResearchPlayer={
                                  setResearchPlayer
                                }
                                setTargetDraftSlot={
                                  setTargetDraftSlot
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

              <div className="league-lineup-progress">
                <div
                  style={{
                    width: `${Math.min(
                      (rosterCount / totalSlots) * 100,
                      100
                    )}%`,
                  }}
                />
              </div>

              <div className="league-lineup-card-footer">
                <div>
                  <span>Projected</span>
                  <strong>
                    {projectedTotal.toFixed(1)}
                  </strong>
                </div>

                <div className="league-lineup-need">
                  {isComplete
                    ? "✓ Complete"
                    : getDraftNeeds(team.id)}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
