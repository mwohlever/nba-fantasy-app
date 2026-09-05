"use client";

import { useEffect, useMemo, useState } from "react";

import type { NcaaScoreGame } from "./NcaaScoreCard";

type EspnLogo = {
  href?: string;
};

type EspnRecord = {
  type?: string;
  summary?: string;
  displayValue?: string;
};

type EspnCompetitor = {
  id?: string;
  homeAway?: "home" | "away";
  winner?: boolean;
  score?: string;
  rank?: number;
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
    logos?: EspnLogo[];
  };
  record?: EspnRecord[];
};

type EspnPlay = {
  id?: string;
  text?: string;
  awayScore?: number;
  homeScore?: number;
  scoringPlay?: boolean;
  period?: {
    number?: number;
  };
  clock?: {
    displayValue?: string;
  };
};

type EspnDrive = {
  id?: string;
  team?: {
    id?: string;
    abbreviation?: string;
    shortDisplayName?: string;
  };
  plays?: EspnPlay[];
};

type EspnTeamStat = {
  name?: string;
  displayName?: string;
  label?: string;
  displayValue?: string;
};

type EspnTeamBox = {
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
    logos?: EspnLogo[];
  };
  statistics?: EspnTeamStat[];
};

type EspnAthleteStat = {
  athlete?: {
    id?: string;
    displayName?: string;
    shortName?: string;
    headshot?: {
      href?: string;
    };
  };
  stats?: string[];
};

type EspnPlayerCategory = {
  name?: string;
  displayName?: string;
  labels?: string[];
  descriptions?: string[];
  athletes?: EspnAthleteStat[];
};

type EspnPlayerBox = {
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    shortDisplayName?: string;
    logos?: EspnLogo[];
  };
  statistics?: EspnPlayerCategory[];
};

type GameDetailResponse = {
  success?: boolean;
  error?: string;
  eventId?: string;
  header?: {
    competitions?: Array<{
      date?: string;
      competitors?: EspnCompetitor[];
      status?: {
        type?: {
          state?: string;
          description?: string;
          detail?: string;
          shortDetail?: string;
          completed?: boolean;
        };
      };
    }>;
  } | null;
  drives?: {
    current?: EspnDrive;
    previous?: EspnDrive[];
  } | null;
  boxscore?: {
    teams?: EspnTeamBox[];
    players?: EspnPlayerBox[];
  } | null;
};

function teamLogo(team?: { logos?: EspnLogo[] }) {
  return team?.logos?.find((logo) => logo?.href)?.href || "";
}

function totalRecord(competitor?: EspnCompetitor) {
  return (
    competitor?.record?.find((record) => record.type === "total")?.summary ||
    competitor?.record?.[0]?.summary ||
    ""
  );
}

function quarterLabel(period: number) {
  if (period === 1) return "1st Quarter";
  if (period === 2) return "2nd Quarter";
  if (period === 3) return "3rd Quarter";
  if (period === 4) return "4th Quarter";
  return `Quarter ${period}`;
}

function categoryTitle(category?: EspnPlayerCategory) {
  return category?.displayName || category?.name || "Stats";
}

