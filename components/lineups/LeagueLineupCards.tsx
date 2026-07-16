"use client";

import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type {
  OrderedTeam,
  Player,
} from "@/components/lineups/types";

type TargetDraftSlot = {
  teamId: number;
  teamName: string;
  positionGroup: "G" | "F/C";
};

type Props = {
  teams: OrderedTeam[];
  currentTeamId: number | null;
  getPlayersForTeam: (teamId: number) => Player[];
  getPlayerProjectionScore: (playerId: number) => number;
  getDraftNeeds: (teamId: number) => string;
  setDraftingPlayer: React.Dispatch<
    React.SetStateAction<Player | null>
  >;
  setTargetDraftSlot: React.Dispatch<
    React.SetStateAction<TargetDraftSlot | null>
  >;
  isLocked: boolean;
};

type MiniSlotProps = {
  player: Player | null;
  positionGroup: "G" | "F/C";
  team: OrderedTeam;
  isLocked: boolean;
  setDraftingPlayer: React.Dispatch<
    React.SetStateAction<Player | null>
  >;
  setTargetDraftSlot: React.Dispatch<
    React.SetStateAction<TargetDraftSlot | null>
  >;
};

function MiniSlot({
  player,
  positionGroup,
  team,
  isLocked,
  setDraftingPlayer,
  setTargetDraftSlot,
}: MiniSlotProps) {
  return (
    <button
      type="button"
      disabled={!player && isLocked}
      onClick={() => {
        if (player) {
          setDraftingPlayer(player);
          return;
        }

        if (isLocked) return;

        setTargetDraftSlot({
          teamId: team.id,
          teamName: team.name,
          positionGroup,
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
  setDraftingPlayer,
  setTargetDraftSlot,
  isLocked,
}: Props) {
  const otherTeams = teams.filter(
    (team) => team.id !== currentTeamId
  );

  if (otherTeams.length === 0) {
    return null;
  }

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
          const guards = rosterPlayers.filter(
            (player) => player.position_group === "G"
          );
          const frontcourt = rosterPlayers.filter(
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

          const projectedTotal = rosterPlayers.reduce(
            (sum, player) =>
              sum + getPlayerProjectionScore(player.id),
            0
          );

          const rosterCount = rosterPlayers.length;
          const isComplete = rosterCount === 5;
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
                  {rosterCount}/5
                </div>
              </div>

              <div className="league-lineup-formation">
                <div className="league-lineup-row league-lineup-row--guards">
                  {guardSlots.map((player, index) => (
                    <MiniSlot
                      key={`g-${team.id}-${index}`}
                      player={player}
                      positionGroup="G"
                      team={team}
                      isLocked={isLocked}
                      setDraftingPlayer={setDraftingPlayer}
                      setTargetDraftSlot={setTargetDraftSlot}
                    />
                  ))}
                </div>

                <div className="league-lineup-row league-lineup-row--frontcourt">
                  {frontcourtSlots.map((player, index) => (
                    <MiniSlot
                      key={`fc-${team.id}-${index}`}
                      player={player}
                      positionGroup="F/C"
                      team={team}
                      isLocked={isLocked}
                      setDraftingPlayer={setDraftingPlayer}
                      setTargetDraftSlot={setTargetDraftSlot}
                    />
                  ))}
                </div>
              </div>

              <div className="league-lineup-progress">
                <div
                  style={{
                    width: `${Math.min(
                      (rosterCount / 5) * 100,
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
