"use client";

import DraftPlayerModal from "@/components/lineups/DraftPlayerModal";
import ReadOnlyPlayerModal from "@/components/lineups/ReadOnlyPlayerModal";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import SlotDraftModal from "@/components/lineups/SlotDraftModal";
import PlayerPool from "@/components/lineups/PlayerPool";
import DraftRosterCourt from "@/components/lineups/DraftRosterCourt";
import LeagueLineupCards from "@/components/lineups/LeagueLineupCards";
import ScoresDashboard from "@/components/lineups/ScoresDashboard";
import { useEffect, useMemo, useRef, useState } from "react";
import LineupControls from "@/components/lineups/LineupControls";
import { getStatColumns } from "@/lib/statColumns";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { getSportConfig } from "@/lib/sports";
import type {
  Player,
  PlayerHistoryDetailRow,
  PlayerStat,
  PositionFilter,
  Props,
  RosterSlotConfig,
  SavedLineup,
  Team,
  TeamResult,
  ViewMode,
  TargetDraftSlot,
} from "@/components/lineups/types";

export default function LineupBuilder({
  players,
  teams,
  slates,
  slateTeamConfigs,
  playerAverages,
  initialSelectedSlateId,
  savedLineupsForInitialSlate,
  playerStats,
  teamResults,
  rosterSlots = [],
  defaultViewMode,
  sport,
}: Props) {
  const { selectedSport, setSelectedSport } = useSelectedSport();

  useEffect(() => {
    if (sport && sport !== selectedSport) {
      setSelectedSport(sport);
    }
  }, [sport]);

  const [selectedSlateId, setSelectedSlateId] = useState<string>(
    initialSelectedSlateId ? String(initialSelectedSlateId) : ""
  );

  const [selectedSeason, setSelectedSeason] = useState<string>(() => {
    const initialSlate = slates.find(
      (slate) => slate.id === Number(initialSelectedSlateId)
    );

    const initialDate = initialSlate?.start_date ?? initialSlate?.date ?? "";
    return initialDate ? initialDate.slice(0, 4) : "2026";
  });
  const [message, setMessage] = useState("");
  const latestSlateLoadRef = useRef(0);
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSlateLoading, setIsSlateLoading] = useState(false);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [isAvailabilityLoading, setIsAvailabilityLoading] = useState(false);
  const [isAssigningPlayer, setIsAssigningPlayer] = useState(false);
  const [draftingPlayerHistory, setDraftingPlayerHistory] = useState<
    PlayerHistoryDetailRow[]
  >([]);
  const [isDraftingPlayerHistoryLoading, setIsDraftingPlayerHistoryLoading] =
    useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("All");
  const [onSlateOnly, setOnSlateOnly] = useState(false);
  const [viewMode] = useState<ViewMode>(defaultViewMode ?? "scoring");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const [compactView, setCompactView] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    teamId: number;
    displayName: string;
    role: "player" | "admin";
  } | null>(null);
  const [
    notifyNextDrafterForProxyPicks,
    setNotifyNextDrafterForProxyPicks,
  ] = useState(false);

  const [lineupsState, setLineupsState] = useState<SavedLineup[]>(
    savedLineupsForInitialSlate
  );
  const [playerStatsState, setPlayerStatsState] =
    useState<PlayerStat[]>(playerStats);
  const [teamResultsState, setTeamResultsState] =
    useState<TeamResult[]>(teamResults);
  const [availablePlayerIdsForSlate, setAvailablePlayerIdsForSlate] =
    useState<number[]>([]);
  const [draftingPlayer, setDraftingPlayer] = useState<Player | null>(null);
  const [
    isInspectingPlayerFromSlot,
    setIsInspectingPlayerFromSlot,
  ] = useState(false);
  const [profilePlayer, setProfilePlayer] = useState<Player | null>(null);
  const [targetDraftSlot, setTargetDraftSlot] =
    useState<TargetDraftSlot | null>(null);

  const [draftPageTab, setDraftPageTab] = useState<
    "lineup" | "players"
  >("lineup");

  const [lastRefreshSummary, setLastRefreshSummary] = useState<{
    gamesFound?: number;
    playerStatsUpserted?: number;
    teamResultsUpserted?: number;
  } | null>(null);

  const seasons = useMemo(() => {
    const uniqueYears = new Set<string>();

    slates.forEach((slate) => {
      const date = slate.start_date ?? slate.date;
      if (date) uniqueYears.add(date.slice(0, 4));
    });

    return Array.from(uniqueYears).sort((a, b) => Number(b) - Number(a));
  }, [slates]);

  const filteredSlates = useMemo(() => {
    return slates.filter((slate) => {
      const date = slate.start_date ?? slate.date;
      const matchesSeason = date?.startsWith(selectedSeason);
      const matchesSport = (slate.sport ?? "nba") === selectedSport;
      return matchesSeason && matchesSport;
    });
  }, [slates, selectedSeason, selectedSport]);

  const selectedSlateIdNumber = selectedSlateId ? Number(selectedSlateId) : null;
  const selectedSlate =
    slates.find((slate) => slate.id === selectedSlateIdNumber) ?? null;

  const selectedSlateDisplay =
    selectedSlate?.label ?? selectedSlate?.date ?? "No slate selected";

  useEffect(() => {
    setHasMounted(true);
    if (window.innerWidth < 768) {
      setCompactView(true);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadCurrentUser() {
      try {
        const response = await fetch("/api/me", {
          cache: "no-store",
        });

        const result = await response.json();

        if (!isActive) return;

        if (!response.ok) {
          setCurrentUser(null);
          return;
        }

        setCurrentUser(result.user ?? null);
      } catch (error) {
        console.error("Failed to load current user", error);

        if (isActive) {
          setCurrentUser(null);
        }
      }
    }

    void loadCurrentUser();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!filteredSlates.length) return;

    const selectedStillInYear = filteredSlates.some(
      (slate) => String(slate.id) === selectedSlateId
    );

    if (!selectedStillInYear) {
      setSelectedSlateId(String(filteredSlates[0].id));
    }
  }, [filteredSlates, selectedSlateId]);

  useEffect(() => {
    if (!draftingPlayer) {
      setDraftingPlayerHistory([]);
      setIsDraftingPlayerHistoryLoading(false);
      return;
    }

    async function loadDraftingPlayerHistory() {
      if ((sport ?? selectedSport) === "golf") {
        setDraftingPlayerHistory([]);
        setIsDraftingPlayerHistoryLoading(false);
        return;
      }

      try {
        setIsDraftingPlayerHistoryLoading(true);

        if (!draftingPlayer) return;

        const response = await fetch(
          `/api/player-history-detail?playerId=${draftingPlayer.id}&season=2026&limit=10`,
          { cache: "no-store" }
        );

        const result = await response.json();

        if (!response.ok) {
          console.error(result.error || "Failed to load player history detail.");
          setDraftingPlayerHistory([]);
          return;
        }

        setDraftingPlayerHistory(result.history ?? []);
      } catch (error) {
        console.error(error);
        setDraftingPlayerHistory([]);
      } finally {
        setIsDraftingPlayerHistoryLoading(false);
      }
    }

    void loadDraftingPlayerHistory();
  }, [draftingPlayer, sport, selectedSport]);

  useEffect(() => {
    setPlayerStatsState(playerStats);
  }, [playerStats]);

  useEffect(() => {
    setTeamResultsState(teamResults);
  }, [teamResults]);

  useEffect(() => {
    if (!selectedSlateIdNumber) return;

    let isActive = true;

    async function loadAvailability() {
      try {
        setIsAvailabilityLoading(true);

        const res = await fetch(
          `/api/slate-availability?slateId=${selectedSlateIdNumber}`,
          { cache: "no-store" }
        );
        const data = await res.json();

        if (!isActive) return;

        const nextIds = data.availablePlayerIds || [];
        setAvailablePlayerIdsForSlate(nextIds);
      } catch (err) {
        console.error("Failed to load availability", err);
        if (!isActive) return;
        setAvailablePlayerIdsForSlate([]);
      } finally {
        if (isActive) {
          setIsAvailabilityLoading(false);
        }
      }
    }

    void loadAvailability();

    return () => {
      isActive = false;
    };
  }, [selectedSlateIdNumber]);

  useEffect(() => {
    if (!autoRefreshEnabled || !selectedSlateIdNumber) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshStatsForSelectedSlate(true);
    }, 30000);

    return () => window.clearInterval(interval);
  }, [autoRefreshEnabled, selectedSlateIdNumber]);

  useEffect(() => {
    if (!selectedSlateIdNumber) return;
    void loadSlateLineups(selectedSlateIdNumber);
  }, [selectedSlateIdNumber]);

  const playerStatsMap = useMemo(() => {
    const map = new Map<number, PlayerStat>();
    playerStatsState.forEach((stat) => {
      map.set(stat.player_id, stat);
    });
    return map;
  }, [playerStatsState]);

  const [playerProjections, setPlayerProjections] = useState<Record<number, any>>({});

  useEffect(() => {
    if (!selectedSeason) return;

    if ((sport ?? "nba") !== "nba") {
      setPlayerProjections({});
      return;
    }

    fetch(`/api/player-projections?season=${selectedSeason}`, { cache: "no-store" })
      .then((res) => res.json())
      .then((data) => setPlayerProjections(data.projections || {}))
      .catch((error) => {
        console.error("Failed to load player projections", error);
        setPlayerProjections({});
      });
  }, [selectedSeason, sport]);

  const playerAverageMap = useMemo(() => {
    const map = new Map<number, number>();
    playerAverages.forEach((row) => {
      map.set(row.player_id, row.avg_fantasy_points);
    });
    return map;
  }, [playerAverages]);

  const getPlayerProjectionScore = (playerId: number) => {
    const projected = playerProjections?.[playerId]?.projection;
    const fallback = playerAverageMap.get(playerId);
    const value = projected ?? fallback ?? 0;
    return Number.isFinite(Number(value)) ? Number(value) : 0;
  };

  const getPregameProjectedTeamTotal = (teamId: number) => {
    const lineup = lineupsState.find(
      (item) => item.team_id === teamId
    );

    const value = lineup?.pregame_projected_points;

    return value !== null &&
      value !== undefined &&
      Number.isFinite(Number(value))
      ? Number(value)
      : null;
  };

  const teamResultsMap = useMemo(() => {
    const map = new Map<number, TeamResult>();
    teamResultsState.forEach((result) => {
      map.set(result.team_id, result);
    });
    return map;
  }, [teamResultsState]);

  const availablePlayerIdSet = useMemo(
    () => new Set(availablePlayerIdsForSlate),
    [availablePlayerIdsForSlate]
  );

  const teamsById = useMemo(() => {
    const map = new Map<number, Team>();
    teams.forEach((team) => map.set(team.id, team));
    return map;
  }, [teams]);

  const orderedTeamsForSlate = useMemo(() => {
    if (!selectedSlateIdNumber) return teams;

    const configs = slateTeamConfigs
      .filter((config) => config.slate_id === selectedSlateIdNumber)
      .sort((a, b) => a.draft_order - b.draft_order);

    if (configs.length === 0) return teams;

    const configuredIds = configs.map((config) => config.team_id);
    const configuredTeams = configs
      .map((config) => {
        const team = teamsById.get(config.team_id);
        if (!team) return null;

        return {
          ...team,
          is_participating: config.is_participating,
          draft_order: config.draft_order,
        };
      })
      .filter(Boolean) as Array<
      Team & { is_participating?: boolean; draft_order?: number }
    >;

    const missingTeams = teams
      .filter((team) => !configuredIds.includes(team.id))
      .map((team, index) => ({
        ...team,
        is_participating: true,
        draft_order: configuredTeams.length + index + 1,
      }));

    return [...configuredTeams, ...missingTeams];
  }, [selectedSlateIdNumber, slateTeamConfigs, teams, teamsById]);

  const participatingTeamIds = useMemo(() => {
    return new Set(
      orderedTeamsForSlate
        .filter((team) => (team as any).is_participating !== false)
        .map((team) => team.id)
    );
  }, [orderedTeamsForSlate]);

  const filteredPlayers = useMemo(() => {
    return players
      .filter((player) => {
        if (
          searchTerm &&
          !player.name.toLowerCase().includes(searchTerm.toLowerCase())
        ) {
          return false;
        }

        if (positionFilter !== "All" && player.position_group !== positionFilter) {
          return false;
        }

        if (onSlateOnly && !isAvailabilityLoading) {
          return availablePlayerIdSet.has(player.id);
        }

        return true;
      })
      .sort((a, b) => {
        if ((selectedSlate?.sport ?? selectedSport) === "golf") {
          return a.name.localeCompare(b.name);
        }

        const avgA = playerAverageMap.get(a.id);
        const avgB = playerAverageMap.get(b.id);

        if (avgA == null && avgB == null) return 0;
        if (avgA == null) return 1;
        if (avgB == null) return -1;

        return avgB - avgA;
      });
  }, [
    players,
    searchTerm,
    positionFilter,
    onSlateOnly,
    isAvailabilityLoading,
    availablePlayerIdSet,
    playerAverageMap,
    selectedSlate?.sport,
    selectedSport,
  ]);

  function getLineupForTeam(teamId: number) {
    return lineupsState.find((item) => item.team_id === teamId) ?? null;
  }

  const playersById = useMemo(() => {
    const map = new Map<number, Player>();
    players.forEach((player) => {
      map.set(player.id, player);
    });
    return map;
  }, [players]);

  function getPlayersForTeam(teamId: number) {
    const lineup = getLineupForTeam(teamId);
    if (!lineup) return [];

    return lineup.player_ids
      .map((playerId) => {
        const player = playersById.get(playerId);

        if (player) return player;

        return {
          id: playerId,
          name: `Player ${playerId}`,
          position_group: "G" as "G" | "F/C",
          is_active: false,
          is_playing_today: null,
        };
      })
      .filter((p): p is Player => Boolean(p));
  }

  function getOwnerTeamIdForPlayer(playerId: number) {
    const owner = lineupsState.find((lineup) =>
      lineup.player_ids.includes(playerId)
    );
    return owner?.team_id ?? null;
  }

  function getOwnerTeamForPlayer(playerId: number) {
    const ownerTeamId = getOwnerTeamIdForPlayer(playerId);
    if (!ownerTeamId) return null;
    return orderedTeamsForSlate.find((team) => team.id === ownerTeamId) ?? null;
  }

  function getTeamStats(teamId: number) {
    const teamPlayers = getPlayersForTeam(teamId);

    const guards = teamPlayers.filter(
      (player) => player.position_group === "G"
    ).length;
    const fcPlayers = teamPlayers.filter(
      (player) => player.position_group === "F/C"
    ).length;

    const sport = selectedSlate?.sport ?? "nba";
    const statColumns = getStatColumns(sport);

    const statTotals: Record<string, number> = {};
    statColumns.forEach((column) => {
      statTotals[column.key] = 0;
    });

    teamPlayers.forEach((player) => {
      const stat = playerStatsMap.get(player.id) as any;
      if (!stat) return;

      statColumns.forEach((column) => {
        statTotals[column.key] += Number(stat[column.key] ?? 0);
      });
    });

    const teamResult = teamResultsMap.get(teamId);

    const nbaFallback =
      (statTotals.points ?? 0) +
      (statTotals.rebounds ?? 0) * 1.2 +
      (statTotals.assists ?? 0) * 1.5 +
      (statTotals.steals ?? 0) * 2 +
      (statTotals.blocks ?? 0) * 2 -
      (statTotals.turnovers ?? 0);

    const playerFantasyTotal = teamPlayers.reduce((sum, player) => {
      const stat = playerStatsMap.get(player.id);
      return sum + Number(stat?.fantasy_points ?? 0);
    }, 0);

    const total =
      teamResult?.fantasy_points ??
      (sport === "nba"
        ? nbaFallback
        : sport === "golf"
          ? playerFantasyTotal
          : 0);

    return {
      totalPlayers: teamPlayers.length,
      guards,
      fcPlayers,
      statTotals,
      points: statTotals.points ?? 0,
      rebounds: statTotals.rebounds ?? 0,
      assists: statTotals.assists ?? 0,
      steals: statTotals.steals ?? 0,
      blocks: statTotals.blocks ?? 0,
      turnovers: statTotals.turnovers ?? 0,
      total,
      games_completed: teamResult?.games_completed ?? 0,
      games_in_progress: teamResult?.games_in_progress ?? 0,
      games_remaining: teamResult?.games_remaining ?? 0,
      finish_position: teamResult?.finish_position ?? null,
    };
  }

  function getPlayerStat(playerId: number) {
    const stat = playerStatsMap.get(playerId) as any;
    const sport = selectedSlate?.sport ?? "nba";
    const statColumns = getStatColumns(sport);

    const statValues: Record<string, number> = {};
    statColumns.forEach((column) => {
      statValues[column.key] = Number(stat?.[column.key] ?? 0);
    });

    return {
      ...statValues,
      points: statValues.points ?? 0,
      rebounds: statValues.rebounds ?? 0,
      assists: statValues.assists ?? 0,
      steals: statValues.steals ?? 0,
      blocks: statValues.blocks ?? 0,
      turnovers: statValues.turnovers ?? 0,
      fantasy_points: stat?.fantasy_points ?? 0,
    };
  }

  function getRawPlayerStat(playerId: number) {
    return playerStatsMap.get(playerId) ?? null;
  }

  // ===== LIVE WIN % HELPERS =====

  function parseNbaIsoClockMinutes(gameClock?: string | null) {
    if (!gameClock) return null;

    const match = gameClock.match(/^PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
    if (!match) return null;

    const minutes = Number(match[1] ?? 0);
    const seconds = Number(match[2] ?? 0);

    return minutes + seconds / 60;
  }

  function parseStatusTextMinutesRemaining(statusText?: string | null) {
    if (!statusText) return null;

    const trimmed = statusText.trim();

    if (/final/i.test(trimmed)) return 0;

    const match = trimmed.match(/^Q(\d+)\s+(?:(\d*)?:)?(\d+(?:\.\d+)?)$/i);
    if (!match) return null;

    const period = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] ?? 0);

    if (!Number.isFinite(period)) return null;

    const clockMinutes = minutes + seconds / 60;
    const periodsRemainingAfterCurrent = Math.max(4 - period, 0);

    return periodsRemainingAfterCurrent * 12 + clockMinutes;
  }

  function getMinutesRemainingForPlayer(stat?: PlayerStat) {
    const gameStatus = stat?.game_status ?? null;

    if (gameStatus === 3) return 0;

    const period = stat?.period ?? null;
    const clockMinutes = parseNbaIsoClockMinutes(stat?.game_clock);

    if (gameStatus === 2 && period && clockMinutes !== null) {
      const regulationPeriods = 4;
      const periodsRemainingAfterCurrent = Math.max(
        regulationPeriods - period,
        0
      );

      return periodsRemainingAfterCurrent * 12 + clockMinutes;
    }

    const statusTextMinutes = parseStatusTextMinutesRemaining(
      stat?.game_status_text
    );

    if (statusTextMinutes !== null) return statusTextMinutes;

    return 48;
  }

  function getLiveProjectedTeamTotal(teamId: number) {
    const stats = getTeamStats(teamId);

    if ((selectedSlate?.sport ?? selectedSport) === "golf") {
      return Number(stats.total ?? 0);
    }

    if (selectedSlate?.is_locked) {
      return Number(stats.total ?? 0);
    }

    const teamPlayers = getPlayersForTeam(teamId);

    return teamPlayers.reduce((sum, player) => {
      const stat = playerStatsMap.get(player.id);

      const current = Number(stat?.fantasy_points ?? 0);

      const projection =
        playerProjections?.[player.id]?.projection ??
        playerAverageMap.get(player.id) ??
        0;

      const minutesRemaining = getMinutesRemainingForPlayer(stat);
      const remainingFactor = minutesRemaining / 48;

      const projected =
        minutesRemaining <= 0
          ? current
          : current + projection * remainingFactor;

      return sum + projected;
    }, 0);
  }

  function computeWinPctMap() {
    const map = new Map<number, number>();

    if ((selectedSlate?.sport ?? selectedSport) === "golf") {
      return map;
    }

    if (selectedSlate?.is_locked) {
      const rows = orderedTeamsForSlate
        .map((team) => ({
          teamId: team.id,
          total: Number(getTeamStats(team.id).total ?? 0),
        }))
        .sort((a, b) => b.total - a.total);

      const winnerTeamId = rows[0]?.teamId ?? null;

      rows.forEach((row) => {
        map.set(row.teamId, row.teamId === winnerTeamId ? 100 : 0);
      });

      return map;
    }

    const k = 20;

    const teams = orderedTeamsForSlate.map((team) => ({
      teamId: team.id,
      projected: getLiveProjectedTeamTotal(team.id),
    }));

    const weights = teams.map((t) => ({
      ...t,
      weight: Math.exp(t.projected / k),
    }));

    const totalWeight = weights.reduce((sum, t) => sum + t.weight, 0);

    weights.forEach((t) => {
      let pct = (t.weight / totalWeight) * 100;
      pct = Math.max(5, Math.min(95, pct));
      map.set(t.teamId, pct);
    });

    return map;
  }

  const liveWinPctMap = computeWinPctMap();

  function getEffectiveRosterSlots() {
    if (rosterSlots.length > 0) {
      return rosterSlots;
    }

    const activeSport = selectedSlate?.sport ?? selectedSport;

    if (activeSport === "golf") {
      return [
        {
          sport: "golf",
          position: "GOLFER",
          slot_count: 4,
          display_order: 1,
        },
      ];
    }

    return [
      { sport: "nba", position: "G", slot_count: 2, display_order: 1 },
      { sport: "nba", position: "F/C", slot_count: 3, display_order: 2 },
    ];
  }

  function getRosterTotalSlots() {
    return getEffectiveRosterSlots().reduce(
      (sum, slot) => sum + slot.slot_count,
      0
    );
  }

  function countPlayersByPosition(playerList: Player[]) {
    const map = new Map<string, number>();
    playerList.forEach((player) => {
      map.set(
        player.position_group,
        (map.get(player.position_group) ?? 0) + 1
      );
    });
    return map;
  }

  function getDraftNeeds(teamId: number) {
    const teamPlayers = getPlayersForTeam(teamId);
    const counts = countPlayersByPosition(teamPlayers);
    const slots = getEffectiveRosterSlots();

    const parts: string[] = [];

    slots.forEach((slot) => {
      const have = counts.get(slot.position) ?? 0;
      const needed = Math.max(0, slot.slot_count - have);
      if (needed > 0) parts.push(`${needed} ${slot.position}`);
    });

    if (parts.length === 0) {
      return "Roster full";
    }

    return `Needs ${parts.join(" • ")}`;
  }

  const dailySummary = useMemo(() => {
    const rows = orderedTeamsForSlate.map((team) => {
      const stats = getTeamStats(team.id);
      return {
        teamId: team.id,
        teamName: team.name,
        total: Number(stats.total ?? 0),
        games_completed: Number(stats.games_completed ?? 0),
        games_in_progress: Number(stats.games_in_progress ?? 0),
        games_remaining: Number(stats.games_remaining ?? 0),
        finish_position: stats.finish_position,
        is_participating: (team as any).is_participating !== false,
      };
    });

    const leader =
      rows
        .filter((row) => row.is_participating)
        .sort((a, b) =>
        (selectedSlate?.sport ?? selectedSport) === "golf"
          ? a.total - b.total
          : b.total - a.total,
      )[0] ?? null;

    return {
      leader,
      rows,
    };
  }, [orderedTeamsForSlate, teamResultsState, playerStatsState, lineupsState]);

  function getTeamAssignmentStatus(teamId: number, player: Player) {
    const team = orderedTeamsForSlate.find((item) => item.id === teamId);
    const teamPlayers = getPlayersForTeam(teamId);
    const ownerTeamId = getOwnerTeamIdForPlayer(player.id);
    const isParticipating = (team as any)?.is_participating !== false;

    if (!selectedSlateIdNumber) {
      return { canAssign: false, reason: "No slate selected" };
    }
    if (selectedSlate?.is_locked) {
      return { canAssign: false, reason: "Slate locked" };
    }
    if (!isParticipating) return { canAssign: false, reason: "Out" };
    if (ownerTeamId === teamId) {
      return { canAssign: false, reason: "Already here" };
    }

    const nextPlayers = [...teamPlayers, player];
    const totalSlots = getRosterTotalSlots();

    if (nextPlayers.length > totalSlots) {
      return { canAssign: false, reason: "Lineup full" };
    }

    const nextCounts = countPlayersByPosition(nextPlayers);
    const slots = getEffectiveRosterSlots();

    for (const slot of slots) {
      const count = nextCounts.get(slot.position) ?? 0;
      if (count > slot.slot_count) {
        return { canAssign: false, reason: `Too many ${slot.position}` };
      }
    }

    return { canAssign: true, reason: "" };
  }

  async function loadSlateLineups(nextSlateId: number) {
    const loadId = ++latestSlateLoadRef.current;

    setLineupsState([]);
    setPlayerStatsState([]);
    setTeamResultsState([]);

    try {
      setIsSlateLoading(true);
      setMessage("");
      setSaveMessage("");

      const [lineupsResponse, statsResponse, resultsResponse] = await Promise.all([
        fetch(`/api/lineups?slateId=${nextSlateId}`, { cache: "no-store" }),
        fetch(`/api/player-stats?slateId=${nextSlateId}`, { cache: "no-store" }),
        fetch(`/api/team-results?slateId=${nextSlateId}`, { cache: "no-store" }),
      ]);

      const lineupsResult = await lineupsResponse.json();
      const statsResult = await statsResponse.json();
      const resultsResult = await resultsResponse.json();

      if (loadId !== latestSlateLoadRef.current) return;

      if (!lineupsResponse.ok) {
        setSaveMessage(lineupsResult.error || "Failed to load slate lineups.");
        return;
      }

      if (!statsResponse.ok) {
        setSaveMessage(statsResult.error || "Failed to load player stats.");
        return;
      }

      if (!resultsResponse.ok) {
        setSaveMessage(resultsResult.error || "Failed to load team results.");
        return;
      }

      setLineupsState(lineupsResult.lineups ?? []);
      setPlayerStatsState(statsResult.playerStats ?? []);
      setTeamResultsState(resultsResult.teamResults ?? []);
      setSaveMessage("");
    } catch (error) {
      if (loadId !== latestSlateLoadRef.current) return;
      console.error(error);
      setSaveMessage("Something went wrong while loading the slate.");
    } finally {
      if (loadId === latestSlateLoadRef.current) {
        setIsSlateLoading(false);
      }
    }

    try {
      setIsAvailabilityLoading(true);

      const availabilityResponse = await fetch(
        `/api/slate-availability?slateId=${nextSlateId}`,
        { cache: "no-store" }
      );

      const availabilityResult = await availabilityResponse.json();

      if (loadId !== latestSlateLoadRef.current) return;

      if (!availabilityResponse.ok) {
        console.error(
          availabilityResult.error || "Failed to load slate availability."
        );
        setAvailablePlayerIdsForSlate([]);
        return;
      }

      setAvailablePlayerIdsForSlate(availabilityResult.availablePlayerIds ?? []);
    } catch (error) {
      if (loadId !== latestSlateLoadRef.current) return;
      console.error(error);
      setAvailablePlayerIdsForSlate([]);
    } finally {
      if (loadId === latestSlateLoadRef.current) {
        setIsAvailabilityLoading(false);
      }
    }
  }

  async function refreshStatsForSelectedSlate(isSilent = false) {
    if (!selectedSlateIdNumber) {
      if (!isSilent) alert("No slate selected.");
      return;
    }

    try {
      setIsRefreshingStats(true);
      if (!isSilent) {
        setMessage("");
        setSaveMessage("");
      }

      const refreshEndpoint =
        selectedSlate?.sport === "nfl"
          ? "/api/refresh-stats-nfl"
          : selectedSlate?.sport === "golf"
            ? "/api/refresh-stats-golf"
            : "/api/refresh-stats";

      const refreshResponse = await fetch(refreshEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slateId: selectedSlateIdNumber }),
        cache: "no-store",
      });

      const refreshResult = await refreshResponse.json();

      if (!refreshResponse.ok) {
        if (!isSilent) {
          alert(refreshResult.error || "Failed to refresh stats.");
        } else {
          console.error(refreshResult.error || "Failed to refresh stats.");
        }
        return;
      }

      setLastRefreshSummary({
        gamesFound: refreshResult.gamesFound,
        playerStatsUpserted: refreshResult.playerStatsUpserted,
        teamResultsUpserted: refreshResult.teamResultsUpserted,
      });

      const [statsResponse, resultsResponse] = await Promise.all([
        fetch(`/api/player-stats?slateId=${selectedSlateIdNumber}`, {
          cache: "no-store",
        }),
        fetch(`/api/team-results?slateId=${selectedSlateIdNumber}`, {
          cache: "no-store",
        }),
      ]);

      const statsResult = await statsResponse.json();
      const resultsResult = await resultsResponse.json();

      setPlayerStatsState(statsResult.playerStats ?? []);
      setTeamResultsState(resultsResult.teamResults ?? []);
      setLastUpdatedAt(new Date().toISOString());

      if (!isSilent) {
        setSaveMessage("Stats refreshed successfully.");
      }

      fetch(`/api/slate-availability?slateId=${selectedSlateIdNumber}`, {
        cache: "no-store",
      })
        .then((res) => res.json())
        .then((availabilityResult) => {
          setAvailablePlayerIdsForSlate(availabilityResult.availablePlayerIds ?? []);
        })
        .catch((error) => {
          console.error(error);
        });
    } catch (error) {
      console.error(error);
      if (!isSilent) alert("Something went wrong while refreshing stats.");
    } finally {
      setIsRefreshingStats(false);
    }
  }

  async function persistLineupForTeam(
    teamId: number,
    playerList: Player[],
    successMessage?: string,
    options?: {
      allowEmpty?: boolean;
      notifyNextDrafter?: boolean;
    }
  ) {
    setSaveMessage("");
    setMessage("");

    if (!selectedSlateIdNumber) {
      setSaveMessage("Please choose a slate before saving.");
      return false;
    }
    if (!participatingTeamIds.has(teamId)) {
      setSaveMessage("That team is not participating in this slate.");
      return false;
    }
    if (selectedSlate?.is_locked) {
      setSaveMessage("This slate is locked.");
      return false;
    }
    if (!options?.allowEmpty && playerList.length === 0) {
      setSaveMessage("Select at least 1 player before saving.");
      return false;
    }

    const totalSlots = getRosterTotalSlots();
    const slots = getEffectiveRosterSlots();
    const listCounts = countPlayersByPosition(playerList);

    if (playerList.length > totalSlots) {
      setSaveMessage(`A lineup can have at most ${totalSlots} players.`);
      return false;
    }

    const overLimitSlot = slots.find(
      (slot) => (listCounts.get(slot.position) ?? 0) > slot.slot_count
    );

    if (overLimitSlot) {
      const limitDescription = slots
        .map((slot) => `${slot.slot_count} ${slot.position}`)
        .join(" and ");
      setSaveMessage(`A lineup can have at most ${limitDescription}.`);
      return false;
    }

    try {
      setIsSaving(true);

      const response = await fetch("/api/lineups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slateId: selectedSlateIdNumber,
          teamId,
          playerIds: playerList.map((player) => player.id),
          notifyNextDrafter: options?.notifyNextDrafter === true,
        }),
        cache: "no-store",
      });

      const result = await response.json();

      if (!response.ok) {
        setSaveMessage(result.error || "Failed to save lineup.");
        return false;
      }

      setLineupsState((prev) => {
        const otherTeams = prev.filter((lineup) => lineup.team_id !== teamId);
        return [
          ...otherTeams,
          {
            team_id: teamId,
            player_ids: playerList.map((player) => player.id),
          },
        ];
      });

      if (successMessage) setSaveMessage(successMessage);
      return true;
    } catch (error) {
      console.error(error);
      setSaveMessage("Something went wrong while saving the lineup.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAssignPlayerToTeam(player: Player, targetTeamId: number) {
    const targetTeam = orderedTeamsForSlate.find((team) => team.id === targetTeamId);
    if (!targetTeam) return;

    const assignmentStatus = getTeamAssignmentStatus(targetTeamId, player);
    if (!assignmentStatus.canAssign) {
      setSaveMessage(assignmentStatus.reason);
      return;
    }

    const currentOwnerTeamId = getOwnerTeamIdForPlayer(player.id);
    const targetPlayers = getPlayersForTeam(targetTeamId);

    if (currentOwnerTeamId === targetTeamId) {
      setSaveMessage(`${player.name} is already on ${targetTeam.name}.`);
      return;
    }

    try {
      setIsAssigningPlayer(true);

      if (currentOwnerTeamId && currentOwnerTeamId !== targetTeamId) {
        const ownerPlayers = getPlayersForTeam(currentOwnerTeamId).filter(
          (item) => item.id !== player.id
        );

        const removed = await persistLineupForTeam(
          currentOwnerTeamId,
          ownerPlayers,
          undefined,
          { allowEmpty: true }
        );

        if (!removed) return;
      }

      const isAdminProxyPick =
        currentUser?.role === "admin" &&
        targetTeamId !== currentUser.teamId;

      const shouldNotifyNextDrafter = isAdminProxyPick
        ? notifyNextDrafterForProxyPicks
        : true;

      const added = await persistLineupForTeam(
        targetTeamId,
        [...targetPlayers, player],
        `${player.name} drafted to ${targetTeam.name}.`,
        {
          notifyNextDrafter: shouldNotifyNextDrafter,
        }
      );

      if (!added) return;

      setDraftingPlayer(null);
      setSearchTerm("");

      if (selectedSlateIdNumber) {
        void loadSlateLineups(selectedSlateIdNumber);
      }
    } finally {
      setIsAssigningPlayer(false);
    }
  }

  async function handleRemovePlayerFromTeam(player: Player) {
    const ownerTeamId = getOwnerTeamIdForPlayer(player.id);
    const ownerTeam = getOwnerTeamForPlayer(player.id);

    if (!ownerTeamId || !ownerTeam) return;

    try {
      setIsAssigningPlayer(true);

      const nextPlayers = getPlayersForTeam(ownerTeamId).filter(
        (item) => item.id !== player.id
      );

      const removed = await persistLineupForTeam(
        ownerTeamId,
        nextPlayers,
        `${player.name} removed from ${ownerTeam.name}.`,
        { allowEmpty: true }
      );

      if (!removed) return;

      setDraftingPlayer(null);
      setSearchTerm("");

      if (selectedSlateIdNumber) {
        void loadSlateLineups(selectedSlateIdNumber);
      }
    } finally {
      setIsAssigningPlayer(false);
    }
  }

  const pillBase =
    "rounded-full border px-3 py-1.5 text-xs font-medium transition";
  const activePill = "border-sky-300 bg-sky-100 text-sky-900";
  const inactivePill =
    "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50";

  const scoreTableCellClass = compactView
    ? "px-0 py-0 text-xs"
    : "px-3 py-2 text-sm";

  const scoreTableHeaderClass = compactView
    ? "border-b border-slate-200 px-0 py-0 font-semibold"
    : "border-b border-slate-200 px-3 py-2 font-semibold";

  const ownerTeamForDraftingPlayer = draftingPlayer
    ? getOwnerTeamForPlayer(draftingPlayer.id)
    : null;

  function inspectPlayerFromSlot(player: Player) {
    setIsInspectingPlayerFromSlot(true);
    setDraftingPlayer(player);
  }

  const setDraftingPlayerWithSlotRestore:
    React.Dispatch<React.SetStateAction<Player | null>> = (
      value
    ) => {
      setDraftingPlayer((currentPlayer) => {
        const nextPlayer =
          typeof value === "function"
            ? value(currentPlayer)
            : value;

        if (!nextPlayer) {
          setIsInspectingPlayerFromSlot(false);
        }

        return nextPlayer;
      });
    };

  async function handleDraftToTargetSlot(
    player: Player
  ) {
    if (!targetDraftSlot) return;

    await handleAssignPlayerToTeam(
      player,
      targetDraftSlot.teamId
    );

    setDraftingPlayer(null);
    setIsInspectingPlayerFromSlot(false);
    setTargetDraftSlot(null);
  }

  const lineupControls = (
    <LineupControls
      selectedSlateId={selectedSlateId}
      setSelectedSlateId={setSelectedSlateId}
      slates={filteredSlates}
      selectedSlate={selectedSlate}
      selectedSlateDisplay={selectedSlateDisplay}
      selectedSlateIdNumber={selectedSlateIdNumber}
      isRefreshingStats={isRefreshingStats}
      refreshStatsForSelectedSlate={
        refreshStatsForSelectedSlate
      }
      autoRefreshEnabled={autoRefreshEnabled}
      setAutoRefreshEnabled={
        setAutoRefreshEnabled
      }
      compactView={compactView}
      setCompactView={setCompactView}
      hasMounted={hasMounted}
      isSlateLoading={isSlateLoading}
      lastUpdatedAt={lastUpdatedAt}
      seasons={seasons}
      selectedSeason={selectedSeason}
      setSelectedSeason={setSelectedSeason}
    />
  );

  return (
    <div className="space-y-6">
      {viewMode === "draft"
        ? lineupControls
        : null}

      {message ? (
        <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
          {message}
        </div>
      ) : null}

      {currentUser?.role === "admin" && viewMode === "draft" ? (
        <section className="draft-admin-toggle">
          <div>
            <strong>Proxy Pick Notifications</strong>
            <span>
              Notify the next drafter after an admin-entered pick.
            </span>
          </div>

          <label className="draft-admin-switch">
            <input
              type="checkbox"
              checked={notifyNextDrafterForProxyPicks}
              onChange={(event) =>
                setNotifyNextDrafterForProxyPicks(
                  event.target.checked
                )
              }
            />

            <span aria-hidden="true" />

            <em>
              {notifyNextDrafterForProxyPicks
                ? "On"
                : "Off"}
            </em>
          </label>
        </section>
      ) : null}

      {saveMessage ? (
        <div
          className={`rounded-2xl px-4 py-3 text-sm ${
            saveMessage.toLowerCase().includes("success") ||
            saveMessage.toLowerCase().includes("loaded") ||
            saveMessage.toLowerCase().includes("drafted") ||
            saveMessage.toLowerCase().includes("removed") ||
            saveMessage.toLowerCase().includes("refreshed")
              ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {saveMessage}
        </div>
      ) : null}

      {viewMode === "draft" ? (
        <>
          <section className="draft-page-tabs">
            <button
              type="button"
              onClick={() => setDraftPageTab("lineup")}
              className={`draft-page-tab ${
                draftPageTab === "lineup"
                  ? "draft-page-tab--active"
                  : ""
              }`}
            >
              <span aria-hidden="true">{getSportConfig(selectedSport).emoji}</span>
              <span>Lineup</span>

              {currentUser?.teamId ? (
                <span className="draft-page-tab-count">
                  {getPlayersForTeam(currentUser.teamId).length}/{getRosterTotalSlots()}
                </span>
              ) : null}
            </button>

            <button
              type="button"
              onClick={() => setDraftPageTab("players")}
              className={`draft-page-tab ${
                draftPageTab === "players"
                  ? "draft-page-tab--active"
                  : ""
              }`}
            >
              <span aria-hidden="true">🔎</span>
              <span>Players</span>
            </button>
          </section>

          {draftPageTab === "lineup" ? (
            <DraftRosterCourt
              teamId={currentUser?.teamId ?? null}
              teamName={currentUser?.displayName ?? null}
              players={
                currentUser?.teamId
                  ? getPlayersForTeam(currentUser.teamId)
                  : []
              }
              rosterSlots={rosterSlots}
              isLocked={Boolean(selectedSlate?.is_locked)}
              setDraftingPlayer={setDraftingPlayer}
              setTargetDraftSlot={setTargetDraftSlot}
            />
          ) : (
            <PlayerPool
              players={players}
              filteredPlayers={filteredPlayers}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              positionFilter={positionFilter}
              setPositionFilter={setPositionFilter}
              onSlateOnly={onSlateOnly}
              setOnSlateOnly={setOnSlateOnly}
              isAvailabilityLoading={isAvailabilityLoading}
              availablePlayerIdsForSlate={availablePlayerIdsForSlate}
              availablePlayerIdSet={availablePlayerIdSet}
              playerAverageMap={playerAverageMap}
              playerProjections={playerProjections}
              getOwnerTeamForPlayer={getOwnerTeamForPlayer}
              setDraftingPlayer={setDraftingPlayer}
              isAssigningPlayer={isAssigningPlayer}
              pillBase={pillBase}
              activePill={activePill}
              inactivePill={inactivePill}
              rosterSlots={rosterSlots}
            />
          )}

          <LeagueLineupCards
            teams={orderedTeamsForSlate}
            currentTeamId={currentUser?.teamId ?? null}
            getPlayersForTeam={getPlayersForTeam}
            getPlayerProjectionScore={
              getPlayerProjectionScore
            }
            getDraftNeeds={getDraftNeeds}
            rosterSlots={rosterSlots}
            setDraftingPlayer={setDraftingPlayer}
            setTargetDraftSlot={setTargetDraftSlot}
            isLocked={Boolean(
              selectedSlate?.is_locked
            )}
          />
        </>
      ) : (
        <ScoresDashboard
          teams={orderedTeamsForSlate}
          selectedSlate={selectedSlate}
          rosterSlots={rosterSlots}
          lastRefreshSummary={lastRefreshSummary}
          getPlayersForTeam={getPlayersForTeam}
          getTeamStats={getTeamStats}
          getPlayerStat={getPlayerStat}
          getRawPlayerStat={getRawPlayerStat}
          getLiveProjectedTeamTotal={
            getLiveProjectedTeamTotal
          }
          getPregameProjectedTeamTotal={
            getPregameProjectedTeamTotal
          }
          liveWinPctMap={liveWinPctMap}
          playerProjections={playerProjections}
          controls={lineupControls}
          setProfilePlayer={setProfilePlayer}
        />
      )}

      <SlotDraftModal
        targetDraftSlot={targetDraftSlot}
        setTargetDraftSlot={setTargetDraftSlot}
        players={players}
        playerAverageMap={playerAverageMap}
        playerProjections={playerProjections}
        availablePlayerIdSet={availablePlayerIdSet}
        isAvailabilityLoading={isAvailabilityLoading}
        getOwnerTeamForPlayer={getOwnerTeamForPlayer}
        handleAssignPlayerToTeam={handleAssignPlayerToTeam}
        onInspectPlayer={inspectPlayerFromSlot}
        hidden={isInspectingPlayerFromSlot}
        isAssigningPlayer={isAssigningPlayer}
        isSaving={isSaving}
      />

      <ReadOnlyPlayerModal
        player={profilePlayer}
        setPlayer={setProfilePlayer}
        playerAverageMap={playerAverageMap}
        playerProjections={playerProjections}
        golfStat={
          profilePlayer
            ? getRawPlayerStat(profilePlayer.id)
            : null
        }
      />

      <DraftPlayerModal
        draftingPlayer={draftingPlayer}
        setDraftingPlayer={
          setDraftingPlayerWithSlotRestore
        }
        playerAverageMap={playerAverageMap}
        playerProjections={playerProjections}
        availablePlayerIdSet={availablePlayerIdSet}
        ownerTeamForDraftingPlayer={ownerTeamForDraftingPlayer}
        isAssigningPlayer={isAssigningPlayer}
        isSaving={isSaving}
        handleRemovePlayerFromTeam={handleRemovePlayerFromTeam}
        draftingPlayerHistory={draftingPlayerHistory}
        isDraftingPlayerHistoryLoading={isDraftingPlayerHistoryLoading}
        orderedTeamsForSlate={orderedTeamsForSlate}
        getTeamStats={getTeamStats}
        getTeamAssignmentStatus={getTeamAssignmentStatus}
        getOwnerTeamIdForPlayer={getOwnerTeamIdForPlayer}
        handleAssignPlayerToTeam={handleAssignPlayerToTeam}
        targetDraftSlot={targetDraftSlot}
        handleDraftToTargetSlot={
          handleDraftToTargetSlot
        }
      />
    </div>
  );
}
