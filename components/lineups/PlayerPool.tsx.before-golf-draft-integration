"use client";

import { useEffect, useMemo, useState } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import { useSelectedSport } from "@/components/providers/SportProvider";
import type {
  Player,
  PositionFilter,
  RosterSlotConfig,
  Team,
} from "@/components/lineups/types";

type PlayerPoolProps = {
  players: Player[];
  filteredPlayers: Player[];
  searchTerm: string;
  setSearchTerm: React.Dispatch<
    React.SetStateAction<string>
  >;
  positionFilter: PositionFilter;
  setPositionFilter: React.Dispatch<
    React.SetStateAction<PositionFilter>
  >;
  onSlateOnly: boolean;
  setOnSlateOnly: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  isAvailabilityLoading: boolean;
  availablePlayerIdsForSlate: number[];
  availablePlayerIdSet: Set<number>;
  playerAverageMap: Map<number, number>;
  playerProjections: Record<number, any>;
  getOwnerTeamForPlayer: (
    playerId: number
  ) => Team | null;
  setDraftingPlayer: React.Dispatch<
    React.SetStateAction<Player | null>
  >;
  isAssigningPlayer: boolean;
  pillBase: string;
  activePill: string;
  inactivePill: string;
  rosterSlots?: RosterSlotConfig[];
  selectedSeason: string;
};

type SortOption =
  | "projection"
  | "average"
  | "owgr"
  | "name"
  | "season_fp"
  | "season_pts"
  | "season_reb"
  | "season_ast"
  | "season_stl"
  | "season_blk"
  | "season_to"
  | "nfl_fp"
  | "nfl_pass_yd"
  | "nfl_pass_td"
  | "nfl_int"
  | "nfl_rush_yd"
  | "nfl_rush_td"
  | "nfl_targets"
  | "nfl_receptions"
  | "nfl_rec_yd"
  | "nfl_rec_td";

type NflSeasonStat = {
  player_id: number;
  player_name: string;

  nfl_player_id:
    number | null;

  position:
    string | null;

  position_group:
    string | null;

  team_abbreviation:
    string | null;

  games_played:
    number | null;

  fantasy_points_per_game:
    number | null;

  passing_yards_per_game:
    number | null;

  passing_tds_per_game:
    number | null;

  passing_ints_per_game:
    number | null;

  rushing_yards_per_game:
    number | null;

  rushing_tds_per_game:
    number | null;

  receiving_targets_per_game:
    number | null;

  receptions_per_game:
    number | null;

  receiving_yards_per_game:
    number | null;

  receiving_tds_per_game:
    number | null;

  fumbles_lost_per_game:
    number | null;
};

type ResearchMode =
  | "league"
  | "season";

type NbaSeasonStat = {
  player_id: number;
  player_name: string;
  nba_player_id: number | null;

  team_abbreviation:
    string | null;

  position_group:
    string | null;

  fantasy_points:
    number | null;

  points:
    number | null;

  rebounds:
    number | null;

  assists:
    number | null;

  steals:
    number | null;

  blocks:
    number | null;

  turnovers:
    number | null;
};

function formatScore(value: unknown) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number.toFixed(1)
    : "—";
}

