"use client";

import type { PlayLogoTeam } from "@/lib/live-scores/playTeamLogo";

/** Empty and failed images retain the same narrow row geometry. */
export default function PlayTeamLogo({ team }: { team: PlayLogoTeam | null }) {
  return <span data-play-team-logo className="flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden="true">
    {team?.logo ? <img key={team.logo} src={team.logo} alt="" width={20} height={20}
      data-team-id={team.id} className="h-5 w-5 object-contain"
      onError={event => { event.currentTarget.style.visibility = "hidden"; }} /> : null}
  </span>;
}
