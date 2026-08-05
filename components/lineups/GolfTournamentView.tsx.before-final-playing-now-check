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
  players: Player[];
  teams: OrderedTeam[];
  getPlayersForTeam: (teamId: number) => Player[];
  getRawPlayerStat: (playerId: number) => PlayerStat | null;
  setProfilePlayer: (player: Player | null) => void;
};

type TournamentRow = {
  player: Player;
  stat: PlayerStat;
  owner: OrderedTeam | null;
};

function formatGolfScore(
  value: number | null | undefined,
) {
  if (value === null || value === undefined) {
    return "—";
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) return "—";
  if (numeric === 0) return "E";

  return numeric > 0
    ? `+${numeric}`
    : String(numeric);
}

function formatPosition(
  value: number | null | undefined,
) {
  if (!value) return "—";
  return `T${value}`;
}

function formatTeeTime(
  rawValue: string | null | undefined,
  parsedValue?: string | null,
) {
  const raw =
    rawValue?.trim() ?? "";

  /*
   * Preserve PGA TOUR's tournament-local display time.
   *
   * Supported examples:
   *   "1:30 PM"
   *   "Sun 1:30 PM"
   *   "Sun Aug 02 13:30:00 PDT 2026"
   */
  const twelveHourMatch = raw.match(
    /(?:^|\s)(\d{1,2}:\d{2}\s*[AP]M)(?:\s|$)/i,
  );

  if (twelveHourMatch) {
    return twelveHourMatch[1]
      .replace(/\s+/g, " ")
      .toUpperCase();
  }

  const twentyFourHourMatch = raw.match(
    /(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s+[A-Z]{2,5}(?:\s|$)/i,
  );

  if (twentyFourHourMatch) {
    const hour24 = Number(
      twentyFourHourMatch[1],
    );

    const minute =
      twentyFourHourMatch[2];

    if (
      Number.isInteger(hour24) &&
      hour24 >= 0 &&
      hour24 <= 23
    ) {
      const period =
        hour24 >= 12 ? "PM" : "AM";

      const hour12 =
        hour24 % 12 || 12;

      return `${hour12}:${minute} ${period}`;
    }
  }

  const value =
    parsedValue ?? rawValue;

  if (!value) return null;

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString(
    "en-US",
    {
      hour: "numeric",
      minute: "2-digit",
    },
  );
}

function golferStatus(stat: PlayerStat) {
  const status = stat.status ?? "scheduled";

  if (status === "active") {
    return {
      label: "🟢 Playing",
      detail:
        stat.last_hole !== null &&
        stat.last_hole !== undefined
          ? `R${stat.current_round ?? "—"} · Thru ${stat.last_hole}`
          : `Round ${stat.current_round ?? "—"}`,
      className:
        "border-emerald-700 bg-emerald-950 text-emerald-200",
      order: 0,
    };
  }

  if (status === "cut") {
    return {
      label: "✂ Cut",
      detail: "Missed cut",
      className:
        "border-red-800 bg-red-950 text-red-200",
      order: 4,
    };
  }

  if (status === "withdrawn") {
    return {
      label: "⚠ WD",
      detail: "Withdrawn",
      className:
        "border-amber-700 bg-amber-950 text-amber-200",
      order: 5,
    };
  }

  if (status === "disqualified") {
    return {
      label: "⛔ DQ",
      detail: "Disqualified",
      className:
        "border-red-800 bg-red-950 text-red-200",
      order: 6,
    };
  }

  if (status === "round_complete") {
    const rounds = [...(stat.rounds ?? [])].sort(
      (a, b) =>
        a.round_number -
        b.round_number,
    );

    const completedRound =
      rounds
        .filter(
          (round) =>
            Number(
              round.holes_completed ?? 0,
            ) === 18,
        )
        .at(-1) ?? null;

    const upcomingRound =
      rounds.find(
        (round) =>
          Number(
            round.holes_completed ?? 0,
          ) === 0 &&
          Boolean(
            round.tee_time ||
              round.tee_time_raw,
          ),
      ) ?? null;

    const nextRoundNumber =
      upcomingRound?.round_number ??
      Math.min(
        4,
        Number(
          completedRound?.round_number ??
            stat.rounds_completed ??
            stat.current_round ??
            1,
        ) + 1,
      );

    const teeTime = upcomingRound
      ? formatTeeTime(
          upcomingRound.tee_time_raw,
          upcomingRound.tee_time,
        )
      : formatTeeTime(
          stat.tee_time_raw,
          stat.tee_time,
        );

    if (
      teeTime &&
      nextRoundNumber <= 4
    ) {
      return {
        label: "⏰ Upcoming",
        detail:
          `R${nextRoundNumber} · Tee ${teeTime}`,
        className:
          "border-sky-700 bg-sky-950 text-sky-200",
        order: 1,
      };
    }

    return {
      label: "✓ Round complete",
      detail:
        completedRound
          ? `Round ${completedRound.round_number}`
          : "Round complete",
      className:
        "border-slate-600 bg-slate-800 text-slate-200",
      order: 2,
    };
  }

  if (status === "finished") {
    return {
      label: "✓ Final",
      detail: "Tournament complete",
      className:
        "border-slate-600 bg-slate-800 text-slate-200",
      order: 3,
    };
  }

  const rounds = [...(stat.rounds ?? [])].sort(
    (a, b) => a.round_number - b.round_number,
  );

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

  if (upcomingRound) {
    const teeTime = formatTeeTime(
      upcomingRound.tee_time ??
        upcomingRound.tee_time_raw,
    );

    return {
      label: "⏰ Upcoming",
      detail:
        `R${upcomingRound.round_number}` +
        (teeTime ? ` · ${teeTime}` : ""),
      className:
        "border-sky-700 bg-sky-950 text-sky-200",
      order: 1,
    };
  }

  const mostRecentRound =
    rounds
      .filter(
        (round) =>
          round.holes_completed > 0 ||
          round.strokes !== null,
      )
      .at(-1) ?? null;

  if (mostRecentRound?.holes_completed === 18) {
    return {
      label: "✓ Round complete",
      detail: `Round ${mostRecentRound.round_number}`,
      className:
        "border-slate-600 bg-slate-800 text-slate-200",
      order: 2,
    };
  }

  return {
    label: "⏰ Upcoming",
    detail:
      formatTeeTime(
        stat.tee_time ??
          stat.tee_time_raw,
      ) ?? "Not started",
    className:
      "border-sky-700 bg-sky-950 text-sky-200",
    order: 1,
  };
}

export default function GolfTournamentView({
  players,
  teams,
  getPlayersForTeam,
  getRawPlayerStat,
  setProfilePlayer,
}: Props) {
  const [searchTerm, setSearchTerm] =
    useState("");

  const [draftedOnly, setDraftedOnly] =
    useState(false);

  const [playingNowOnly, setPlayingNowOnly] =
    useState(false);

  const [
    selectedOwnerTeamId,
    setSelectedOwnerTeamId,
  ] = useState<number | "drafted" | null>(null);

  const fantasyTeams = useMemo(
    () =>
      teams.filter(
        (team) =>
          team.is_participating !== false,
      ),
    [teams],
  );

  const ownerByPlayerId = useMemo(() => {
    const map =
      new Map<number, OrderedTeam>();

    teams
      .filter(
        (team) =>
          team.is_participating !== false,
      )
      .forEach((team) => {
        getPlayersForTeam(team.id).forEach(
          (player) => {
            map.set(player.id, team);
          },
        );
      });

    return map;
  }, [teams, getPlayersForTeam]);

  const rows = useMemo<TournamentRow[]>(() => {
    const normalizedSearch =
      searchTerm.trim().toLowerCase();

    return players
      .map((player) => {
        const stat =
          getRawPlayerStat(player.id);

        if (!stat) return null;

        return {
          player,
          stat,
          owner:
            ownerByPlayerId.get(player.id) ??
            null,
        };
      })
      .filter(
        (
          row,
        ): row is TournamentRow =>
          row !== null,
      )
      .filter((row) => {
        if (
          draftedOnly &&
          !row.owner
        ) {
          return false;
        }

        if (
          normalizedSearch &&
          !row.player.name
            .toLowerCase()
            .includes(normalizedSearch)
        ) {
          return false;
        }

        return true;
      })
      .sort((a, b) => {
        const aPosition =
          Number(
            a.stat.leaderboard_order ??
              9999,
          );

        const bPosition =
          Number(
            b.stat.leaderboard_order ??
              9999,
          );

        if (aPosition !== bPosition) {
          return aPosition - bPosition;
        }

        const aStatus =
          golferStatus(a.stat).order;

        const bStatus =
          golferStatus(b.stat).order;

        if (aStatus !== bStatus) {
          return aStatus - bStatus;
        }

        return a.player.name.localeCompare(
          b.player.name,
        );
      });
  }, [
    players,
    getRawPlayerStat,
    ownerByPlayerId,
    searchTerm,
    draftedOnly,
  ]);

  const draftedCount = useMemo(
    () =>
      players.filter((player) =>
        ownerByPlayerId.has(player.id),
      ).length,
    [players, ownerByPlayerId],
  );

  function getCurrentGolfRound(
    row: TournamentRow,
  ) {
    const rounds =
      [...(row.stat.rounds ?? [])]
        .sort(
          (a, b) =>
            a.round_number -
            b.round_number,
        );

    const statedCurrentRound =
      Number(
        row.stat.current_round ?? 0,
      );

    if (statedCurrentRound > 0) {
      const matchingRound =
        rounds.find(
          (round) =>
            Number(
              round.round_number,
            ) === statedCurrentRound,
        );

      if (matchingRound) {
        return matchingRound;
      }
    }

    return (
      rounds
        .filter(
          (round) =>
            Number(
              round.holes_completed ?? 0,
            ) > 0 ||
            round.strokes !== null,
        )
        .at(-1) ??
      null
    );
  }

  function isGolferPlayingNow(
    row: TournamentRow,
  ) {
    if (
      row.stat.status !== "active"
    ) {
      return false;
    }

    const currentRound =
      getCurrentGolfRound(row);

    if (!currentRound) {
      return false;
    }

    const holesCompleted =
      Number(
        currentRound.holes_completed ?? 0,
      );

    return (
      holesCompleted > 0 &&
      holesCompleted < 18
    );
  }

  const playingNowCount = useMemo(
    () =>
      rows.filter(
        isGolferPlayingNow,
      ).length,
    [rows],
  );

  const visibleRows = useMemo(() => {
    if (!playingNowOnly) {
      return rows;
    }

    /*
     * The main rows array is already sorted by ESPN's official
     * leaderboard order. Filtering it preserves that correct order.
     */
    return rows.filter(
      isGolferPlayingNow,
    );
  }, [playingNowOnly, rows]);


  return (
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 shadow-sm">
      <header className="border-b border-slate-800 bg-gradient-to-r from-emerald-950 to-slate-950 px-5 py-5 text-white">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
              Tournament view
            </span>

            <h3 className="mt-1 text-2xl font-black">
              Official Leaderboard
            </h3>

            <p className="mt-1 text-sm text-slate-300">
              Full field with fantasy ownership highlighted.
            </p>
          </div>

          <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-bold text-slate-200">
            {rows.length} golfers
          </div>
        </div>
      </header>

      <div className="border-b border-slate-800 bg-slate-900 p-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="min-w-0 flex-1">
            <span className="sr-only">
              Search golfers
            </span>

            <input
              type="search"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(
                  event.target.value,
                )
              }
              placeholder="Search golfers..."
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-500"
            />
          </label>

          <button
            type="button"
            onClick={() =>
              setDraftedOnly(
                (current) => !current,
              )
            }
            aria-pressed={draftedOnly}
            className={`rounded-xl border px-4 py-2.5 text-sm font-bold transition ${
              draftedOnly
                ? "border-emerald-500 bg-emerald-900 text-emerald-100"
                : "border-slate-700 bg-slate-950 text-slate-300 hover:border-emerald-700"
            }`}
          >
            {draftedOnly
              ? `✓ Drafted only (${draftedCount})`
              : `Drafted only (${draftedCount})`}
          </button>

          <button
            type="button"
            onClick={() =>
              setPlayingNowOnly(
                (current) => !current,
              )
            }
            aria-pressed={playingNowOnly}
            className={`rounded-xl border px-3 py-2 text-xs font-bold transition ${
              playingNowOnly
                ? "border-amber-400 bg-amber-400 text-slate-950"
                : "border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-600 hover:text-amber-200"
            }`}
          >
            {playingNowOnly
              ? `✓ Playing now (${playingNowCount})`
              : `Playing now (${playingNowCount})`}
          </button>

        </div>
      </div>

      <div className="border-b border-slate-800 bg-slate-950 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <span className="text-[9px] font-black uppercase tracking-[0.16em] text-emerald-400">
              Fantasy overlay
            </span>

            <p className="mt-0.5 text-[11px] text-slate-500">
              Highlight all drafted golfers or isolate one fantasy team.
            </p>
          </div>

          {selectedOwnerTeamId !== null ? (
            <button
              type="button"
              onClick={() =>
                setSelectedOwnerTeamId(null)
              }
              className="shrink-0 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-slate-300 transition hover:border-emerald-700 hover:text-white"
            >
              Clear overlay
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() =>
              setSelectedOwnerTeamId(
                selectedOwnerTeamId === "drafted"
                  ? null
                  : "drafted",
              )
            }
            aria-pressed={
              selectedOwnerTeamId === "drafted"
            }
            className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-2 text-xs font-black transition ${
              selectedOwnerTeamId === "drafted"
                ? "border-emerald-500 bg-emerald-900 text-emerald-100"
                : "border-slate-700 bg-slate-900 text-slate-400 hover:border-emerald-700"
            }`}
          >
            All drafted

            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                selectedOwnerTeamId === "drafted"
                  ? "bg-emerald-700 text-white"
                  : "bg-slate-800 text-slate-500"
              }`}
            >
              {draftedCount}
            </span>
          </button>

          {fantasyTeams.map((team) => {
            const isSelected =
              selectedOwnerTeamId ===
              team.id;

            const golferCount =
              getPlayersForTeam(
                team.id,
              ).length;

            return (
              <button
                key={team.id}
                type="button"
                onClick={() =>
                  setSelectedOwnerTeamId(
                    isSelected
                      ? null
                      : team.id,
                  )
                }
                aria-pressed={isSelected}
                className={`flex shrink-0 items-center gap-2 rounded-full border px-2.5 py-1.5 text-xs font-black transition ${
                  isSelected
                    ? "border-emerald-400 bg-emerald-900 text-emerald-100 shadow-sm"
                    : "border-slate-700 bg-slate-900 text-slate-300 hover:border-emerald-700"
                }`}
              >
                <TeamAvatar
                  teamName={team.name}
                  size="xs"
                />

                <span>{team.name}</span>

                <span
                  className={`rounded-full px-1.5 py-0.5 text-[9px] ${
                    isSelected
                      ? "bg-emerald-700 text-white"
                      : "bg-slate-800 text-slate-500"
                  }`}
                >
                  {golferCount}
                </span>
              </button>
            );
          })}
        </div>

        {selectedOwnerTeamId !== null ? (
          <div className="mt-3 rounded-xl border border-emerald-800 bg-emerald-950/60 px-3 py-2 text-xs text-emerald-200">
            {selectedOwnerTeamId === "drafted" ? (
              <>
                Highlighting{" "}
                <strong>
                  all {draftedCount} drafted golfers
                </strong>
                . Undrafted golfers remain visible but are faded.
              </>
            ) : (
              <>
                Highlighting{" "}
                <strong>
                  {fantasyTeams.find(
                    (team) =>
                      team.id === selectedOwnerTeamId,
                  )?.name ?? "selected team"}
                </strong>
                . Other golfers remain visible but are faded.
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="hidden grid-cols-[70px_minmax(220px,1fr)_150px_100px_180px] border-b border-slate-800 bg-slate-900 px-4 py-3 text-[10px] font-black uppercase tracking-wider text-slate-500 md:grid">
        <div>Pos</div>
        <div>Golfer</div>
        <div>Owner</div>
        <div className="text-right">
          Score
        </div>
        <div className="text-right">
          Status
        </div>
      </div>

      <div className="divide-y divide-slate-800">
        {visibleRows.map((row) => {
          const status =
            golferStatus(row.stat);

          return (
            <button
              key={row.player.id}
              type="button"
              onClick={() =>
                setProfilePlayer(row.player)
              }
              className={`grid w-full grid-cols-[54px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-900 md:grid-cols-[70px_minmax(220px,1fr)_150px_100px_180px] ${
                selectedOwnerTeamId === null ||
                (selectedOwnerTeamId === "drafted"
                  ? Boolean(row.owner)
                  : row.owner?.id === selectedOwnerTeamId)
                  ? "opacity-100"
                  : "opacity-30 grayscale"
              } ${
                (selectedOwnerTeamId === "drafted" &&
                  row.owner) ||
                (typeof selectedOwnerTeamId === "number" &&
                  row.owner?.id === selectedOwnerTeamId)
                  ? "bg-emerald-950/30"
                  : ""
              }`}
              aria-label={`Open ${row.player.name} tournament scorecard`}
            >
              <div className="text-sm font-black text-slate-200">
                {formatPosition(
                  row.stat.leaderboard_order,
                )}
              </div>

              <div className="flex min-w-0 items-center gap-3">
                <PlayerHeadshot
                  espnGolfPlayerId={
                    row.player.espn_player_id
                  }
                  imageUrl={
                    row.player.headshot_url
                  }
                  playerName={row.player.name}
                  size="sm"
                />

                <div className="min-w-0">
                  <strong className="block truncate text-sm text-white sm:text-base">
                    {row.player.name}
                  </strong>

                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-slate-500 md:hidden">
                    <span>{status.detail}</span>

                    {row.owner ? (
                      <span className="text-emerald-300">
                        {row.owner.name}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="hidden md:block">
                {row.owner ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-800 bg-emerald-950 px-2 py-1 text-xs font-bold text-emerald-200">
                    <TeamAvatar
                      teamName={
                        row.owner.name
                      }
                      size="xs"
                    />
                    {row.owner.name}
                  </span>
                ) : (
                  <span className="text-xs text-slate-600">
                    —
                  </span>
                )}
              </div>

              <div className="text-right">
                <strong className="block text-xl font-black text-white">
                  {formatGolfScore(
                    row.stat.official_score_to_par ??
                      row.stat.fantasy_points,
                  )}
                </strong>

                {row.owner ? (
                  <span className="mt-0.5 block text-[9px] font-black uppercase text-emerald-400 md:hidden">
                    Drafted
                  </span>
                ) : null}
              </div>

              <div className="hidden text-right md:block">
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase ${status.className}`}
                >
                  {status.label}
                </span>

                <div className="mt-1 text-xs text-slate-500">
                  {status.detail}
                </div>
              </div>
            </button>
          );
        })}

        {visibleRows.length === 0 ? (
          <div className="px-5 py-12 text-center text-sm text-slate-500">
            No golfers match the current filters.
          </div>
        ) : null}
      </div>
    </section>
  );
}
