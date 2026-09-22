export type BracketHomeCompetition = {
  competition: {
    id: number;
    season: number;
    sportKey: string;
    formatKey: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  };
};

export function defaultBracketHomeSeason(
  competitions: BracketHomeCompetition[],
  now = new Date(),
) {
  const seasons = [...new Set(competitions.map((item) => item.competition.season))]
    .sort((a, b) => b - a);
  if (!seasons.length) return null;

  const currentYear = now.getUTCFullYear();
  if (seasons.includes(currentYear)) return currentYear;

  const relevant = competitions
    .filter((item) => {
      const competition = item.competition;
      return competition.status === "open" || competition.status === "in_progress" ||
        (competition.startsAt !== null && new Date(competition.startsAt).getTime() >= now.getTime());
    })
    .map((item) => item.competition.season)
    .sort((a, b) => a - b)[0];

  return relevant ?? seasons[0];
}

export function filterBracketHomeCompetitions<T extends BracketHomeCompetition>(
  competitions: T[],
  season: number | null,
  categoryKey: string,
) {
  return competitions.filter((item) =>
    (season === null || item.competition.season === season) &&
    (categoryKey === "all" || competitionCategoryIdentity(item) === categoryKey),
  );
}

/** The card format remains specific; filter categories intentionally are not. */
export function competitionCategoryIdentity(item: BracketHomeCompetition) {
  return item.competition.sportKey;
}

export function competitionIdentity(item: BracketHomeCompetition) {
  return `${item.competition.sportKey}:${item.competition.formatKey}`;
}
