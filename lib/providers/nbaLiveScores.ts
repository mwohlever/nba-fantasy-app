import { normalizeBroadcast } from "@/lib/live-scores/metadata";
import { selectFootballOdds } from "@/lib/live-scores/odds";

export const ESPN_NBA_BASE = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba";

type Raw = Record<string, any>;

export type NbaLiveTeam = {
  id: string;
  displayName: string;
  abbreviation: string | null;
  logo: string | null;
  record: string | null;
  score: number | null;
  winner: boolean;
  linescores: Array<{ period: number; value: number }>;
};

export type NbaLiveGame = {
  espnEventId: string;
  name: string;
  shortName: string | null;
  startAt: string;
  awayTeam: NbaLiveTeam;
  homeTeam: NbaLiveTeam;
  status: "pre" | "in" | "post" | string;
  statusDetail: string | null;
  completed: boolean;
  period: number | null;
  clock: string | null;
  broadcast: { network: string } | null;
  odds: { favoriteTeamId: string | null; spread: number | null; overUnder: number | null; provider: string | null } | null;
};

function numberOrNull(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeTeam(raw: Raw): NbaLiveTeam {
  return {
    id: String(raw.team?.id ?? raw.id),
    displayName: raw.team?.displayName ?? raw.team?.name ?? "Team",
    abbreviation: raw.team?.abbreviation ?? null,
    logo: raw.team?.logo ?? raw.team?.logos?.[0]?.href ?? null,
    record: (raw.records ?? []).find((record: Raw) => record.type === "total")?.summary ?? null,
    score: numberOrNull(raw.score),
    winner: raw.winner === true,
    linescores: (Array.isArray(raw.linescores) ? raw.linescores : [])
      .map((line: Raw) => ({ period: numberOrNull(line.period), value: numberOrNull(line.value) }))
      .filter((line): line is { period: number; value: number } => line.period !== null && line.value !== null),
  };
}

export function nbaStatusDetail(status: Raw | null | undefined) {
  if (!status) return null;
  if (status.state === "post") return status.shortDetail ?? status.detail ?? "Final";
  if (status.state === "pre") return status.shortDetail ?? status.detail ?? null;
  const clock = typeof status.displayClock === "string" && status.displayClock ? status.displayClock : null;
  const period = numberOrNull(status.period);
  const periodLabel = period === null ? null : period <= 4 ? `Q${period}` : `OT${period - 4}`;
  return [periodLabel, clock].filter(Boolean).join(" · ") || status.shortDetail || status.detail || "Live";
}

export function normalizeNbaGame(event: Raw): NbaLiveGame | null {
  const competition = event.competitions?.[0];
  const competitors: Raw[] = competition?.competitors ?? [];
  const away = competitors.find((competitor) => competitor.homeAway === "away");
  const home = competitors.find((competitor) => competitor.homeAway === "home");
  if (!event.id || !event.date || !away?.team?.id || !home?.team?.id) return null;
  const status = competition?.status?.type ?? event.status?.type ?? {};
  return {
    espnEventId: String(event.id),
    name: event.name ?? `${away.team.displayName} at ${home.team.displayName}`,
    shortName: event.shortName ?? null,
    startAt: event.date,
    awayTeam: normalizeTeam(away),
    homeTeam: normalizeTeam(home),
    status: status.state ?? "pre",
    statusDetail: nbaStatusDetail({ ...status, period: competition?.status?.period, displayClock: competition?.status?.displayClock }),
    completed: status.completed === true,
    period: numberOrNull(competition?.status?.period),
    clock: typeof competition?.status?.displayClock === "string" ? competition.status.displayClock : null,
    broadcast: normalizeBroadcast(competition),
    odds: selectFootballOdds(competition?.odds, { away: String(away.team.id), home: String(home.team.id) }),
  };
}

export async function fetchNbaLiveScores(date: string) {
  if (!/^\d{8}$/.test(date)) throw new Error("A valid NBA date is required.");
  const response = await fetch(`${ESPN_NBA_BASE}/scoreboard?dates=${date}&limit=100`, { cache: "no-store" });
  if (!response.ok) throw new Error(`NBA scoreboard unavailable (${response.status}).`);
  const payload = await response.json();
  return (payload.events ?? []).map(normalizeNbaGame).filter((game: NbaLiveGame | null): game is NbaLiveGame => game !== null);
}
