"use client";
import { useState } from "react";
import { playerCenterEnabled } from "@/lib/player-center/feature";
import CatalogBrowser from "./CatalogBrowser";
import type { PlayerPoolProps } from "@/components/lineups/PlayerPool";
import type { CenterSport } from "@/lib/player-center/types";
import { professionalSeason } from "@/lib/player-center/types";
import type { CenterIdentity } from "@/lib/player-center/display";
import ResearchBrowser from "./ResearchBrowser";
import PlayerCenterModal from "./PlayerCenterModal";

export function centerIdentity(player: { id: number; name: string; position_group?: string; nba_player_id?: number | null; nfl_player_id?: number | null; team_abbreviation?: string | null; headshot_url?: string | null }): CenterIdentity {
  return { id: player.id, name: player.name, positionGroup: player.position_group, nbaPlayerId: player.nba_player_id,
    nflPlayerId: player.nfl_player_id, teamAbbreviation: player.team_abbreviation, headshotUrl: player.headshot_url };
}
export default function DraftPlayerCenter({ sport, ...props }: PlayerPoolProps & { sport: CenterSport }) {
  const [selected, setSelected] = useState<CenterIdentity | null>(null);
  const season = props.centerSeason ?? (sport === "nfl" && props.nflSeason ? Number(props.nflSeason) : professionalSeason(sport));
  const byId = new Map(props.players.map(player => [player.id, player]));
  const inspect = (identity: CenterIdentity) => setSelected(identity);
  const select = (identity: CenterIdentity) => {
    const player = byId.get(identity.id);
    if (!player) return;
    if (props.speedEntry) { void props.speedEntry.onSelect(player); return; }
    props.setDraftingPlayer(player);
  };
  const entries = props.filteredPlayers.map(player => ({ identity: centerIdentity(player), status: props.getOwnerTeamForPlayer(player.id)?.name
    ? `Drafted · ${props.getOwnerTeamForPlayer(player.id)!.name}` : props.availablePlayerIdSet.has(player.id) ? "Available on slate" : "Not on slate" }));
  const Browser = playerCenterEnabled() ? ResearchBrowser : CatalogBrowser;
  return <>
    <Browser sport={sport} season={season} slateId={props.slateId} entries={entries} search={props.searchTerm} onSearch={props.setSearchTerm}
      position={props.positionFilter} onPosition={props.setPositionFilter} hidePositionFilter={props.hidePositionFilter} selectedId={selected?.id}
      positions={sport === "nba" ? ["All", "G", "F/C"] : ["All", "QB", "RB", "WR", "TE", "K", "D/ST", ...(props.rosterSlots?.map(slot => slot.position) ?? [])]}
      disabled={props.isAssigningPlayer} onInspect={identity => {
        const player = byId.get(identity.id);
        if (props.speedEntry && player) props.speedEntry.onResearch(player); else inspect(identity);
      }} onSelect={select}
      extras={<div className="pc-availability" aria-label="Availability filter"><button aria-pressed={props.onSlateOnly} onClick={() => props.setOnSlateOnly(true)}>On slate</button><button aria-pressed={!props.onSlateOnly} onClick={() => props.setOnSlateOnly(false)}>All players</button>{props.isAvailabilityLoading && <span>Checking slate…</span>}</div>} />
    {selected && <PlayerCenterModal identity={selected} sport={sport} season={season} slateId={props.slateId} onClose={() => setSelected(null)}>
      <button className="pc-primary-action" disabled={props.isAssigningPlayer} onClick={async () => {
        const player = byId.get(selected.id); if (!player) return;
        if (props.slotDraftContext) await props.slotDraftContext.onDraftPlayer(player); else props.setDraftingPlayer(player);
        setSelected(null);
      }}>{props.slotDraftContext ? `Draft to ${props.slotDraftContext.targetDraftSlot.positionGroup} slot` : props.getOwnerTeamForPlayer(selected.id) ? "Roster actions" : "Draft options"}</button>
    </PlayerCenterModal>}
  </>;
}
