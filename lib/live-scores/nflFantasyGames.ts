import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";

type Window = { date: string; start_date?: string | null; end_date?: string | null };

export function nflSlateWindow(slate: Window) {
  const start = slate.start_date ?? slate.date;
  const end = slate.end_date ?? slate.date;
  const valid = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  return valid(start) && valid(end) && start <= end ? { start, end } : null;
}

export function nflGameActionLabel(status: string) {
  switch (status) {
    case "pre": return "View Game";
    case "in": return "View Live Game";
    case "post": return "View Final";
    default: return null;
  }
}

// NFL sync and scoring use ESPN abbreviations, uppercased, with no alias map.
export function nflTeamCode(code?: string | null) {
  return (code ?? "").toUpperCase();
}

export function resolveNflFantasyGames(games: LiveScoreGame[], slate: Window) {
  const window = nflSlateWindow(slate);
  const candidates = new Map<string, Map<string, LiveScoreGame>>();
  if (!window) return new Map<string, LiveScoreGame>();
  for (const game of games) {
    if (!game.espnEventId || !Number.isFinite(Date.parse(game.kickoffAt))) continue;
    // NFL slate dates are US calendar days, including Monday night after UTC midnight.
    const day = new Date(game.kickoffAt).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    if (day < window.start || day > window.end) continue;
    for (const team of [game.awayTeam, game.homeTeam]) {
      const code = nflTeamCode(team.abbreviation);
      if (!code) continue;
      const events = candidates.get(code) ?? new Map<string, LiveScoreGame>();
      events.set(game.espnEventId, game);
      candidates.set(code, events);
    }
  }
  const resolved = new Map<string, LiveScoreGame>();
  for (const [code, events] of candidates) {
    if (events.size !== 1) continue;
    const game = [...events.values()][0];
    // Keep interrupted games mapped so stale player stats cannot imply a final.
    if (nflGameActionLabel(game.status) || ["postponed", "canceled", "suspended"].includes(game.status)) resolved.set(code, game);
  }
  return resolved;
}
