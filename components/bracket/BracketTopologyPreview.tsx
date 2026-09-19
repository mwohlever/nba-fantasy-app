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
  teams?: Team[];
  picks?: Record<
    string,
    string | null | undefined
  >;
  editable?: boolean;
  savingGameKey?: string | null;
  onPick?: (
    gameKey: string,
    teamId: string,
  ) => void;
};

const ROUND_LABELS: Record<
  string,
  string
> = {
  first_round: "First Round",
  quarterfinal: "Quarterfinals",
  semifinal: "Semifinals",
  championship: "Championship",
};

export default function BracketTopologyPreview({
  games,
  teams = [],
  picks = {},
  editable = false,
  savingGameKey = null,
  onPick,
}: Props) {
  const gameById = new Map(
    games.map((game) => [
      game.id,
      game,
    ]),
  );

  const teamById = new Map(
    teams.map((team) => [
      team.providerTeamId,
      team,
    ]),
  );

  function resolvedSource(
    teamId: string | null,
    sourceGameId: number | null,
    seed: number | null,
  ) {
    if (teamId) {
      const team = teamById.get(teamId);

      return {
        teamId,
        seed: seed ?? team?.seed ?? null,
        label:
          team?.displayName ??
          (seed !== null
            ? `Seed ${seed}`
            : teamId),
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
          label:
            "Previous game winner",
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
          label:
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
        label: `Winner of ${sourceGame.gameKey.toUpperCase()}`,
        abbreviation: null,
        logoUrl: null,
      };
    }

    return {
      teamId: null,
      seed: null,
      label: "TBD",
      abbreviation: null,
      logoUrl: null,
    };
  }

  const rounds = [
    ...new Set(
      games.map(
        (game) =>
          game.roundOrder,
      ),
    ),
  ]
    .sort((a, b) => a - b)
    .map((roundOrder) => ({
      roundOrder,
      games: games
        .filter(
          (game) =>
            game.roundOrder ===
            roundOrder,
        )
        .sort(
          (a, b) =>
            a.gameOrder -
            b.gameOrder,
        ),
    }));

  function renderTeam(
    game: Game,
    source: ReturnType<
      typeof resolvedSource
    >,
  ) {
    const selected =
      source.teamId !== null &&
      picks[game.gameKey] ===
        source.teamId;

    const canPick =
      editable &&
      source.teamId !== null &&
      Boolean(onPick);

    const content = (
      <>
        {source.seed !== null ? (
          <span className="w-5 shrink-0 text-right text-xs font-black text-slate-500">
            {source.seed}
          </span>
        ) : null}

        {source.logoUrl ? (
          <img
            src={source.logoUrl}
            alt=""
            className="h-6 w-6 shrink-0 object-contain"
          />
        ) : null}

        <span
          className={`min-w-0 flex-1 truncate text-sm font-bold ${
            selected
              ? "text-blue-100"
              : source.teamId
                ? "text-slate-100"
                : "text-slate-500"
          }`}
          title={source.label}
        >
          {source.abbreviation ?? source.label}
        </span>

        {selected ? (
          <span
            className="shrink-0 text-sm font-black text-blue-300"
            aria-label="Selected"
          >
            ✓
          </span>
        ) : null}
      </>
    );

    if (!canPick) {
      return (
        <div className="flex min-h-11 items-center gap-2 px-3 py-2">
          {content}
        </div>
      );
    }

    return (
      <button
        type="button"
        disabled={
          savingGameKey !== null
        }
        onClick={() =>
          onPick?.(
            game.gameKey,
            source.teamId!,
          )
        }
        className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left transition disabled:cursor-wait disabled:opacity-60 ${
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
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[900px] grid-cols-4 gap-4">
        {rounds.map((round) => {
          const first =
            round.games[0];

          return (
            <section
              key={round.roundOrder}
              className="min-w-0"
            >
              <div className="mb-3 text-center text-xs font-black uppercase tracking-[0.16em] text-blue-300">
                {ROUND_LABELS[
                  first?.roundKey
                ] ??
                  first?.roundKey ??
                  `Round ${round.roundOrder}`}
              </div>

              <div className="flex h-full flex-col justify-around gap-4">
                {round.games.map(
                  (game) => {
                    const sourceA =
                      resolvedSource(
                        game.sourceATeamId,
                        game.sourceAGameId,
                        game.sourceASeed,
                      );

                    const sourceB =
                      resolvedSource(
                        game.sourceBTeamId,
                        game.sourceBGameId,
                        game.sourceBSeed,
                      );

                    return (
                      <article
                        key={game.id}
                        className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900/90 shadow-sm"
                      >
                        <div className="flex items-center justify-between border-b border-slate-700/80 px-3 py-2 text-[10px] font-black uppercase tracking-[0.15em] text-slate-500">
                          <span>
                            {game.gameKey}
                          </span>

                          {savingGameKey ===
                          game.gameKey ? (
                            <span className="text-blue-300">
                              Saving…
                            </span>
                          ) : null}
                        </div>

                        <div className="divide-y divide-slate-700/80">
                          {renderTeam(
                            game,
                            sourceA,
                          )}

                          {renderTeam(
                            game,
                            sourceB,
                          )}
                        </div>
                      </article>
                    );
                  },
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
