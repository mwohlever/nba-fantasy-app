type Competition = {
  status?: { type?: { state?: string; completed?: boolean } };
  competitors?: Array<{ id?: string; team?: { id?: string }; possession?: boolean }>;
};

/** ESPN owns this flag. Never infer possession from a completed drive or play. */
export function possessionTeamId(competition?: Competition | null): string | null {
  if (competition?.status?.type?.state !== "in" || competition.status.type.completed) return null;
  const possessing = (competition.competitors ?? []).filter((team) => team.possession === true);
  if (possessing.length !== 1) return null;
  const id = possessing[0].team?.id ?? possessing[0].id;
  return id ? String(id) : null;
}
