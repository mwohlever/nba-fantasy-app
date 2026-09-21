import LiveScoreCard, {
  type LiveScoreGame,
} from "@/components/live-scores/LiveScoreCard";

export type BracketLiveParticipant = {
  status: "resolved" | "unresolved";
  team?: {
    seed: number;
    providerTeamId: string;
    displayName: string;
    abbreviation: string | null;
    logoUrl: string | null;
  };
  sourceLabel?: string;
};

export type BracketLiveScoreCardGame = {
  gameKey: string;
  gameOrder: number;
  scheduledAt: string | null;
  officialStatus: string;
  participants: {
    a: BracketLiveParticipant;
    b: BracketLiveParticipant;
  };
  provider: {
    mappingState: string;
    game?: LiveScoreGame;
  };
};

function scheduledLabel(scheduledAt: string | null, officialStatus: string) {
  if (scheduledAt) {
    return new Date(scheduledAt).toLocaleString([], {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  if (officialStatus === "final") return "Final";
  if (officialStatus === "in_progress") return "In progress";
  return "Time TBD";
}

function ParticipantRow({ participant }: { participant: BracketLiveParticipant }) {
  if (participant.status === "unresolved") {
    return <div className="min-w-0 py-1.5 text-sm font-semibold leading-5 text-slate-400">{participant.sourceLabel ?? "Tournament participant TBD"}</div>;
  }

  const team = participant.team;
  if (!team) return null;

  return (
    <div className="flex min-w-0 items-center gap-2 py-1.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center">
        {team.logoUrl ? <img src={team.logoUrl} alt="" className="max-h-7 max-w-7 object-contain" onError={(event) => { event.currentTarget.style.display = "none"; }} /> : null}
      </div>
      <div className="min-w-0 text-sm font-bold text-slate-100"><span className="mr-1 text-xs font-black text-blue-300">#{team.seed}</span><span className="break-words">{team.displayName}</span></div>
    </div>
  );
}

/** Official graph fallback; fully validated ESPN games stay on the shared card. */
export default function BracketLiveScoreCard({
  game,
  onOpenGameCenter,
}: {
  game: BracketLiveScoreCardGame;
  onOpenGameCenter?: (game: LiveScoreGame) => void;
}) {
  if (game.provider.mappingState === "valid" && game.provider.game) {
    const seeds = [game.participants.a, game.participants.b].flatMap((participant) => participant.team ? [`#${participant.team.seed} ${participant.team.abbreviation ?? participant.team.displayName}`] : []);

    return (
      <div className="space-y-1.5">
        {seeds.length ? <p className="px-1 text-[10px] font-black uppercase tracking-[0.12em] text-blue-200">CFP seeds · {seeds.join(" vs ")}</p> : null}
        <LiveScoreCard
          game={game.provider.game}
          onClick={
            onOpenGameCenter
              ? () => onOpenGameCenter(game.provider.game!)
              : undefined
          }
        />
      </div>
    );
  }

  return (
    <article className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2.5 shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 pb-2 text-[11px]"><span className="font-black uppercase tracking-wide text-blue-200">Game {game.gameOrder}</span><span className="text-right font-semibold text-slate-400">{scheduledLabel(game.scheduledAt, game.officialStatus)}</span></div>
      <div className="divide-y divide-slate-800"><ParticipantRow participant={game.participants.a} /><ParticipantRow participant={game.participants.b} /></div>
    </article>
  );
}
