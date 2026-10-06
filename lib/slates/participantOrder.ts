type Team = { id: number; name: string };
type Result = {
  team_id: number;
  finish_position: number | null;
  fantasy_points: number | null;
};

/** Previous results determine order only; the caller supplies currently eligible teams. */
export function buildSuggestedOrderIds(results: Result[], teams: Team[]) {
  const eligible = new Set(teams.map((team) => team.id));
  const ranked = results
    .filter((row) => eligible.has(row.team_id) && row.finish_position != null && (row.fantasy_points ?? 0) > 0)
    .sort((a, b) => (a.finish_position! - b.finish_position!) ||
      Number(b.fantasy_points ?? 0) - Number(a.fantasy_points ?? 0));
  const inverseOrderIds = ranked.map((row) => row.team_id).reverse();
  const unranked = teams.filter((team) => !inverseOrderIds.includes(team.id))
    .sort((a, b) => a.name.localeCompare(b.name)).map((team) => team.id);
  return [...inverseOrderIds, ...unranked];
}
