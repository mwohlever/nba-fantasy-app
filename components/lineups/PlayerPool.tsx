"use client";

import { useEffect, useMemo, useState } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import PlayerResearchModal from "@/components/lineups/PlayerResearchModal";
import { useSelectedSport } from "@/components/providers/SportProvider";
import type {
  Player,
  PositionFilter,
  RosterSlotConfig,
  Team,
  TargetDraftSlot,
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

  /*
   * Optional context used by the roster-slot workflow.
   * The player browser itself remains shared with the normal
   * Players tab.
   */
  slotDraftContext?: {
    targetDraftSlot: TargetDraftSlot;
    onDraftPlayer: (
      player: Player,
    ) => Promise<void>;
  };

  hidePositionFilter?: boolean;
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
  | "nfl_rec_td"
  | "golf_scoring_avg"
  | "golf_cuts_pct"
  | "golf_wins"
  | "golf_top5"
  | "golf_top10"
  | "golf_birdies_round"
  | "golf_birdie_rate"
  | "golf_bogey_rate"
  | "golf_gir"
  | "golf_drive_acc"
  | "golf_drive_dist"
  | "golf_putts_gir"
  | "times_drafted"
  | "avg_score"
  | "high_score"
  | "winning_lineups"
  | "runner_up_lineups"
  | "podium_lineups"
  | "avg_finish";

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

type GolfSeasonStat = {
  player_id: number;
  player_name: string;

  espn_golf_player_id:
    string | null;

  headshot_url:
    string | null;

  country:
    string | null;

  owgr_rank:
    number | null;

  tournaments_played:
    number | null;

  rounds_played:
    number | null;

  cuts_made:
    number | null;

  cuts_made_pct:
    number | null;

  has_detailed_stats:
    boolean;

  wins:
    number | null;

  top_5_finishes:
    number | null;

  top_10_finishes:
    number | null;

  scoring_average:
    number | null;

  birdies_per_round:
    number | null;

  birdie_rate:
    number | null;

  bogey_rate:
    number | null;

  greens_in_reg_pct:
    number | null;

  driving_accuracy_pct:
    number | null;

  driving_distance:
    number | null;

  putts_per_gir:
    number | null;
};

type LeagueHistoryStat = {
  player_id: number;
  player_name: string;

  times_drafted:
    number | null;

  avg_score:
    number | null;

  high_score:
    number | null;

  low_score:
    number | null;

  winning_lineups:
    number | null;

  runner_up_lineups:
    number | null;

  podium_lineups:
    number | null;

  avg_finish:
    number | null;

  owgr_rank:
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
  slotDraftContext,
  hidePositionFilter = false,
}: PlayerPoolProps) {
  const { selectedSport } = useSelectedSport();
  const isGolf = selectedSport === "golf";
  const isNba = selectedSport === "nba";
  const isNfl = selectedSport === "nfl";

  const hasSeasonResearch =
    isNba ||
    isNfl ||
    isGolf;

  const [
    researchMode,
    setResearchMode,
  ] =
    useState<ResearchMode>(
      "season",
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
    golfSeasonStats,
    setGolfSeasonStats,
  ] =
    useState<GolfSeasonStat[]>(
      [],
    );

  const [
    leagueHistoryStats,
    setLeagueHistoryStats,
  ] =
    useState<LeagueHistoryStat[]>(
      [],
    );

  const [
    isLeagueHistoryLoading,
    setIsLeagueHistoryLoading,
  ] =
    useState(false);

  const [
    leagueHistoryError,
    setLeagueHistoryError,
  ] =
    useState("");

  const [
    researchPlayer,
    setResearchPlayer,
  ] =
    useState<Player | null>(
      null,
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
    setOnSlateOnly(false);
  }, [setOnSlateOnly]);

  useEffect(() => {
    setResearchMode(
      "season",
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

    setResearchPlayer(
      null,
    );

    setSortBy(
      isGolf
        ? "golf_scoring_avg"
        : isNfl
          ? "nfl_fp"
          : "season_fp",
    );
  }, [
    selectedSport,
    isGolf,
    isNfl,
  ]);

  useEffect(() => {
    let cancelled =
      false;

    async function loadLeagueHistory() {
      try {
        setIsLeagueHistoryLoading(
          true,
        );

        setLeagueHistoryError(
          "",
        );

        const response =
          await fetch(
            `/api/player-history?season=${selectedSeason}&sport=${selectedSport}`,
            {
              cache:
                "no-store",
            },
          );

        const result =
          await response.json();

        if (
          !response.ok
        ) {
          throw new Error(
            result?.error ??
              "League history is unavailable.",
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        const rawRows =
          Array.isArray(
            result?.playerHistory,
          )
            ? result.playerHistory
            : [];

        setLeagueHistoryStats(
          rawRows.map(
            (
              row:
                any,
            ) => ({
              player_id:
                Number(
                  row.player_id,
                ),

              player_name:
                String(
                  row.player_name ??
                    "",
                ),

              times_drafted:
                row.times_drafted ??
                0,

              avg_score:
                row.avg_score ??
                null,

              high_score:
                row.high_score ??
                null,

              low_score:
                row.low_score ??
                null,

              winning_lineups:
                row.winning_lineups ??
                0,

              runner_up_lineups:
                row.runner_up_lineups ??
                0,

              podium_lineups:
                row.podium_lineups ??
                0,

              avg_finish:
                row.avg_finish ??
                null,

              owgr_rank:
                row.owgr_rank ??
                null,
            }),
          ),
        );
      } catch (
        error
      ) {
        console.error(
          error,
        );

        if (
          !cancelled
        ) {
          setLeagueHistoryStats(
            [],
          );

          setLeagueHistoryError(
            error instanceof Error
              ? error.message
              : "League history is unavailable.",
          );
        }
      } finally {
        if (
          !cancelled
        ) {
          setIsLeagueHistoryLoading(
            false,
          );
        }
      }
    }

    void loadLeagueHistory();

    return () => {
      cancelled =
        true;
    };
  }, [
    selectedSeason,
    selectedSport,
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

  useEffect(() => {
    if (
      !isGolf
    ) {
      return;
    }

    let cancelled =
      false;

    async function loadGolfSeasonStats() {
      try {
        setIsSeasonStatsLoading(
          true,
        );

        setSeasonStatsError(
          "",
        );

        const response =
          await fetch(
            `/api/player-season-stats?season=${selectedSeason}&sport=golf`,
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
              "PGA season stats are unavailable.",
          );
        }

        if (
          cancelled
        ) {
          return;
        }

        setGolfSeasonStats(
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

        setGolfSeasonStats(
          [],
        );

        setSeasonStatsError(
          error instanceof Error
            ? error.message
            : "Failed to load PGA season stats.",
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

    void loadGolfSeasonStats();

    return () => {
      cancelled =
        true;
    };
  }, [
    isGolf,
    selectedSeason,
  ]);

  const golfSeasonStatByPlayerId =
    useMemo(() => {
      const map =
        new Map<
          number,
          GolfSeasonStat
        >();

      for (
        const row
        of golfSeasonStats
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
      golfSeasonStats,
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

  const leagueHistoryByPlayerId =
    useMemo(
      () => {
        const map =
          new Map<
            number,
            LeagueHistoryStat
          >();

        for (
          const row
          of leagueHistoryStats
        ) {
          map.set(
            Number(
              row.player_id,
            ),
            row,
          );
        }

        return map;
      },
      [
        leagueHistoryStats,
      ],
    );

  const sortedFilteredPlayers = useMemo(() => {
    return [...filteredPlayers].sort((a, b) => {
      if (
        researchMode ===
          "league"
      ) {
        if (
          sortBy ===
          "name"
        ) {
          return a.name.localeCompare(
            b.name,
          );
        }

        const aHistory =
          leagueHistoryByPlayerId.get(
            a.id,
          );

        const bHistory =
          leagueHistoryByPlayerId.get(
            b.id,
          );

        const getValue =
          (
            row:
              LeagueHistoryStat | undefined,
          ) => {
            if (
              !row
            ) {
              return null;
            }

            switch (
              sortBy
            ) {
              case "avg_score":
                return row.avg_score;

              case "high_score":
                return row.high_score;

              case "winning_lineups":
                return row.winning_lineups;

              case "runner_up_lineups":
                return row.runner_up_lineups;

              case "podium_lineups":
                return row.podium_lineups;

              case "avg_finish":
                return row.avg_finish;

              case "times_drafted":
              default:
                return row.times_drafted;
            }
          };

        const aValue =
          getValue(
            aHistory,
          );

        const bValue =
          getValue(
            bHistory,
          );

        const aMissing =
          aValue ===
            null ||
          aValue ===
            undefined ||
          !Number.isFinite(
            Number(
              aValue,
            ),
          );

        const bMissing =
          bValue ===
            null ||
          bValue ===
            undefined ||
          !Number.isFinite(
            Number(
              bValue,
            ),
          );

        if (
          aMissing &&
          bMissing
        ) {
          return a.name.localeCompare(
            b.name,
          );
        }

        if (
          aMissing
        ) {
          return 1;
        }

        if (
          bMissing
        ) {
          return -1;
        }

        const comparison =
          sortBy ===
          "avg_finish"
            ? Number(
                aValue,
              ) -
              Number(
                bValue,
              )
            : Number(
                bValue,
              ) -
              Number(
                aValue,
              );

        return comparison !==
          0
          ? comparison
          : a.name.localeCompare(
              b.name,
            );
      }

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
        isGolf
      ) {
        const aStat =
          golfSeasonStatByPlayerId.get(
            a.id,
          );

        const bStat =
          golfSeasonStatByPlayerId.get(
            b.id,
          );

        const value = (
          stat:
            GolfSeasonStat | undefined,
        ) => {
          switch (
            sortBy
          ) {
            case "golf_cuts_pct":
              return stat?.cuts_made_pct;

            case "golf_wins":
              return stat?.wins;

            case "golf_top5":
              return stat?.top_5_finishes;

            case "golf_top10":
              return stat?.top_10_finishes;

            case "golf_birdies_round":
              return stat?.birdies_per_round;

            case "golf_birdie_rate":
              return stat?.birdie_rate;

            case "golf_bogey_rate":
              return stat?.bogey_rate;

            case "golf_gir":
              return stat?.greens_in_reg_pct;

            case "golf_drive_acc":
              return stat?.driving_accuracy_pct;

            case "golf_drive_dist":
              return stat?.driving_distance;

            case "golf_putts_gir":
              return stat?.putts_per_gir;

            default:
              return stat?.scoring_average;
          }
        };

        const aValue =
          value(
            aStat,
          );

        const bValue =
          value(
            bStat,
          );

        const aMissing =
          aValue === null ||
          aValue === undefined ||
          !Number.isFinite(
            Number(
              aValue,
            ),
          );

        const bMissing =
          bValue === null ||
          bValue === undefined ||
          !Number.isFinite(
            Number(
              bValue,
            ),
          );

        if (
          aMissing &&
          bMissing
        ) {
          return a.name.localeCompare(
            b.name,
          );
        }

        if (
          aMissing
        ) {
          return 1;
        }

        if (
          bMissing
        ) {
          return -1;
        }

        const lowerIsBetter =
          sortBy ===
            "golf_scoring_avg" ||
          sortBy ===
            "golf_bogey_rate" ||
          sortBy ===
            "golf_putts_gir";

        const comparison =
          lowerIsBetter
            ? Number(
                aValue,
              ) -
              Number(
                bValue,
              )
            : Number(
                bValue,
              ) -
              Number(
                aValue,
              );

        return comparison !==
          0
          ? comparison
          : a.name.localeCompare(
              b.name,
            );
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
    golfSeasonStatByPlayerId,
    leagueHistoryByPlayerId,
    isGolf,
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

  const golfSeasonSortLabel =
    sortBy ===
      "owgr"
      ? "OWGR"
      : sortBy ===
          "golf_cuts_pct"
      ? "CUTS"
      : sortBy ===
          "golf_wins"
        ? "WINS"
        : sortBy ===
            "golf_top5"
          ? "TOP 5"
          : sortBy ===
              "golf_top10"
            ? "TOP 10"
            : sortBy ===
                "golf_birdies_round"
              ? "BIRD/R"
              : sortBy ===
                  "golf_birdie_rate"
                ? "BIRD%"
                : sortBy ===
                    "golf_bogey_rate"
                  ? "BOGEY%"
                  : sortBy ===
                      "golf_gir"
                    ? "GIR"
                    : sortBy ===
                        "golf_drive_acc"
                      ? "DRV ACC"
                      : sortBy ===
                          "golf_drive_dist"
                        ? "DIST"
                        : sortBy ===
                            "golf_putts_gir"
                          ? "PUTTS/GIR"
                          : "AVG";

  function golfSeasonSortValue(
    stat:
      GolfSeasonStat | undefined,
  ) {
    switch (
      sortBy
    ) {
      case "owgr":
        return stat?.owgr_rank;

      case "golf_cuts_pct":
        return stat?.cuts_made_pct;

      case "golf_wins":
        return stat?.wins;

      case "golf_top5":
        return stat?.top_5_finishes;

      case "golf_top10":
        return stat?.top_10_finishes;

      case "golf_birdies_round":
        return stat?.birdies_per_round;

      case "golf_birdie_rate":
        return stat?.birdie_rate;

      case "golf_bogey_rate":
        return stat?.bogey_rate;

      case "golf_gir":
        return stat?.greens_in_reg_pct;

      case "golf_drive_acc":
        return stat?.driving_accuracy_pct;

      case "golf_drive_dist":
        return stat?.driving_distance;

      case "golf_putts_gir":
        return stat?.putts_per_gir;

      default:
        return stat?.scoring_average;
    }
  }

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
                  "times_drafted",
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
                  ? isGolf
                    ? "bg-emerald-600 text-white"
                    : isNfl
                      ? "bg-sky-600 text-white"
                      : "bg-orange-600 text-white"
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
                  isGolf
                    ? "golf_scoring_avg"
                    : isNfl
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
                  ? isGolf
                    ? "bg-emerald-600 text-white"
                    : isNfl
                      ? "bg-sky-600 text-white"
                      : "bg-orange-600 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Season Stats
            </button>
          </div>

          {compareMode ? (
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
          ) : null}

          {researchMode ===
            "league" &&
          isLeagueHistoryLoading ? (
            <div className="text-xs text-slate-400">
              Loading league history…
            </div>
          ) : null}

          {researchMode ===
            "league" &&
          leagueHistoryError ? (
            <div className="rounded-xl border border-red-900 bg-red-950/50 px-3 py-2 text-xs text-red-200">
              {
                leagueHistoryError
              }
            </div>
          ) : null}

          {researchMode ===
            "season" &&
          isSeasonStatsLoading ? (
            <div className="text-xs text-slate-400">
              Loading{" "}
              {isGolf
                ? "PGA"
                : isNfl
                  ? "NFL"
                  : "NBA"}{" "}
              season stats…
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
          {!hidePositionFilter &&
          !isGolf ? (
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
          ) : (
            <div />
          )}

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
              {researchMode ===
                "league" ? (
                <>
                  <option value="times_drafted">
                    Times Drafted
                  </option>

                  <option value="avg_score">
                    Avg Score
                  </option>

                  <option value="high_score">
                    Best Score
                  </option>

                  <option value="winning_lineups">
                    Wins
                  </option>

                  {isGolf ? (
                    <option value="podium_lineups">
                      Podiums
                    </option>
                  ) : (
                    <option value="runner_up_lineups">
                      Runner-Ups
                    </option>
                  )}

                  <option value="avg_finish">
                    Avg Finish
                  </option>

                  <option value="name">
                    Player Name
                  </option>
                </>
              ) : isGolf &&
                researchMode ===
                  "season" ? (
                <>
                  <option value="owgr">
                    OWGR
                  </option>

                  <option value="golf_scoring_avg">
                    Scoring Average
                  </option>

                  <option value="golf_cuts_pct">
                    Cuts Made %
                  </option>

                  <option value="golf_wins">
                    Wins
                  </option>

                  <option value="golf_top5">
                    Top 5s
                  </option>

                  <option value="golf_top10">
                    Top 10s
                  </option>

                  <option value="golf_birdies_round">
                    Birdies / Round
                  </option>

                  <option value="golf_birdie_rate">
                    Birdie %
                  </option>

                  <option value="golf_bogey_rate">
                    Bogey %
                  </option>

                  <option value="golf_gir">
                    GIR %
                  </option>

                  <option value="golf_drive_acc">
                    Driving Accuracy
                  </option>

                  <option value="golf_drive_dist">
                    Driving Distance
                  </option>

                  <option value="golf_putts_gir">
                    Putts / GIR
                  </option>

                  <option value="name">
                    Player Name
                  </option>
                </>
              ) : isGolf ? (
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

            const golfSeasonStat =
              golfSeasonStatByPlayerId.get(
                player.id,
              );

            const leagueHistory =
              leagueHistoryByPlayerId.get(
                player.id,
              );

            const displayScore =
              isGolf
                ? researchMode ===
                    "season"
                  ? golfSeasonSortValue(
                      golfSeasonStat,
                    )
                  : player.owgr_rank
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
                ? researchMode ===
                    "season"
                  ? golfSeasonSortLabel
                  : "OWGR"
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

                  if (
                    researchMode ===
                    "season"
                  ) {
                    setResearchPlayer(
                      player,
                    );

                    return;
                  }

                  setDraftingPlayer(
                    player,
                  );
                }}
                className={`draft-player-card ${
                  hasSeasonResearch
                    ? "draft-player-card--season draft-player-card--research"
                    : ""
                } ${
                  ownerTeam
                    ? "draft-player-card--owned"
                    : ""
                } ${
                  comparePlayerIds.includes(
                    player.id,
                  )
                    ? isGolf
                      ? "ring-2 ring-emerald-400"
                      : isNfl
                        ? "ring-2 ring-sky-400"
                        : "ring-2 ring-orange-400"
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
                    {researchMode ===
                    "league" ? (
                      <span className="draft-player-score">
                        {leagueHistory
                          ? `Drafted ${
                              leagueHistory.times_drafted ??
                              0
                            }x`
                          : "Not drafted yet"}
                      </span>
                    ) : null}

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

                {researchMode ===
                  "league" ? (
                  (() => {
                    const avg =
                      leagueHistory?.avg_score;

                    const best =
                      leagueHistory?.high_score;

                    const wins =
                      leagueHistory?.winning_lineups ??
                      0;

                    const drafted =
                      leagueHistory?.times_drafted ??
                      0;

                    const runnerUps =
                      leagueHistory?.runner_up_lineups ??
                      0;

                    const podiums =
                      leagueHistory?.podium_lineups ??
                      0;

                    const avgFinish =
                      leagueHistory?.avg_finish;

                    const formatLeagueScore =
                      (
                        value:
                          number | null | undefined,
                      ) => {
                        if (
                          value === null ||
                          value === undefined ||
                          !Number.isFinite(
                            Number(
                              value,
                            ),
                          )
                        ) {
                          return "—";
                        }

                        return Number(
                          value,
                        ).toFixed(
                          1,
                        );
                      };

                    const dynamicBySort =
                      sortBy ===
                      "runner_up_lineups"
                        ? {
                            label:
                              "2ND",
                            value:
                              String(
                                runnerUps,
                              ),
                            key:
                              "runner_up_lineups",
                          }
                        : sortBy ===
                            "podium_lineups"
                          ? {
                              label:
                                "PODIUM",
                              value:
                                String(
                                  podiums,
                                ),
                              key:
                                "podium_lineups",
                            }
                          : sortBy ===
                              "avg_finish"
                            ? {
                                label:
                                  "FINISH",
                                value:
                                  formatLeagueScore(
                                    avgFinish,
                                  ),
                                key:
                                  "avg_finish",
                              }
                            : sortBy ===
                                "times_drafted"
                              ? {
                                  label:
                                    "DRAFTED",
                                  value:
                                    String(
                                      drafted,
                                    ),
                                  key:
                                    "times_drafted",
                                }
                              : {
                                  label:
                                    isGolf
                                      ? "PODIUM"
                                      : "DRAFTED",
                                  value:
                                    isGolf
                                      ? String(
                                          podiums,
                                        )
                                      : String(
                                          drafted,
                                        ),
                                  key:
                                    isGolf
                                      ? "podium_lineups"
                                      : "times_drafted",
                                };

                    const fixedKeys = [
                      "avg_score",
                      "high_score",
                      "winning_lineups",
                    ];

                    const defaultDynamic =
                      isGolf
                        ? {
                            label:
                              "PODIUM",
                            value:
                              String(
                                podiums,
                              ),
                            key:
                              "podium_lineups",
                          }
                        : {
                            label:
                              "DRAFTED",
                            value:
                              String(
                                drafted,
                              ),
                            key:
                              "times_drafted",
                          };

                    const dynamicStat =
                      fixedKeys.includes(
                        String(
                          sortBy,
                        ),
                      )
                        ? defaultDynamic
                        : dynamicBySort;

                    const cardStats = [
                      {
                        label:
                          "AVG",
                        value:
                          formatLeagueScore(
                            avg,
                          ),
                        key:
                          "avg_score",
                      },
                      {
                        label:
                          "BEST",
                        value:
                          formatLeagueScore(
                            best,
                          ),
                        key:
                          "high_score",
                      },
                      {
                        label:
                          "WINS",
                        value:
                          String(
                            wins,
                          ),
                        key:
                          "winning_lineups",
                      },
                      dynamicStat,
                    ];

                    const sportClasses =
                      isGolf
                        ? {
                            border:
                              "border-emerald-400",
                            bg:
                              "bg-emerald-950/70",
                            text:
                              "text-emerald-300",
                          }
                        : isNfl
                          ? {
                              border:
                                "border-sky-400",
                              bg:
                                "bg-sky-950/70",
                              text:
                                "text-sky-300",
                            }
                          : {
                              border:
                                "border-orange-400",
                              bg:
                                "bg-orange-950/70",
                              text:
                                "text-orange-300",
                            };

                    return (
                      <div className="mt-2 grid grid-cols-4 gap-1 border-t border-slate-700/60 pt-2 text-center">
                        {cardStats.map(
                          (
                            item,
                            index,
                          ) => {
                            const active =
                              item.key ===
                              sortBy;

                            return (
                              <div
                                key={`${item.label}-${index}`}
                                className={`rounded-lg border px-1 py-1.5 ${
                                  active
                                    ? `${sportClasses.border} ${sportClasses.bg}`
                                    : "border-transparent bg-slate-900/35"
                                }`}
                              >
                                <strong
                                  className={`block text-[13px] font-black leading-tight ${
                                    active
                                      ? sportClasses.text
                                      : "text-white"
                                  }`}
                                >
                                  {
                                    item.value
                                  }
                                </strong>

                                <span
                                  className={`mt-0.5 block text-[9px] font-bold uppercase leading-tight ${
                                    active
                                      ? sportClasses.text
                                      : "text-slate-400"
                                  }`}
                                >
                                  {
                                    item.label
                                  }
                                </span>
                              </div>
                            );
                          },
                        )}
                      </div>
                    );
                  })()
                ) : null}

                {isGolf &&
                researchMode ===
                  "season" &&
                golfSeasonStat ? (
                  (() => {
                    const fixedStats = [
                      {
                        label:
                          "AVG",
                        value:
                          golfSeasonStat.scoring_average,
                        key:
                          "golf_scoring_avg",
                        format:
                          "decimal2",
                      },
                      {
                        label:
                          "CUTS",
                        value:
                          golfSeasonStat.cuts_made_pct,
                        key:
                          "golf_cuts_pct",
                        format:
                          "percent0",
                      },
                      {
                        label:
                          "BIRD/R",
                        value:
                          golfSeasonStat.birdies_per_round,
                        key:
                          "golf_birdies_round",
                        format:
                          "decimal2",
                      },
                    ];

                    const dynamicBySort =
                      sortBy ===
                        "owgr"
                        ? {
                            label:
                              "OWGR",
                            value:
                              golfSeasonStat.owgr_rank ??
                              player.owgr_rank,
                            key:
                              "owgr",
                            format:
                              "rank",
                          }
                        : sortBy ===
                            "golf_wins"
                        ? {
                            label:
                              "WINS",
                            value:
                              golfSeasonStat.wins,
                            key:
                              "golf_wins",
                            format:
                              "integer",
                          }
                        : sortBy ===
                            "golf_top5"
                          ? {
                              label:
                                "TOP 5",
                              value:
                                golfSeasonStat.top_5_finishes,
                              key:
                                "golf_top5",
                              format:
                                "integer",
                            }
                          : sortBy ===
                              "golf_top10"
                            ? {
                                label:
                                  "TOP 10",
                                value:
                                  golfSeasonStat.top_10_finishes,
                                key:
                                  "golf_top10",
                                format:
                                  "integer",
                              }
                            : sortBy ===
                                "golf_birdie_rate"
                              ? {
                                  label:
                                    "BIRD %",
                                  value:
                                    golfSeasonStat.birdie_rate,
                                  key:
                                    "golf_birdie_rate",
                                  format:
                                    "percent1",
                                }
                              : sortBy ===
                                  "golf_bogey_rate"
                                ? {
                                    label:
                                      "BOGEY %",
                                    value:
                                      golfSeasonStat.bogey_rate,
                                    key:
                                      "golf_bogey_rate",
                                    format:
                                      "percent1",
                                  }
                                : sortBy ===
                                    "golf_drive_acc"
                                  ? {
                                      label:
                                        "DRV ACC",
                                      value:
                                        golfSeasonStat.driving_accuracy_pct,
                                      key:
                                        "golf_drive_acc",
                                      format:
                                        "percent1",
                                    }
                                  : sortBy ===
                                      "golf_drive_dist"
                                    ? {
                                        label:
                                          "DRV DIST",
                                        value:
                                          golfSeasonStat.driving_distance,
                                        key:
                                          "golf_drive_dist",
                                        format:
                                          "decimal1",
                                      }
                                    : sortBy ===
                                        "golf_putts_gir"
                                      ? {
                                          label:
                                            "PUTTS",
                                          value:
                                            golfSeasonStat.putts_per_gir,
                                          key:
                                            "golf_putts_gir",
                                          format:
                                            "decimal2",
                                        }
                                      : {
                                          label:
                                            "GIR",
                                          value:
                                            golfSeasonStat.greens_in_reg_pct,
                                          key:
                                            "golf_gir",
                                          format:
                                            "percent1",
                                        };

                    const fixedKeys =
                      fixedStats.map(
                        (
                          stat,
                        ) =>
                          stat.key,
                      );

                    const dynamicStat =
                      fixedKeys.includes(
                        sortBy,
                      )
                        ? {
                            label:
                              "GIR",
                            value:
                              golfSeasonStat.greens_in_reg_pct,
                            key:
                              "golf_gir",
                            format:
                              "percent1",
                          }
                        : dynamicBySort;

                    const cardStats = [
                      ...fixedStats,
                      dynamicStat,
                    ];

                    function formatGolfCardValue(
                      item:
                        (typeof cardStats)[number],
                    ) {
                      if (
                        item.value ===
                          null ||
                        item.value ===
                          undefined ||
                        !Number.isFinite(
                          Number(
                            item.value,
                          ),
                        )
                      ) {
                        return "—";
                      }

                      const value =
                        Number(
                          item.value,
                        );

                      if (
                        item.format ===
                        "percent0"
                      ) {
                        return `${value.toFixed(
                          0,
                        )}%`;
                      }

                      if (
                        item.format ===
                        "percent1"
                      ) {
                        return `${value.toFixed(
                          1,
                        )}%`;
                      }

                      if (
                        item.format ===
                        "rank"
                      ) {
                        return `#${value.toFixed(
                          0,
                        )}`;
                      }

                      if (
                        item.format ===
                        "integer"
                      ) {
                        return value.toFixed(
                          0,
                        );
                      }

                      if (
                        item.format ===
                        "decimal1"
                      ) {
                        return value.toFixed(
                          1,
                        );
                      }

                      return value.toFixed(
                        2,
                      );
                    }

                    return (
                      <div className="mt-2 grid grid-cols-4 gap-1 border-t border-slate-700/60 pt-2 text-center">
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
                                className={`rounded-lg border px-1 py-1.5 ${
                                  active
                                    ? "border-emerald-400 bg-emerald-950/70"
                                    : "border-transparent bg-slate-900/35"
                                }`}
                              >
                                <strong
                                  className={`block text-[13px] font-black leading-tight ${
                                    active
                                      ? "text-emerald-300"
                                      : "text-white"
                                  }`}
                                >
                                  {formatGolfCardValue(
                                    item,
                                  )}
                                </strong>

                                <span
                                  className={`mt-0.5 block text-[9px] font-bold uppercase leading-tight ${
                                    active
                                      ? "text-emerald-300"
                                      : "text-slate-400"
                                  }`}
                                >
                                  {
                                    item.label
                                  }
                                </span>
                              </div>
                            );
                          },
                        )}
                      </div>
                    );
                  })()
                ) : null}

                {isNfl &&
                researchMode ===
                  "season" &&
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

                    const fpStat = {
                      label:
                        "FP/G",
                      value:
                        stat.fantasy_points_per_game,
                      key:
                        "nfl_fp",
                      digits:
                        1,
                    };

                    const qbFixed = [
                      fpStat,
                      {
                        label:
                          "PASS",
                        value:
                          stat.passing_yards_per_game,
                        key:
                          "nfl_pass_yd",
                        digits:
                          1,
                      },
                      {
                        label:
                          "P TD",
                        value:
                          stat.passing_tds_per_game,
                        key:
                          "nfl_pass_td",
                        digits:
                          2,
                      },
                    ];

                    const rbFixed = [
                      fpStat,
                      {
                        label:
                          "RUSH",
                        value:
                          stat.rushing_yards_per_game,
                        key:
                          "nfl_rush_yd",
                        digits:
                          1,
                      },
                      {
                        label:
                          "TGT",
                        value:
                          stat.receiving_targets_per_game,
                        key:
                          "nfl_targets",
                        digits:
                          1,
                      },
                    ];

                    const receiverFixed = [
                      fpStat,
                      {
                        label:
                          "TGT",
                        value:
                          stat.receiving_targets_per_game,
                        key:
                          "nfl_targets",
                        digits:
                          1,
                      },
                      {
                        label:
                          "REC",
                        value:
                          stat.receptions_per_game,
                        key:
                          "nfl_receptions",
                        digits:
                          1,
                      },
                    ];

                    const fixedStats =
                      position ===
                      "QB"
                        ? qbFixed
                        : position ===
                            "RB"
                          ? rbFixed
                          : receiverFixed;

                    const dynamicBySort =
                      sortBy ===
                        "nfl_pass_yd"
                        ? {
                            label:
                              "PASS",
                            value:
                              stat.passing_yards_per_game,
                            key:
                              "nfl_pass_yd",
                            digits:
                              1,
                          }
                        : sortBy ===
                            "nfl_pass_td"
                          ? {
                              label:
                                "P TD",
                              value:
                                stat.passing_tds_per_game,
                              key:
                                "nfl_pass_td",
                              digits:
                                2,
                            }
                          : sortBy ===
                              "nfl_int"
                            ? {
                                label:
                                  "INT",
                                value:
                                  stat.passing_ints_per_game,
                                key:
                                  "nfl_int",
                                digits:
                                  2,
                              }
                            : sortBy ===
                                "nfl_rush_yd"
                              ? {
                                  label:
                                    "RUSH",
                                  value:
                                    stat.rushing_yards_per_game,
                                  key:
                                    "nfl_rush_yd",
                                  digits:
                                    1,
                                }
                              : sortBy ===
                                  "nfl_rush_td"
                                ? {
                                    label:
                                      "R TD",
                                    value:
                                      stat.rushing_tds_per_game,
                                    key:
                                      "nfl_rush_td",
                                    digits:
                                      2,
                                  }
                                : sortBy ===
                                    "nfl_targets"
                                  ? {
                                      label:
                                        "TGT",
                                      value:
                                        stat.receiving_targets_per_game,
                                      key:
                                        "nfl_targets",
                                      digits:
                                        1,
                                    }
                                  : sortBy ===
                                      "nfl_receptions"
                                    ? {
                                        label:
                                          "REC",
                                        value:
                                          stat.receptions_per_game,
                                        key:
                                          "nfl_receptions",
                                        digits:
                                          1,
                                      }
                                    : sortBy ===
                                        "nfl_rec_td"
                                      ? {
                                          label:
                                            "REC TD",
                                          value:
                                            stat.receiving_tds_per_game,
                                          key:
                                            "nfl_rec_td",
                                          digits:
                                            2,
                                        }
                                      : {
                                          label:
                                            "REC YD",
                                          value:
                                            stat.receiving_yards_per_game,
                                          key:
                                            "nfl_rec_yd",
                                          digits:
                                            1,
                                        };

                    const fixedKeys =
                      fixedStats.map(
                        (
                          item,
                        ) =>
                          item.key,
                      );

                    const defaultDynamic =
                      position ===
                      "QB"
                        ? {
                            label:
                              "RUSH",
                            value:
                              stat.rushing_yards_per_game,
                            key:
                              "nfl_rush_yd",
                            digits:
                              1,
                          }
                        : position ===
                            "RB"
                          ? {
                              label:
                                "REC",
                              value:
                                stat.receptions_per_game,
                              key:
                                "nfl_receptions",
                              digits:
                                1,
                            }
                          : {
                              label:
                                "REC YD",
                              value:
                                stat.receiving_yards_per_game,
                              key:
                                "nfl_rec_yd",
                              digits:
                                1,
                            };

                    const dynamicStat =
                      fixedKeys.includes(
                        sortBy,
                      )
                        ? defaultDynamic
                        : dynamicBySort;

                    const cardStats = [
                      ...fixedStats,
                      dynamicStat,
                    ];

                    return (
                      <div className="mt-2 grid grid-cols-4 gap-1 border-t border-slate-700/60 pt-2 text-center">
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
                                className={`rounded-lg border px-1 py-1.5 ${
                                  active
                                    ? "border-sky-400 bg-sky-950/70"
                                    : "border-transparent bg-slate-900/35"
                                }`}
                              >
                                <strong
                                  className={`block text-[13px] font-black leading-tight ${
                                    active
                                      ? "text-sky-300"
                                      : "text-white"
                                  }`}
                                >
                                  {Number(
                                    item.value ??
                                      0,
                                  ).toFixed(
                                    item.digits,
                                  )}
                                </strong>

                                <span
                                  className={`mt-0.5 block text-[9px] font-bold uppercase ${
                                    active
                                      ? "text-sky-300"
                                      : "text-slate-400"
                                  }`}
                                >
                                  {
                                    item.label
                                  }
                                </span>
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
                  (() => {
                    const fixedStats = [
                      {
                        label:
                          "FP",
                        value:
                          seasonStat.fantasy_points,
                        key:
                          "season_fp",
                      },
                      {
                        label:
                          "PTS",
                        value:
                          seasonStat.points,
                        key:
                          "season_pts",
                      },
                      {
                        label:
                          "REB",
                        value:
                          seasonStat.rebounds,
                        key:
                          "season_reb",
                      },
                    ];

                    const dynamicBySort =
                      sortBy ===
                        "season_ast"
                        ? {
                            label:
                              "AST",
                            value:
                              seasonStat.assists,
                            key:
                              "season_ast",
                          }
                        : sortBy ===
                            "season_stl"
                          ? {
                              label:
                                "STL",
                              value:
                                seasonStat.steals,
                              key:
                                "season_stl",
                            }
                          : sortBy ===
                              "season_blk"
                            ? {
                                label:
                                  "BLK",
                                value:
                                  seasonStat.blocks,
                                key:
                                  "season_blk",
                              }
                            : sortBy ===
                                "season_to"
                              ? {
                                  label:
                                    "TO",
                                  value:
                                    seasonStat.turnovers,
                                  key:
                                    "season_to",
                                }
                              : {
                                  label:
                                    "AST",
                                  value:
                                    seasonStat.assists,
                                  key:
                                    "season_ast",
                                };

                    const fixedKeys =
                      fixedStats.map(
                        (
                          item,
                        ) =>
                          item.key,
                      );

                    const dynamicStat =
                      fixedKeys.includes(
                        sortBy,
                      )
                        ? {
                            label:
                              "AST",
                            value:
                              seasonStat.assists,
                            key:
                              "season_ast",
                          }
                        : dynamicBySort;

                    const cardStats = [
                      ...fixedStats,
                      dynamicStat,
                    ];

                    return (
                      <div className="mt-2 grid grid-cols-4 gap-1 border-t border-slate-700/60 pt-2 text-center">
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
                                className={`rounded-lg border px-1 py-1.5 ${
                                  active
                                    ? "border-sky-400 bg-sky-950/70"
                                    : "border-transparent bg-slate-900/35"
                                }`}
                              >
                                <strong
                                  className={`block text-[13px] font-black leading-tight ${
                                    active
                                      ? "text-sky-300"
                                      : "text-white"
                                  }`}
                                >
                                  {formatScore(
                                    item.value,
                                  )}
                                </strong>

                                <span
                                  className={`mt-0.5 block text-[9px] font-bold uppercase ${
                                    active
                                      ? "text-sky-300"
                                      : "text-slate-400"
                                  }`}
                                >
                                  {
                                    item.label
                                  }
                                </span>
                              </div>
                            );
                          },
                        )}
                      </div>
                    );
                  })()
                ) : null}

                <div
                  className={`draft-player-card-action ${
                    ownerTeam
                      ? "draft-player-card-action--owned"
                      : ""
                  }`}
                  style={
                    researchMode ===
                      "season"
                      ? {
                          display:
                            "none",
                        }
                      : undefined
                  }
                >
                  {compareMode
                    ? comparePlayerIds.includes(
                        player.id,
                      )
                      ? "Selected ✓"
                      : "Compare"
                    : researchMode ===
                        "season"
                      ? "View Stats"
                      : ownerTeam
                        ? `On ${ownerTeam.name}`
                        : "Draft"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <PlayerResearchModal
        player={
          researchPlayer
            ? {
                id:
                  researchPlayer.id,

                name:
                  researchPlayer.name,

                nbaPlayerId:
                  researchPlayer.nba_player_id ??
                  null,

                nflPlayerId:
                  researchPlayer.nfl_player_id ??
                  null,

                espnGolfPlayerId:
                  researchPlayer.espn_player_id ??
                  null,

                headshotUrl:
                  researchPlayer.headshot_url ??
                  null,

                positionGroup:
                  researchPlayer.position_group ??
                  null,

                owgrRank:
                  researchPlayer.owgr_rank ??
                  null,
              }
            : null
        }
        sport={
          selectedSport as
            | "nba"
            | "nfl"
            | "golf"
        }
        season={
          Number(
            selectedSeason,
          )
        }
        defaultMode="season"
        actionLabel={
          researchPlayer
            ? slotDraftContext
              ? `Draft to ${slotDraftContext.targetDraftSlot.positionGroup} Slot`
              : "Draft"
            : undefined
        }
        onAction={
          researchPlayer
            ? async () => {
                if (
                  slotDraftContext
                ) {
                  await slotDraftContext.onDraftPlayer(
                    researchPlayer,
                  );

                  setResearchPlayer(
                    null,
                  );

                  return;
                }

                /*
                 * Season Stats uses PlayerResearchModal instead of
                 * the normal DraftPlayerModal.
                 *
                 * Hand the selected player back to the established
                 * draft flow so availability, ownership, current turn,
                 * admin assignment, and roster rules remain centralized.
                 */
                const playerToDraft =
                  researchPlayer;

                setResearchPlayer(
                  null,
                );

                setDraftingPlayer(
                  playerToDraft,
                );
              }
            : undefined
        }
        onClose={() =>
          setResearchPlayer(
            null,
          )
        }
      />

      {!compareMode &&
      !compareOpen &&
      hasSeasonResearch ? (
        <button
          type="button"
          data-floating-compare="true"
          onClick={() => {
            setCompareMode(
              true,
            );

            setComparePlayerIds(
              [],
            );
          }}
          className={`fixed bottom-[5.75rem] right-3 z-[10990] rounded-2xl border px-4 py-3 text-sm font-black text-white shadow-2xl backdrop-blur sm:bottom-6 sm:right-6 ${
            isGolf
              ? "border-emerald-400/80 bg-emerald-900/95 text-emerald-50"
              : isNfl
                ? "border-sky-400/80 bg-sky-950/95 text-sky-50"
                : "border-orange-400/80 bg-orange-950/95 text-orange-50"
          }`}
        >
          ⇄ Compare{" "}
          {isGolf
            ? "Golfers"
            : "Players"}
        </button>
      ) : null}

      {compareMode &&
      !compareOpen ? (
        <div
          data-floating-compare-selection="true"
          className="fixed bottom-[5.75rem] left-3 right-3 z-[11000] sm:hidden"
        >
          <div className="mx-auto flex max-w-md items-center gap-2 rounded-2xl border border-sky-700/70 bg-slate-950/95 p-2.5 text-white shadow-2xl backdrop-blur">
            <div className="min-w-0 flex-1 px-1">
              <div className="text-xs font-black text-white">
                Compare{" "}
                {isGolf
                  ? "Golfers"
                  : "Players"}
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
                  Compare{" "}
                  {isGolf
                    ? "Golfers"
                    : "Players"}
                </h3>

                <div className="mt-1 text-xs text-slate-400">
                  {isGolf
                    ? `${selectedSeason} PGA Season Stats`
                    : isNfl
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
                          espnGolfPlayerId={
                            player.espn_player_id
                          }
                          imageUrl={
                            player.headshot_url
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
                  isGolf
                    ? [
                        [
                          "Scoring Avg",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.scoring_average,
                          true,
                        ],
                        [
                          "Cuts %",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.cuts_made_pct,
                          false,
                        ],
                        [
                          "Wins",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.wins,
                          false,
                        ],
                        [
                          "Top 5",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.top_5_finishes,
                          false,
                        ],
                        [
                          "Top 10",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.top_10_finishes,
                          false,
                        ],
                        [
                          "Birdies/R",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.birdies_per_round,
                          false,
                        ],
                        [
                          "Birdie %",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.birdie_rate,
                          false,
                        ],
                        [
                          "Bogey %",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.bogey_rate,
                          true,
                        ],
                        [
                          "GIR %",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.greens_in_reg_pct,
                          false,
                        ],
                        [
                          "Drive Acc %",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.driving_accuracy_pct,
                          false,
                        ],
                        [
                          "Drive Dist",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.driving_distance,
                          false,
                        ],
                        [
                          "Putts/GIR",
                          (
                            stat:
                              GolfSeasonStat | undefined,
                          ) =>
                            stat?.putts_per_gir,
                          true,
                        ],
                      ]
                    : isNfl
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
                            isGolf
                          ) {
                            return Number(
                              getter(
                                golfSeasonStatByPlayerId.get(
                                  player.id,
                                ),
                              ) ??
                                NaN,
                            );
                          }

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
