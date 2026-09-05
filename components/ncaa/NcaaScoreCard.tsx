type Team = {
  id: string;
  displayName: string;
  abbreviation: string | null;
  logo: string | null;
  rank: number | null;
  record: string | null;
  conferenceId: string | null;
  score: number | null;
  winner: boolean;
};

type Odds = {
  favoriteTeamId: string | null;
  spread: number | null;
  overUnder: number | null;
  provider: string | null;
};

export type NcaaScoreGame = {
  espnEventId: string;
  name: string;
  shortName: string | null;
  kickoffAt: string;
  awayTeam: Team;
  homeTeam: Team;
  status: string;
  statusDetail: string | null;
  completed: boolean;
  winnerTeamId: string | null;
  odds: Odds | null;
};

function TeamRow({
  team,
  showScore,
}: {
  team: Team;
  showScore: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center">
        <img
          src={
            team.logo ||
            `https://a.espncdn.com/i/teamlogos/ncaa/500/${team.id}.png`
          }
          alt=""
          className="max-h-7 max-w-7 object-contain"
          onError={(event) => {
            event.currentTarget.style.display = "none";
          }}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div
          className={`truncate text-sm ${
            team.winner ? "font-black" : "font-bold"
          }`}
        >
          {team.rank !== null ? (
            <span className="mr-1 text-xs text-slate-500">
              {team.rank}
            </span>
          ) : null}
          {team.displayName}
        </div>

        {team.record ? (
          <div className="text-[11px] text-slate-500">
            {team.record}
          </div>
        ) : null}
      </div>

      {showScore ? (
        <div
          className={`w-9 text-right text-lg tabular-nums ${
            team.winner ? "font-black" : "font-bold text-slate-600"
          }`}
        >
          {team.score ?? "—"}
        </div>
      ) : null}
    </div>
  );
}

function bettingLine(game: NcaaScoreGame) {
  const odds = game.odds;

  if (!odds) return null;

  const parts: string[] = [];

  if (
    odds.favoriteTeamId &&
    odds.spread !== null
  ) {
    const favorite =
      game.awayTeam.id === odds.favoriteTeamId
        ? game.awayTeam.abbreviation
        : game.homeTeam.id === odds.favoriteTeamId
          ? game.homeTeam.abbreviation
          : null;

    if (favorite) {
      parts.push(
        `${favorite} ${odds.spread > 0 ? "+" : ""}${odds.spread}`,
      );
    }
  }

  if (odds.overUnder !== null) {
    parts.push(`O/U ${odds.overUnder}`);
  }

  return parts.length > 0
    ? parts.join(" · ")
    : null;
}

export default function NcaaScoreCard({
  game,
  onClick,
}: {
  game: NcaaScoreGame;
  onClick?: () => void;
}) {
  const started = game.status !== "pre";
  const line = bettingLine(game);

  const status =
    game.status === "pre"
      ? new Date(game.kickoffAt).toLocaleTimeString([], {
          hour: "numeric",
          minute: "2-digit",
        })
      : game.status === "post"
        ? "Final"
        : game.statusDetail || "Live";

  return (
    <article
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`rounded-xl bg-white px-3 py-2.5 shadow-sm ${
        game.status === "in"
          ? "border border-sky-400 ring-1 ring-sky-400/20"
          : "border border-slate-200"
      }`}
    >
      <div className="space-y-2">
        <TeamRow
          team={game.awayTeam}
          showScore={started}
        />
        <TeamRow
          team={game.homeTeam}
          showScore={started}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-[11px]">
        <span
          className={
            game.status === "in"
              ? "font-black text-sky-600"
              : "font-semibold text-slate-500"
          }
        >
          {status}
        </span>

        {line ? (
          <span className="truncate text-right font-medium text-slate-500">
            {line}
          </span>
        ) : null}
      </div>
    </article>
  );
}
