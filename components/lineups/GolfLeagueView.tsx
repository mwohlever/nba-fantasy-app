"use client";

import { useMemo, useState } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type {
  OrderedTeam,
  Player,
  PlayerStat,
} from "@/components/lineups/types";

type Props = {
  teams: OrderedTeam[];
  getPlayersForTeam: (teamId: number) => Player[];
  getRawPlayerStat: (playerId: number) => PlayerStat | null;
  setProfilePlayer: (player: Player | null) => void;
};

type LeagueGolferRow = {
  player: Player;
  team: OrderedTeam;
  stat: PlayerStat | null;
  playingRound: NonNullable<PlayerStat["rounds"]>[number] | null;
  upcomingRound: NonNullable<PlayerStat["rounds"]>[number] | null;
  mostRecentRound: NonNullable<PlayerStat["rounds"]>[number] | null;
  displayRound: NonNullable<PlayerStat["rounds"]>[number] | null;
  groupOrder: number;
  sortValue: number;
};

type LeagueSort =
  | "score"
  | "tee_time"
  | "name";

type LeagueGroup = "none" | "team";

type LeagueStatusFilter =
  | "all"
  | "playing"
  | "upcoming"
  | "round_complete"
  | "finished";

type LeagueRoundView =
  | "current"
  | "1"
  | "2"
  | "3"
  | "4";

function formatGolfScore(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return "—";
  if (numeric === 0) return "E";

  return numeric > 0 ? `+${numeric}` : String(numeric);
}

function formatPosition(value: number | null | undefined) {
  if (!value) return "—";
  return `T${value}`;
}

