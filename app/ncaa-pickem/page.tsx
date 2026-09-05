"use client";

import AppNav from "@/components/AppNav";

import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  useSelectedSport,
} from "@/components/providers/SportProvider";

type PickEmWeek = {
  id: number;
  season: number;
  week_number: number;
  label: string;
  lock_at: string | null;
  status:
    | "open"
    | "locked"
    | "final";
  analysis: string | null;
  show_analysis: boolean;
};

type PickEmGame = {
  id: number;
  espn_event_id: string;
  kickoff_at: string;

  away_team_id: string;
  away_team_name: string;
  away_team_abbreviation:
    string | null;
  away_team_logo_url:
    string | null;
  away_rank: number | null;
  away_record: string | null;
  away_score: number | null;
  away_stats:
    Record<string, unknown>;

  home_team_id: string;
  home_team_name: string;
  home_team_abbreviation:
    string | null;
  home_team_logo_url:
    string | null;
  home_rank: number | null;
  home_record: string | null;
  home_score: number | null;
  home_stats:
    Record<string, unknown>;

  status: string;
  status_detail: string | null;
  winner_team_id:
    string | null;

  spread_favorite_team_id:
    string | null;
  spread: number | null;
  over_under: number | null;
  odds_provider: string | null;
  odds_updated_at: string | null;
};

type Participant = {
  teamId: number;
  name: string;
  avatarUrl: string | null;
};

type GroupPick = {
  game_id: number;
  team_id: number;
  picked_team_id: string;
  is_correct:
    boolean | null;
};

type WeekResponse = {
  success: boolean;

  viewer?: {
    teamId: number;
    displayName: string;
    avatarUrl: string | null;
  };

  participants:
    Participant[];

  weeks: PickEmWeek[];
  week: PickEmWeek | null;
  games: PickEmGame[];

  picks: Array<{
    game_id: number;
    picked_team_id: string;
    is_correct?: boolean | null;
  }>;

  groupPicks:
    GroupPick[];

  locked: boolean;

  error?: string;
};

function formatKickoff(
  value: string,
) {
  return new Date(
    value,
  ).toLocaleString(
    "en-US",
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone:
        "America/New_York",
    },
  );
}

function teamLabel(
  rank: number | null,
  name: string,
) {
  return rank
    ? `#${rank} ${name}`
    : name;
}

function gameStatus(
  game: PickEmGame,
) {
  if (
    game.status_detail
  ) {
    return game.status_detail;
  }

  if (
    game.status === "post"
  ) {
    return "Final";
  }

  if (
    game.status === "in"
  ) {
    return "Live";
  }

  return formatKickoff(
    game.kickoff_at,
  );
}

function bettingLine(
  game: PickEmGame,
) {
  const parts: string[] = [];

  if (
    game.spread !== null &&
    Number.isFinite(Number(game.spread))
  ) {
    const spread = Number(game.spread);

    if (
      spread === 0 ||
      !game.spread_favorite_team_id
    ) {
      parts.push("PK");
    } else {
      const favorite =
        String(game.spread_favorite_team_id) ===
        String(game.away_team_id)
          ? game.away_team_abbreviation ||
            game.away_team_name
          : String(game.spread_favorite_team_id) ===
              String(game.home_team_id)
            ? game.home_team_abbreviation ||
              game.home_team_name
            : null;

      if (favorite) {
        parts.push(
          `${favorite} ${
            spread > 0
              ? `+${spread}`
              : spread
          }`,
        );
      }
    }
  }

  if (
    game.over_under !== null &&
    Number.isFinite(Number(game.over_under))
  ) {
    parts.push(
      `O/U ${Number(game.over_under)}`,
    );
  }

  return parts.join(" · ");
}

function avatarFallback(
  name: string,
) {
  return (
    name.trim()[0]?.toUpperCase() ??
    "?"
  );
}

