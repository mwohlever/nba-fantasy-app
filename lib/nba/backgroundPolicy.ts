import type { NbaGame } from "./types";

export function easternDate(now: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
// Preserve the existing refresh route's server-local end-day gate; pass its explicit instant to SQL.
export function nbaSlateEndAt(endDate: string) { return new Date(`${endDate}T23:59:59`).toISOString(); }
export function nbaSlateEndPassed(endDate: string, now: Date) { return now.getTime() > Date.parse(nbaSlateEndAt(endDate)); }

/** Known game list is authoritative; no tip time means cautious hourly discovery, never guessed finality. */
export function fantasyPollPolicy(games: readonly NbaGame[], endDate: string, now: Date) {
  if (!games.length) return { process: false, reason: "no_games", delaySeconds: 3600 };
  if (games.some(game => game.status === 2)) return { process: true, reason: "live", delaySeconds: 240 };
  if (games.every(game => game.status === 3)) return {
    process: true, reason: "final", delaySeconds: nbaSlateEndPassed(endDate, now) ? 240 : 900,
  };
  const tips = games.filter(game => game.status !== 3).map(game => game.startAt ? Date.parse(game.startAt) : NaN);
  if (tips.some(tip => Number.isFinite(tip) && tip <= now.getTime() + 30 * 60_000)) {
    return { process: true, reason: "tip_window", delaySeconds: 240 };
  }
  if (games.some(game => game.status !== 3 && game.date <= easternDate(now) && !game.startAt)) {
    return { process: true, reason: "unknown_tip", delaySeconds: 900 };
  }
  const nextTip = Math.min(...tips.filter(Number.isFinite));
  const delaySeconds = Number.isFinite(nextTip)
    ? Math.max(240, Math.min(3600, Math.floor((nextTip - now.getTime()) / 1000) - 1800)) : 3600;
  // A past final game still needs ingestion/correction while later slate games await tip.
  return { process: games.some(game => game.status === 3), reason: games.some(game => game.status === 3) ? "between_games" : "scheduled", delaySeconds };
}

/** Standings are season totals, not live box scores. Avoid creating a schedule-provider dependency. */
export function skinsPollDelay(season: number, now: Date, complete = false) {
  if (complete) return 86400; // Preserve explicit season finalization; permit daily pre-final corrections.
  const date = easternDate(now);
  if (date < `${season}-10-01` || date > `${season + 1}-06-30`) return 21600;
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }).format(now));
  // Include afternoon/holiday games and the overnight standings publication window.
  return hour >= 12 || hour < 4 ? 240 : 3600;
}

export function projectionIsDue(summary: Record<string, unknown>, now: Date) {
  const checked = typeof summary.projectionCheckedAt === "string" ? Date.parse(summary.projectionCheckedAt) : NaN;
  return !Number.isFinite(checked) || now.getTime() - checked >= (summary.projectionError ? 6 : 24) * 3600_000;
}
