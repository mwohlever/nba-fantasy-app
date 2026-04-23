"use client";

import ScoringBoard from "@/components/lineups/ScoringBoard";
import DraftPlayerModal from "@/components/lineups/DraftPlayerModal";
import PlayerPool from "@/components/lineups/PlayerPool";
import { useEffect, useMemo, useRef, useState } from "react";
import LineupControls from "@/components/lineups/LineupControls";
import type {
  OrderedTeam,
  Player,
  PlayerAverage,
  PlayerHistoryDetailRow,
  PlayerStat,
  PositionFilter,
  Props,
  SavedLineup,
  Slate,
  SlateTeamConfig,
  Team,
  TeamResult,
  ViewMode,
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
}: Props) {
  const [selectedSlateId, setSelectedSlateId] = useState<string>(
    initialSelectedSlateId ? String(initialSelectedSlateId) : ""
  );
  const [message, setMessage] = useState("");
const latestSlateLoadRef = useRef(0);  
const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSlateLoading, setIsSlateLoading] = useState(false);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [isAvailabilityLoading, setIsAvailabilityLoading] = useState(false);
  const [isAssigningPlayer, setIsAssigningPlayer] = useState(false);
const [draftingPlayerHistory, setDraftingPlayerHistory] = useState<PlayerHistoryDetailRow[]>([]);
const [isDraftingPlayerHistoryLoading, setIsDraftingPlayerHistoryLoading] = useState(false);

  const [searchTerm, setSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("All");
  const [onSlateOnly, setOnSlateOnly] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("scoring");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);

  const [compactView, setCompactView] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);

  const [lineupsState, setLineupsState] = useState<SavedLineup[]>(
    savedLineupsForInitialSlate
  );
  const [playerStatsState, setPlayerStatsState] =
    useState<PlayerStat[]>(playerStats);
  const [teamResultsState, setTeamResultsState] =
    useState<TeamResult[]>(teamResults);
  const [availablePlayerIdsForSlate, setAvailablePlayerIdsForSlate] = useState<
    number[]
  >([]);
  const [draftingPlayer, setDraftingPlayer] = useState<Player | null>(null);

  const [lastRefreshSummary, setLastRefreshSummary] = useState<{
    gamesFound?: number;
    playerStatsUpserted?: number;
    teamResultsUpserted?: number;
  } | null>(null);

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
  if (!draftingPlayer) {
    setDraftingPlayerHistory([]);
    setIsDraftingPlayerHistoryLoading(false);
    return;
  }

  async function loadDraftingPlayerHistory() {
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
}, [draftingPlayer]);

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

  const playerAverageMap = useMemo(() => {
    const map = new Map<number, number>();
    playerAverages.forEach((row) => {
      map.set(row.player_id, row.avg_fantasy_points);
    });
    return map;
  }, [playerAverages]);

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
.filter(Boolean) as OrderedTeam[];
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

    let points = 0;
    let rebounds = 0;
    let assists = 0;
    let steals = 0;
    let blocks = 0;
    let turnovers = 0;

    teamPlayers.forEach((player) => {
      const stat = playerStatsMap.get(player.id);
      if (!stat) return;

      points += stat.points ?? 0;
      rebounds += stat.rebounds ?? 0;
      assists += stat.assists ?? 0;
      steals += stat.steals ?? 0;
      blocks += stat.blocks ?? 0;
      turnovers += stat.turnovers ?? 0;
    });

    const teamResult = teamResultsMap.get(teamId);

    const total =
      teamResult?.fantasy_points ??
      (points +
        rebounds * 1.2 +
        assists * 1.5 +
        steals * 2 +
        blocks * 2 -
        turnovers);

    return {
      totalPlayers: teamPlayers.length,
      guards,
      fcPlayers,
      points,
      rebounds,
      assists,
      steals,
      blocks,
      turnovers,
      total,
      games_completed: teamResult?.games_completed ?? 0,
      games_in_progress: teamResult?.games_in_progress ?? 0,
      games_remaining: teamResult?.games_remaining ?? 0,
      finish_position: teamResult?.finish_position ?? null,
    };
  }

  function getPlayerStat(playerId: number) {
    const stat = playerStatsMap.get(playerId);

    return {
      points: stat?.points ?? 0,
      rebounds: stat?.rebounds ?? 0,
      assists: stat?.assists ?? 0,
      steals: stat?.steals ?? 0,
      blocks: stat?.blocks ?? 0,
      turnovers: stat?.turnovers ?? 0,
      fantasy_points: stat?.fantasy_points ?? 0,
    };
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
        .sort((a, b) => b.total - a.total)[0] ?? null;

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

    if (!selectedSlateIdNumber) return { canAssign: false, reason: "No slate selected" };
    if (selectedSlate?.is_locked) return { canAssign: false, reason: "Slate locked" };
    if (!isParticipating) return { canAssign: false, reason: "Out" };
    if (ownerTeamId === teamId) return { canAssign: false, reason: "Already here" };

    const nextPlayers = [...teamPlayers, player];
    const nextGuardCount = nextPlayers.filter(
      (item) => item.position_group === "G"
    ).length;
    const nextFcCount = nextPlayers.filter(
      (item) => item.position_group === "F/C"
    ).length;

    if (nextPlayers.length > 5) return { canAssign: false, reason: "Lineup full" };
    if (nextGuardCount > 2) return { canAssign: false, reason: "Too many G" };
    if (nextFcCount > 3) return { canAssign: false, reason: "Too many F/C" };

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
    setSaveMessage("Loaded slate.");
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

      const refreshResponse = await fetch("/api/refresh-stats", {
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
    options?: { allowEmpty?: boolean }
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

    const nextGuardCount = playerList.filter(
      (player) => player.position_group === "G"
    ).length;
    const nextFcCount = playerList.filter(
      (player) => player.position_group === "F/C"
    ).length;

    if (playerList.length > 5) {
      setSaveMessage("A lineup can have at most 5 players.");
      return false;
    }
    if (nextGuardCount > 2 || nextFcCount > 3) {
      setSaveMessage("A lineup can have at most 2 Guards and 3 F/C players.");
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

    const added = await persistLineupForTeam(
      targetTeamId,
      [...targetPlayers, player],
      `${player.name} drafted to ${targetTeam.name}.`
    );

    if (!added) return;

    // close / reset immediately
    setDraftingPlayer(null);
    setSearchTerm("");

    // reload in background so UI doesn't stay locked
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

    // close / reset immediately
    setDraftingPlayer(null);
    setSearchTerm("");

    // reload in background so UI doesn't stay locked
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

  const bigModeBase =
    "rounded-2xl border px-5 py-3 text-sm font-semibold transition sm:px-6 sm:py-3.5 sm:text-base";
  const bigModeActive = "border-sky-300 bg-sky-100 text-sky-900 shadow-sm";
  const bigModeInactive =
    "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50";

  const ownerTeamForDraftingPlayer = draftingPlayer
    ? getOwnerTeamForPlayer(draftingPlayer.id)
    : null;

  const scoreTableCellClass = compactView
    ? "px-0 py-0 text-xs"
    : "px-3 py-2 text-sm";

  const scoreTableHeaderClass = compactView
    ? "border-b border-slate-200 px-0 py-0 font-semibold"
    : "border-b border-slate-200 px-3 py-2 font-semibold";

return (
  <div className="space-y-6">
    <LineupControls
      viewMode={viewMode}
      setViewMode={setViewMode}
      selectedSlateId={selectedSlateId}
      setSelectedSlateId={setSelectedSlateId}
      slates={slates}
      selectedSlate={selectedSlate}
      selectedSlateDisplay={selectedSlateDisplay}
      selectedSlateIdNumber={selectedSlateIdNumber}
      isRefreshingStats={isRefreshingStats}
      refreshStatsForSelectedSlate={refreshStatsForSelectedSlate}
      autoRefreshEnabled={autoRefreshEnabled}
      setAutoRefreshEnabled={setAutoRefreshEnabled}
      compactView={compactView}
      setCompactView={setCompactView}
      hasMounted={hasMounted}
      isSlateLoading={isSlateLoading}
      lastUpdatedAt={lastUpdatedAt}
    />

    {message ? (
      <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
        {message}
      </div>
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
  getOwnerTeamForPlayer={getOwnerTeamForPlayer}
  setDraftingPlayer={setDraftingPlayer}
  isAssigningPlayer={isAssigningPlayer}
  pillBase={pillBase}
  activePill={activePill}
  inactivePill={inactivePill}
/>

<ScoringBoard
  orderedTeamsForSlate={orderedTeamsForSlate}
  compactView={compactView}
  dailySummary={dailySummary}
  lastRefreshSummary={lastRefreshSummary}
  getPlayersForTeam={getPlayersForTeam}
  getTeamStats={getTeamStats}
  getPlayerStat={getPlayerStat}
  scoreTableCellClass={scoreTableCellClass}
  scoreTableHeaderClass={scoreTableHeaderClass}
/>
        </>
      ) : (
        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">Scores</h2>
              <p className="text-sm text-slate-600">
                Lineups and live totals for the selected slate.
              </p>
            </div>

            {dailySummary.leader ? (
              <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-slate-700">
                <div className="text-xs uppercase tracking-wide text-orange-700">
                  Leader
                </div>
                <div className="font-semibold text-slate-900">
                  {dailySummary.leader.teamName} • {dailySummary.leader.total.toFixed(1)}
                </div>
              </div>
            ) : null}
          </div>

          {lastRefreshSummary ? (
            <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              Refresh complete — Games found: {lastRefreshSummary.gamesFound ?? 0},
              Players updated: {lastRefreshSummary.playerStatsUpserted ?? 0}, Teams
              updated: {lastRefreshSummary.teamResultsUpserted ?? 0}
            </div>
          ) : null}

          <div className="overflow-x-auto -mx-4 px-4">
<div className={`${compactView ? "min-w-[720px]" : "min-w-[1100px]"} space-y-4`}>
              {orderedTeamsForSlate.map((team) => {
                const teamPlayers = getPlayersForTeam(team.id);
                const stats = getTeamStats(team.id);

                const guards = teamPlayers.filter((p) => p.position_group === "G");
                const fcs = teamPlayers.filter((p) => p.position_group === "F/C");

                const rosterRows: Array<{
                  slot: string;
                  player: Player | null;
                }> = [
                  { slot: "G", player: guards[0] ?? null },
                  { slot: "G", player: guards[1] ?? null },
                  { slot: "F/C", player: fcs[0] ?? null },
                  { slot: "F/C", player: fcs[1] ?? null },
                  { slot: "F/C", player: fcs[2] ?? null },
                ];

                const isParticipating = (team as any).is_participating !== false;

                return (
                  <div
                    key={team.id}
                    className={`rounded-2xl border border-slate-200 bg-white ${
                      !isParticipating ? "opacity-70" : ""
                    }`}
                  >
                    <div
                      className={`flex items-center justify-between bg-slate-50 ${
                        compactView ? "px-3 py-2" : "px-4 py-3"
                      }`}
                    >
                      <div className={`${compactView ? "text-base" : "text-lg"} font-semibold text-slate-900`}>
                        {team.name}
                        {!isParticipating ? " (Out)" : ""}
                        {(team as any).draft_order ? ` • #${(team as any).draft_order}` : ""}
                      </div>
                      <div className={`${compactView ? "text-xs" : "text-sm"} text-slate-600`}>
                        Total:{" "}
                        {typeof stats.total === "number" ? stats.total.toFixed(1) : "0.0"} • C:{" "}
                        {stats.games_completed} • P: {stats.games_in_progress} • R:{" "}
                        {stats.games_remaining}
                      </div>
                    </div>

                    <table
                      className={`w-full border-separate border-spacing-0 ${
                        compactView ? "table-fixed text-xs" : "text-sm"
                      }`}
                    >
                      <thead className="bg-slate-100 text-slate-700">
                        {compactView ? (
                          <tr className="text-left">
<th className={`${scoreTableHeaderClass} sticky left-0 z-30 w-[40px]`}>
  <div className="w-[40px] min-w-[40px] border-b border-r border-slate-200 bg-slate-100 px-2 py-1 font-semibold">
    Pos
  </div>
</th>
<th className={`${scoreTableHeaderClass} sticky left-[40px] z-30 w-[128px]`}>
  <div className="w-[128px] min-w-[128px] border-b border-r border-slate-200 bg-slate-100 px-2 py-1 font-semibold">
    Player
  </div>
</th>
<th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>PTS</th>
<th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>REB</th>
<th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>AST</th>
<th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>STL</th>
<th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>BLK</th>
<th className={`${scoreTableHeaderClass} w-[36px] text-right px-1 py-1`}>TO</th>
<th className={`${scoreTableHeaderClass} w-[42px] text-right px-1 py-1`}>TOT</th>
                          </tr>
                        ) : (
                          <tr className="text-left">
                            <th className={scoreTableHeaderClass}>Position</th>
                            <th className={scoreTableHeaderClass}>Player</th>
                            <th className={scoreTableHeaderClass}>Points (1)</th>
                            <th className={scoreTableHeaderClass}>Rebounds (1.2)</th>
                            <th className={scoreTableHeaderClass}>Assists (1.5)</th>
                            <th className={scoreTableHeaderClass}>Steals (2)</th>
                            <th className={scoreTableHeaderClass}>Blocks (2)</th>
                            <th className={scoreTableHeaderClass}>Turnovers (-1)</th>
                            <th className={scoreTableHeaderClass}>Total</th>
                          </tr>
                        )}
                      </thead>

                      <tbody className="text-slate-800">
                        {rosterRows.map((row, index) => {
                          const stat = row.player ? getPlayerStat(row.player.id) : null;

                          return (
                            <tr key={`${team.id}-${index}`} className="border-b border-slate-100">
<td className={compactView ? "sticky left-0 z-20 w-[40px] p-0" : scoreTableCellClass}>
  {compactView ? (
    <div className="w-[40px] min-w-[40px] border-r border-slate-200 bg-white px-2 py-1">
      {row.slot}
    </div>
  ) : (
    row.slot
  )}
</td>

<td className={compactView ? "sticky left-[40px] z-20 w-[128px] p-0" : scoreTableCellClass}>
  {compactView ? (
    <div className="w-[128px] min-w-[128px] border-r border-slate-200 bg-white px-2 py-1">
      {row.player ? (
        <span className="block truncate">{row.player.name}</span>
      ) : (
        <span className="text-slate-400">—</span>
      )}
    </div>
  ) : row.player ? (
    row.player.name
  ) : (
    <span className="text-slate-400">—</span>
  )}
</td>

                              <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                                {stat ? stat.points : 0}
                              </td>
                              <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                                {stat ? stat.rebounds : 0}
                              </td>
                              <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                                {stat ? stat.assists : 0}
                              </td>
                              <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                                {stat ? stat.steals : 0}
                              </td>
                              <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                                {stat ? stat.blocks : 0}
                              </td>
                              <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                                {stat ? stat.turnovers : 0}
                              </td>
                              <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                                {stat ? Number(stat.fantasy_points).toFixed(1) : "0.0"}
                              </td>
                            </tr>
                          );
                        })}

                        <tr className="bg-slate-50 font-semibold text-slate-900">
<td className={compactView ? "sticky left-0 z-20 w-[40px] p-0" : scoreTableCellClass}>
  {compactView ? (
    <div className="w-[40px] min-w-[40px] border-r border-slate-200 bg-slate-50 px-2 py-1"></div>
  ) : null}
</td>
<td className={compactView ? "sticky left-[40px] z-20 w-[128px] p-0" : scoreTableCellClass}>
  {compactView ? (
    <div className="w-[128px] min-w-[128px] border-r border-slate-200 bg-slate-50 px-2 py-1">
      <span className="block truncate">Totals</span>
    </div>
  ) : (
    <span>Totals</span>
  )}
</td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stats.points}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stats.rebounds}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stats.assists}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stats.steals}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stats.blocks}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {stats.turnovers}
                          </td>
                          <td className={`${compactView ? "px-2 py-1" : scoreTableCellClass} text-right`}>
                            {typeof stats.total === "number" ? stats.total.toFixed(1) : "0.0"}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

<DraftPlayerModal
  draftingPlayer={draftingPlayer}
  setDraftingPlayer={setDraftingPlayer}
  playerAverageMap={playerAverageMap}
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
/>
    </div>
  );
}
