import { normalizeBroadcast, normalizeGameStory } from "./metadata";
import { selectFootballOdds } from "./odds";
import { normalizeNbaPlays } from "./nbaPlays";
import { ESPN_NBA_BASE } from "@/lib/providers/nbaLiveScores";

export async function fetchNbaGameDetail(eventId: string) {
  if (!/^\d+$/.test(eventId)) throw new Error("A valid ESPN event ID is required.");
  const response = await fetch(`${ESPN_NBA_BASE}/summary?event=${eventId}`, { cache: "no-store", headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`ESPN NBA game summary failed: ${response.status}.`);
  const summary = await response.json();
  const competition = summary.header?.competitions?.[0];
  const competitors = Array.isArray(competition?.competitors) ? competition.competitors : [];
  const away = competitors.find((team: any) => team.homeAway === "away");
  const home = competitors.find((team: any) => team.homeAway === "home");
  return {
    success: true, eventId, header: summary.header ?? null, boxscore: summary.boxscore ?? null,
    leaders: Array.isArray(summary.leaders) ? summary.leaders : [], plays: normalizeNbaPlays(summary.plays),
    broadcast: normalizeBroadcast(competition), gameStory: normalizeGameStory(summary.article, eventId, competition?.status?.type?.state),
    gameInfo: summary.gameInfo ?? null,
    odds: selectFootballOdds(summary.odds?.length ? summary.odds : competition?.odds, { away: String(away?.team?.id ?? away?.id ?? ""), home: String(home?.team?.id ?? home?.id ?? "") }),
  };
}
