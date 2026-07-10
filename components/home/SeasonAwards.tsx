import PlayerHeadshot from "@/components/ui/PlayerHeadshot";

type Award = {
  title: string;
  emoji: string;
  winner: string;
  detail: string;
};

type FirstTeamPlayer = {
  playerId: number;
  name: string;
  positionGroup: "G" | "F/C" | null;
  nbaPlayerId: number | null;
  games: number;
  avgFantasy: number;
};

type SeasonAwardsProps = {
  season?: number | string;
  awards: Award[];
  guards: FirstTeamPlayer[];
  frontcourt: FirstTeamPlayer[];
};

export default function SeasonAwards({ season,
  awards,
  guards,
  frontcourt,
}: SeasonAwardsProps) {
  const firstTeam = [...guards, ...frontcourt];

  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-slate-900">
            {season ?? 'Season'} Season Awards
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            End-of-season hardware for the league.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {awards.map((award) => (
            <div
              key={award.title}
              className="rounded-2xl border border-amber-200 bg-white px-4 py-3"
            >
              <div className="text-2xl">{award.emoji}</div>
              <div className="mt-2 text-sm font-semibold uppercase tracking-wide text-amber-700">
                {award.title}
              </div>
              <div className="mt-1 text-xl font-bold text-slate-900">
                {award.winner}
              </div>
              <div className="mt-1 text-sm text-slate-600">
                {award.detail}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-3xl border border-sky-200 bg-sky-50/70 p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="text-2xl font-bold text-slate-900">
            All-111 First Team
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Top 2 guards and top 3 F/C by average fantasy points, minimum 5 games.
          </p>
        </div>

        <div className="space-y-3">
          {firstTeam.map((player, index) => (
            <div
              key={player.playerId}
              className="flex items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-white px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="w-6 text-sm font-bold text-slate-400">
                  {index + 1}
                </div>
                <PlayerHeadshot
                  nbaPlayerId={player.nbaPlayerId}
                  playerName={player.name}
                  size="sm"
                />
                <div>
                  <div className="font-semibold text-slate-900">
                    {player.name}
                  </div>
                  <div className="text-xs text-slate-500">
                    {player.positionGroup}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="text-lg font-bold text-slate-900">
                  {player.avgFantasy.toFixed(1)}
                </div>
                <div className="text-xs text-slate-500">Avg FP</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
