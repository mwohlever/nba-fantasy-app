import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import type { CenterIdentity } from "@/lib/player-center/display";

export default function PlayerBasics({ identity }: { identity: CenterIdentity }) {
  return <article className="pc pc-profile" aria-label={`${identity.name} player details`}><header className="pc-header"><div className="pc-identity">
    <PlayerHeadshot nbaPlayerId={identity.nbaPlayerId} nflPlayerId={identity.nflPlayerId} imageUrl={identity.headshotUrl} playerName={identity.name} size="xl" />
    <div className="pc-name"><h2>{identity.name}</h2><p>{[identity.teamAbbreviation,identity.positionGroup].filter(Boolean).join(" · ")}</p></div>
  </div></header><p className="pc-panel pc-footnote">Historical statistical profiles are not activated.</p></article>;
}
