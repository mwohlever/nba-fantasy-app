export type NcaaEspnDirectoryTeam = {
  id: string;
  displayName: string;
  abbreviation: string | null;
  logo: string | null;
};

function logoFromTeam(team: any) {
  const logos = Array.isArray(team?.logos) ? team.logos : [];
  return typeof logos[0]?.href === "string" ? logos[0].href : null;
}

/** Normalizes ESPN's college-football teams directory into NCAA Pick'em identity fields. */
export function normalizeNcaaEspnTeamDirectory(payload: any): NcaaEspnDirectoryTeam[] {
  const sports = Array.isArray(payload?.sports) ? payload.sports : [];
  const entries = sports.flatMap((sport: any) =>
    (Array.isArray(sport?.leagues) ? sport.leagues : []).flatMap((league: any) =>
      Array.isArray(league?.teams) ? league.teams : [],
    ),
  );

  const byId = new Map<string, NcaaEspnDirectoryTeam>();
  for (const entry of entries) {
    const team = entry?.team ?? entry;
    const id = team?.id != null ? String(team.id).trim() : "";
    const displayName = typeof team?.displayName === "string" ? team.displayName.trim() : "";
    if (!id || !displayName) continue;

    byId.set(id, {
      id,
      displayName,
      abbreviation:
        typeof team?.abbreviation === "string" && team.abbreviation.trim()
          ? team.abbreviation.trim()
          : null,
      logo: logoFromTeam(team),
    });
  }

  return [...byId.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}
