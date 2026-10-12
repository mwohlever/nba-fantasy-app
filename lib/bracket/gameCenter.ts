import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import type { FootballGameDetail } from "@/components/live-scores/FootballGameCenter";
import type { BracketLiveScoreCardGame } from "@/components/bracket/BracketLiveScoreCard";

export type BracketGameCenterMatchup = BracketLiveScoreCardGame;

/** Empty provider identity, scores and kickoff are intentional. Always passed with an external request. */
export function unboundBracketGame(matchup?: BracketGameCenterMatchup): LiveScoreGame {
  const team = (side: "a" | "b") => {
    const actual = matchup?.participants[side].team;
    return { id: actual?.providerTeamId ?? "", displayName: actual?.displayName ?? "TBD", abbreviation: actual?.abbreviation ?? null,
      logo: actual?.logoUrl ?? null, rank: actual?.seed ?? null, record: null, conferenceId: null, score: null, winner: false };
  };
  return { espnEventId: "", name: "CFP tournament game", shortName: null, kickoffAt: matchup?.scheduledAt ?? "",
    awayTeam: team("a"), homeTeam: team("b"), status: matchup?.officialStatus === "final" ? "post" : matchup?.officialStatus === "in_progress" ? "in" : "pre",
    completed: matchup?.officialStatus === "final", winnerTeamId: null, odds: null, statusDetail: null };
}

export function bracketMatchupFacts(matchup: BracketGameCenterMatchup | undefined, game: LiveScoreGame | null, detail?: FootballGameDetail | null) {
  const competition = detail?.header?.competitions?.[0];
  const providerState = competition?.status?.type?.state ?? game?.status;
  const official = matchup?.officialStatus === "final";
  const status = official ? "Final · Official result" : providerState === "post" ? "Final · Awaiting official result"
    : providerState === "in" || matchup?.officialStatus === "in_progress" ? `Live${competition?.status?.type?.shortDetail ? ` · ${competition.status.type.shortDetail}` : game?.statusDetail ? ` · ${game.statusDetail}` : ""}` : "Scheduled";
  const scheduledAt = matchup?.scheduledAt ?? (game?.kickoffAt || null);
  const participants = (["a", "b"] as const).map((side, index) => {
    const actual = matchup?.participants[side];
    const provider = index === 0 ? game?.awayTeam : game?.homeTeam;
    const id = actual?.team?.providerTeamId ?? provider?.id;
    const competitor = competition?.competitors?.find((row) => String(row.team?.id ?? row.id) === id);
    return { name: actual?.team?.displayName ?? (actual?.status === "unresolved" ? "TBD" : provider?.displayName ?? "TBD"),
      sourceLabel: actual?.status === "unresolved" ? actual.sourceLabel : undefined,
      seed: actual?.team?.seed ?? null, logoUrl: actual?.team?.logoUrl ?? provider?.logo ?? null,
      score: game && providerState !== "pre" ? competitor?.score ?? provider?.score ?? null : null };
  });
  return { status, scheduledAt, providerState, participants, official };
}
