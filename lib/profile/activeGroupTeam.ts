/**
 * Resolves the team identity for a viewer's Group-scoped profile.
 *
 * `app_users.team_id` is a legacy authentication reference and must not be
 * used here: it can identify a historical team outside the active Group.
 */
export function resolveActiveGroupProfileTeamId(
  groupTeamId: number | null | undefined,
) {
  return Number.isInteger(groupTeamId) && Number(groupTeamId) > 0
    ? Number(groupTeamId)
    : null;
}
