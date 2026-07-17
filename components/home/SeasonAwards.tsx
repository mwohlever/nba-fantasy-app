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
    <section className="season-awards-grid grid gap-6 lg:grid-cols-[1fr_1fr]">
      <section className="season-awards-panel season-awards-panel--gold rounded-3xl border p-5 shadow-sm">
        <div className="mb-4">
          <h2 className="season-awards-title text-2xl font-bold">
            {season ?? 'Season'} Season Awards
          </h2>
          <p className="season-awards-description mt-1 text-sm">
            End-of-season hardware for the league.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {awards.map((award) => (
            <div
              key={award.title}
              className="season-award-card rounded-2xl border px-4 py-3"
            >
              <div className="text-2xl">{award.emoji}</div>
              <div className="season-award-label mt-2 text-sm font-semibold uppercase tracking-wide">
                {award.title}
              </div>
              <div className="season-award-winner mt-1 text-xl font-bold">
                {award.winner}
              </div>
              <div className="season-award-detail mt-1 text-sm">
                {award.detail}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="season-awards-panel season-awards-panel--blue rounded-3xl border p-5 shadow-sm">
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
              className="first-team-card flex items-center justify-between gap-3 rounded-2xl border px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <div className="first-team-rank w-6 text-sm font-bold">
                  {index + 1}
                </div>
                <PlayerHeadshot
                  nbaPlayerId={player.nbaPlayerId}
                  playerName={player.name}
                  size="sm"
                />
                <div>
                  <div className="first-team-name font-semibold">
                    {player.name}
                  </div>
                  <div className="first-team-meta text-xs">
                    {player.positionGroup}
                  </div>
                </div>
              </div>

              <div className="text-right">
                <div className="first-team-score text-lg font-bold">
                  {player.avgFantasy.toFixed(1)}
                </div>
                <div className="first-team-meta text-xs">Avg FP</div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </section>
  );
}