export default function NcaaPickEmHome() {
  const {
    selectedSport,
    setSelectedSport,
  } = useSelectedSport();

  const [data, setData] =
    useState<WeekResponse | null>(
      null,
    );

  const [
    selections,
    setSelections,
  ] =
    useState<
      Record<number, string>
    >({});

  const [
    expandedGameId,
    setExpandedGameId,
  ] =
    useState<number | null>(
      null,
    );

  const [
    selectedSeason,
    setSelectedSeason,
  ] =
    useState<number | null>(
      null,
    );

  const [
    selectedWeek,
    setSelectedWeek,
  ] =
    useState<number | null>(
      null,
    );

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  const [
    isSaving,
    setIsSaving,
  ] =
    useState(false);

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    error,
    setError,
  ] =
    useState("");

  useEffect(() => {
    if (
      selectedSport !==
      "ncaa"
    ) {
      setSelectedSport(
        "ncaa",
      );
    }
  }, [
    selectedSport,
    setSelectedSport,
  ]);

  async function loadWeek() {
    try {
      setIsLoading(true);
      setError("");

      const params =
        new URLSearchParams();

      if (
        selectedSeason !==
        null
      ) {
        params.set(
          "season",
          String(
            selectedSeason,
          ),
        );
      }

      if (
        selectedWeek !== null
      ) {
        params.set(
          "week",
          String(
            selectedWeek,
          ),
        );
      }

      const suffix =
        params.toString()
          ? `?${params.toString()}`
          : "";

      const response =
        await fetch(
          `/api/ncaa-pickem/week${suffix}`,
          {
            cache:
              "no-store",
          },
        );

      const result =
        (await response.json()) as WeekResponse;

      if (!response.ok) {
        setError(
          result.error ||
            "Failed to load NCAA Pick 'Em.",
        );

        setData(null);
        return;
      }

      setData(result);

      const saved:
        Record<number, string> =
        {};

      for (
        const pick
        of result.picks ?? []
      ) {
        saved[
          Number(
            pick.game_id,
          )
        ] =
          String(
            pick.picked_team_id,
          );
      }

      setSelections(
        saved,
      );

      if (
        selectedSeason ===
          null &&
        result.week
      ) {
        setSelectedSeason(
          result.week.season,
        );
      }

      if (
        selectedWeek ===
          null &&
        result.week
      ) {
        setSelectedWeek(
          result.week.week_number,
        );
      }
    } catch (loadError) {
      console.error(
        loadError,
      );

      setError(
        "Unable to load NCAA Pick 'Em.",
      );

      setData(null);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadWeek();
  }, [
    selectedSeason,
    selectedWeek,
  ]);

  const seasons =
    useMemo(
      () =>
        Array.from(
          new Set(
            (data?.weeks ??
              []).map(
              (week) =>
                week.season,
            ),
          ),
        ).sort(
          (a, b) =>
            b - a,
        ),
      [data?.weeks],
    );

  const weeksForSeason =
    useMemo(
      () =>
        (data?.weeks ?? [])
          .filter(
            (week) =>
              selectedSeason ===
                null ||
              week.season ===
                selectedSeason,
          )
          .sort(
            (a, b) =>
              a.week_number -
              b.week_number,
          ),
      [
        data?.weeks,
        selectedSeason,
      ],
    );

  const participantById =
    useMemo(
      () =>
        new Map(
          (
            data?.participants ??
            []
          ).map(
            (participant) => [
              participant.teamId,
              participant,
            ],
          ),
        ),
      [data?.participants],
    );

  const allGamesPicked =
    Boolean(
      data?.games.length,
    ) &&
    data!.games.every(
      (game) =>
        Boolean(
          selections[
            game.id
          ],
        ),
    );

  function picksForTeam(
    game: PickEmGame,
    pickedTeamId: string,
  ) {
    if (!data?.locked) {
      return [];
    }

    return (
      data.groupPicks ??
      []
    )
      .filter(
        (pick) =>
          pick.game_id ===
            game.id &&
          pick.picked_team_id ===
            pickedTeamId,
      )
      .map(
        (pick) =>
          participantById.get(
            pick.team_id,
          ),
      )
      .filter(
        (
          participant,
        ): participant is Participant =>
          Boolean(
            participant,
          ),
      );
  }

  async function savePicks() {
    if (
      !data?.week ||
      data.locked ||
      !allGamesPicked
    ) {
      return;
    }

    try {
      setIsSaving(true);
      setMessage("");
      setError("");

      const response =
        await fetch(
          "/api/ncaa-pickem/picks",
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                weekId:
                  data.week.id,

                picks:
                  data.games.map(
                    (game) => ({
                      gameId:
                        game.id,

                      pickedTeamId:
                        selections[
                          game.id
                        ],
                    }),
                  ),
              }),
          },
        );

      const result =
        await response.json();

      if (!response.ok) {
        setError(
          result.error ||
            "Unable to save picks.",
        );

        return;
      }

      setMessage(
        "✓ Picks saved.",
      );

      await loadWeek();
    } catch (saveError) {
      console.error(
        saveError,
      );

      setError(
        "Unable to save picks.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <AppNav />

        <section className="w-full rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-3 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-blue-300">
                NCAA Pick &apos;Em
              </div>

              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <h1 className="text-xl font-black tracking-tight sm:text-2xl">
                  Pick the winners
                </h1>

                {data?.week ? (
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      data.locked
                        ? "border-slate-600 bg-slate-800 text-slate-300"
                        : "border-emerald-500/40 bg-emerald-950/40 text-emerald-300"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        data.locked
                          ? "bg-slate-400"
                          : "bg-emerald-400"
                      }`}
                    />

                    {data.locked
                      ? "Locked"
                      : "Open"}
                  </span>
                ) : null}
              </div>

              <p className="mt-1 text-xs text-slate-400">
                Top-25 matchups for the selected week
              </p>
            </div>

            <details className="group relative shrink-0">
              <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-950/70 px-2.5 py-1.5 text-xs font-bold text-slate-300 hover:border-slate-600 [&::-webkit-details-marker]:hidden">
                <span>
                  {selectedSeason ?? "Season"} · Week{" "}
                  {selectedWeek ?? "—"}
                </span>

                <span
                  aria-hidden="true"
                  className="text-[9px] text-slate-500 transition-transform group-open:rotate-180"
                >
                  ▼
                </span>
              </summary>

              <div className="absolute right-0 z-30 mt-2 w-64 space-y-3 rounded-xl border border-slate-700 bg-slate-900 p-3 shadow-2xl">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Season
                  </span>

                  <select
                    value={
                      selectedSeason ??
                      ""
                    }
                    onChange={(
                      event,
                    ) => {
                      const value =
                        Number(
                          event.target
                            .value,
                        );

                      setSelectedSeason(
                        Number.isFinite(
                          value,
                        )
                          ? value
                          : null,
                      );

                      setSelectedWeek(
                        null,
                      );

                      setMessage("");
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm font-semibold text-slate-100"
                  >
                    {seasons.length ===
                    0 ? (
                      <option value="">
                        No seasons yet
                      </option>
                    ) : null}

                    {seasons.map(
                      (season) => (
                        <option
                          key={season}
                          value={season}
                        >
                          {season}
                        </option>
                      ),
                    )}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                    Week
                  </span>

                  <select
                    value={
                      selectedWeek ??
                      ""
                    }
                    onChange={(
                      event,
                    ) => {
                      const value =
                        Number(
                          event.target
                            .value,
                        );

                      setSelectedWeek(
                        Number.isFinite(
                          value,
                        )
                          ? value
                          : null,
                      );

                      setMessage("");
                    }}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm font-semibold text-slate-100"
                  >
                    {weeksForSeason.length ===
                    0 ? (
                      <option value="">
                        No weeks yet
                      </option>
                    ) : null}

                    {weeksForSeason.map(
                      (week) => (
                        <option
                          key={
                            week.id
                          }
                          value={
                            week.week_number
                          }
                        >
                          {week.label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
              </div>
            </details>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-sm text-red-200">
            {error}
          </div>
        ) : null}

        {message ? (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-3 text-sm font-semibold text-emerald-300">
            {message}
          </div>
        ) : null}

        {isLoading ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
            Loading NCAA Pick &apos;Em…
          </section>
        ) : null}

        {!isLoading &&
        !error &&
        !data?.week ? (
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
            <div className="text-4xl">
              🏈
            </div>

            <h2 className="mt-3 text-xl font-bold">
              NCAA Pick &apos;Em is ready
            </h2>

            <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-400">
              No weekly games have been imported yet.
            </p>
          </section>
        ) : null}

        {!isLoading &&
        data?.week ? (
          <>
            <section className="mx-auto w-full max-w-3xl space-y-2">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
                    {data.week.season}
                  </div>

                  <h2 className="mt-0.5 text-xl font-black sm:text-2xl">
                    {data.week.label}
                  </h2>
                </div>

                {data.week.lock_at ? (
                  <div className="text-xs text-slate-500 sm:text-sm">
                    {data.locked
                      ? "Locked "
                      : "Locks "}

                    {formatKickoff(
                      data.week
                        .lock_at,
                    )}
                  </div>
                ) : null}
              </div>

              {data.week.show_analysis === true &&
              data.week.analysis?.trim() ? (
                <details className="group overflow-hidden rounded-2xl border border-blue-500/30 bg-blue-950/20">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold text-blue-100 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true">
                        📝
                      </span>

                      MW Analysis
                    </span>

                    <span
                      aria-hidden="true"
                      className="text-xs text-blue-300 transition-transform group-open:rotate-180"
                    >
                      ▼
                    </span>
                  </summary>

                  <div className="border-t border-blue-900/70 px-4 py-4">
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
                      {data.week.analysis.trim()}
                    </p>
                  </div>
                </details>
              ) : null}

              {data.games.length ===
              0 ? (
                <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm text-slate-400">
                  No eligible Top 25 matchups are loaded for this week.
                </div>
              ) : null}

              {data.games.map(
                (game) => {
                  const awayPicked =
                    selections[
                      game.id
                    ] ===
                    String(
                      game.away_team_id,
                    );

                  const homePicked =
                    selections[
                      game.id
                    ] ===
                    String(
                      game.home_team_id,
                    );

                  const awayPeople =
                    picksForTeam(
                      game,
                      String(
                        game.away_team_id,
                      ),
                    );

                  const homePeople =
                    picksForTeam(
                      game,
                      String(
                        game.home_team_id,
                      ),
                    );

                  return (
                    <article
                      key={
                        game.id
                      }
                      className="overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-3 py-1.5">
                        <div className="min-w-0 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                          {gameStatus(
                            game,
                          )}
                        </div>

                        {bettingLine(
                          game,
                        ) ? (
                          <div className="shrink-0 text-[10px] font-bold text-blue-300">
                            {bettingLine(
                              game,
                            )}
                          </div>
                        ) : null}
                      </div>

                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-1.5 p-2">
                        {[
                          {
                            side:
                              "away",

                            id:
                              String(
                                game.away_team_id,
                              ),

                            name:
                              game.away_team_name,

                            logo:
                              game.away_team_logo_url,

                            rank:
                              game.away_rank,

                            record:
                              game.away_record,

                            score:
                              game.away_score,

                            selected:
                              awayPicked,

                            people:
                              awayPeople,
                          },

                          {
                            side:
                              "home",

                            id:
                              String(
                                game.home_team_id,
                              ),

                            name:
                              game.home_team_name,

                            logo:
                              game.home_team_logo_url,

                            rank:
                              game.home_rank,

                            record:
                              game.home_record,

                            score:
                              game.home_score,

                            selected:
                              homePicked,

                            people:
                              homePeople,
                          },
                        ].map(
                          (
                            team,
                            index,
                          ) => (
                            <div
                              key={
                                team.id
                              }
                              className="contents"
                            >
                              {index ===
                              1 ? (
                                <div className="flex items-center justify-center px-0.5 text-[10px] font-black uppercase tracking-wider text-slate-600">
                                  vs
                                </div>
                              ) : null}

                              <label
                                className={`relative flex min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 transition ${
                                  team.selected
                                    ? "border-blue-400 bg-blue-950/60 ring-1 ring-blue-400/30"
                                    : "border-slate-700 bg-slate-950/70 hover:border-slate-600"
                                } ${
                                  data.locked
                                    ? "cursor-default"
                                    : ""
                                }`}
                              >
                                <input
                                  type="radio"
                                  name={`game-${game.id}`}
                                  value={
                                    team.id
                                  }
                                  checked={
                                    team.selected
                                  }
                                  disabled={
                                    data.locked
                                  }
                                  onChange={() => {
                                    if (
                                      data.locked
                                    ) {
                                      return;
                                    }

                                    setSelections(
                                      (
                                        current,
                                      ) => ({
                                        ...current,
                                        [
                                          game.id
                                        ]:
                                          team.id,
                                      }),
                                    );

                                    setMessage(
                                      "",
                                    );
                                  }}
                                  className="sr-only"
                                />

                                <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-[10px] font-black text-slate-500">
                                  <span>
                                    {team.name[0]}
                                  </span>

                                  <img
                                    src={
                                      team.logo ||
                                      `https://a.espncdn.com/i/teamlogos/ncaa/500/${team.id}.png`
                                    }
                                    alt=""
                                    className="absolute inset-0 h-full w-full object-contain p-0.5"
                                    onError={(
                                      event,
                                    ) => {
                                      event.currentTarget.style.display =
                                        "none";
                                    }}
                                  />
                                </div>

                                <div className="min-w-0 flex-1">
                                  <div className="flex min-w-0 items-start gap-1">
                                    <div className="min-w-0 flex-1 text-[12px] font-bold leading-tight text-slate-100">
                                      <span className="line-clamp-2">
                                        {teamLabel(
                                          team.rank,
                                          team.name,
                                        )}
                                      </span>
                                    </div>

                                    {team.score !==
                                    null ? (
                                      <div className="shrink-0 text-base font-black">
                                        {
                                          team.score
                                        }
                                      </div>
                                    ) : null}
                                  </div>

                                  <div className="mt-0.5 flex items-center gap-1 text-[10px] leading-none text-slate-500">
                                    <span>
                                      {team.record ??
                                        (team.side ===
                                        "away"
                                          ? "Away"
                                          : "Home")}
                                    </span>

                                  </div>

                                  {data.locked &&
                                  team.people.length >
                                    0 ? (
                                    <div className="mt-1 flex -space-x-1">
                                      {team.people
                                        .slice(
                                          0,
                                          4,
                                        )
                                        .map(
                                          (
                                            participant,
                                          ) =>
                                            participant.avatarUrl ? (
                                              <img
                                                key={
                                                  participant.teamId
                                                }
                                                src={
                                                  participant.avatarUrl
                                                }
                                                alt={
                                                  participant.name
                                                }
                                                title={
                                                  participant.name
                                                }
                                                className="h-5 w-5 rounded-full border border-slate-800 object-cover"
                                              />
                                            ) : (
                                              <span
                                                key={
                                                  participant.teamId
                                                }
                                                title={
                                                  participant.name
                                                }
                                                className="flex h-5 w-5 items-center justify-center rounded-full border border-slate-800 bg-slate-700 text-[8px] font-bold text-slate-200"
                                              >
                                                {avatarFallback(
                                                  participant.name,
                                                )}
                                              </span>
                                            ),
                                        )}

                                      {team.people.length >
                                      4 ? (
                                        <span className="ml-1 text-[9px] text-slate-500">
                                          +
                                          {team.people.length -
                                            4}
                                        </span>
                                      ) : null}
                                    </div>
                                  ) : null}
                                </div>
                              </label>
                            </div>
                          ),
                        )}
                      </div>

                    </article>
                  );
                },
              )}
            </section>

            {data.games.length >
            0 ? (
              <div className="mx-auto flex w-full max-w-3xl justify-end rounded-xl border border-slate-800 bg-slate-900/70 p-2 shadow-sm">
                {data.locked ? (
                  <div className="text-center text-sm font-semibold text-slate-400">
                    🔒 Picks are locked. Everyone&apos;s selections are now visible.
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={
                      !allGamesPicked ||
                      isSaving
                    }
                    onClick={() =>
                      void savePicks()
                    }
                    className="w-full rounded-lg bg-blue-600 px-5 py-2.5 font-bold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto sm:min-w-40"
                  >
                    {isSaving
                      ? "Saving…"
                      : allGamesPicked
                        ? "Save Picks"
                        : `Pick all ${data.games.length} game${data.games.length === 1 ? "" : "s"} to save`}
                  </button>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}