export default function PlayerPool({
  players,
  filteredPlayers,
  searchTerm,
  setSearchTerm,
  positionFilter,
  setPositionFilter,
  onSlateOnly,
  setOnSlateOnly,
  isAvailabilityLoading,
  availablePlayerIdsForSlate,
  availablePlayerIdSet,
  playerAverageMap,
  playerProjections,
  getOwnerTeamForPlayer,
  setDraftingPlayer,
  isAssigningPlayer,
  rosterSlots = [],
  selectedSeason,
}: PlayerPoolProps) {
  const { selectedSport } = useSelectedSport();
  const isGolf = selectedSport === "golf";
  const isNba = selectedSport === "nba";
  const isNfl = selectedSport === "nfl";

  const hasSeasonResearch =
    isNba ||
    isNfl;

  const [
    researchMode,
    setResearchMode,
  ] =
    useState<ResearchMode>(
      "league",
    );

  const [
    nbaSeasonStats,
    setNbaSeasonStats,
  ] =
    useState<NbaSeasonStat[]>(
      [],
    );

  const [
    nflSeasonStats,
    setNflSeasonStats,
  ] =
    useState<NflSeasonStat[]>(
      [],
    );

  const [
    isSeasonStatsLoading,
    setIsSeasonStatsLoading,
  ] =
    useState(false);

  const [
    seasonStatsError,
    setSeasonStatsError,
  ] =
    useState("");

  const [
    compareMode,
    setCompareMode,
  ] =
    useState(false);

  const [
    comparePlayerIds,
    setComparePlayerIds,
  ] =
    useState<number[]>(
      [],
    );

  const [
    compareOpen,
    setCompareOpen,
  ] =
    useState(false);

  const [sortBy, setSortBy] =
    useState<SortOption>(
      selectedSport === "golf" ? "owgr" : "projection",
    );

  useEffect(() => {
    setOnSlateOnly(true);
  }, [setOnSlateOnly]);

  useEffect(() => {
    setResearchMode(
      "league",
    );

    setCompareMode(
      false,
    );

    setComparePlayerIds(
      [],
    );

    setCompareOpen(
      false,
    );

    setSortBy(
      isGolf
        ? "owgr"
        : "projection",
    );
  }, [
    selectedSport,
    isGolf,
  ]);

  useEffect(() => {
    if (
      !isNba
    ) {
      return;
    }

    let cancelled =
      false;

    async function loadSeasonStats() {
      try {
        setIsSeasonStatsLoading(
          true,
        );

        setSeasonStatsError(
          "",
        );

        const response =
          await fetch(
            `/api/player-season-stats?season=${selectedSeason}&sport=nba`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json();

        if (
          !response.ok ||
          !result?.available
        ) {
          throw new Error(
            result?.error ??
              result?.message ??
              "NBA season stats are unavailable.",
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        setNbaSeasonStats(
          Array.isArray(
            result.playerStats,
          )
            ? result.playerStats
            : [],
        );
      } catch (
        error
      ) {
        if (
          cancelled
        ) {
          return;
        }

        console.error(
          error,
        );

        setNbaSeasonStats(
          [],
        );

        setSeasonStatsError(
          error instanceof Error
            ? error.message
            : "Failed to load NBA season stats.",
        );
      } finally {
        if (
          !cancelled
        ) {
          setIsSeasonStatsLoading(
            false,
          );
        }
      }
    }

    void loadSeasonStats();

    return () => {
      cancelled = true;
    };
  }, [
    isNba,
    selectedSeason,
  ]);

  useEffect(() => {
    if (
      !isNfl
    ) {
      return;
    }

    let cancelled =
      false;

    async function loadNflSeasonStats() {
      try {
        setIsSeasonStatsLoading(
          true,
        );

        setSeasonStatsError(
          "",
        );

        const response =
          await fetch(
            `/api/player-season-stats?season=${selectedSeason}&sport=nfl`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json();

        if (
          !response.ok ||
          !result?.available
        ) {
          throw new Error(
            result?.error ??
              result?.message ??
              "NFL season stats are unavailable.",
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        setNflSeasonStats(
          Array.isArray(
            result.playerStats,
          )
            ? result.playerStats
            : [],
        );
      } catch (
        error
      ) {
        if (
          cancelled
        ) {
          return;
        }

        console.error(
          error,
        );

        setNflSeasonStats(
          [],
        );

        setSeasonStatsError(
          error instanceof Error
            ? error.message
            : "Failed to load NFL season stats.",
        );
      } finally {
        if (
          !cancelled
        ) {
          setIsSeasonStatsLoading(
            false,
          );
        }
      }
    }

    void loadNflSeasonStats();

    return () => {
      cancelled = true;
    };
  }, [
    isNfl,
    selectedSeason,
  ]);

  const nflSeasonStatByPlayerId =
    useMemo(() => {
      const map =
        new Map<
          number,
          NflSeasonStat
        >();

      for (
        const row
        of nflSeasonStats
      ) {
        map.set(
          Number(
            row.player_id,
          ),
          row,
        );
      }

      return map;
    }, [
      nflSeasonStats,
    ]);

  const nbaSeasonStatByPlayerId =
    useMemo(() => {
      const map =
        new Map<
          number,
          NbaSeasonStat
        >();

      for (
        const row
        of nbaSeasonStats
      ) {
        map.set(
          Number(
            row.player_id,
          ),
          row,
        );
      }

      return map;
    }, [
      nbaSeasonStats,
    ]);

  const sortedFilteredPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      if (sortBy === "projection") {
        const aScore =
          playerProjections?.[a.id]?.projection ??
          playerAverageMap.get(a.id) ??
          0;

        const bScore =
          playerProjections?.[b.id]?.projection ??
          playerAverageMap.get(b.id) ??
          0;

        return Number(bScore) - Number(aScore);
      }

      if (sortBy === "average") {
        const aScore =
          playerAverageMap.get(a.id) ?? 0;

        const bScore =
          playerAverageMap.get(b.id) ?? 0;

        return Number(bScore) - Number(aScore);
      }

      if (sortBy === "owgr") {
        const aRank = a.owgr_rank;
        const bRank = b.owgr_rank;

        if (aRank == null && bRank == null) {
          return a.name.localeCompare(b.name);
        }

        if (aRank == null) return 1;
        if (bRank == null) return -1;

        if (aRank !== bRank) {
          return aRank - bRank;
        }

        return a.name.localeCompare(b.name);
      }

      if (
        researchMode ===
          "season" &&
        isNfl
      ) {
        const aStat =
          nflSeasonStatByPlayerId.get(
            a.id,
          );

        const bStat =
          nflSeasonStatByPlayerId.get(
            b.id,
          );

        const getValue = (
          stat:
            NflSeasonStat | undefined,
        ) => {
          if (
            sortBy ===
            "nfl_pass_yd"
          ) {
            return Number(
              stat?.passing_yards_per_game ??
                -999,
            );
          }

          if (
            sortBy ===
            "nfl_pass_td"
          ) {
            return Number(
              stat?.passing_tds_per_game ??
                -999,
            );
          }

          if (
            sortBy ===
            "nfl_int"
          ) {
            return Number(
              stat?.passing_ints_per_game ??
                999,
            );
          }

          if (
            sortBy ===
            "nfl_rush_yd"
          ) {
            return Number(
              stat?.rushing_yards_per_game ??
                -999,
            );
          }

          if (
            sortBy ===
            "nfl_rush_td"
          ) {
            return Number(
              stat?.rushing_tds_per_game ??
                -999,
            );
          }

          if (
            sortBy ===
            "nfl_targets"
          ) {
            return Number(
              stat?.receiving_targets_per_game ??
                -999,
            );
          }

          if (
            sortBy ===
            "nfl_receptions"
          ) {
            return Number(
              stat?.receptions_per_game ??
                -999,
            );
          }

          if (
            sortBy ===
            "nfl_rec_yd"
          ) {
            return Number(
              stat?.receiving_yards_per_game ??
                -999,
            );
          }

          if (
            sortBy ===
            "nfl_rec_td"
          ) {
            return Number(
              stat?.receiving_tds_per_game ??
                -999,
            );
          }

          return Number(
            stat?.fantasy_points_per_game ??
              -999,
          );
        };

        const aValue =
          getValue(
            aStat,
          );

        const bValue =
          getValue(
            bStat,
          );

        return sortBy ===
          "nfl_int"
          ? aValue - bValue
          : bValue - aValue;
      }

      if (
        researchMode ===
          "season" &&
        isNba
      ) {
        const aStat =
          nbaSeasonStatByPlayerId.get(
            a.id,
          );

        const bStat =
          nbaSeasonStatByPlayerId.get(
            b.id,
          );

        const getValue = (
          stat:
            NbaSeasonStat | undefined,
        ) => {
          if (
            sortBy ===
            "season_pts"
          ) {
            return Number(
              stat?.points ??
                -999,
            );
          }

          if (
            sortBy ===
            "season_reb"
          ) {
            return Number(
              stat?.rebounds ??
                -999,
            );
          }

          if (
            sortBy ===
            "season_ast"
          ) {
            return Number(
              stat?.assists ??
                -999,
            );
          }

          if (
            sortBy ===
            "season_stl"
          ) {
            return Number(
              stat?.steals ??
                -999,
            );
          }

          if (
            sortBy ===
            "season_blk"
          ) {
            return Number(
              stat?.blocks ??
                -999,
            );
          }

          if (
            sortBy ===
            "season_to"
          ) {
            return Number(
              stat?.turnovers ??
                999,
            );
          }

          return Number(
            stat?.fantasy_points ??
              -999,
          );
        };

        const aValue =
          getValue(
            aStat,
          );

        const bValue =
          getValue(
            bStat,
          );

        return sortBy ===
          "season_to"
          ? aValue - bValue
          : bValue - aValue;
      }

      return a.name.localeCompare(b.name);
    });
  }, [
    filteredPlayers,
    playerAverageMap,
    playerProjections,
    sortBy,
    researchMode,
    isNba,
    isNfl,
    nbaSeasonStatByPlayerId,
    nflSeasonStatByPlayerId,
  ]);

  function toggleComparePlayer(
    playerId:
      number,
  ) {
    setComparePlayerIds(
      (
        previous,
      ) => {
        if (
          previous.includes(
            playerId,
          )
        ) {
          return previous.filter(
            (
              id,
            ) =>
              id !==
              playerId,
          );
        }

        if (
          previous.length >=
          3
        ) {
          return previous;
        }

        return [
          ...previous,
          playerId,
        ];
      },
    );
  }

  const comparePlayers =
    comparePlayerIds
      .map(
        (
          playerId,
        ) =>
          players.find(
            (
              player,
            ) =>
              player.id ===
              playerId,
          ),
      )
      .filter(
        (
          player,
        ): player is Player =>
          Boolean(
            player,
          ),
      );

  const seasonSortLabel =
    sortBy ===
      "season_pts"
      ? "PTS"
      : sortBy ===
          "season_reb"
        ? "REB"
        : sortBy ===
            "season_ast"
          ? "AST"
          : sortBy ===
              "season_stl"
            ? "STL"
            : sortBy ===
                "season_blk"
              ? "BLK"
              : sortBy ===
                  "season_to"
                ? "TO"
                : "FP";

  const nflSeasonSortLabel =
    sortBy ===
      "nfl_pass_yd"
      ? "PASS"
      : sortBy ===
          "nfl_pass_td"
        ? "P TD"
        : sortBy ===
            "nfl_int"
          ? "INT"
          : sortBy ===
              "nfl_rush_yd"
            ? "RUSH"
            : sortBy ===
                "nfl_rush_td"
              ? "R TD"
              : sortBy ===
                  "nfl_targets"
                ? "TGT"
                : sortBy ===
                    "nfl_receptions"
                  ? "REC"
                  : sortBy ===
                      "nfl_rec_yd"
                    ? "REC YD"
                    : sortBy ===
                        "nfl_rec_td"
                      ? "REC TD"
                      : "FP/G";

  function nflSeasonSortValue(
    stat:
      NflSeasonStat | undefined,
  ) {
    if (
      sortBy ===
      "nfl_pass_yd"
    ) {
      return stat?.passing_yards_per_game;
    }

    if (
      sortBy ===
      "nfl_pass_td"
    ) {
      return stat?.passing_tds_per_game;
    }

    if (
      sortBy ===
      "nfl_int"
    ) {
      return stat?.passing_ints_per_game;
    }

    if (
      sortBy ===
      "nfl_rush_yd"
    ) {
      return stat?.rushing_yards_per_game;
    }

    if (
      sortBy ===
      "nfl_rush_td"
    ) {
      return stat?.rushing_tds_per_game;
    }

    if (
      sortBy ===
      "nfl_targets"
    ) {
      return stat?.receiving_targets_per_game;
    }

    if (
      sortBy ===
      "nfl_receptions"
    ) {
      return stat?.receptions_per_game;
    }

    if (
      sortBy ===
      "nfl_rec_yd"
    ) {
      return stat?.receiving_yards_per_game;
    }

    if (
      sortBy ===
      "nfl_rec_td"
    ) {
      return stat?.receiving_tds_per_game;
    }

    return stat?.fantasy_points_per_game;
  }

  function seasonSortValue(
    stat:
      NbaSeasonStat | undefined,
  ) {
    if (
      sortBy ===
      "season_pts"
    ) {
      return stat?.points;
    }

    if (
      sortBy ===
      "season_reb"
    ) {
      return stat?.rebounds;
    }

    if (
      sortBy ===
      "season_ast"
    ) {
      return stat?.assists;
    }

    if (
      sortBy ===
      "season_stl"
    ) {
      return stat?.steals;
    }

    if (
      sortBy ===
      "season_blk"
    ) {
      return stat?.blocks;
    }

    if (
      sortBy ===
      "season_to"
    ) {
      return stat?.turnovers;
    }

    return stat?.fantasy_points;
  }

  useEffect(() => {
    if (
      !isNfl
    ) {
      return;
    }

    setResearchMode(
      "season",
    );

    setSortBy(
      "nfl_fp",
    );

    setCompareMode(
      false,
    );

    setComparePlayerIds(
      [],
    );
  }, [
    isNfl,
  ]);

  return (
    <section className="draft-player-pool">
      {hasSeasonResearch ? (
        <div className="mb-4 space-y-3 rounded-2xl border border-slate-700 bg-slate-950 p-3 text-white">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-900 p-1">
            <button
              type="button"
              onClick={() => {
                setResearchMode(
                  "league",
                );

                setSortBy(
                  isNfl
                    ? "average"
                    : "projection",
                );

                setCompareMode(
                  false,
                );

                setComparePlayerIds(
                  [],
                );
              }}
              className={`rounded-lg px-3 py-2 text-sm font-black transition ${
                researchMode ===
                "league"
                  ? "bg-sky-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              League History
            </button>

            <button
              type="button"
              onClick={() => {
                setResearchMode(
                  "season",
                );

                setSortBy(
                  isNfl
                    ? "nfl_fp"
                    : "season_fp",
                );

                setCompareMode(
                  false,
                );

                setComparePlayerIds(
                  [],
                );
              }}
              className={`rounded-lg px-3 py-2 text-sm font-black transition ${
                researchMode ===
                "season"
                  ? "bg-sky-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Season Stats
            </button>
          </div>

          {!compareMode ? (
            <button
              type="button"
              onClick={() => {
                setCompareMode(
                  true,
                );

                setComparePlayerIds(
                  [],
                );
              }}
              className="rounded-xl border border-sky-500/60 bg-slate-900 px-4 py-2 text-sm font-black text-sky-200 transition hover:bg-slate-800"
            >
              ⇄ Compare Players
            </button>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <strong className="block">
                  Select 2–3 players
                </strong>

                <span className="text-xs text-sky-300">
                  Tap player cards to compare.{" "}
                  {
                    comparePlayerIds.length
                  }
                  /3 selected
                </span>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCompareMode(
                      false,
                    );

                    setComparePlayerIds(
                      [],
                    );
                  }}
                  className="rounded-lg border border-slate-600 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  disabled={
                    comparePlayerIds.length <
                    2
                  }
                  onClick={() =>
                    setCompareOpen(
                      true,
                    )
                  }
                  className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-black text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Compare (
                  {
                    comparePlayerIds.length
                  }
                  )
                </button>
              </div>
            </div>
          )}

          {researchMode ===
            "season" &&
          isSeasonStatsLoading ? (
            <div className="text-xs text-slate-400">
              Loading NBA season stats…
            </div>
          ) : null}

          {researchMode ===
            "season" &&
          seasonStatsError ? (
            <div className="rounded-xl border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-200">
              {
                seasonStatsError
              }
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="draft-player-toolbar">
        <div className="draft-player-search-row">
          <label className="draft-player-search">
            <span className="sr-only">
              Search players
            </span>

            <span
              className="draft-player-search-icon"
              aria-hidden="true"
            >
              🔎
            </span>

            <input
              type="search"
              value={searchTerm}
              onChange={(event) =>
                setSearchTerm(event.target.value)
              }
              placeholder="Search players…"
            />

            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="draft-player-search-clear"
                aria-label="Clear player search"
              >
                ×
              </button>
            ) : null}
          </label>

          {!isGolf &&
          researchMode ===
            "league" ? (
            <details className="draft-projection-key">
              <summary>
                <span aria-hidden="true">ⓘ</span>
                Projection key
              </summary>

              <div>
                <p>
                  Mark&apos;s Projection blends NBA
                  averages, league performance, recent
                  form, and average finish.
                </p>

                <div className="draft-projection-key-items">
                  <span>🏆 Strong history</span>
                  <span>🔥 Trending up</span>
                  <span>🧊 Trending down</span>
                </div>
              </div>
            </details>
          ) : null}
        </div>

        <div className="draft-player-filter-row">
          <div
            className="draft-player-segment"
            aria-label="Position filter"
          >
            {(
              rosterSlots.length > 0
                ? ["All", ...rosterSlots.map((slot) => slot.position)]
                : ["All", "G", "F/C"]
            ).map(
              (position) => (
                <button
                  key={position}
                  type="button"
                  onClick={() =>
                    setPositionFilter(position)
                  }
                  className={
                    positionFilter === position
                      ? "draft-player-segment-active"
                      : ""
                  }
                >
                  {position}
                </button>
              )
            )}
          </div>

          <div
            className="draft-player-segment"
            aria-label="Availability filter"
          >
            <button
              type="button"
              onClick={() => setOnSlateOnly(true)}
              className={
                onSlateOnly
                  ? "draft-player-segment-active"
                  : ""
              }
            >
              On Slate
            </button>

            <button
              type="button"
              onClick={() => setOnSlateOnly(false)}
              className={
                !onSlateOnly
                  ? "draft-player-segment-active"
                  : ""
              }
            >
              All Players
            </button>
          </div>
        </div>

        <div className="draft-player-sort-row">
          <label>
            <span>Sort</span>

            <select
              value={sortBy}
              onChange={(event) =>
                setSortBy(
                  event.target.value as SortOption
                )
              }
            >
              {isGolf ? (
                <>
                  <option value="owgr">
                    OWGR
                  </option>

                  <option value="name">
                    Player Name
                  </option>
                </>
              ) : isNfl &&
                researchMode ===
                  "season" ? (
                <>
                  <option value="nfl_fp">
                    Fantasy Points / Game
                  </option>

                  <option value="nfl_pass_yd">
                    Pass Yards / Game
                  </option>

                  <option value="nfl_pass_td">
                    Pass TD / Game
                  </option>

                  <option value="nfl_int">
                    INT / Game
                  </option>

                  <option value="nfl_rush_yd">
                    Rush Yards / Game
                  </option>

                  <option value="nfl_rush_td">
                    Rush TD / Game
                  </option>

                  <option value="nfl_targets">
                    Targets / Game
                  </option>

                  <option value="nfl_receptions">
                    Receptions / Game
                  </option>

                  <option value="nfl_rec_yd">
                    Receiving Yards / Game
                  </option>

                  <option value="nfl_rec_td">
                    Receiving TD / Game
                  </option>

                  <option value="name">
                    Player Name
                  </option>
                </>
              ) : isNba &&
                researchMode ===
                  "season" ? (
                <>
                  <option value="season_fp">
                    Fantasy Points
                  </option>

                  <option value="season_pts">
                    Points
                  </option>

                  <option value="season_reb">
                    Rebounds
                  </option>

                  <option value="season_ast">
                    Assists
                  </option>

                  <option value="season_stl">
                    Steals
                  </option>

                  <option value="season_blk">
                    Blocks
                  </option>

                  <option value="season_to">
                    Turnovers
                  </option>

                  <option value="name">
                    Player Name
                  </option>
                </>
              ) : (
                <>
                  <option value="projection">
                    Projection
                  </option>

                  <option value="average">
                    League Average
                  </option>

                  <option value="name">
                    Player Name
                  </option>
                </>
              )}
            </select>
          </label>

          <div className="draft-player-results-count">
            <strong>
              {sortedFilteredPlayers.length}
            </strong>{" "}
            shown
            <span aria-hidden="true"> • </span>
            {isAvailabilityLoading
              ? "Checking slate…"
              : `${availablePlayerIdsForSlate.length} on slate`}
          </div>
        </div>
      </div>

      {sortedFilteredPlayers.length === 0 ? (
        <div className="draft-player-empty">
          <div aria-hidden="true">
            {isGolf
              ? "⛳"
              : isNfl
                ? "🏈"
                : "🏀"}
          </div>

          <strong>No players found</strong>

          <p>
            {onSlateOnly
              ? "No players match these filters on the selected slate. Switch to All Players to browse everyone."
              : "Try another search or position filter."}
          </p>
        </div>
      ) : (
        <div className="draft-player-grid">
          {sortedFilteredPlayers.map((player) => {
            const ownerTeam =
              getOwnerTeamForPlayer(player.id);

            const isOnSlate =
              availablePlayerIdSet.has(player.id);

            const projectionMeta =
              playerProjections?.[player.id];

            const seasonStat =
              nbaSeasonStatByPlayerId.get(
                player.id,
              );

            const displayScore =
              isGolf
                ? player.owgr_rank
                : isNfl
                  ? researchMode ===
                      "season"
                    ? nflSeasonSortValue(
                        nflSeasonStatByPlayerId.get(
                          player.id,
                        ),
                      )
                    : playerAverageMap.get(
                        player.id,
                      )
                  : isNba &&
                      researchMode ===
                        "season"
                    ? seasonSortValue(
                        seasonStat,
                      )
                    : sortBy ===
                      "average"
                      ? playerAverageMap.get(
                          player.id,
                        ) ?? 0
                      : projectionMeta?.projection ??
                        playerAverageMap.get(
                          player.id,
                        ) ??
                        0;

            const scoreLabel =
              isGolf
                ? "OWGR"
                : isNfl
                  ? researchMode ===
                      "season"
                    ? nflSeasonSortLabel
                    : "111 Avg"
                  : isNba &&
                      researchMode ===
                        "season"
                    ? seasonSortLabel
                    : sortBy ===
                      "average"
                      ? "Avg"
                      : "Proj";

            const badges =
              projectionMeta?.badges ?? [];

            return (
              <button
                key={player.id}
                type="button"
                disabled={isAssigningPlayer}
                onClick={() => {
                  if (
                    compareMode
                  ) {
                    toggleComparePlayer(
                      player.id,
                    );

                    return;
                  }

                  setDraftingPlayer(
                    player,
                  );
                }}
                className={`draft-player-card ${
                  ownerTeam
                    ? "draft-player-card--owned"
                    : ""
                } ${
                  comparePlayerIds.includes(
                    player.id,
                  )
                    ? "ring-2 ring-sky-400"
                    : ""
                }`}
              >
                <PlayerHeadshot
                  nbaPlayerId={
                    player.nba_player_id
                  }
                  nflPlayerId={
                    player.nfl_player_id
                  }
                  espnGolfPlayerId={
                    player.espn_player_id
                  }
                  imageUrl={
                    player.headshot_url
                  }
                  playerName={player.name}
                  size="md"
                  className="draft-player-card-headshot"
                />

                <div className="draft-player-card-main">
                  <div className="draft-player-card-name-row">
                    <strong>{player.name}</strong>

                    <span className="draft-player-position">
                      {player.position_group}
                    </span>
                  </div>

                  <div className="draft-player-card-meta">
                    <span className="draft-player-score">
                      {isNfl &&
                      researchMode ===
                        "league" &&
                      displayScore == null
                        ? "Not drafted yet"
                        : (
                            <>
                              {scoreLabel}{" "}
                              {isGolf
                                ? displayScore == null
                                  ? "—"
                                  : `#${displayScore}`
                                : displayScore == null
                                  ? "—"
                                  : formatScore(
                                      displayScore,
                                    )}
                            </>
                          )}
                    </span>

                    {badges.includes("trophy") ||
                    badges.includes("winner") ? (
                      <span
                        title="Strong league history"
                        aria-label="Strong league history"
                      >
                        🏆
                      </span>
                    ) : null}

                    {badges.includes("hot") ? (
                      <span
                        title="Trending up"
                        aria-label="Trending up"
                      >
                        🔥
                      </span>
                    ) : null}

                    {badges.includes("cold") ? (
                      <span
                        title="Trending down"
                        aria-label="Trending down"
                      >
                        🧊
                      </span>
                    ) : null}

                    {isOnSlate ? (
                      <span className="draft-player-on-slate">
                        On slate
                      </span>
                    ) : null}
                  </div>

                {isNfl &&
                nflSeasonStatByPlayerId.get(
                  player.id,
                ) ? (
                  (() => {
                    const stat =
                      nflSeasonStatByPlayerId.get(
                        player.id,
                      )!;

                    const position =
                      String(
                        player.position_group ??
                          stat.position ??
                          "",
                      ).toUpperCase();

                    const cardStats =
                      position ===
                      "QB"
                        ? [
                            {
                              label:
                                "PASS",
                              value:
                                stat.passing_yards_per_game,
                              key:
                                "nfl_pass_yd",
                            },
                            {
                              label:
                                "P TD",
                              value:
                                stat.passing_tds_per_game,
                              key:
                                "nfl_pass_td",
                            },
                            {
                              label:
                                "INT",
                              value:
                                stat.passing_ints_per_game,
                              key:
                                "nfl_int",
                            },
                            {
                              label:
                                "RUSH",
                              value:
                                stat.rushing_yards_per_game,
                              key:
                                "nfl_rush_yd",
                            },
                            {
                              label:
                                "R TD",
                              value:
                                stat.rushing_tds_per_game,
                              key:
                                "nfl_rush_td",
                            },
                          ]
                        : [
                            {
                              label:
                                "TGT",
                              value:
                                stat.receiving_targets_per_game,
                              key:
                                "nfl_targets",
                            },
                            {
                              label:
                                "REC",
                              value:
                                stat.receptions_per_game,
                              key:
                                "nfl_receptions",
                            },
                            {
                              label:
                                "REC YD",
                              value:
                                stat.receiving_yards_per_game,
                              key:
                                "nfl_rec_yd",
                            },
                            {
                              label:
                                "RUSH",
                              value:
                                stat.rushing_yards_per_game,
                              key:
                                "nfl_rush_yd",
                            },
                            {
                              label:
                                "TD",
                              value:
                                Number(
                                  stat.receiving_tds_per_game ??
                                    0,
                                ) +
                                Number(
                                  stat.rushing_tds_per_game ??
                                    0,
                                ),
                              key:
                                sortBy ===
                                "nfl_rush_td"
                                  ? "nfl_rush_td"
                                  : "nfl_rec_td",
                            },
                          ];

                    return (
                      <div className="mt-2 grid grid-cols-5 gap-1 border-t border-slate-700/60 pt-2 text-center text-[9px] leading-tight text-slate-400">
                        {cardStats.map(
                          (
                            item,
                          ) => {
                            const active =
                              item.key ===
                              sortBy;

                            return (
                              <div
                                key={
                                  item.label
                                }
                                className={`rounded-lg px-1 py-1 ${
                                  active
                                    ? "border border-sky-300 bg-sky-50"
                                    : ""
                                }`}
                              >
                                <strong
                                  className={`block text-[12px] font-black leading-tight ${
                                    active
                                      ? "text-sky-800"
                                      : "text-slate-900"
                                  }`}
                                >
                                  {Number(
                                    item.value ??
                                      0,
                                  ).toFixed(
                                    item.label.includes(
                                      "TD",
                                    ) ||
                                    item.label ===
                                      "INT"
                                      ? 2
                                      : 1,
                                  )}
                                </strong>

                                {
                                  item.label
                                }
                              </div>
                            );
                          },
                        )}
                      </div>
                    );
                  })()
                ) : null}
                </div>

                {isNba &&
                researchMode ===
                  "season" &&
                seasonStat ? (
                  <div className="mt-2 grid grid-cols-3 gap-x-1.5 gap-y-1 text-center text-[9px] leading-tight text-slate-500 sm:grid-cols-6 sm:gap-1 sm:text-[10px]">
                    <span>
                      <strong className="block text-[13px] font-black leading-tight text-slate-900 sm:text-xs">
                        {formatScore(
                          seasonStat.points,
                        )}
                      </strong>
                      PTS
                    </span>

                    <span>
                      <strong className="block text-[13px] font-black leading-tight text-slate-900 sm:text-xs">
                        {formatScore(
                          seasonStat.rebounds,
                        )}
                      </strong>
                      REB
                    </span>

                    <span>
                      <strong className="block text-[13px] font-black leading-tight text-slate-900 sm:text-xs">
                        {formatScore(
                          seasonStat.assists,
                        )}
                      </strong>
                      AST
                    </span>

                    <span>
                      <strong className="block text-[13px] font-black leading-tight text-slate-900 sm:text-xs">
                        {formatScore(
                          seasonStat.steals,
                        )}
                      </strong>
                      STL
                    </span>

                    <span>
                      <strong className="block text-[13px] font-black leading-tight text-slate-900 sm:text-xs">
                        {formatScore(
                          seasonStat.blocks,
                        )}
                      </strong>
                      BLK
                    </span>

                    <span>
                      <strong className="block text-[13px] font-black leading-tight text-slate-900 sm:text-xs">
                        {formatScore(
                          seasonStat.turnovers,
                        )}
                      </strong>
                      TO
                    </span>
                  </div>
                ) : null}

                <div
                  className={`draft-player-card-action ${
                    ownerTeam
                      ? "draft-player-card-action--owned"
                      : ""
                  }`}
                >
                  {compareMode
                    ? comparePlayerIds.includes(
                        player.id,
                      )
                      ? "Selected ✓"
                      : "Compare"
                    : ownerTeam
                      ? `On ${ownerTeam.name}`
                      : "Draft"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {compareMode &&
      !compareOpen ? (
        <div className="fixed bottom-[5.75rem] left-3 right-3 z-[11000] sm:hidden">
          <div className="mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-sky-700/70 bg-slate-950/95 p-2.5 text-white shadow-2xl backdrop-blur">
            <div className="min-w-0 flex-1 px-1">
              <div className="text-xs font-black text-white">
                Compare Players
              </div>

              <div className="text-[11px] text-sky-300">
                {comparePlayerIds.length}/3 selected
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                setCompareMode(
                  false,
                );

                setComparePlayerIds(
                  [],
                );
              }}
              className="shrink-0 rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-bold text-slate-200"
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={
                comparePlayerIds.length <
                2
              }
              onClick={() =>
                setCompareOpen(
                  true,
                )
              }
              className="shrink-0 rounded-xl bg-sky-600 px-3 py-2 text-xs font-black text-white shadow-lg disabled:cursor-not-allowed disabled:opacity-40"
            >
              Compare (
              {
                comparePlayerIds.length
              }
              )
            </button>
          </div>
        </div>
      ) : null}

      {compareOpen &&
      comparePlayers.length >=
        2 ? (
        <div
          className="fixed inset-0 z-[12000] flex items-start justify-center bg-slate-950/75 px-0 pt-3 backdrop-blur-sm sm:items-center sm:p-6"
          onMouseDown={
            (
              event,
            ) => {
              if (
                event.target ===
                event.currentTarget
              ) {
                setCompareOpen(
                  false,
                );
              }
            }
          }
        >
          <section className="max-h-[calc(100dvh-1.5rem)] w-full overflow-y-auto rounded-[28px] border border-slate-700 bg-slate-950 text-white shadow-2xl sm:max-h-[92vh] sm:max-w-4xl">
            <header className="sticky top-0 z-10 flex items-center justify-between border-b border-sky-900 bg-slate-950/95 px-5 py-4 backdrop-blur">
              <div>
                <div className="text-xs font-black uppercase tracking-[0.2em] text-sky-300">
                  Head-to-Head
                </div>

                <h3 className="mt-1 text-xl font-black">
                  Compare Players
                </h3>

                <div className="mt-1 text-xs text-slate-400">
                  {isNfl
                    ? `${selectedSeason} NFL Season Stats`
                    : `${selectedSeason} NBA Season Stats`}
                </div>
              </div>

              <button
                type="button"
                onClick={() =>
                  setCompareOpen(
                    false,
                  )
                }
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800 text-xl text-slate-300"
              >
                ×
              </button>
            </header>

            <div className="p-4 sm:p-6">
              <div
                className="grid gap-2"
                style={{
                  gridTemplateColumns:
                    `110px repeat(${comparePlayers.length}, minmax(0, 1fr))`,
                }}
              >
                <div />

                {comparePlayers.map(
                  (
                    player,
                  ) => (
                    <div
                      key={
                        player.id
                      }
                      className="min-w-0 rounded-2xl border border-sky-700 bg-sky-950/40 p-3 text-center"
                    >
                      <div className="mx-auto w-fit">
                        <PlayerHeadshot
                          nbaPlayerId={
                            player.nba_player_id
                          }
                          nflPlayerId={
                            player.nfl_player_id
                          }
                          playerName={
                            player.name
                          }
                          size="md"
                        />
                      </div>

                      <div className="mt-2 text-sm font-black leading-tight">
                        {
                          player.name
                        }
                      </div>

                      <div className="mt-1 text-[10px] text-sky-300">
                        {
                          player.position_group
                        }
                      </div>
                    </div>
                  ),
                )}
              </div>

              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-700">
                {(
                  isNfl
                    ? [
                        [
                          "FP/G",
                          (
                            stat:
                              NflSeasonStat | undefined,
                          ) =>
                            stat?.fantasy_points_per_game,
                          false,
                        ],
                        ...(
                          comparePlayers.some(
                            (player) =>
                              String(
                                player.position_group ??
                                  "",
                              ).toUpperCase() ===
                              "QB",
                          )
                            ? [
                                [
                                  "Pass Yds/G",
                                  (
                                    stat:
                                      NflSeasonStat | undefined,
                                  ) =>
                                    stat?.passing_yards_per_game,
                                  false,
                                ],
                                [
                                  "Pass TD/G",
                                  (
                                    stat:
                                      NflSeasonStat | undefined,
                                  ) =>
                                    stat?.passing_tds_per_game,
                                  false,
                                ],
                                [
                                  "INT/G",
                                  (
                                    stat:
                                      NflSeasonStat | undefined,
                                  ) =>
                                    stat?.passing_ints_per_game,
                                  true,
                                ],
                              ]
                            : []
                        ),
                        [
                          "Rush Yds/G",
                          (
                            stat:
                              NflSeasonStat | undefined,
                          ) =>
                            stat?.rushing_yards_per_game,
                          false,
                        ],
                        [
                          "Rush TD/G",
                          (
                            stat:
                              NflSeasonStat | undefined,
                          ) =>
                            stat?.rushing_tds_per_game,
                          false,
                        ],
                        [
                          "Targets/G",
                          (
                            stat:
                              NflSeasonStat | undefined,
                          ) =>
                            stat?.receiving_targets_per_game,
                          false,
                        ],
                        [
                          "REC/G",
                          (
                            stat:
                              NflSeasonStat | undefined,
                          ) =>
                            stat?.receptions_per_game,
                          false,
                        ],
                        [
                          "Rec Yds/G",
                          (
                            stat:
                              NflSeasonStat | undefined,
                          ) =>
                            stat?.receiving_yards_per_game,
                          false,
                        ],
                        [
                          "Rec TD/G",
                          (
                            stat:
                              NflSeasonStat | undefined,
                          ) =>
                            stat?.receiving_tds_per_game,
                          false,
                        ],
                      ]
                    : isNba
                    ? [
                        [
                          "FP",
                          (
                            stat:
                              NbaSeasonStat | undefined,
                          ) =>
                            stat?.fantasy_points,
                          false,
                        ],
                        [
                          "PTS",
                          (
                            stat:
                              NbaSeasonStat | undefined,
                          ) =>
                            stat?.points,
                          false,
                        ],
                        [
                          "REB",
                          (
                            stat:
                              NbaSeasonStat | undefined,
                          ) =>
                            stat?.rebounds,
                          false,
                        ],
                        [
                          "AST",
                          (
                            stat:
                              NbaSeasonStat | undefined,
                          ) =>
                            stat?.assists,
                          false,
                        ],
                        [
                          "STL",
                          (
                            stat:
                              NbaSeasonStat | undefined,
                          ) =>
                            stat?.steals,
                          false,
                        ],
                        [
                          "BLK",
                          (
                            stat:
                              NbaSeasonStat | undefined,
                          ) =>
                            stat?.blocks,
                          false,
                        ],
                        [
                          "TO",
                          (
                            stat:
                              NbaSeasonStat | undefined,
                          ) =>
                            stat?.turnovers,
                          true,
                        ],
                      ]
                    : [
                        [
                          "Projection",
                          (
                            player:
                              Player,
                          ) =>
                            playerProjections?.[
                              player.id
                            ]?.projection ??
                            null,
                          false,
                        ],
                        [
                          "League Avg",
                          (
                            player:
                              Player,
                          ) =>
                            playerAverageMap.get(
                              player.id,
                            ) ??
                            null,
                          false,
                        ],
                      ]
                ).map(
                  (
                    metric,
                  ) => {
                    const [
                      label,
                      getter,
                      lowerIsBetter,
                    ] =
                      metric as [
                        string,
                        (
                          value:
                            any,
                        ) =>
                          number | null | undefined,
                        boolean,
                      ];

                    const values =
                      comparePlayers.map(
                        (
                          player,
                        ) => {
                          if (
                            isNfl
                          ) {
                            return Number(
                              getter(
                                nflSeasonStatByPlayerId.get(
                                  player.id,
                                ),
                              ) ??
                                NaN,
                            );
                          }

                          if (
                            isNba
                          ) {
                            return Number(
                              getter(
                                nbaSeasonStatByPlayerId.get(
                                  player.id,
                                ),
                              ) ??
                                NaN,
                            );
                          }

                          return Number(
                            getter(
                              player,
                            ) ??
                              NaN,
                          );
                        },
                      );

                    const finite =
                      values.filter(
                        Number.isFinite,
                      );

                    const best =
                      finite.length
                        ? lowerIsBetter
                          ? Math.min(
                              ...finite,
                            )
                          : Math.max(
                              ...finite,
                            )
                        : null;

                    return (
                      <div
                        key={
                          label
                        }
                        className="grid border-t border-slate-700 first:border-t-0"
                        style={{
                          gridTemplateColumns:
                            `110px repeat(${comparePlayers.length}, minmax(0, 1fr))`,
                        }}
                      >
                        <div className="flex items-center bg-slate-900 px-3 py-3 text-xs font-bold uppercase text-slate-400">
                          {
                            label
                          }
                        </div>

                        {values.map(
                          (
                            value,
                            index,
                          ) => {
                            const isBest =
                              best !==
                                null &&
                              Number.isFinite(
                                value,
                              ) &&
                              value ===
                                best;

                            return (
                              <div
                                key={`${label}-${comparePlayers[index].id}`}
                                className={`flex items-center justify-center border-l border-slate-700 px-2 py-3 text-sm font-black ${
                                  isBest
                                    ? "bg-sky-950 text-sky-300"
                                    : "bg-slate-900 text-white"
                                }`}
                              >
                                {Number.isFinite(
                                  value,
                                )
                                  ? formatScore(
                                      value,
                                    )
                                  : "—"}

                                {isBest
                                  ? " ✓"
                                  : ""}
                              </div>
                            );
                          },
                        )}
                      </div>
                    );
                  },
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}

      <div className="draft-player-pool-footer">
        Browsing {players.length} active players
      </div>
    </section>
  );
}
