import type { BracketGameCenterMatchup } from "@/lib/bracket/gameCenter";
import { bracketMatchupFacts } from "@/lib/bracket/gameCenter";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import type { FootballGameDetail } from "@/components/live-scores/FootballGameCenter";

export default function BracketMatchupHeader({ matchup, game, detail }: {
  matchup?: BracketGameCenterMatchup; game: LiveScoreGame | null; detail?: FootballGameDetail | null;
}) {
  const facts = bracketMatchupFacts(matchup, game, detail);
  const time = facts.scheduledAt && Number.isFinite(Date.parse(facts.scheduledAt))
    ? new Date(facts.scheduledAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "Time TBD";
  const team = (index: number) => {
    const participant = facts.participants[index];
    return <div className="min-w-0 text-center">
      {participant.logoUrl ? <img src={participant.logoUrl} alt="" className="mx-auto h-10 w-10 object-contain" /> : null}
      <p className="mt-1 break-words text-xs font-black text-slate-900">{participant.seed ? `#${participant.seed} ` : ""}{participant.name}</p>
      {participant.sourceLabel ? <p className="mt-1 text-[10px] text-slate-500">{participant.sourceLabel}</p> : null}
    </div>;
  };
  return <div className="border-b border-slate-200 px-4 py-3" aria-label="CFP matchup">
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">{team(0)}
      <div className="max-w-36 text-center"><p className="text-[10px] font-bold uppercase text-slate-500">{facts.status}</p>
        {facts.participants.some((row) => row.score !== null) ? <p className="mt-1 whitespace-nowrap text-3xl font-black text-slate-900">{facts.participants[0].score ?? "—"} <span className="text-slate-300">-</span> {facts.participants[1].score ?? "—"}</p>
          : <p className="mt-1 text-sm font-black text-slate-900">vs</p>}
        <p className="mt-1 text-[10px] text-slate-500">{time}</p>
      </div>{team(1)}</div>
  </div>;
}
