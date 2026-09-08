"use client";

import AppNav from "@/components/AppNav";

import {
  useEffect,
  useRef,
  useState,
} from "react";

type AdminGame = {
  odds?: { favoriteTeamId: string | null; spread: number | null; overUnder: number | null; provider: string | null } | null;
  espnEventId: string;
  kickoffAt: string;
  included: boolean;
  commissionerSelected?: boolean;
  automatic: boolean;

  away: {
    id: string;
    name: string;
    abbreviation: string | null;
    logo: string | null;
    rank: number | null;
    record: string | null;
  };

  home: {
    id: string;
    name: string;
    abbreviation: string | null;
    logo: string | null;
    rank: number | null;
    record: string | null;
  };

  status: string;
  statusDetail: string | null;
};

function CandidateLine({ game }: { game: AdminGame }) {
  const favorite = game.odds?.favoriteTeamId === game.away.id ? game.away : game.odds?.favoriteTeamId === game.home.id ? game.home : null;
  const line = [favorite?.abbreviation && game.odds?.spread != null ? `${favorite.abbreviation} ${game.odds.spread > 0 ? "+" : ""}${game.odds.spread}` : null,
    game.odds?.overUnder != null ? `O/U ${game.odds.overUnder}` : null].filter(Boolean).join(" · ");
  return <span className={`text-[11px] tabular-nums ${line ? "font-bold text-blue-300" : "text-slate-500"}`}>{line || "Line unavailable"}</span>;
}

type ImportResult = {
  success?: boolean;
  status?: string;
  error?: string;
  weekId?: number;
  season?: number;
  week?: number;
  label?: string;
  lockAt?: string | null;
  importedGames?: number;
  normalEligibleGames?: number;
  optionalGames?: number;

  diagnostics?: {
    totalEvents?: number;
    mappedEvents?: number;
    rankedVsRankedEvents?: number;
    rankedTeamGames?: number;
    rankingPoll?: string | null;
    rankingPollType?: string | null;
    rankedTeams?: number;
  };

  games?: AdminGame[];
  analysis?: string | null;
  showAnalysis?: boolean;
};

function gameTime(
  value: string,
) {
  const date =
    new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    return value;
  }

  return date.toLocaleString(
    undefined,
    {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    },
  );
}

