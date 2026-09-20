"use client";

type Game = {
  id: number;
  gameKey: string;
  roundKey: string;
  roundOrder: number;
  gameOrder: number;
  sourceATeamId: string | null;
  sourceAGameId: number | null;
  sourceASeed: number | null;
  sourceBTeamId: string | null;
  sourceBGameId: number | null;
  sourceBSeed: number | null;
};

type Team = {
  seed: number;
  providerTeamId: string;
  displayName: string;
  abbreviation: string | null;
  logoUrl: string | null;
};

type Props = {
  games: Game[];
  teams: Team[];
  picks: Record<
    string,
    string | null | undefined
  >;
  editable: boolean;
  editableGameKeys?: Set<string>;
  savingGameKey: string | null;
  onPick: (
    gameKey: string,
    teamId: string,
  ) => void;
};

const ROUND_LABELS: Record<string, string> = {
  first_round: "First Round",
  quarterfinal: "Quarterfinals",
  semifinal: "Semifinals",
  championship: "Championship",
};

export default function BracketMakePicks({
  games,
  teams,
  picks,
  editable,
  editableGameKeys,
  savingGameKey,
  onPick,
}: Props) {
  const rounds = [
    ...new Map(
      games
        .slice()
        .sort(
          (a, b) =>
            a.roundOrder - b.roundOrder,
        )
        .map((game) => [
          game.roundOrder,
          {
            roundOrder: game.roundOrder,
            roundKey: game.roundKey,
          },
        ]),
    ).values(),
  ];

  const firstIncompleteRound =
    rounds.find((round) =>
      games.some(
        (game) =>
          game.roundOrder ===
            round.roundOrder &&
          !picks[game.gameKey],
      ),
    ) ?? rounds[rounds.length - 1];

  const initialRound =
    firstIncompleteRound?.roundOrder ?? 1;

  const React =
    require("react") as typeof import("react");

  const [activeRound, setActiveRound] =
    React.useState(initialRound);

  const gameById = new Map(
    games.map((game) => [game.id, game]),
  );

  const teamById = new Map(
    teams.map((team) => [
      team.providerTeamId,
      team,
    ]),
  );

  function resolveSource(
    teamId: string | null,
    sourceGameId: number | null,
    seed: number | null,
  ) {
    if (teamId) {
      const team = teamById.get(teamId);

      return {
        teamId,
        seed: seed ?? team?.seed ?? null,
        name:
          team?.displayName ?? teamId,
        abbreviation:
          team?.abbreviation ?? null,
        logoUrl: team?.logoUrl ?? null,
      };
    }

    if (sourceGameId !== null) {
      const sourceGame =
        gameById.get(sourceGameId);

      if (!sourceGame) {
        return {
          teamId: null,
          seed: null,
          name: "Previous game winner",
          abbreviation: null,
          logoUrl: null,
        };
      }

      const pickedTeamId =
        picks[sourceGame.gameKey];

      if (pickedTeamId) {
        const team =
          teamById.get(pickedTeamId);

        return {
          teamId: pickedTeamId,
          seed: team?.seed ?? null,
          name:
            team?.displayName ??
            pickedTeamId,
          abbreviation:
            team?.abbreviation ?? null,
          logoUrl:
            team?.logoUrl ?? null,
        };
      }

      return {
        teamId: null,
        seed: null,
        name: `Winner of ${sourceGame.gameKey.toUpperCase()}`,
        abbreviation: null,
        logoUrl: null,
      };
    }

    return {
      teamId: null,
      seed: null,
      name: "TBD",
      abbreviation: null,
      logoUrl: null,
    };
  }

  const activeGames = games
    .filter(
      (game) =>
        game.roundOrder === activeRound,
    )
    .sort(
      (a, b) =>
        a.gameOrder - b.gameOrder,
    );

  function TeamChoice({
    game,
    source,
  }: {
    game: Game;
    source: ReturnType<
      typeof resolveSource
    >;
  }) {
    const selected =
      source.teamId !== null &&
      picks[game.gameKey] ===
        source.teamId;

    const canPick =
      editable &&
      (editableGameKeys?.has(game.gameKey) ?? true) &&
      source.teamId !== null;

    const content = (
      <>
        <span className="w-6 shrink-0 text-right text-xs font-black text-slate-500">
          {source.seed ?? ""}
        </span>

        {source.logoUrl ? (
          <img
            src={source.logoUrl}
            alt=""
            className="h-8 w-8 shrink-0 object-contain"
          />
        ) : (
          <span className="h-8 w-8 shrink-0" />
        )}

        <span
          className={`min-w-0 flex-1 text-left text-sm font-bold ${
            source.teamId
              ? "text-slate-100"
              : "text-slate-500"
          }`}
        >
          {source.name}
        </span>

        {selected ? (
          <span className="shrink-0 text-lg font-black text-blue-300">
            ✓
          </span>
        ) : null}
      </>
    );

    if (!canPick) {
      return (
        <div className="flex min-h-14 items-center gap-3 px-3 py-2">
          {content}
        </div>
      );
    }

    return (
      <button
        type="button"
        disabled={
          savingGameKey === game.gameKey
        }
        onClick={() =>
          onPick(
            game.gameKey,
            source.teamId!,
          )
        }
        className={`flex min-h-14 w-full items-center gap-3 px-3 py-2 transition disabled:cursor-wait disabled:opacity-60 ${
          selected
            ? "bg-blue-500/15"
            : "hover:bg-slate-800"
        }`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <div className="flex min-w-max gap-2">
          {rounds.map((round) => {
            const roundGames =
              games.filter(
                (game) =>
                  game.roundOrder ===
                  round.roundOrder,
              );

            const made =
              roundGames.filter(
                (game) =>
                  Boolean(
                    picks[game.gameKey],
                  ),
              ).length;

            const active =
              activeRound ===
              round.roundOrder;

            return (
              <button
                key={round.roundOrder}
                type="button"
                onClick={() =>
                  setActiveRound(
                    round.roundOrder,
                  )
                }
                className={`rounded-full border px-3 py-2 text-xs font-black transition ${
                  active
                    ? "border-blue-400 bg-blue-500/20 text-blue-100"
                    : "border-slate-700 bg-slate-900 text-slate-400 hover:border-slate-600 hover:text-slate-200"
                }`}
              >
                {ROUND_LABELS[
                  round.roundKey
                ] ?? round.roundKey}
                <span className="ml-1 text-[10px] opacity-70">
                  {made}/{roundGames.length}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        {activeGames.map((game) => {
          const sourceA =
            resolveSource(
              game.sourceATeamId,
              game.sourceAGameId,
              game.sourceASeed,
            );

          const sourceB =
            resolveSource(
              game.sourceBTeamId,
              game.sourceBGameId,
              game.sourceBSeed,
            );

          return (
            <article
              key={game.id}
              className="overflow-hidden rounded-2xl border border-slate-700 bg-slate-900/90"
            >
              <div className="flex items-center justify-between border-b border-slate-700/80 px-3 py-2">
                <span className="text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
                  {game.gameKey}
                </span>

                {savingGameKey ===
                game.gameKey ? (
                  <span className="text-[10px] font-black uppercase tracking-wide text-blue-300">
                    Saving…
                  </span>
                ) : picks[
                    game.gameKey
                  ] ? (
                  <span className="text-[10px] font-black uppercase tracking-wide text-emerald-300">
                    Picked
                  </span>
                ) : null}
              </div>

              <div className="divide-y divide-slate-700/80">
                <TeamChoice
                  game={game}
                  source={sourceA}
                />
                <TeamChoice
                  game={game}
                  source={sourceB}
                />
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
