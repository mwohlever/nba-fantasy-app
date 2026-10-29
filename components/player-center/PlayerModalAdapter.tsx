"use client";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type { PlayerModalProps } from "@/components/lineups/PlayerModal";
import type { CenterSport } from "@/lib/player-center/types";
import PlayerCenterModal from "./PlayerCenterModal";
import { centerIdentity } from "./DraftPlayerCenter";

/** Calls the established assignment/removal handlers; the profile never saves a pick itself. */
export default function PlayerModalAdapter({ sport, ...props }: PlayerModalProps & { sport: CenterSport }) {
  if (!props.player) return null;
  const player = props.player, draft = props.mode === "draft" ? props : null;
  const busy = draft ? draft.isAssigningPlayer || draft.isSaving || draft.isExternalLoading : false;
  return <PlayerCenterModal identity={centerIdentity(player)} sport={sport} season={props.centerSeason} slateId={props.slateId} onClose={props.onClose}>
    {draft && <section className="pc-roster-actions" aria-label="Roster actions">
      {draft.targetDraftSlot && <button className="pc-primary-action" disabled={busy} onClick={() => { void draft.handleDraftToTargetSlot?.(player); }}>{busy ? "Drafting…" : `Draft to ${draft.targetDraftSlot.positionGroup} Slot`}</button>}
      <div className="pc-section-title"><strong>{draft.ownerTeam ? `Currently on ${draft.ownerTeam.name}` : "Choose a lineup"}</strong>
        {draft.ownerTeam && <button className="pc-text-button" disabled={busy} onClick={() => { void draft.handleRemovePlayerFromTeam(player); }}>Remove from {draft.ownerTeam.name}</button>}</div>
      <div className="pc-team-actions">{draft.orderedTeamsForSlate.map(team => {
        const status = draft.getTeamAssignmentStatus(team.id, player), owner = draft.getOwnerTeamIdForPlayer(player.id) === team.id;
        return <button key={team.id} disabled={busy || owner || !status.canAssign} onClick={() => { void draft.handleAssignPlayerToTeam(player, team.id); }}>
          <TeamAvatar teamName={team.name} size="sm" /><span><strong>{team.name}</strong><small>{owner ? "Current lineup" : status.canAssign ? draft.ownerTeam ? "Move here" : "Draft here" : status.reason}</small><small>{draft.getTeamStats(team.id).totalPlayers} rostered{team.is_participating === false ? " · Out" : ""}</small></span>
        </button>;
      })}</div>
    </section>}
  </PlayerCenterModal>;
}
