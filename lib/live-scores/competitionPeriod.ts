type CalendarEntry = {
  value?: unknown;
  startDate?: unknown;
  endDate?: unknown;
};

type CompetitionCalendar = {
  value?: unknown;
  entries?: CalendarEntry[];
};

type FootballScoreboard = {
  season?: { year?: unknown; type?: unknown };
  week?: { number?: unknown };
  leagues?: { calendar?: CompetitionCalendar[] }[];
};

export type FootballCompetitionPeriod = {
  season: number;
  seasonType: number;
  week: number;
};

export function currentFootballCompetitionPeriod(
  scoreboard: FootballScoreboard,
  seasonType = 2,
  now = Date.now(),
): FootballCompetitionPeriod | null {
  const season = Number(scoreboard.season?.year);
  const entries = scoreboard.leagues?.[0]?.calendar?.find(
    (part) => Number(part.value) === seasonType,
  )?.entries ?? [];
  const providerWeek = Number(scoreboard.week?.number);

  if (
    Number(scoreboard.season?.type) === seasonType &&
    entries.some((entry) => Number(entry.value) === providerWeek)
  ) {
    return { season, seasonType, week: providerWeek };
  }

  const scheduledWeek = entries.find((entry) => {
    const start = Date.parse(String(entry.startDate ?? ""));
    const end = Date.parse(String(entry.endDate ?? ""));

    return Number.isFinite(end) && now <= end &&
      (!Number.isFinite(start) || now >= start);
  });
  const week = Number(scheduledWeek?.value);

  return Number.isInteger(season) && season > 0 &&
    Number.isInteger(week) && week > 0
    ? { season, seasonType, week }
    : null;
}
