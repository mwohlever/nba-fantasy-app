import type { CenterProfile } from "./presentation";
import type { CenterGame } from "./types";

export type TrendPeriod = "last5" | "last10" | "season";
export type TrendPoint = { game: CenterGame; points: number | null };

/** Keep incomplete completed appearances in their chronological slots. Never slide past a gap. */
export function fantasyTrendGames(profile: CenterProfile): TrendPoint[] {
  if (profile.player.identity !== "resolved" || !profile.fantasyScoringAvailable) return [];
  return profile.games.filter(game => game.season === profile.season && game.phase === profile.phase &&
    game.providerPlayerId === profile.player.providerPlayerId && game.status === "final" &&
    game.participation === "played" && Date.parse(game.gameAt) <= Date.parse(profile.asOf))
    .sort((a, b) => Date.parse(a.gameAt) - Date.parse(b.gameAt) || a.eventId.localeCompare(b.eventId))
    .map(game => {
      const points = profile.gameFantasyPoints[game.eventId];
      return { game, points: typeof points === "number" && Number.isFinite(points) ? points : null };
    });
}

export function defaultTrendPeriod(points: TrendPoint[]): TrendPeriod {
  return points.filter(point => point.points !== null).length >= 10 ? "last10" : "season";
}

export function fantasyTrend(profile: CenterProfile, period: TrendPeriod) {
  const all = fantasyTrendGames(profile);
  const points = period === "season" ? all : all.slice(period === "last5" ? -5 : -10);
  const verified = points.flatMap(point => point.points === null ? [] : [point.points]);
  const average = verified.length ? verified.reduce((sum, value) => sum + value, 0) / verified.length : null;
  // This observed average is research only. It never opens comparison/ranking gates.
  const complete = profile.windows.season.metricComparable.fantasy_points === true &&
    verified.length === points.length && points.length > 0 &&
    (period === "season" || points.length === (period === "last5" ? 5 : 10));
  return { points, verified: verified.length, average, complete,
    high: verified.length ? Math.max(...verified) : null, low: verified.length ? Math.min(...verified) : null };
}

/** Percent coordinates keep SVG strokes and HTML focus/touch targets independent of viewport size. */
export function trendGeometry(points: TrendPoint[]) {
  const values = points.flatMap(point => point.points === null ? [] : [point.points]);
  const bottom = Math.min(0, ...values), top = Math.max(1, ...values);
  const padding = (top - bottom) * .12;
  const min = bottom < 0 ? bottom - padding : 0, max = top + padding;
  const y = (value: number) => 92 - (value - min) / (max - min) * 84;
  const coordinates = points.map((point, index) => ({ x: points.length === 1 ? 50 : 5 + index / (points.length - 1) * 90,
    y: point.points === null ? null : y(point.points) }));
  let connected = false;
  const path = coordinates.map(point => {
    if (point.y === null) { connected = false; return ""; }
    const command = connected ? "L" : "M";
    connected = true;
    return `${command}${point.x},${point.y}`;
  }).join(" ");
  return { coordinates, path, y, ticks: [max, (max + min) / 2, min] };
}
