"use client";
import { useState } from "react";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { playerCenterEnabled } from "@/lib/player-center/feature";
import type { LeagueSeason, PlayerResearchMode } from "@/lib/player-center/modalContext";
import PlayerCenter, { type PlayerCenterProps } from "./PlayerCenter";
import PlayerBasics from "./PlayerBasics";
import PlayerLeagueHistory from "./PlayerLeagueHistory";

export type PlayerProfileContentProps = PlayerCenterProps & { leagueSeason?: LeagueSeason; defaultMode?: PlayerResearchMode };

/** Context navigation sits outside the approved professional-stat profile and its three tabs. */
export default function PlayerProfileContent(props: PlayerProfileContentProps) {
  const { groupContext } = useGroupContext();
  if (props.fixture) return <PlayerCenter {...props} />;
  return <ProfileViews key={`${groupContext?.group.id}:${props.sport}:${props.identity.id}:${props.season}:${props.slateId}:${props.leagueSeason}:${props.defaultMode}`} {...props} />;
}

function ProfileViews({ leagueSeason = new Date().getUTCFullYear(), defaultMode = "season", ...props }: PlayerProfileContentProps) {
  const [mode, setMode] = useState<PlayerResearchMode>(defaultMode);
  const [visited, setVisited] = useState({ season: defaultMode === "season", league: defaultMode === "league" });
  const choose = (next: PlayerResearchMode) => { setMode(next); setVisited(previous => ({ ...previous, [next]: true })); };
  return <div className="pc" data-sport={props.sport}>
    <nav className="pc-window border-b px-4 py-2" aria-label="Professional and league research">
      <button type="button" aria-pressed={mode === "season"} onClick={() => choose("season")}>{props.sport.toUpperCase()} statistics</button>
      <button type="button" aria-pressed={mode === "league"} onClick={() => choose("league")}>111 Sports League History</button>
    </nav>
    {visited.season && <div hidden={mode !== "season"}>{playerCenterEnabled() ? <PlayerCenter {...props} /> : <PlayerBasics identity={props.identity} />}</div>}
    {visited.league && <div hidden={mode !== "league"}><PlayerLeagueHistory identity={props.identity} sport={props.sport} initialSeason={leagueSeason} /></div>}
  </div>;
}
