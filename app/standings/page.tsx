"use client";

import AppNav from "@/components/AppNav";
import SeasonAwards from "@/components/home/SeasonAwards";
import TeamProfileModal from "@/components/TeamProfileModal";
import TeamAvatar from "@/components/ui/TeamAvatar";
import { useEffect, useMemo, useState } from "react";
import { useSelectedSport } from "@/components/providers/SportProvider";

type StandingRow = {
  season: number;
  team_id: number;
  name: string;
  wins: number;
  runner_ups: number;
  avg_finish: number | null;
  avg_score: number | null;
  high_score: number | null;
  low_score: number | null;
  slates_played: number;
};

type DraftPositionRow = {
  draft_order: number;
  wins: number;
  runner_ups: number;
  avg_finish: number | null;
  avg_score: number | null;
  slates_played: number;
};

type StandingsResponse = {
  success: boolean;
  selectedSeason: number | null;
  availableSeasons: number[];
  standings: StandingRow[];
  draftPositionResults: DraftPositionRow[];
};

type TeamStatsRow = {
  teamId: number;
  slateCount: number;
  pointsPerSlate: number;
  reboundsPerSlate: number;
  assistsPerSlate: number;
  stealsPerSlate: number;
  blocksPerSlate: number;
  turnoversPerSlate: number;
};

type SortKey =
  | "name"
  | "wins"
  | "runner_ups"
  | "avg_finish"
  | "avg_score"
  | "high_score"
  | "low_score"
  | "slates_played";

type TeamStatsSortKey =
  | "name"
  | "slateCount"
  | "pointsPerSlate"
  | "reboundsPerSlate"
  | "assistsPerSlate"
  | "stealsPerSlate"
  | "blocksPerSlate"
  | "turnoversPerSlate";

type SortDirection = "asc" | "desc";
type DetailTab = "team-style" | "draft-position" | "awards";

type SeasonAwardsResponse = {
  success: boolean;
  awards: Array<{
    title: string;
    emoji: string;
    winner: string;
    detail: string;
  }>;
  firstTeam: {
    guards: Array<{
      playerId: number;
      name: string;
      positionGroup: "G" | "F/C" | null;
      nbaPlayerId: number | null;
      games: number;
      avgFantasy: number;
    }>;
    frontcourt: Array<{
      playerId: number;
      name: string;
      positionGroup: "G" | "F/C" | null;
      nbaPlayerId: number | null;
      games: number;
      avgFantasy: number;
    }>;
  };
};

function formatNumber(value: number | null, digits = 2) {
  if (value === null || value === undefined) return "—";
  return value.toFixed(digits);
}

function compareValues(
  a: string | number | null,
  b: string | number | null,
  direction: SortDirection
) {
  const multiplier = direction === "asc" ? 1 : -1;

  if (typeof a === "string" && typeof b === "string") {
    return a.localeCompare(b) * multiplier;
  }

  const aValue = a === null ? Number.NEGATIVE_INFINITY : Number(a);
  const bValue = b === null ? Number.NEGATIVE_INFINITY : Number(b);

  if (aValue < bValue) return -1 * multiplier;
  if (aValue > bValue) return 1 * multiplier;
  return 0;
}

