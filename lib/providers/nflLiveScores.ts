import { possessionTeamId } from "@/lib/live-scores/possession";
import { normalizeBroadcast } from "@/lib/live-scores/metadata";
import { ESPN_BASE_URL } from "./nfl";
import { selectFootballOdds } from "@/lib/live-scores/odds";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";

type Raw = Record<string, any>;
export type NflCalendar = Array<{ value: string; label: string; entries: Array<{ value: string; label: string }> }>;

export function normalizeNflGame(event: Raw): LiveScoreGame | null {
  const competition = event.competitions?.[0];
  const competitors: Raw[] = competition?.competitors ?? [];
  const away = competitors.find((team) => team.homeAway === "away");
  const home = competitors.find((team) => team.homeAway === "home");
  if (!event.id || !event.date || !away?.team?.id || !home?.team?.id) return null;
  const status = competition.status?.type ?? event.status?.type ?? {};
  const interrupted = /CANCELED|CANCELLED/.test(status.name ?? "") ? "canceled"
    : /POSTPONED/.test(status.name ?? "") ? "postponed"
    : /SUSPENDED/.test(status.name ?? "") ? "suspended" : null;
  const team = (raw: Raw): LiveScoreGame["awayTeam"] => ({
    id: String(raw.team.id),
    displayName: raw.team.displayName || raw.team.name,
    abbreviation: raw.team.abbreviation ?? null,
    logo: raw.team.logo ?? raw.team.logos?.[0]?.href ?? null,
    rank: null,
    conferenceId: null,
    record: (raw.records ?? []).find((record: Raw) => record.type === "total")?.summary ?? null,
    score: raw.score != null && Number.isFinite(Number(raw.score)) ? Number(raw.score) : null,
    winner: raw.winner === true,
  });
  return {
    espnEventId: String(event.id), name: event.name || `${away.team.displayName} at ${home.team.displayName}`,
    shortName: event.shortName ?? null, kickoffAt: event.date,
    awayTeam: team(away), homeTeam: team(home),
    status: interrupted ?? status.state ?? "pre", statusDetail: status.detail ?? status.shortDetail ?? null,
    completed: !interrupted && status.completed === true,
    winnerTeamId: away.winner ? String(away.team.id) : home.winner ? String(home.team.id) : null,
    broadcast: normalizeBroadcast(competition),
    possessionTeamId: possessionTeamId(competition),
    odds: selectFootballOdds(competition.odds, { away: String(away.team.id), home: String(home.team.id) }),
  };
}

export async function fetchNflLiveScores(context?: { season: number; seasonType: number; week: number }) {
  const params = new URLSearchParams({ limit: "100" });
  if (context) {
    params.set("dates", String(context.season));
    params.set("seasontype", String(context.seasonType));
    params.set("week", String(context.week));
  }
  const response = await fetch(`${ESPN_BASE_URL}/scoreboard?${params}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`NFL scoreboard unavailable (${response.status}).`);
  const payload = await response.json();
  const calendar: NflCalendar = (payload.leagues?.[0]?.calendar ?? [])
    .filter((part: Raw) => ["1", "2", "3"].includes(String(part.value)) && Array.isArray(part.entries))
    .map((part: Raw) => ({ value: String(part.value), label: String(part.label), entries: part.entries.map((week: Raw) => ({ value: String(week.value), label: String(week.label) })) }));
  const providerType = Number(payload.season?.type);
  const defaultPart = calendar.find((part) => Number(part.value) === providerType) ?? calendar.at(-1);
  const defaultType = Number(defaultPart?.value ?? 2);
  const defaultWeek = defaultType === providerType ? Number(payload.week?.number ?? 1) : Number(defaultPart?.entries.at(-1)?.value ?? 1);
  return {
    season: context?.season ?? Number(payload.season?.year),
    seasonType: context?.seasonType ?? defaultType,
    week: context?.week ?? defaultWeek,
    calendar,
    games: (payload.events ?? []).map(normalizeNflGame).filter((game: LiveScoreGame | null): game is LiveScoreGame => game !== null),
  };
}