export default function NcaaGameCenterModal({
  game,
  onClose,
}: {
  game: NcaaScoreGame;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"game" | "stats">("game");
  const [detail, setDetail] = useState<GameDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statsTeamId, setStatsTeamId] = useState<string>("");
  const [selectedQuarter, setSelectedQuarter] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");
      setDetail(null);

      try {
        const response = await fetch(
          `/api/ncaa-pickem/game-detail?eventId=${encodeURIComponent(
            game.espnEventId,
          )}`,
          { cache: "no-store" },
        );

        const body = (await response.json()) as GameDetailResponse;

        if (!response.ok) {
          throw new Error(body.error || "Unable to load game detail.");
        }

        if (!cancelled) {
          setDetail(body);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load game detail.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [game.espnEventId]);

  const competition = detail?.header?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const away = competitors.find((team) => team.homeAway === "away");
  const home = competitors.find((team) => team.homeAway === "home");

  useEffect(() => {
    if (!statsTeamId && away?.id) {
      setStatsTeamId(away.id);
    }
  }, [away?.id, statsTeamId]);

  const drives = useMemo(() => {
    const previous = Array.isArray(detail?.drives?.previous)
      ? detail?.drives?.previous
      : [];
    const current = detail?.drives?.current ? [detail.drives.current] : [];
    return [...previous, ...current];
  }, [detail?.drives]);

  const playsByQuarter = useMemo(() => {
    const map = new Map<number, EspnPlay[]>();

    for (const drive of drives) {
      for (const play of drive.plays || []) {
        const period = play.period?.number;
        if (!period) continue;

        const existing = map.get(period) || [];
        existing.push(play);
        map.set(period, existing);
      }
    }

    const isLive = competition?.status?.type?.state === "in";

    return Array.from(map.entries())
      .sort(([a], [b]) => b - a)
      .map(([period, plays]) => ({
        period,
        plays: [...plays].reverse(),
      }));
  }, [competition?.status?.type?.state, drives]);

  useEffect(() => {
    if (!playsByQuarter.length) {
      setSelectedQuarter(null);
      return;
    }

    const periods = playsByQuarter.map(({ period }) => period);
    const latestPeriod = Math.max(...periods);

    setSelectedQuarter((current) =>
      current !== null && periods.includes(current)
        ? current
        : latestPeriod,
    );
  }, [playsByQuarter]);

  const selectedQuarterPlays =
    playsByQuarter.find(({ period }) => period === selectedQuarter)?.plays || [];

  const teamStats = detail?.boxscore?.teams || [];
  const awayTeamStats = teamStats.find(
    (entry) => entry.team?.id === away?.id,
  );
  const homeTeamStats = teamStats.find(
    (entry) => entry.team?.id === home?.id,
  );

  const statRows = useMemo(() => {
    const awayStats = awayTeamStats?.statistics || [];
    const homeStats = homeTeamStats?.statistics || [];
    const homeByName = new Map(
      homeStats.map((stat) => [stat.name || stat.displayName, stat]),
    );

    return awayStats
      .map((awayStat) => {
        const key = awayStat.name || awayStat.displayName;
        if (!key) return null;

        const homeStat = homeByName.get(key);

        return {
          key,
          label: awayStat.label || awayStat.displayName || key,
          away: awayStat.displayValue ?? "—",
          home: homeStat?.displayValue ?? "—",
        };
      })
      .filter(Boolean) as Array<{
      key: string;
      label: string;
      away: string;
      home: string;
    }>;
  }, [awayTeamStats?.statistics, homeTeamStats?.statistics]);

  const playerTeams = detail?.boxscore?.players || [];
  const selectedPlayerTeam =
    playerTeams.find((team) => team.team?.id === statsTeamId) ||
    playerTeams[0];

  const statusText =
    competition?.status?.type?.shortDetail ||
    competition?.status?.type?.detail ||
    competition?.status?.type?.description ||
    (game.status === "post"
      ? "Final"
      : game.status === "in"
        ? "Live"
        : new Date(game.kickoffAt).toLocaleString([], {
            weekday: "short",
            hour: "numeric",
            minute: "2-digit",
          }));

  const favoriteAbbreviation =
    game.odds?.favoriteTeamId === game.awayTeam.id
      ? game.awayTeam.abbreviation
      : game.odds?.favoriteTeamId === game.homeTeam.id
        ? game.homeTeam.abbreviation
        : null;

  const lineText = [
    favoriteAbbreviation && game.odds?.spread != null
      ? `${favoriteAbbreviation} ${
          game.odds.spread > 0 ? "+" : ""
        }${game.odds.spread}`
      : "",
    game.odds?.overUnder != null
      ? `O/U ${game.odds.overUnder}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/55 p-0 sm:p-3"
      onClick={onClose}
    >
      <div
        className="mx-auto flex h-full max-h-none w-full max-w-3xl flex-col overflow-hidden bg-white shadow-xl sm:mt-4 sm:h-auto sm:max-h-[92vh] sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-black text-slate-900">
              {game.shortName || game.name}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="ml-3 text-2xl font-bold leading-none text-slate-500"
            aria-label="Close game center"
          >
            ×
          </button>
        </div>

        <div className="border-b border-slate-200 px-4 py-3">
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div className="min-w-0 text-center">
              {teamLogo(away?.team) ? (
                <img
                  src={teamLogo(away?.team)}
                  alt=""
                  className="mx-auto h-10 w-10 object-contain"
                />
              ) : null}
              <div className="mt-1 truncate text-xs font-black text-slate-900">
                {away?.rank ? `#${away.rank} ` : ""}
                {away?.team?.shortDisplayName ||
                  away?.team?.abbreviation ||
                  "Away"}
              </div>
              <div className="text-[11px] text-slate-500">
                {totalRecord(away)}
              </div>
            </div>

            <div className="min-w-[92px] text-center">
              <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {statusText}
              </div>

              {game.status === "pre" ? (
                <div className="mt-1 text-sm font-black text-slate-900">
                  {new Date(game.kickoffAt).toLocaleTimeString([], {
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              ) : (
                <div className="mt-1 flex items-center justify-center gap-2 text-3xl font-black text-slate-900">
                  <span>{away?.score ?? game.awayTeam.score ?? "—"}</span>
                  <span className="text-slate-300">-</span>
                  <span>{home?.score ?? game.homeTeam.score ?? "—"}</span>
                </div>
              )}

              {lineText ? (
                <div className="mt-1 whitespace-nowrap text-[11px] text-slate-500">
                  {lineText}
                </div>
              ) : null}
            </div>

            <div className="min-w-0 text-center">
              {teamLogo(home?.team) ? (
                <img
                  src={teamLogo(home?.team)}
                  alt=""
                  className="mx-auto h-10 w-10 object-contain"
                />
              ) : null}
              <div className="mt-1 truncate text-xs font-black text-slate-900">
                {home?.rank ? `#${home.rank} ` : ""}
                {home?.team?.shortDisplayName ||
                  home?.team?.abbreviation ||
                  "Home"}
              </div>
              <div className="text-[11px] text-slate-500">
                {totalRecord(home)}
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 border-b border-slate-200">
          {(["game", "stats"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`px-4 py-2.5 text-sm font-bold ${
                tab === value
                  ? "border-b-2 border-sky-500 text-sky-600"
                  : "text-slate-500"
              }`}
            >
              {value === "game" ? "Game" : "Stats"}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-center text-sm text-slate-500">
              Loading game details…
            </div>
          ) : error ? (
            <div className="p-4">
              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
                {error}
              </div>
            </div>
          ) : tab === "game" ? (
            <div className="space-y-5 p-4">
              {game.status === "pre" ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-black text-slate-900">
                    Matchup Preview
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    Pregame national team rankings and season player stats are
                    coming in the next phase.
                  </div>
                </div>
              ) : (
                <>
                  <section>
                    <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
                      Play-by-Play
                    </div>

                    {playsByQuarter.length ? (
                      <div className="space-y-3">
                        <div className="flex gap-2 overflow-x-auto pb-1">
                          {[...playsByQuarter]
                            .sort((a, b) => a.period - b.period)
                            .map(({ period }) => (
                              <button
                                key={period}
                                type="button"
                                onClick={() => setSelectedQuarter(period)}
                                className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-black ${
                                  selectedQuarter === period
                                    ? "border-sky-500 bg-sky-50 text-sky-700"
                                    : "border-slate-200 bg-white text-slate-500"
                                }`}
                              >
                                {period <= 4 ? `Q${period}` : `OT${period - 4}`}
                              </button>
                            ))}
                        </div>

                        <div>
                          <div className="mb-2 text-sm font-black text-slate-900">
                            {selectedQuarter
                              ? quarterLabel(selectedQuarter)
                              : ""}
                          </div>

                          <div className="overflow-hidden rounded-xl border border-slate-200">
                            {selectedQuarterPlays.map((play, index) => (
                              <div
                                key={`${play.id || "play"}-${selectedQuarter}-${index}`}
                                className={`border-b border-slate-100 px-3 py-2.5 last:border-b-0 ${
                                  play.scoringPlay
                                    ? "bg-amber-50"
                                    : "bg-white"
                                }`}
                              >
                                <div className="flex gap-3">
                                  <div className="w-11 shrink-0 text-xs font-black text-slate-500">
                                    {play.clock?.displayValue || ""}
                                  </div>

                                  <div className="min-w-0 flex-1">
                                    <div
                                      className={`text-sm leading-snug ${
                                        play.scoringPlay
                                          ? "font-bold text-slate-900"
                                          : "text-slate-700"
                                      }`}
                                    >
                                      {play.text || "Play"}
                                    </div>

                                    {play.scoringPlay ? (
                                      <div className="mt-1 text-xs font-black text-amber-700">
                                        {play.awayScore ?? 0} -{" "}
                                        {play.homeScore ?? 0}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                        Play-by-play is not available for this game.
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
                      Team Stats
                    </div>

                    {statRows.length ? (
                      <div className="overflow-hidden rounded-xl border border-slate-200">
                        <div className="grid grid-cols-[1fr_auto_1fr] bg-slate-50 px-3 py-2 text-xs font-black text-slate-500">
                          <div className="text-left">
                            {away?.team?.abbreviation || "Away"}
                          </div>
                          <div className="px-3 text-center">Stat</div>
                          <div className="text-right">
                            {home?.team?.abbreviation || "Home"}
                          </div>
                        </div>

                        {statRows.map((row) => (
                          <div
                            key={row.key}
                            className="grid grid-cols-[1fr_auto_1fr] items-center border-t border-slate-100 px-3 py-2 text-sm"
                          >
                            <div className="font-bold text-slate-900">
                              {row.away}
                            </div>
                            <div className="max-w-[160px] px-3 text-center text-xs text-slate-500">
                              {row.label}
                            </div>
                            <div className="text-right font-bold text-slate-900">
                              {row.home}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                        Team stats are not available for this game.
                      </div>
                    )}
                  </section>
                </>
              )}
            </div>
          ) : (
            <div className="space-y-4 p-4">
              {game.status === "pre" ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-black text-slate-900">
                    Season Player Stats
                  </div>
                  <div className="mt-1 text-sm text-slate-500">
                    Pregame season player stats are coming in the next phase.
                  </div>
                </div>
              ) : playerTeams.length ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    {playerTeams.map((team) => (
                      <button
                        key={team.team?.id || team.team?.abbreviation}
                        type="button"
                        onClick={() =>
                          setStatsTeamId(team.team?.id || "")
                        }
                        className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                          selectedPlayerTeam?.team?.id === team.team?.id
                            ? "border-sky-500 bg-sky-50 text-sky-700"
                            : "border-slate-200 bg-white text-slate-600"
                        }`}
                      >
                        {team.team?.shortDisplayName ||
                          team.team?.abbreviation ||
                          "Team"}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-4">
                    {(selectedPlayerTeam?.statistics || []).map(
                      (category, categoryIndex) => {
                        const labels = category.labels || [];
                        const athletes = category.athletes || [];

                        if (!athletes.length) return null;

                        return (
                          <section
                            key={
                              category.name ||
                              category.displayName ||
                              categoryIndex
                            }
                          >
                            <div className="mb-2 text-xs font-black uppercase tracking-wider text-slate-500">
                              {categoryTitle(category)}
                            </div>

                            <div className="overflow-x-auto rounded-xl border border-slate-200">
                              <table className="min-w-full text-xs">
                                <thead className="bg-slate-50 text-slate-500">
                                  <tr>
                                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-black">
                                      Player
                                    </th>
                                    {labels.map((label, index) => (
                                      <th
                                        key={`${label}-${index}`}
                                        className="whitespace-nowrap px-2 py-2 text-right font-black"
                                      >
                                        {label}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>

                                <tbody>
                                  {athletes.map((row, rowIndex) => (
                                    <tr
                                      key={
                                        row.athlete?.id ||
                                        `${categoryIndex}-${rowIndex}`
                                      }
                                      className="border-t border-slate-100"
                                    >
                                      <td className="sticky left-0 bg-white px-3 py-2">
                                        <div className="flex min-w-[135px] items-center gap-2">
                                          {row.athlete?.headshot?.href ? (
                                            <img
                                              src={
                                                row.athlete.headshot.href
                                              }
                                              alt=""
                                              className="h-7 w-7 rounded-full object-cover"
                                            />
                                          ) : (
                                            <div className="h-7 w-7 rounded-full bg-slate-100" />
                                          )}
                                          <span className="font-bold text-slate-900">
                                            {row.athlete?.shortName ||
                                              row.athlete?.displayName ||
                                              "Player"}
                                          </span>
                                        </div>
                                      </td>

                                      {(row.stats || []).map(
                                        (stat, statIndex) => (
                                          <td
                                            key={`${rowIndex}-${statIndex}`}
                                            className="whitespace-nowrap px-2 py-2 text-right font-medium text-slate-700"
                                          >
                                            {stat}
                                          </td>
                                        ),
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </section>
                        );
                      },
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Player stats are not available for this game.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
