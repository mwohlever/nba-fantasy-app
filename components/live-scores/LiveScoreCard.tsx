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

export type LiveScoreGame = {
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
  possessionTeamId?: string | null;
  broadcast?: import("@/lib/live-scores/metadata").Broadcast | null;
};

function TeamRow({
  team,
  showScore,
  favorite,
  onToggleFavorite,
  possession,
}: {
  possession?: boolean;
  team: Team;
  showScore: boolean;
  favorite: boolean;
  onToggleFavorite?: (teamId: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center">
        <img
          src={
            team.logo || undefined
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
          {possession ? <span role="img" aria-label="Possession" className="mr-1 text-[11px]">🏈</span> : null}
          {team.displayName}
        </div>

        {team.record ? (
          <div className="text-[11px] text-slate-500">
            {team.record}
          </div>
        ) : null}
      </div>

      {onToggleFavorite ? (
        <button
          type="button"
          aria-label={
            favorite
              ? `Remove ${team.displayName} from favorites`
              : `Add ${team.displayName} to favorites`
          }
          aria-pressed={favorite}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-lg leading-none ${
            favorite
              ? "text-amber-500"
              : "text-slate-300 hover:text-amber-400"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFavorite(team.id);
          }}
        >
          {favorite ? "★" : "☆"}
        </button>
      ) : null}

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

export function bettingLine(game: LiveScoreGame) {
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

export default function LiveScoreCard({
  game,
  onClick,
  favoriteTeamIds,
  onToggleFavorite,
}: {
  game: LiveScoreGame;
  onClick?: () => void;
  favoriteTeamIds?: Set<string>;
  onToggleFavorite?: (teamId: string) => void;
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
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
          event.preventDefault();
          onClick?.();
        }
      }}
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
          possession={game.status === "in" && game.possessionTeamId === game.awayTeam.id}
          showScore={started}
          favorite={favoriteTeamIds?.has(game.awayTeam.id) ?? false}
          onToggleFavorite={onToggleFavorite}
        />
        <TeamRow
          team={game.homeTeam}
          possession={game.status === "in" && game.possessionTeamId === game.homeTeam.id}
          showScore={started}
          favorite={favoriteTeamIds?.has(game.homeTeam.id) ?? false}
          onToggleFavorite={onToggleFavorite}
        />
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 border-t border-slate-100 pt-2 text-[11px]">
        <span
          className={
            game.status === "in"
              ? "min-w-0 truncate font-black text-sky-600"
              : "min-w-0 truncate font-semibold text-slate-500"
          }
        >
          {status}{game.broadcast?.network ? ` · ${game.broadcast.network}` : ""}
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
