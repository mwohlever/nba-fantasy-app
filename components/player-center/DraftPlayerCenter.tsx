"use client";
import type { PlayerPoolProps } from "@/components/lineups/PlayerPool";
import type { CenterSport, CenterWindow } from "@/lib/player-center/types";
import { professionalSeason } from "@/lib/player-center/types";
import type { CenterIdentity } from "@/lib/player-center/display";
import ResearchBrowser from "./ResearchBrowser";

export function centerIdentity(player: { id: number; name: string; position_group?: string; nba_player_id?: number | null; nfl_player_id?: number | null; team_abbreviation?: string | null; headshot_url?: string | null }): CenterIdentity {
  return { id: player.id, name: player.name, positionGroup: player.position_group, nbaPlayerId: player.nba_player_id,
    nflPlayerId: player.nfl_player_id, teamAbbreviation: player.team_abbreviation, headshotUrl: player.headshot_url };
}
export default function DraftPlayerCenter({ sport, comparison, researchWindow, onResearchWindowChange, ...props }: PlayerPoolProps & { sport: CenterSport;
  researchWindow?: CenterWindow; onResearchWindowChange?: (window: CenterWindow) => void;
  comparison?: { selectedIds: number[]; onToggle: (playerId: number) => void } }) {
  const season = props.centerSeason ?? professionalSeason(sport);
  const byId = new Map(props.players.map(player => [player.id, player]));
  const select = (identity: CenterIdentity) => {
    const player = byId.get(identity.id);
    if (!player) return;
    if (props.speedEntry) { props.speedEntry.onResearch(player); return; }
    props.setDraftingPlayer(player);
  };
  const entries = props.filteredPlayers.map(player => ({ identity: centerIdentity(player), status: props.getOwnerTeamForPlayer(player.id)?.name
    ? `Drafted · ${props.getOwnerTeamForPlayer(player.id)!.name}` : props.availablePlayerIdSet.has(player.id) ? "Available on slate" : "Not on slate" }));
  return <ResearchBrowser comparison={comparison && { selectedIds: comparison.selectedIds, onToggle: identity => comparison.onToggle(identity.id) }} sport={sport} season={season} slateId={props.slateId} entries={entries} search={props.searchTerm} onSearch={props.setSearchTerm}
      window={researchWindow} onWindowChange={onResearchWindowChange}
      position={props.positionFilter} onPosition={props.setPositionFilter} hidePositionFilter={props.hidePositionFilter}
      positions={[...new Set(["All", ...(sport === "nba" ? ["G", "F/C"] : ["QB", "RB", "WR", "TE", "K", "D/ST"]), ...(props.rosterSlots?.map(slot => slot.position) ?? [])])]}
      disabled={props.isAssigningPlayer} onInspect={select} onSelect={select}
      extras={<div className="pc-availability" aria-label="Availability filter"><button aria-pressed={props.onSlateOnly} onClick={() => props.setOnSlateOnly(true)}>On slate</button><button aria-pressed={!props.onSlateOnly} onClick={() => props.setOnSlateOnly(false)}>All players</button>{props.isAvailabilityLoading && <span>Checking slate…</span>}</div>} />
}
