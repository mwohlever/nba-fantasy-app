export function bracketChallengeRoutes(contestId: string) {
  const contest = `/bracket-challenge/${encodeURIComponent(contestId)}`;
  return {
    home: "/bracket-challenge",
    leaderboard: contest,
    bracket: `${contest}/bracket`,
    liveScores: `${contest}/live`,
  };
}

export function bracketEntrantProfileHref(entrantId: string, contestId?: string | null) {
  const params = new URLSearchParams({ entrantId });
  if (contestId) params.set("contestId", contestId);
  return `/profile/bracket?${params.toString()}`;
}

export function resolveAuthorizedBracketContestId(requestedId: string | null, activeGroupContestIds: string[]) {
  return requestedId && activeGroupContestIds.includes(requestedId) ? requestedId : null;
}