function formatTeeTime(value: string | null | undefined) {
  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function relativeLabel(relative: number | null | undefined) {
  if (relative === null || relative === undefined) return "—";
  if (relative === 0) return "E";

  return relative > 0
    ? `+${relative}`
    : String(relative);
}

function relativeClass(relative: number | null | undefined) {
  if (relative === null || relative === undefined) {
    return "border-slate-700 bg-slate-950 text-slate-500";
  }

  if (relative <= -2) {
    return "border-emerald-500 bg-emerald-600 text-white";
  }

  if (relative === -1) {
    return "border-emerald-500 bg-emerald-950 text-emerald-200";
  }

  if (relative === 0) {
    return "border-slate-600 bg-slate-800 text-slate-100";
  }

  if (relative === 1) {
    return "border-red-700 bg-red-950 text-red-200";
  }

  return "border-red-500 bg-red-700 text-white";
}

function holePar(
  hole:
    | {
        par?: number | null;
        strokes: number | null;
        relative_to_par: number | null;
      }
    | null
    | undefined,
) {
  if (
    hole?.par !== null &&
    hole?.par !== undefined &&
    Number.isFinite(Number(hole.par))
  ) {
    return Number(hole.par);
  }

  if (
    hole?.strokes === null ||
    hole?.strokes === undefined ||
    hole.relative_to_par === null ||
    hole.relative_to_par === undefined
  ) {
    return null;
  }

  const par =
    Number(hole.strokes) -
    Number(hole.relative_to_par);

  return Number.isFinite(par) ? par : null;
}

function resultName(relative: number | null | undefined) {
  if (relative === null || relative === undefined) {
    return "Not played";
  }

  if (relative <= -3) return "Albatross or better";
  if (relative === -2) return "Eagle";
  if (relative === -1) return "Birdie";
  if (relative === 0) return "Par";
  if (relative === 1) return "Bogey";
  if (relative === 2) return "Double bogey";

  return `+${relative}`;
}

function statusMeta(row: LeagueGolferRow) {
  const status = row.stat?.status ?? "scheduled";

  if (row.playingRound) {
    return {
      label: "🟢 Playing",
      detail:
        `R${row.playingRound.round_number} · ` +
        `Thru ${row.playingRound.holes_completed}`,
      className:
        "border-emerald-700 bg-emerald-950 text-emerald-200",
      section: "Playing now",
    };
  }

  if (status === "cut") {
    return {
      label: "✂ Cut",
      detail: "Missed cut",
      className:
        "border-red-800 bg-red-950 text-red-200",
      section: "Finished",
    };
  }

  if (status === "withdrawn") {
    return {
      label: "⚠ WD",
      detail: "Withdrawn",
      className:
        "border-amber-700 bg-amber-950 text-amber-200",
      section: "Finished",
    };
  }

  if (status === "disqualified") {
    return {
      label: "⛔ DQ",
      detail: "Disqualified",
      className:
        "border-red-800 bg-red-950 text-red-200",
      section: "Finished",
    };
  }

  if (status === "finished") {
    return {
      label: "✓ Final",
      detail: "Tournament complete",
      className:
        "border-slate-600 bg-slate-800 text-slate-200",
      section: "Finished",
    };
  }

  if (row.upcomingRound) {
    const teeTime = formatTeeTime(
      row.upcomingRound.tee_time ??
        row.upcomingRound.tee_time_raw,
    );

    return {
      label: "⏰ Upcoming",
      detail:
        `R${row.upcomingRound.round_number}` +
        (teeTime ? ` · ${teeTime}` : ""),
      className:
        "border-sky-700 bg-sky-950 text-sky-200",
      section: "Upcoming",
    };
  }

  if (row.mostRecentRound?.holes_completed === 18) {
    return {
      label: "✓ Round complete",
      detail: `Round ${row.mostRecentRound.round_number}`,
      className:
        "border-slate-600 bg-slate-800 text-slate-200",
      section: "Round complete",
    };
  }

  return {
    label: "⏰ Upcoming",
    detail:
      formatTeeTime(
        row.stat?.tee_time ??
          row.stat?.tee_time_raw,
      ) ?? "Not started",
    className:
      "border-sky-700 bg-sky-950 text-sky-200",
    section: "Upcoming",
  };
}

function scorecardContext(row: LeagueGolferRow) {
  if (row.playingRound) return "Current round";
  if (row.mostRecentRound) return "Most recent round";
  if (row.upcomingRound) return "Upcoming round";

  return "Round";
}

export default function GolfLeagueView({
  teams,
  getPlayersForTeam,
  getRawPlayerStat,
  setProfilePlayer,
}: Props) {
  const [selectedHoleKey, setSelectedHoleKey] =
    useState<string | null>(null);

  const [sortBy, setSortBy] =
    useState<LeagueSort>("score");

  const [groupBy, setGroupBy] =
    useState<LeagueGroup>("none");

  const [statusFilter, setStatusFilter] =
    useState<LeagueStatusFilter>("all");

  const [roundView, setRoundView] =
    useState<LeagueRoundView>("current");

  const [mobileControlsOpen, setMobileControlsOpen] =
    useState(false);

  const clearControls = () => {
    setSortBy("score");
    setGroupBy("none");
    setStatusFilter("all");
    setRoundView("current");
  };

  const hasCustomControls =
    sortBy !== "score" ||
    groupBy !== "none" ||
    statusFilter !== "all" ||
    roundView !== "current";

  const draftedGolferCount = useMemo(
    () =>
      teams
        .filter(
          (team) =>
            team.is_participating !== false,
        )
        .reduce(
          (total, team) =>
            total +
            getPlayersForTeam(team.id).length,
          0,
        ),
    [teams, getPlayersForTeam],
  );

  const rows = useMemo<LeagueGolferRow[]>(() => {
    const allRows = teams
      .filter(
        (team) =>
          team.is_participating !== false,
      )
      .flatMap((team) =>
        getPlayersForTeam(team.id).map((player) => {
          const stat = getRawPlayerStat(player.id);

          const rounds = [...(stat?.rounds ?? [])].sort(
            (a, b) =>
              a.round_number - b.round_number,
          );

          const playingRound =
            rounds
              .filter(
                (round) =>
                  round.holes_completed > 0 &&
                  round.holes_completed < 18,
              )
              .at(-1) ?? null;

          const upcomingRound =
            rounds.find(
              (round) =>
                round.holes_completed === 0 &&
                round.strokes === null &&
                Boolean(
                  round.tee_time ||
                    round.tee_time_raw,
                ),
            ) ?? null;

          const mostRecentRound =
            rounds
              .filter(
                (round) =>
                  round.holes_completed > 0 ||
                  round.strokes !== null,
              )
              .at(-1) ?? null;

          const selectedRoundNumber =
            roundView === "current"
              ? null
              : Number(roundView);

          const specificallySelectedRound =
            selectedRoundNumber === null
              ? null
              : rounds.find(
                  (round) =>
                    round.round_number ===
                    selectedRoundNumber,
                ) ?? null;

          const displayRound =
            selectedRoundNumber !== null
              ? specificallySelectedRound
              : playingRound ??
                mostRecentRound ??
                upcomingRound ??
                rounds[0] ??
                null;

          const rawStatus =
            stat?.status ?? "scheduled";

          let groupOrder = 2;
          let sortValue = Number(
            stat?.fantasy_points ?? 999,
          );

          if (playingRound) {
            groupOrder = 0;
            sortValue =
              -Number(
                playingRound.holes_completed ?? 0,
              );
          } else if (upcomingRound) {
            groupOrder = 1;

            const parsed = new Date(
              upcomingRound.tee_time ??
                upcomingRound.tee_time_raw ??
                "",
            ).getTime();

            sortValue = Number.isFinite(parsed)
              ? parsed
              : Number.MAX_SAFE_INTEGER;
          } else if (
            [
              "cut",
              "withdrawn",
              "disqualified",
              "finished",
            ].includes(rawStatus)
          ) {
            groupOrder = 3;
          }

          return {
            player,
            team,
            stat,
            playingRound,
            upcomingRound,
            mostRecentRound,
            displayRound,
            groupOrder,
            sortValue,
          };
        }),
      );

    const filteredRows = allRows.filter((row) => {
      if (statusFilter === "all") {
        return true;
      }

      const rawStatus =
        row.stat?.status ?? "scheduled";

      if (statusFilter === "playing") {
        return row.playingRound !== null;
      }

      if (statusFilter === "upcoming") {
        return (
          row.playingRound === null &&
          row.upcomingRound !== null
        );
      }

      if (statusFilter === "round_complete") {
        return (
          row.playingRound === null &&
          row.upcomingRound === null &&
          row.mostRecentRound?.holes_completed === 18 &&
          ![
            "cut",
            "withdrawn",
            "disqualified",
            "finished",
          ].includes(rawStatus)
        );
      }

      return [
        "cut",
        "withdrawn",
        "disqualified",
        "finished",
      ].includes(rawStatus);
    });

    function compareRows(
      a: LeagueGolferRow,
      b: LeagueGolferRow,
    ) {
      if (sortBy === "name") {
        return a.player.name.localeCompare(
          b.player.name,
        );
      }

      if (sortBy === "tee_time") {
        const aTime = new Date(
          a.upcomingRound?.tee_time ??
            a.upcomingRound?.tee_time_raw ??
            a.stat?.tee_time ??
            a.stat?.tee_time_raw ??
            "",
        ).getTime();

        const bTime = new Date(
          b.upcomingRound?.tee_time ??
            b.upcomingRound?.tee_time_raw ??
            b.stat?.tee_time ??
            b.stat?.tee_time_raw ??
            "",
        ).getTime();

        const aValue = Number.isFinite(aTime)
          ? aTime
          : Number.MAX_SAFE_INTEGER;

        const bValue = Number.isFinite(bTime)
          ? bTime
          : Number.MAX_SAFE_INTEGER;

        if (aValue !== bValue) {
          return aValue - bValue;
        }
      }

      if (sortBy === "score") {
        const aValue = Number(
          a.stat?.fantasy_points ??
            Number.MAX_SAFE_INTEGER,
        );

        const bValue = Number(
          b.stat?.fantasy_points ??
            Number.MAX_SAFE_INTEGER,
        );

        if (aValue !== bValue) {
          return aValue - bValue;
        }
      }

      const positionDifference =
        Number(
          a.stat?.leaderboard_order ??
            Number.MAX_SAFE_INTEGER,
        ) -
        Number(
          b.stat?.leaderboard_order ??
            Number.MAX_SAFE_INTEGER,
        );

      if (positionDifference !== 0) {
        return positionDifference;
      }

      return a.player.name.localeCompare(
        b.player.name,
      );
    }

    return [...filteredRows].sort((a, b) => {
      if (groupBy === "team") {
        const draftDifference =
          Number(
            a.team.draft_order ??
              Number.MAX_SAFE_INTEGER,
          ) -
          Number(
            b.team.draft_order ??
              Number.MAX_SAFE_INTEGER,
          );

        if (draftDifference !== 0) {
          return draftDifference;
        }

        const teamDifference =
          a.team.name.localeCompare(
            b.team.name,
          );

        if (teamDifference !== 0) {
          return teamDifference;
        }
      }

      return compareRows(a, b);
    });
  }, [
    teams,
    getPlayersForTeam,
    getRawPlayerStat,
    sortBy,
    groupBy,
    statusFilter,
    roundView,
  ]);

  if (draftedGolferCount === 0) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center text-slate-400">
        No drafted golfers are available.
      </section>
    );
  }

  let previousSection: string | null = null;

  return (
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-sm">
      <header className="border-b border-slate-800 bg-gradient-to-r from-emerald-950 to-slate-950 px-5 py-5 text-white">
        <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
          League view
        </span>

        <h3 className="mt-1 text-2xl font-black">
          Every Drafted Golfer
        </h3>

        <p className="mt-2 text-sm text-slate-300">
          All fantasy golfers and scorecards in one continuous view.
        </p>
      </header>

      <div className="border-b border-slate-800 bg-slate-900 p-3">
        <div className="flex items-center justify-between gap-3 sm:hidden">
          <button
            type="button"
            onClick={() =>
              setMobileControlsOpen(
                (current) => !current,
              )
            }
            aria-expanded={mobileControlsOpen}
            className="flex min-w-0 flex-1 items-center justify-between rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-left text-sm font-bold text-white"
          >
            <span>
              Sort & filter
              {hasCustomControls ? (
                <span className="ml-2 rounded-full bg-emerald-800 px-2 py-0.5 text-[9px] uppercase text-emerald-100">
                  Active
                </span>
              ) : null}
            </span>

            <span aria-hidden="true">
              {mobileControlsOpen ? "▲" : "▼"}
            </span>
          </button>

          {hasCustomControls ? (
            <button
              type="button"
              onClick={clearControls}
              className="shrink-0 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-xs font-bold text-slate-300"
            >
              Clear
            </button>
          ) : null}
        </div>

        <div
          className={`${
            mobileControlsOpen
              ? "mt-3 grid"
              : "hidden"
          } gap-2 sm:grid sm:grid-cols-4`}
        >
          <label className="block">
            <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">
              Round
            </span>

            <select
              value={roundView}
              onChange={(event) => {
                setRoundView(
                  event.target.value as LeagueRoundView,
                );

                setSelectedHoleKey(null);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white"
            >
              <option value="current">
                Current / most recent
              </option>

              <option value="1">
                Round 1
              </option>

              <option value="2">
                Round 2
              </option>

              <option value="3">
                Round 3
              </option>

              <option value="4">
                Round 4
              </option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">
              Sort by
            </span>

            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(
                  event.target.value as LeagueSort,
                )
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white"
            >
              <option value="score">
                Total score
              </option>

              <option value="tee_time">
                Tee time
              </option>

              <option value="name">
                Golfer name
              </option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">
              Group by
            </span>

            <select
              value={groupBy}
              onChange={(event) =>
                setGroupBy(
                  event.target.value as LeagueGroup,
                )
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white"
            >
              <option value="none">
                None
              </option>

              <option value="team">
                Fantasy team
              </option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[9px] font-black uppercase tracking-wider text-slate-500">
              Status
            </span>

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target
                    .value as LeagueStatusFilter,
                )
              }
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm font-semibold text-white"
            >
              <option value="all">
                All golfers
              </option>

              <option value="playing">
                Playing now
              </option>

              <option value="upcoming">
                Upcoming
              </option>

              <option value="round_complete">
                Round complete
              </option>

              <option value="finished">
                Finished / cut
              </option>
            </select>
          </label>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-slate-500">
          <span>
            Showing{" "}
            <strong className="text-slate-300">
              {rows.length}
            </strong>{" "}
            of{" "}
            <strong className="text-slate-300">
              {draftedGolferCount}
            </strong>{" "}
            drafted golfers
          </span>

          <div className="flex items-center gap-3">
            <span>
              {roundView === "current"
                ? "Current / most recent round"
                : `Viewing Round ${roundView}`}
              {" · "}
              {groupBy === "team"
                ? "Grouped by fantasy team"
                : sortBy === "score"
                  ? "Sorted by total score"
                  : sortBy === "tee_time"
                    ? "Sorted by tee time"
                    : "Sorted by golfer name"}
            </span>

            {hasCustomControls ? (
              <button
                type="button"
                onClick={clearControls}
                className="hidden font-bold text-emerald-400 hover:text-emerald-300 sm:inline"
              >
                Clear filters
              </button>
            ) : null}
          </div>
        </div>
      </div>

      <div className="divide-y divide-slate-800">
        {rows.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="text-3xl" aria-hidden="true">
              ⛳
            </div>

            <h4 className="mt-3 text-base font-black text-white">
              No golfers match this filter
            </h4>

            <p className="mt-1 text-sm text-slate-500">
              Nobody is currently in the selected status.
            </p>

            <button
              type="button"
              onClick={clearControls}
              className="mt-4 rounded-xl border border-emerald-700 bg-emerald-950 px-4 py-2.5 text-sm font-bold text-emerald-200 transition hover:bg-emerald-900"
            >
              Show all drafted golfers
            </button>
          </div>
        ) : null}

        {rows.map((row) => {
          const status = statusMeta(row);

          const sectionLabel =
            groupBy === "team"
              ? row.team.name
              : statusFilter === "all"
                ? status.section
                : null;

          const showSection =
            sectionLabel !== null &&
            sectionLabel !== previousSection;

          previousSection = sectionLabel;

          const holesByNumber = new Map(
            (row.displayRound?.holes ?? []).map(
              (hole) => [
                hole.hole_number,
                hole,
              ],
            ),
          );

          const context =
            roundView === "current"
              ? scorecardContext(row)
              : "Selected round";

          const displayedRoundNumber =
            row.displayRound?.round_number ??
            (roundView === "current"
              ? null
              : Number(roundView));

          return (
            <div key={row.player.id}>
              {showSection ? (
                <div className="sticky top-0 z-10 border-y border-slate-800 bg-slate-900/95 px-4 py-2 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-300 backdrop-blur">
                  {sectionLabel}
                </div>
              ) : null}

              <article className="bg-slate-950">
                <button
                  type="button"
                  onClick={() =>
                    setProfilePlayer(row.player)
                  }
                  className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition hover:bg-slate-900"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <PlayerHeadshot
                      espnGolfPlayerId={
                        row.player.espn_player_id
                      }
                      imageUrl={
                        row.player.headshot_url
                      }
                      playerName={row.player.name}
                      size="md"
                    />

                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <strong className="truncate text-base text-white">
                          {row.player.name}
                        </strong>

                        <span
                          className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                        <span className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-slate-200">
                          <TeamAvatar
                            teamName={row.team.name}
                            size="xs"
                          />
                          {row.team.name}
                        </span>

                        <span>{status.detail}</span>

                        <span>
                          Position{" "}
                          {formatPosition(
                            row.stat?.leaderboard_order,
                          )}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="shrink-0 text-right">
                    <span className="block text-[9px] font-bold uppercase text-emerald-400">
                      Total
                    </span>

                    <strong className="block text-2xl font-black text-white">
                      {formatGolfScore(
                        row.stat?.fantasy_points,
                      )}
                    </strong>
                  </div>
                </button>

                <div className="border-t border-slate-800 bg-slate-900/40 px-4 py-3">
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-500">
                        {context}
                      </span>

                      <strong className="ml-2 text-xs text-slate-200">
                        {displayedRoundNumber !== null
                          ? `R${displayedRoundNumber}`
                          : "Not started"}
                      </strong>
                    </div>

                    {row.displayRound ? (
                      <strong className="text-sm text-white">
                        {formatGolfScore(
                          row.displayRound.score_to_par,
                        )}
                      </strong>
                    ) : roundView !== "current" ? (
                      <span className="text-[11px] font-semibold text-slate-500">
                        No scorecard
                      </span>
                    ) : null}
                  </div>

                  <div
                    className={`overflow-x-auto ${
                      selectedHoleKey?.startsWith(
                        `${row.player.id}:${row.displayRound?.round_number ?? 0}:`,
                      )
                        ? "pb-28"
                        : "pb-1"
                    }`}
                  >
                    <div className="grid min-w-[680px] grid-cols-18 gap-1">
                      {Array.from(
                        { length: 18 },
                        (_, index) => index + 1,
                      ).map((holeNumber) => (
                        <div
                          key={`number-${holeNumber}`}
                          className="text-center text-[8px] font-bold text-slate-600"
                        >
                          {holeNumber}
                        </div>
                      ))}

                      {Array.from(
                        { length: 18 },
                        (_, index) => index + 1,
                      ).map((holeNumber) => {
                        const hole =
                          holesByNumber.get(holeNumber);

                        return (
                          <div
                            key={`par-${holeNumber}`}
                            className="text-center text-[8px] font-bold text-slate-500"
                          >
                            {holePar(hole) ?? "—"}
                          </div>
                        );
                      })}

                      {Array.from(
                        { length: 18 },
                        (_, index) => index + 1,
                      ).map((holeNumber) => {
                        const hole =
                          holesByNumber.get(holeNumber);

                        const holeKey =
                          `${row.player.id}:` +
                          `${row.displayRound?.round_number ?? 0}:` +
                          `${holeNumber}`;

                        const isSelected =
                          selectedHoleKey === holeKey;

                        const par = holePar(hole);

                        const yards =
                          hole?.yards === null ||
                          hole?.yards === undefined
                            ? null
                            : Number(hole.yards);

                        return (
                          <div
                            key={`score-${holeNumber}`}
                            className="relative"
                          >
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();

                                setSelectedHoleKey(
                                  isSelected
                                    ? null
                                    : holeKey,
                                );
                              }}
                              onBlur={() =>
                                setSelectedHoleKey(
                                  (current) =>
                                    current === holeKey
                                      ? null
                                      : current,
                                )
                              }
                              aria-expanded={isSelected}
                              className={`flex h-8 w-full items-center justify-center rounded-md border text-[10px] font-black ${relativeClass(
                                hole?.relative_to_par,
                              )}`}
                            >
                              {relativeLabel(
                                hole?.relative_to_par,
                              )}
                            </button>

                            {isSelected ? (
                              <div
                                role="tooltip"
                                className="absolute left-1/2 top-full z-30 mt-2 w-44 -translate-x-1/2 rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-left text-white shadow-xl"
                              >
                                <div className="text-xs font-black">
                                  Hole {holeNumber}
                                </div>

                                <div className="mt-1 text-[11px] text-slate-300">
                                  {par === null
                                    ? "Par —"
                                    : `Par ${par}`}

                                  {yards !== null
                                    ? ` · ${yards} yards`
                                    : ""}
                                </div>

                                <div className="mt-1 text-[11px] font-bold text-emerald-300">
                                  {hole?.strokes === null ||
                                  hole?.strokes === undefined
                                    ? "Not played"
                                    : `${hole.strokes} strokes · ${resultName(
                                        hole.relative_to_par,
                                      )} (${relativeLabel(
                                        hole.relative_to_par,
                                      )})`}
                                </div>

                                <span
                                  aria-hidden="true"
                                  className="absolute bottom-full left-1/2 -translate-x-1/2 border-x-8 border-b-8 border-x-transparent border-b-slate-950"
                                />
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}
