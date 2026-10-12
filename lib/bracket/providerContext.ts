import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import type { FootballGameDetail } from "@/components/live-scores/FootballGameCenter";

/** Use refreshed, ID-matched scores. Unavailable/invalid scores cannot supply a story about a lead. */
export function refreshedBracketProvider(game: LiveScoreGame, detail: FootballGameDetail | null): LiveScoreGame {
  const competition = detail?.header?.competitions?.[0];
  const updated = (team: LiveScoreGame["awayTeam"]) => {
    const competitor = competition?.competitors?.find((row) => String(row.team?.id ?? row.id) === team.id);
    const raw: unknown = competitor?.score;
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : null;
    const score = raw === undefined ? team.score : parsed !== null && Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    return { ...team, score: typeof score === "number" ? score : null };
  };
  return { ...game, status: competition?.status?.type?.state ?? detail?.game?.status ?? game.status,
    awayTeam: updated(game.awayTeam), homeTeam: updated(game.homeTeam) };
}