export default function StandingsPage() {
  const [standings, setStandings] = useState<StandingRow[]>([]);
  const [teamStats, setTeamStats] = useState<TeamStatsRow[]>([]);
  const [draftPositionResults, setDraftPositionResults] = useState<DraftPositionRow[]>([]);
  const [availableSeasons, setAvailableSeasons] = useState<number[]>([]);
  const [selectedSeason, setSelectedSeason] = useState<number | "all" | "">("");
  const { selectedSport } = useSelectedSport();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("wins");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [teamStatsSortKey, setTeamStatsSortKey] =
    useState<TeamStatsSortKey>("pointsPerSlate");
  const [teamStatsSortDirection, setTeamStatsSortDirection] =
    useState<SortDirection>("desc");
  const [profileTeam, setProfileTeam] = useState<{ id: number; name: string } | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<DetailTab>("team-style");
  const [seasonAwards, setSeasonAwards] = useState<SeasonAwardsResponse | null>(null);

  useEffect(() => {
    setSelectedSeason("");
    void loadStandings("", selectedSport);
  }, [selectedSport]);

  async function loadStandings(
    seasonOverride?: number | "all" | "",
    sportOverride?: string,
  ) {
    try {
      setIsLoading(true);
      setErrorMessage("");

      const seasonToUse =
        seasonOverride !== undefined ? seasonOverride : selectedSeason;
      const sportToUse =
        sportOverride !== undefined ? sportOverride : selectedSport;

      const url =
        seasonToUse === "" || seasonToUse === null
          ? `/api/standings?sport=${sportToUse}`
          : `/api/standings?season=${seasonToUse}&sport=${sportToUse}`;

      const response = await fetch(url);
      const result = (await response.json()) as StandingsResponse | { error?: string };

      if (!response.ok) {
        setErrorMessage(
          "error" in result && result.error
            ? result.error
            : "Failed to load standings."
        );
        return;
      }

      const safeResult = result as StandingsResponse;
      setStandings(safeResult.standings ?? []);
      setDraftPositionResults(safeResult.draftPositionResults ?? []);
      setAvailableSeasons(safeResult.availableSeasons ?? []);
      setSelectedSeason(safeResult.selectedSeason ?? "");

      const statsSeason = safeResult.selectedSeason ?? seasonToUse;
      setSeasonAwards(null);

      if (statsSeason !== "" && statsSeason !== null && statsSeason !== "all") {
        try {
          const awardsResponse = await fetch(`/api/season-awards?season=${statsSeason}&sport=${sportToUse}`);
          const awardsResult = await awardsResponse.json();

          if (awardsResponse.ok && awardsResult?.success) {
            setSeasonAwards(awardsResult);
          } else {
            setSeasonAwards(null);
          }
        } catch (awardsError) {
          console.error("Failed to load season awards", awardsError);
          setSeasonAwards(null);
        }


        try {
          const statsResponse = await fetch(`/api/team-stats?season=${statsSeason}&sport=${sportToUse}`);
          const statsResult = await statsResponse.json();

          if (statsResponse.ok) {
            setTeamStats(statsResult.teams ?? []);
          } else {
            setTeamStats([]);
          }
        } catch (statsError) {
          console.error("Failed to load team stats", statsError);
          setTeamStats([]);
        }
      } else {
        setTeamStats([]);
        setSeasonAwards(null);
      }
    } catch (error) {
      console.error(error);
      setErrorMessage("Something went wrong while loading standings.");
    } finally {
      setIsLoading(false);
    }
  }

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setSortKey(nextKey);
    setSortDirection(nextKey === "name" ? "asc" : "desc");
  }

  function getSortArrow(key: SortKey) {
    if (sortKey !== key) return "";
    return sortDirection === "asc" ? " ↑" : " ↓";
  }

  function handleTeamStatsSort(nextKey: TeamStatsSortKey) {
    if (teamStatsSortKey === nextKey) {
      setTeamStatsSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }

    setTeamStatsSortKey(nextKey);
    setTeamStatsSortDirection(nextKey === "name" ? "asc" : "desc");
  }

  function getTeamStatsSortArrow(key: TeamStatsSortKey) {
    if (teamStatsSortKey !== key) return "";
    return teamStatsSortDirection === "asc" ? " ↑" : " ↓";
  }

  const sortedStandings = useMemo(() => {
    const copy = [...standings];
    copy.sort((a, b) => compareValues(a[sortKey], b[sortKey], sortDirection));
    return copy;
  }, [standings, sortKey, sortDirection]);

  const teamStatsWithNames = useMemo(() => {
    const nameMap = new Map(standings.map((row) => [row.team_id, row.name]));

    const rows = teamStats.map((row) => ({
      ...row,
      name: nameMap.get(row.teamId) ?? `Team ${row.teamId}`,
    }));

    rows.sort((a, b) =>
      compareValues(
        a[teamStatsSortKey] as string | number | null,
        b[teamStatsSortKey] as string | number | null,
        teamStatsSortDirection
      )
    );

    return rows;
  }, [teamStats, standings, teamStatsSortKey, teamStatsSortDirection]);

  const headerButtonClass =
    "standings-header-button font-semibold transition";

  function getStandingRankLabel(index: number) {
    const isDefaultStandingsOrder =
      sortKey === "wins" && sortDirection === "desc";

    if (!isDefaultStandingsOrder) {
      return `${index + 1}.`;
    }

    if (index === 0) return "🥇";
    if (index === 1) return "🥈";
    if (index === 2) return "🥉";

    return `${index + 1}.`;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Standings</h1>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label
                  htmlFor="season-select"
                  className="mb-1 block text-xs font-medium text-slate-600"
                >
                  Season
                </label>
                <select
                  id="season-select"
                  value={selectedSeason}
                  onChange={async (e) => {
                    const nextValue =
                      e.target.value === "all"
                        ? "all"
                        : e.target.value
                          ? Number(e.target.value)
                          : "";
                    setSelectedSeason(nextValue);
                    await loadStandings(nextValue);
                  }}
                  className="min-w-[140px] rounded-xl border border-slate-200 bg-white px-3 py-3.5 text-sm text-slate-800 outline-none transition focus:border-sky-300"
                >
                  <option value="all">All-Time</option>
                  {availableSeasons.map((season) => (
                    <option key={season} value={season}>
                      {season}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={() => void loadStandings()}
                className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-2.5 text-sm font-medium text-sky-900 transition hover:bg-sky-200"
              >
                Refresh Standings
              </button>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 shadow-sm">
            {errorMessage}
          </div>
        ) : null}

        <section className="standings-panel rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          {isLoading ? (
            <div className="px-2 py-6 text-sm text-slate-600">Loading standings...</div>
          ) : sortedStandings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No season summary data found for this season.
            </div>
          ) : (
            <div className="standings-table-shell overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="standings-table min-w-full table-fixed border-collapse text-sm">
                  <thead className="standings-table-head bg-slate-100 text-slate-700">
                    <tr className="text-left">
                      <th className="w-[7%] px-2 py-3 text-center">
                        Rank
                      </th>

                      <th className="w-[21%] px-3 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("name")}>
                          Team{getSortArrow("name")}
                        </button>
                      </th>
                      <th className="w-[12%] px-2 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("wins")}>
                          Wins{getSortArrow("wins")}
                        </button>
                      </th>
                      <th className="w-[12%] px-2 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("runner_ups")}>
                          Runner-ups{getSortArrow("runner_ups")}
                        </button>
                      </th>
                      <th className="w-[12%] px-2 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("avg_finish")}>
                          Avg Finish{getSortArrow("avg_finish")}
                        </button>
                      </th>
                      <th className="w-[12%] px-2 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("avg_score")}>
                          Avg Score{getSortArrow("avg_score")}
                        </button>
                      </th>
                      <th className="w-[12%] px-2 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("high_score")}>
                          High Score{getSortArrow("high_score")}
                        </button>
                      </th>
                      <th className="w-[12%] px-2 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("low_score")}>
                          Low Score{getSortArrow("low_score")}
                        </button>
                      </th>
                      <th className="w-[12%] px-2 py-3">
                        <button className={headerButtonClass} onClick={() => handleSort("slates_played")}>
                          Slates Played{getSortArrow("slates_played")}
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="standings-table-body bg-white text-slate-800">
                    {sortedStandings.map((row, index) => (
                      <tr
                        key={`${row.season}-${row.team_id}`}
                        className={`standings-table-row border-t border-slate-100 ${
                          index === 0
                            ? "standings-table-row--leader bg-orange-50/50"
                            : ""
                        }`}
                      >
                        <td className="standings-rank-cell px-2 py-3 text-center">
                          {getStandingRankLabel(index)}
                        </td>

                        <td className="px-3 py-3 font-medium">
                          <button
                            type="button"
                            onClick={() =>
                              setProfileTeam({
                                id: row.team_id,
                                name: row.name,
                              })
                            }
                            className="standings-team-button"
                            aria-label={`Open ${row.name} team profile`}
                          >
                            <TeamAvatar
                              teamName={row.name}
                              size="sm"
                            />

                            <span>{row.name}</span>
                          </button>
                        </td>

                        <td className="standings-number-cell px-2 py-3">{row.wins}</td>
                        <td className="standings-number-cell px-2 py-3">{row.runner_ups}</td>
                        <td className="standings-number-cell px-2 py-3">
                          {formatNumber(row.avg_finish, 2)}
                        </td>
                        <td className="standings-number-cell px-2 py-3">
                          {formatNumber(row.avg_score, 2)}
                        </td>
                        <td className="standings-number-cell px-2 py-3">
                          {formatNumber(row.high_score, 2)}
                        </td>
                        <td className="standings-number-cell px-2 py-3">
                          {formatNumber(row.low_score, 2)}
                        </td>
                        <td className="standings-number-cell px-2 py-3">
                          {row.slates_played}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
        <section className="standings-panel rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 overflow-x-auto">
            <div className="standings-detail-tabs inline-flex min-w-full gap-2 rounded-2xl bg-slate-100 p-1 sm:min-w-0">
              {[
                { id: "team-style", label: "Team Style" },
                { id: "draft-position", label: "Draft Position" },
                { id: "awards", label: "Awards" },
              ].map((tab) => {
                const isActive = activeDetailTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveDetailTab(tab.id as DetailTab)}
                    className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? "standings-detail-tab--active bg-white text-sky-900 shadow-sm"
                        : "standings-detail-tab text-slate-600 hover:bg-white/70 hover:text-slate-900"
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {activeDetailTab === "team-style" ? (
            <section>
              <div className="mb-3">
                <h2 className="text-xl font-semibold text-slate-900">
                  Team Style
                </h2>
                <p className="text-sm text-slate-600">
                  Per-slate averages from slates with tracked player box-score data.
                </p>
              </div>

              {selectedSeason === "all" ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
                  <div className="text-4xl">📊</div>

                  <h2 className="mt-4 text-xl font-semibold text-slate-900">
                    Select a Season
                  </h2>

                  <p className="mt-2 text-sm text-slate-600">
                    Team Style, Draft Position, and Awards are shown by individual season.
                  </p>
                </div>
              ) : teamStatsWithNames.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                  No team stats available for this season.
                </div>
              ) : (
                <div className="standings-table-shell overflow-hidden rounded-2xl border border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="standings-table standings-team-style-table min-w-full table-fixed border-collapse text-sm">
                      <thead className="standings-table-head bg-slate-100 text-slate-700">
                        <tr className="text-left">
                          <th className="w-[16%] px-3 py-3">
                            <button className={headerButtonClass} onClick={() => handleTeamStatsSort("name")}>
                              Team{getTeamStatsSortArrow("name")}
                            </button>
                          </th>
                          <th className="w-[12%] px-3 py-3 text-right">
                            <button className={headerButtonClass} onClick={() => handleTeamStatsSort("slateCount")}>
                              Slates{getTeamStatsSortArrow("slateCount")}
                            </button>
                          </th>
                          <th className="w-[12%] px-3 py-3 text-right">
                            <button className={headerButtonClass} onClick={() => handleTeamStatsSort("pointsPerSlate")}>
                              PTS{getTeamStatsSortArrow("pointsPerSlate")}
                            </button>
                          </th>
                          <th className="w-[12%] px-3 py-3 text-right">
                            <button className={headerButtonClass} onClick={() => handleTeamStatsSort("reboundsPerSlate")}>
                              REB{getTeamStatsSortArrow("reboundsPerSlate")}
                            </button>
                          </th>
                          <th className="w-[12%] px-3 py-3 text-right">
                            <button className={headerButtonClass} onClick={() => handleTeamStatsSort("assistsPerSlate")}>
                              AST{getTeamStatsSortArrow("assistsPerSlate")}
                            </button>
                          </th>
                          <th className="w-[12%] px-3 py-3 text-right">
                            <button className={headerButtonClass} onClick={() => handleTeamStatsSort("stealsPerSlate")}>
                              STL{getTeamStatsSortArrow("stealsPerSlate")}
                            </button>
                          </th>
                          <th className="w-[12%] px-3 py-3 text-right">
                            <button className={headerButtonClass} onClick={() => handleTeamStatsSort("blocksPerSlate")}>
                              BLK{getTeamStatsSortArrow("blocksPerSlate")}
                            </button>
                          </th>
                          <th className="w-[12%] px-3 py-3 text-right">
                            <button className={headerButtonClass} onClick={() => handleTeamStatsSort("turnoversPerSlate")}>
                              TO{getTeamStatsSortArrow("turnoversPerSlate")}
                            </button>
                          </th>
                        </tr>
                      </thead>
                      <tbody className="standings-table-body bg-white text-slate-800">
                        {teamStatsWithNames.map((row) => (
                          <tr
                            key={row.teamId}
                            className="standings-table-row border-t border-slate-100"
                          >
                            <td className="px-3 py-3 font-medium">
                              <button
                                type="button"
                                onClick={() =>
                                  setProfileTeam({
                                    id: row.teamId,
                                    name: row.name,
                                  })
                                }
                                className="standings-team-button"
                                aria-label={`Open ${row.name} team profile`}
                              >
                                <TeamAvatar
                                  teamName={row.name}
                                  size="sm"
                                />

                                <span>{row.name}</span>
                              </button>
                            </td>

                            <td className="standings-number-cell px-3 py-3 text-right">
                              {row.slateCount}
                            </td>
                            <td className="standings-number-cell px-3 py-3 text-right">
                              {row.pointsPerSlate}
                            </td>
                            <td className="standings-number-cell px-3 py-3 text-right">
                              {row.reboundsPerSlate}
                            </td>
                            <td className="standings-number-cell px-3 py-3 text-right">
                              {row.assistsPerSlate}
                            </td>
                            <td className="standings-number-cell px-3 py-3 text-right">
                              {row.stealsPerSlate}
                            </td>
                            <td className="standings-number-cell px-3 py-3 text-right">
                              {row.blocksPerSlate}
                            </td>
                            <td className="standings-number-cell px-3 py-3 text-right">
                              {row.turnoversPerSlate}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          {activeDetailTab === "draft-position" ? (
            <section>
              <div className="mb-4">
                <h2 className="text-xl font-semibold tracking-tight">Draft Position</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Based on slates with saved draft order data. Early backfilled slates without draft order are excluded.
                </p>
              </div>

              {selectedSeason === "all" ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
                  <div className="text-4xl">📊</div>

                  <h2 className="mt-4 text-xl font-semibold text-slate-900">
                    Select a Season
                  </h2>

                  <p className="mt-2 text-sm text-slate-600">
                    Team Style, Draft Position, and Awards are shown by individual season.
                  </p>
                </div>
              ) : selectedSeason !== 2026 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
                  <div className="text-4xl">🎲</div>

                  <h2 className="mt-4 text-xl font-semibold text-slate-900">
                    No Draft Position Data Yet
                  </h2>

                  <p className="mt-2 text-sm text-slate-600">
                    Draft position tracking starts with the 2026 season.
                  </p>
                </div>
              ) : draftPositionResults.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                  No draft position data available yet.
                </div>
              ) : (
                <div className="standings-table-shell overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="standings-table min-w-full text-left text-sm">
                    <thead className="standings-table-head bg-slate-100 text-slate-700">
                      <tr>
                        <th className="px-4 py-3">Draft Slot</th>
                        <th className="px-4 py-3">Wins</th>
                        <th className="px-4 py-3">Runner-ups</th>
                        <th className="px-4 py-3">Avg Finish</th>
                        <th className="px-4 py-3">Avg Score</th>
                        <th className="px-4 py-3">Tracked Slates</th>
                      </tr>
                    </thead>

                    <tbody className="standings-table-body bg-white text-slate-800">
                      {draftPositionResults.map((row) => (
                        <tr
                          key={row.draft_order}
                          className="standings-table-row border-t border-slate-100"
                        >
                          <td className="px-4 py-3 font-semibold">#{row.draft_order}</td>
                          <td className="px-4 py-3">{row.wins}</td>
                          <td className="px-4 py-3">{row.runner_ups}</td>
                          <td className="px-4 py-3">{formatNumber(row.avg_finish)}</td>
                          <td className="px-4 py-3">{formatNumber(row.avg_score)}</td>
                          <td className="px-4 py-3">{row.slates_played}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {activeDetailTab === "awards" ? (
            selectedSeason === "all" ? (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
                <div className="text-4xl">📊</div>

                <h2 className="mt-4 text-xl font-semibold text-slate-900">
                  Select a Season
                </h2>

                <p className="mt-2 text-sm text-slate-600">
                  Team Style, Draft Position, and Awards are shown by individual season.
                </p>
              </div>
            ) : seasonAwards && seasonAwards.awards.length > 0 ? (
              <SeasonAwards
                season={selectedSeason}
                awards={seasonAwards.awards}
                guards={seasonAwards.firstTeam.guards}
                frontcourt={seasonAwards.firstTeam.frontcourt}
              />
            ) : (
              <div className="rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-10 text-center">
                <div className="text-4xl">🏆</div>

                <h2 className="mt-4 text-xl font-semibold text-slate-900">
                  No Season Awards Yet
                </h2>

                <p className="mt-2 text-sm text-slate-600">
                  Awards and the All-111 First Team are published after the playoffs conclude.
                </p>
              </div>
            )
          ) : null}
        </section>

      </div>

      <TeamProfileModal team={profileTeam} setTeam={setProfileTeam} />
    </main>
  );
}