function TeamLine({
  team,
}: {
  team: AdminGame["away"];
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {team.logo ? (
        <img
          src={team.logo}
          alt=""
          className="h-8 w-8 shrink-0 object-contain"
        />
      ) : (
        <div className="h-8 w-8 shrink-0 rounded-full bg-slate-800" />
      )}

      <div className="min-w-0">
        <div className="truncate font-bold text-slate-100">
          {team.rank !== null ? (
            <span className="mr-1 text-blue-300">
              #{team.rank}
            </span>
          ) : null}

          {team.name}
        </div>

        {team.record ? (
          <div className="text-xs text-slate-500">
            {team.record}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function NcaaPickEmAdminPage() {
  const [
    season,
    setSeason,
  ] =
    useState("");

  const [
    week,
    setWeek,
  ] =
    useState("");

  const [
    result,
    setResult,
  ] =
    useState<ImportResult | null>(
      null,
    );

  const [
    message,
    setMessage,
  ] =
    useState("");

  const [
    analysis,
    setAnalysis,
  ] =
    useState("");

  const [
    showAnalysis,
    setShowAnalysis,
  ] =
    useState(false);

  const [
    isWorking,
    setIsWorking,
  ] =
    useState(false);

  const [options, setOptions] = useState<{ seasons: number[]; weeks: number[] } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [notImported, setNotImported] = useState(false);
  const generation = useRef(0);
  const analysisDirty = Boolean(result?.success && (analysis !== (result.analysis ?? "") || showAnalysis !== (result.showAnalysis === true)));

  function canReplaceWeek() {
    return !analysisDirty || window.confirm("Discard unsaved MW Analysis changes? Choose Cancel to save them first.");
  }

  function changeSelection(nextSeason: string, nextWeek: string) {
    if (isWorking || !canReplaceWeek()) return;
    generation.current++;
    setResult(null);
    setAnalysis("");
    setShowAnalysis(false);
    setMessage("");
    setNotImported(false);
    setIsLoading(true);
    setSeason(nextSeason);
    setWeek(nextWeek);
  }

  useEffect(() => {
    if (week) return;
    const controller = new AbortController();
    let active = true;
    async function loadOptions() {
      try {
        const params = new URLSearchParams({ options: "1" });
        if (season) params.set("season", season);
        const response = await fetch(`/api/admin/ncaa-pickem/import-week?${params}`, { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!active) return;
        if (!response.ok) throw new Error(data.error || "Unable to load week options.");
        setOptions(data);
        setSeason(String(data.season));
        setWeek(String(data.week));
      } catch (error) {
        if (!active) return;
        setMessage(error instanceof Error ? error.message : "Unable to load week options.");
        setIsLoading(false);
      }
    }
    void loadOptions();
    return () => { active = false; controller.abort(); };
  }, [season, week]);

  useEffect(() => {
    if (!season || !week) return;
    const controller = new AbortController();
    const requestGeneration = generation.current;
    let active = true;
    const isCurrent = () => active && requestGeneration === generation.current;
    setIsLoading(true);
    async function loadWeek() {
      try {
        const params = new URLSearchParams({ season, week });
        const response = await fetch(`/api/admin/ncaa-pickem/import-week?${params}`, { cache: "no-store", signal: controller.signal });
        const data = (await response.json()) as ImportResult;
        if (!isCurrent()) return;
        if (response.status === 404 && data.error === "NCAA Pick 'Em week has not been imported.") {
          setNotImported(true);
          return;
        }
        if (!response.ok) throw new Error(data.error || "Unable to load the saved week.");
        setResult(data);
        setAnalysis(data.analysis ?? "");
        setShowAnalysis(data.showAnalysis === true);
        setMessage("");
      } catch (error) {
        if (!isCurrent()) return;
        setMessage(error instanceof Error ? error.message : "Unable to load the saved week.");
      } finally {
        if (isCurrent()) setIsLoading(false);
      }
    }
    void loadWeek();
    return () => { active = false; controller.abort(); };
  }, [season, week]);

  async function importWeek(
    includedEventIds?:
      string[],
  ) {
    if (isLoading || isWorking || !canReplaceWeek()) return;
    try {
      setIsWorking(true);
      setMessage("");

      const body: {
        season: number;
        week: number;
        includedEventIds?: string[];
      } = {
        season:
          Number(season),

        week:
          Number(week),
      };

      if (
        includedEventIds !==
        undefined
      ) {
        body.includedEventIds =
          includedEventIds;
      }

      const response =
        await fetch(
          "/api/admin/ncaa-pickem/import-week",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify(
                body,
              ),
          },
        );

      const data =
        (await response.json()) as ImportResult;

      if (response.ok) {
        setResult(data);
        setNotImported(false);
        setAnalysis(
          data.analysis ??
            "",
        );

        setShowAnalysis(
          data.showAnalysis ===
            true,
        );
      }

      if (!response.ok) {
        setMessage(
          data.error ||
            "Refresh failed.",
        );

        return;
      }

      setMessage(
        `✓ Week ${week} ${notImported ? "imported" : "refreshed"}. ${data.importedGames ?? 0} game(s) on the Pick 'Em card.`,
      );
    } catch (error) {
      console.error(
        error,
      );

      setMessage(
        "Refresh failed.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function toggleGame(
    espnEventId: string,
  ) {
    if (!result?.games) {
      return;
    }

    const includedIds =
      result.games
        .filter(
          (game) =>
            game.espnEventId ===
            espnEventId
              ? !game.included
              : game.included,
        )
        .map(
          (game) =>
            game.espnEventId,
        );

    await importWeek(
      includedIds,
    );
  }

  async function saveAnalysis() {
    if (
      !result?.weekId
    ) {
      setMessage(
        "Refresh the week first.",
      );
      return;
    }

    try {
      setIsWorking(true);
      setMessage("");

      const response =
        await fetch(
          "/api/admin/ncaa-pickem/week-control",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                weekId:
                  result.weekId,
                analysis,
                showAnalysis,
              }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        setMessage(
          data.error ||
            "Unable to save MW Analysis.",
        );
        return;
      }

      setAnalysis(
        data.week?.analysis ??
          "",
      );

      setShowAnalysis(
        data.week
          ?.show_analysis ===
          true,
      );

      setResult(previous => previous ? { ...previous, analysis: data.week?.analysis ?? "", showAnalysis: data.week?.show_analysis === true } : previous);
      setMessage(
        "✓ MW Analysis saved.",
      );
    } catch (error) {
      console.error(
        error,
      );

      setMessage(
        "Unable to save MW Analysis.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function setStatus(
    status:
      | "open"
      | "locked"
      | "final",
  ) {
    if (
      !result?.weekId
    ) {
      setMessage(
        "Refresh the week first.",
      );

      return;
    }

    try {
      setIsWorking(true);

      const response =
        await fetch(
          "/api/admin/ncaa-pickem/week-control",
          {
            method:
              "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body:
              JSON.stringify({
                weekId:
                  result.weekId,
                status,
              }),
          },
        );

      const data =
        await response.json();

      if (!response.ok) {
        setMessage(
          data.error ||
            "Unable to update status.",
        );

        return;
      }

      setResult(previous => previous ? { ...previous, status } : previous);
      setMessage(
        `✓ Week is now ${status}.`,
      );
    } catch (error) {
      console.error(
        error,
      );

      setMessage(
        "Unable to update status.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  const automaticGames =
    (
      result?.games ??
      []
    ).filter(
      (game) =>
        game.automatic,
    );

  const optionalGames =
    (
      result?.games ??
      []
    ).filter(
      (game) =>
        !game.automatic,
    );

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-6">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-blue-300">
            Commissioner
          </div>

          <h1 className="mt-2 text-3xl font-black">
            NCAA Pick &apos;Em
          </h1>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            Ranked-vs-ranked games are added automatically. Games featuring one ranked team are available below for commissioner selection.
          </p>
        </section>

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Season
              </div>

              <select
                value={season}
                disabled={isWorking || !options || !week}
                onChange={event => changeSelection(event.target.value, "")}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-40"
              >
                {!season && <option value="">Loading seasons…</option>}
                {options?.seasons.map(value => <option key={value} value={value}>{value}</option>)}
              </select>
            </label>

            <label className="space-y-1">
              <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Week
              </div>

              <select
                value={week}
                disabled={isWorking || !options || !week}
                onChange={event => changeSelection(season, event.target.value)}
                className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-40"
              >
                {!week && <option value="">Loading weeks…</option>}
                {options?.weeks.map(value => <option key={value} value={value}>Week {value}</option>)}
              </select>
            </label>
          </div>

          <button
            type="button"
            disabled={
              isWorking || isLoading || (!result?.success && !notImported)
            }
            onClick={() =>
              void importWeek()
            }
            className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-40"
          >
            {isWorking
              ? "Working…"
              : isLoading ? "Loading…" : notImported ? "Import Week from ESPN" : "Refresh Week from ESPN"}
          </button>

          <div className="mt-3 text-sm text-slate-400" role="status">
            {isLoading ? "Loading selected week…" : notImported ? `Week ${week} is not imported. Import its schedule to set up the card in advance.` : result?.success ? `Week ${week} — ${result.status === "final" ? "Final" : result.status === "locked" || (result.lockAt && Date.now() >= Date.parse(result.lockAt)) ? "Locked" : "Open"}` : ""}
          </div>
          <div className="mt-3 text-xs leading-5 text-slate-500">
            Refreshing updates ESPN schedule, rankings, records and game data without removing commissioner-added games.
          </div>

          {message ? (
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-sm">
              {message}
            </div>
          ) : null}
        </section>

        {result?.success ? (
          <>
            <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-lg font-bold">
                    Week {result.week} Control
                  </h2>

                  <div className="mt-1 text-sm text-slate-400">
                    {result.diagnostics
                      ?.rankingPoll
                      ? `Rankings: ${result.diagnostics.rankingPoll}`
                      : "Rankings feed loaded"}
                  </div>
                </div>

                {result.lockAt ? (
                  <div className="rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-right">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
                      Pick Lock
                    </div>

                    <div className="mt-1 text-sm font-bold">
                      {gameTime(
                        result.lockAt,
                      )}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-4">
                <div className="rounded-xl bg-slate-950 p-3">
                  <div className="text-xs text-slate-500">
                    ESPN events
                  </div>

                  <div className="mt-1 text-xl font-black">
                    {result.diagnostics
                      ?.totalEvents ??
                      "—"}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 p-3">
                  <div className="text-xs text-slate-500">
                    Ranked teams
                  </div>

                  <div className="mt-1 text-xl font-black">
                    {result.diagnostics
                      ?.rankedTeams ??
                      "—"}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 p-3">
                  <div className="text-xs text-slate-500">
                    Auto games
                  </div>

                  <div className="mt-1 text-xl font-black">
                    {result.normalEligibleGames ??
                      0}
                  </div>
                </div>

                <div className="rounded-xl bg-slate-950 p-3">
                  <div className="text-xs text-slate-500">
                    Active card
                  </div>

                  <div className="mt-1 text-xl font-black">
                    {result.importedGames ??
                      0}
                  </div>
                </div>
              </div>

              <div className="mt-5 rounded-2xl border border-blue-500/25 bg-blue-950/10 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">
                      MW Analysis
                    </div>

                    <p className="mt-1 text-sm leading-5 text-slate-400">
                      Write the weekly commentary for the Pick &apos;Em Home page.
                      Keep it hidden while drafting, then show it whenever you&apos;re ready.
                    </p>
                  </div>

                  <label className="inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border border-slate-700 bg-slate-950/60 px-3 py-2">
                    <input
                      type="checkbox"
                      checked={
                        showAnalysis
                      }
                      onChange={(
                        event,
                      ) =>
                        setShowAnalysis(
                          event.target
                            .checked,
                        )
                      }
                      disabled={
                        isWorking
                      }
                      className="h-4 w-4 accent-blue-500"
                    />

                    <span className="text-sm font-semibold text-slate-200">
                      {showAnalysis
                        ? "Showing on Home"
                        : "Hidden"}
                    </span>
                  </label>
                </div>

                <textarea
                  value={
                    analysis
                  }
                  onChange={(
                    event,
                  ) =>
                    setAnalysis(
                      event.target
                        .value,
                    )
                  }
                  disabled={
                    isWorking
                  }
                  maxLength={
                    4000
                  }
                  rows={6}
                  placeholder="Write the latest MW Analysis..."
                  className="mt-4 w-full resize-y rounded-xl border border-slate-700 bg-slate-950 px-3 py-3 text-sm leading-6 text-slate-100 placeholder:text-slate-600 outline-none focus:border-blue-400 disabled:opacity-60"
                />

                <div className="mt-2 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    disabled={
                      isWorking
                    }
                    onClick={() =>
                      void saveAnalysis()
                    }
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-blue-500 disabled:opacity-40"
                  >
                    Save MW Analysis
                  </button>

                  <span className="text-xs text-slate-500">
                    {analysis.length}/4000
                  </span>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={
                    isWorking
                  }
                  onClick={() =>
                    void setStatus(
                      "open",
                    )
                  }
                  className="rounded-xl border border-emerald-500/40 bg-emerald-950/30 px-4 py-2 text-sm font-bold text-emerald-300 disabled:opacity-40"
                >
                  Reopen Picks
                </button>

                <button
                  type="button"
                  disabled={
                    isWorking
                  }
                  onClick={() =>
                    void setStatus(
                      "locked",
                    )
                  }
                  className="rounded-xl border border-amber-500/40 bg-amber-950/30 px-4 py-2 text-sm font-bold text-amber-300 disabled:opacity-40"
                >
                  Lock Picks
                </button>

                <button
                  type="button"
                  disabled={
                    isWorking
                  }
                  onClick={() =>
                    void setStatus(
                      "final",
                    )
                  }
                  className="rounded-xl border border-blue-500/40 bg-blue-950/30 px-4 py-2 text-sm font-bold text-blue-300 disabled:opacity-40"
                >
                  Mark Final
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-blue-300">
                    Automatic
                  </div>

                  <h2 className="mt-1 text-xl font-black">
                    Ranked vs. Ranked
                  </h2>

                  <p className="mt-1 text-sm text-slate-400">
                    These games are included automatically.
                  </p>
                </div>

                <div className="text-sm font-bold text-slate-400">
                  {automaticGames.length}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {automaticGames.length >
                0 ? (
                  automaticGames.map(
                    (game) => (
                      <article
                        key={
                          game.espnEventId
                        }
                        className="rounded-2xl border border-blue-500/30 bg-blue-950/10 p-4"
                      >
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                          <TeamLine
                            team={
                              game.away
                            }
                          />

                          <div className="text-xs font-bold uppercase text-slate-600">
                            at
                          </div>

                          <TeamLine
                            team={
                              game.home
                            }
                          />
                        </div>

                        <div className="mt-1"><CandidateLine game={game} /></div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
                          <div className="text-xs text-slate-500">
                            {gameTime(
                              game.kickoffAt,
                            )}
                          </div>

                          <div className="rounded-full bg-blue-500/15 px-2.5 py-1 text-xs font-bold text-blue-300">
                            Included automatically
                          </div>
                        </div>
                      </article>
                    ),
                  )
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">
                    No ranked-vs-ranked games found for this week.
                  </div>
                )}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">
                    Commissioner Choice
                  </div>

                  <h2 className="mt-1 text-xl font-black">
                    Other Ranked-Team Games
                  </h2>

                  <p className="mt-1 max-w-2xl text-sm text-slate-400">
                    Add any matchup featuring one Top-25 team that you want on this week&apos;s card.
                  </p>
                </div>

                <div className="text-sm font-bold text-slate-400">
                  {optionalGames.length}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                {optionalGames.length >
                0 ? (
                  optionalGames.map(
                    (game) => (
                      <article
                        key={
                          game.espnEventId
                        }
                        className={
                          game.included
                            ? "rounded-2xl border border-emerald-500/30 bg-emerald-950/10 p-4"
                            : "rounded-2xl border border-slate-800 bg-slate-950 p-4"
                        }
                      >
                        <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                          <TeamLine
                            team={
                              game.away
                            }
                          />

                          <div className="text-xs font-bold uppercase text-slate-600">
                            at
                          </div>

                          <TeamLine
                            team={
                              game.home
                            }
                          />
                        </div>

                        <div className="mt-1"><CandidateLine game={game} /></div>
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 pt-3">
                          <div>
                            <div className="text-xs text-slate-500">
                              {gameTime(
                                game.kickoffAt,
                              )}
                            </div>

                            <div className="mt-1 text-[10px] text-slate-700">
                              ESPN{" "}
                              {
                                game.espnEventId
                              }
                            </div>
                          </div>

                          <button
                            type="button"
                            disabled={
                              isWorking
                            }
                            onClick={() =>
                              void toggleGame(
                                game.espnEventId,
                              )
                            }
                            className={
                              game.included
                                ? "rounded-xl border border-red-500/40 bg-red-950/20 px-4 py-2 text-sm font-bold text-red-300 disabled:opacity-40"
                                : "rounded-xl bg-emerald-600 px-4 py-2 text-sm font-bold text-white transition hover:bg-emerald-500 disabled:opacity-40"
                            }
                          >
                            {game.included
                              ? "Remove"
                              : "Add to Pick 'Em"}
                          </button>
                        </div>
                      </article>
                    ),
                  )
                ) : (
                  <div className="rounded-2xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-500">
                    No additional Top-25 matchups found for this week.
                  </div>
                )}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
