"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Player = {
  id: number;
  name: string;
  position_group: "G" | "F/C";
  is_active: boolean;
  is_playing_today?: boolean | null;
};

type Team = {
  id: number;
  name: string;
};

type Slate = {
  id: number;
  date: string;
  start_date?: string;
  end_date?: string;
  label?: string;
  is_locked: boolean;
};

type SavedLineup = {
  team_id: number;
  player_ids: number[];
};

type PlayerStat = {
  player_id: number;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fantasy_points: number | null;
};

type TeamResult = {
  team_id: number;
  fantasy_points: number | null;
  finish_position: number | null;
  games_completed: number | null;
  games_in_progress: number | null;
  games_remaining: number | null;
};

type SlateTeamConfig = {
  slate_id: number;
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

type PlayerAverage = {
  player_id: number;
  avg_fantasy_points: number;
};

type Props = {
  players: Player[];
  teams: Team[];
  slates: Slate[];
  slateTeamConfigs: SlateTeamConfig[];
  playerAverages: PlayerAverage[];
  initialSelectedSlateId: number | null;
  savedLineupsForInitialSlate: SavedLineup[];
  playerStats: PlayerStat[];
  teamResults: TeamResult[];
};

type PositionFilter = "All" | "G" | "F/C";
type ViewMode = "draft" | "scoring";

function formatLastUpdated(value: string | null) {
  if (!value) return "Not refreshed yet";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not refreshed yet";

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

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
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSlateLoading, setIsSlateLoading] = useState(false);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [isAvailabilityLoading, setIsAvailabilityLoading] = useState(false);
  const [isAssigningPlayer, setIsAssigningPlayer] = useState(false);

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
  const [playerStatsState, setPlayerStatsState] = useState<PlayerStat[]>(playerStats);
  const [teamResultsState, setTeamResultsState] = useState<TeamResult[]>(teamResults);
  const [availablePlayerIdsForSlate, setAvailablePlayerIdsForSlate] = useState<number[]>(
    []
  );
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
  if (!selectedSlateIdNumber) return;
  void loadSlateLineups(selectedSlateIdNumber);
}, [selectedSlateIdNumber]);

  useEffect(() => {
    setPlayerStatsState(playerStats);
  }, [playerStats]);

  useEffect(() => {
    setTeamResultsState(teamResults);
  }, [teamResults]);

  useEffect(() => {
    if (!autoRefreshEnabled || !selectedSlateIdNumber) return;

    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void refreshStatsForSelectedSlate(true);
    }, 30000);

    return () => window.clearInterval(interval);
  }, [autoRefreshEnabled, selectedSlateIdNumber]);

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
      .filter(Boolean) as Array<
        Team & { is_participating: boolean; draft_order: number }
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
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return players
      .filter((player) => {
        const matchesSearch =
          normalizedSearch === "" ||
          player.name.toLowerCase().includes(normalizedSearch);

        const matchesPosition =
          positionFilter === "All" || player.position_group === positionFilter;

        const matchesSlateAvailability =
          !onSlateOnly || availablePlayerIdSet.has(player.id);

        return matchesSearch && matchesPosition && matchesSlateAvailability;
      })
      .sort((a, b) => {
        const aAvg = playerAverageMap.get(a.id) ?? 0;
        const bAvg = playerAverageMap.get(b.id) ?? 0;

        if (bAvg !== aAvg) return bAvg - aAvg;
        return a.name.localeCompare(b.name);
      });
  }, [
    players,
    searchTerm,
    positionFilter,
    onSlateOnly,
    availablePlayerIdSet,
    playerAverageMap,
  ]);

  function getLineupForTeam(teamId: number) {
    return lineupsState.find((item) => item.team_id === teamId) ?? null;
  }

  function getPlayersForTeam(teamId: number) {
    const lineup = getLineupForTeam(teamId);
    if (!lineup) return [];

    return players.filter((player) => lineup.player_ids.includes(player.id));
  }

  function getOwnerTeamIdForPlayer(playerId: number) {
    const owner = lineupsState.find((lineup) => lineup.player_ids.includes(playerId));
    return owner?.team_id ?? null;
  }

  function getOwnerTeamForPlayer(playerId: number) {
    const ownerTeamId = getOwnerTeamIdForPlayer(playerId);
    if (!ownerTeamId) return null;
    return orderedTeamsForSlate.find((team) => team.id === ownerTeamId) ?? null;
  }

  function getTeamStats(teamId: number) {
    const teamPlayers = getPlayersForTeam(teamId);

    const guards = teamPlayers.filter((player) => player.position_group === "G").length;
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

    if (!selectedSlateIdNumber) {
      return { canAssign: false, reason: "No slate selected" };
    }

    if (selectedSlate?.is_locked) {
      return { canAssign: false, reason: "Slate locked" };
    }

    if (!isParticipating) {
      return { canAssign: false, reason: "Out" };
    }

    if (ownerTeamId === teamId) {
      return { canAssign: false, reason: "Already here" };
    }

    const nextPlayers = [...teamPlayers, player];
    const nextGuardCount = nextPlayers.filter(
      (item) => item.position_group === "G"
    ).length;
    const nextFcCount = nextPlayers.filter(
      (item) => item.position_group === "F/C"
    ).length;

    if (nextPlayers.length > 5) {
      return { canAssign: false, reason: "Lineup full" };
    }

    if (nextGuardCount > 2) {
      return { canAssign: false, reason: "Too many G" };
    }

    if (nextFcCount > 3) {
      return { canAssign: false, reason: "Too many F/C" };
    }

    return { canAssign: true, reason: "" };
  }

  async function loadSlateAvailability(nextSlateId: number) {
    try {
      setIsAvailabilityLoading(true);

      const response = await fetch(`/api/slate-availability?slateId=${nextSlateId}`);
      const result = await response.json();

      if (!response.ok) {
        console.error(result.error || "Failed to load slate availability.");
        setAvailablePlayerIdsForSlate([]);
        return;
      }

      setAvailablePlayerIdsForSlate(result.availablePlayerIds ?? []);
    } catch (error) {
      console.error(error);
      setAvailablePlayerIdsForSlate([]);
    } finally {
      setIsAvailabilityLoading(false);
    }
  }

  async function loadSlateLineups(nextSlateId: number) {
    try {
      setIsSlateLoading(true);
      setMessage("");
      setSaveMessage("");

      const [lineupsResponse, statsResponse, resultsResponse, availabilityResponse] =
        await Promise.all([
          fetch(`/api/lineups?slateId=${nextSlateId}`),
          fetch(`/api/player-stats?slateId=${nextSlateId}`),
          fetch(`/api/team-results?slateId=${nextSlateId}`),
          fetch(`/api/slate-availability?slateId=${nextSlateId}`),
        ]);

      const lineupsResult = await lineupsResponse.json();
      const statsResult = await statsResponse.json();
      const resultsResult = await resultsResponse.json();
      const availabilityResult = await availabilityResponse.json();

      if (!lineupsResponse.ok) {
        setSaveMessage(lineupsResult.error || "Failed to load slate lineups.");
        return;
      }

      setLineupsState(lineupsResult.lineups ?? []);
      setPlayerStatsState(statsResult.playerStats ?? []);
      setTeamResultsState(resultsResult.teamResults ?? []);
      setAvailablePlayerIdsForSlate(availabilityResult.availablePlayerIds ?? []);
      setSaveMessage("Loaded slate.");
    } catch (error) {
      console.error(error);
      setSaveMessage("Something went wrong while loading the slate.");
    } finally {
      setIsSlateLoading(false);
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slateId: selectedSlateIdNumber }),
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

const [statsResponse, resultsResponse, availabilityResponse] = await Promise.all([
  fetch(`/api/player-stats?slateId=${selectedSlateIdNumber}`, {
    cache: "no-store",
  }),
  fetch(`/api/team-results?slateId=${selectedSlateIdNumber}`, {
    cache: "no-store",
  }),
  fetch(`/api/slate-availability?slateId=${selectedSlateIdNumber}`, {
    cache: "no-store",
  }),
]);
      const statsResult = await statsResponse.json();
      const resultsResult = await resultsResponse.json();
      const availabilityResult = await availabilityResponse.json();

      setPlayerStatsState(statsResult.playerStats ?? []);
      setTeamResultsState(resultsResult.teamResults ?? []);
      setAvailablePlayerIdsForSlate(availabilityResult.availablePlayerIds ?? []);
      setLastUpdatedAt(new Date().toISOString());

      if (!isSilent) {
        setSaveMessage("Stats refreshed successfully.");
      }
    } catch (error) {
      console.error(error);
      if (!isSilent) {
        alert("Something went wrong while refreshing stats.");
      }
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
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          slateId: selectedSlateIdNumber,
          teamId,
          playerIds: playerList.map((player) => player.id),
        }),
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

      if (successMessage) {
        setSaveMessage(successMessage);
      }
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

    if (selectedSlateIdNumber) {
      await loadSlateLineups(selectedSlateIdNumber);
    }

    setDraftingPlayer(null);
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

    if (selectedSlateIdNumber) {
      await loadSlateLineups(selectedSlateIdNumber);
    }

    setDraftingPlayer(null);
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
    ? "px-2 py-1 text-xs"
    : "px-3 py-2 text-sm";

  const scoreTableHeaderClass = compactView
    ? "border-b border-slate-200 px-2 py-1 font-semibold"
    : "border-b border-slate-200 px-3 py-2 font-semibold";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-col gap-5">
            <div>
              <div className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Page Mode
              </div>
              <div className="flex flex-wrap gap-3">
                {([
                  { value: "draft", label: "Draft Board" },
                  { value: "scoring", label: "Scores" },
                ] as Array<{ value: ViewMode; label: string }>).map((mode) => {
                  const isActive = viewMode === mode.value;

                  return (
                    <button
                      key={mode.value}
                      type="button"
                      onClick={() => setViewMode(mode.value)}
                      className={`${bigModeBase} ${
                        isActive ? bigModeActive : bigModeInactive
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
              <div>
                <label
                  htmlFor="slate-select"
                  className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Slate / Day
                </label>
                <select
                  id="slate-select"
                  value={selectedSlateId}
onChange={(e) => {
  setSelectedSlateId(e.target.value);
}}
                  className="min-w-[210px] rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
                >
                  {slates.map((slate) => (
                    <option key={slate.id} value={slate.id}>
                      {slate.label ?? slate.date}
                      {slate.is_locked ? " (Locked)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Stats
                </label>
                <div className="flex flex-wrap gap-2">
<button
  type="button"
  onClick={() => refreshStatsForSelectedSlate(false)}
  disabled={!selectedSlateIdNumber || isRefreshingStats || selectedSlate?.is_locked}
  className="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-900 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
>
  {selectedSlate?.is_locked
    ? "Locked"
    : isRefreshingStats
    ? "Refreshing..."
    : "Refresh Stats"}
</button>

                  <button
                    type="button"
                    onClick={() => setAutoRefreshEnabled((prev) => !prev)}
                    disabled={!selectedSlateIdNumber}
                    className={`rounded-xl border px-4 py-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      autoRefreshEnabled
                        ? "border-sky-300 bg-sky-100 text-sky-900 hover:bg-sky-200"
                        : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50"
                    }`}
                  >
                    {autoRefreshEnabled ? "Auto Refresh On" : "Auto Refresh Off"}
                  </button>
                </div>
              </div>

              {viewMode === "scoring" ? (
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    View
                  </label>
                  <button
                    type="button"
                    onClick={() => setCompactView((prev) => !prev)}
                    disabled={!hasMounted}
                    className={`${pillBase} ${
                      compactView
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : inactivePill
                    } disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {hasMounted ? (compactView ? "Compact On" : "Compact Off") : "View"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-start gap-1 text-sm text-slate-600 xl:items-end">
            <div>
              {isSlateLoading
                ? "Loading slate..."
                : selectedSlate
                ? `${selectedSlateDisplay}${selectedSlate.is_locked ? " • Locked" : " • Open"}`
                : "No slate selected"}
            </div>
            <div>
              Last updated: {formatLastUpdated(lastUpdatedAt)}
              {autoRefreshEnabled ? " • Auto every 30s" : ""}
            </div>
            <Link
              href="/standings"
              className="font-medium text-sky-700 underline underline-offset-2 hover:text-sky-900"
            >
              View standings
            </Link>
          </div>
        </div>
      </section>

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
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold text-slate-900">Player Pool</h2>
              <p className="text-sm text-slate-600">
                Search a player, click them, then choose which team gets them.
              </p>
            </div>

            <div className="mb-4 flex flex-col gap-3">
              <div>
                <label
                  htmlFor="player-search"
                  className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
                >
                  Search players
                </label>
                <input
                  id="player-search"
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search by player name"
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-sky-300"
                />
              </div>

              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Position
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {(["All", "G", "F/C"] as PositionFilter[]).map((filter) => {
                      const isActive = positionFilter === filter;

                      return (
                        <button
                          key={filter}
                          type="button"
                          onClick={() => setPositionFilter(filter)}
                          className={`${pillBase} ${isActive ? activePill : inactivePill}`}
                        >
                          {filter}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                    Availability
                  </label>
                  <button
                    type="button"
                    onClick={() => setOnSlateOnly((prev) => !prev)}
                    className={`${pillBase} ${
                      onSlateOnly
                        ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                        : inactivePill
                    }`}
                  >
                    {onSlateOnly ? "On This Slate" : "All Players"}
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-4 flex flex-wrap gap-4 text-xs text-slate-500">
              <span>
                Showing {filteredPlayers.length} of {players.length} active players
              </span>
              <span>
                On this slate:{" "}
                {isAvailabilityLoading ? "Loading..." : availablePlayerIdsForSlate.length}
              </span>
            </div>

            {filteredPlayers.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                No players match your current search/filter.
              </div>
            ) : (
              <div className="max-h-[305px] overflow-y-auto pr-1">
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredPlayers.map((player) => {
                    const ownerTeam = getOwnerTeamForPlayer(player.id);
                    const isOnSlate = availablePlayerIdSet.has(player.id);
                    const avgScore = playerAverageMap.get(player.id) ?? 0;

                    return (
                      <button
                        key={player.id}
                        type="button"
                        onClick={() => setDraftingPlayer(player)}
                        disabled={isAssigningPlayer}
                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                          ownerTeam
                            ? "border-red-200 bg-red-50 hover:border-red-300"
                            : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50"
                        } disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {player.name}
                            </div>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                                Avg {avgScore.toFixed(1)}
                              </span>
                              {isOnSlate ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">
                                  On this slate
                                </span>
                              ) : null}
                              {ownerTeam ? (
                                <span className="text-[11px] text-red-600">
                                  Used by {ownerTeam.name}
                                </span>
                              ) : (
                                <span className="text-[11px] text-sky-700">
                                  Click to draft
                                </span>
                              )}
                            </div>
                          </div>

                          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                            {player.position_group}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold text-slate-900">Slate Lineups</h2>
              <p className="text-sm text-slate-600">
                Current draft board for this slate.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {orderedTeamsForSlate.map((team) => {
                const teamPlayers = getPlayersForTeam(team.id);
                const stats = getTeamStats(team.id);
                const isParticipating = (team as any).is_participating !== false;

                return (
                  <div
                    key={team.id}
                    className={`rounded-2xl border p-4 transition ${
                      !isParticipating ? "opacity-70" : ""
                    } border-slate-200 bg-white`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{team.name}</h3>
                        <div className="text-xs text-slate-500">
                          {(team as any).draft_order ? `Order #${(team as any).draft_order}` : ""}
                          {!isParticipating ? " • Out" : ""}
                        </div>
                      </div>

                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${
                          isParticipating
                            ? "border-slate-200 bg-white text-slate-700"
                            : "border-slate-200 bg-slate-100 text-slate-500"
                        }`}
                      >
                        {isParticipating ? "Open" : "Out"}
                      </span>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2 text-xs text-slate-600">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">
                        {stats.totalPlayers}/5
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">
                        G {stats.guards}/2
                      </span>
                      <span className="rounded-full bg-slate-100 px-2.5 py-1">
                        F/C {stats.fcPlayers}/3
                      </span>
                    </div>

                    {teamPlayers.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-sm text-slate-500">
                        No players saved.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {teamPlayers.map((player) => (
                          <button
                            key={player.id}
                            type="button"
                            onClick={() => setDraftingPlayer(player)}
                            className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left transition hover:border-sky-200 hover:bg-sky-50"
                          >
                            <span className="truncate pr-2 text-sm text-slate-800">
                              {player.name}
                            </span>
                            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                              {player.position_group}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
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
                  {dailySummary.leader.teamName} •{" "}
                  {dailySummary.leader.total.toFixed(1)}
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
            <div className={`${compactView ? "min-w-[820px]" : "min-w-[1100px]"} space-y-4`}>
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
                    className={`overflow-hidden rounded-2xl border border-slate-200 bg-white ${
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
                        {(team as any).draft_order
                          ? ` • #${(team as any).draft_order}`
                          : ""}
                      </div>
                      <div className={`${compactView ? "text-xs" : "text-sm"} text-slate-600`}>
                        Total:{" "}
                        {typeof stats.total === "number"
                          ? stats.total.toFixed(1)
                          : "0.0"}{" "}
                        • C: {stats.games_completed} • P: {stats.games_in_progress} •
                        R: {stats.games_remaining}
                      </div>
                    </div>

                    <table
                      className={`w-full border-collapse ${
                        compactView ? "table-fixed text-xs" : "text-sm"
                      }`}
                    >
                      <thead className="bg-slate-100 text-slate-700">
                        {compactView ? (
                          <tr className="text-left">
                            <th className={`${scoreTableHeaderClass} w-[42px]`}>Pos</th>
                            <th className={`${scoreTableHeaderClass} w-[120px]`}>Player</th>
                            <th className={`${scoreTableHeaderClass} w-[44px] text-right`}>PTS</th>
                            <th className={`${scoreTableHeaderClass} w-[44px] text-right`}>REB</th>
                            <th className={`${scoreTableHeaderClass} w-[44px] text-right`}>AST</th>
                            <th className={`${scoreTableHeaderClass} w-[44px] text-right`}>STL</th>
                            <th className={`${scoreTableHeaderClass} w-[44px] text-right`}>BLK</th>
                            <th className={`${scoreTableHeaderClass} w-[44px] text-right`}>TO</th>
                            <th className={`${scoreTableHeaderClass} w-[48px] text-right`}>TOT</th>
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
                              <td className={scoreTableCellClass}>{row.slot}</td>
                              <td className={scoreTableCellClass}>
                                {row.player ? (
                                  <span className={compactView ? "block truncate" : ""}>
                                    {row.player.name}
                                  </span>
                                ) : (
                                  <span className="text-slate-400">—</span>
                                )}
                              </td>
                              <td className={`${scoreTableCellClass} text-right`}>
                                {stat ? stat.points : 0}
                              </td>
                              <td className={`${scoreTableCellClass} text-right`}>
                                {stat ? stat.rebounds : 0}
                              </td>
                              <td className={`${scoreTableCellClass} text-right`}>
                                {stat ? stat.assists : 0}
                              </td>
                              <td className={`${scoreTableCellClass} text-right`}>
                                {stat ? stat.steals : 0}
                              </td>
                              <td className={`${scoreTableCellClass} text-right`}>
                                {stat ? stat.blocks : 0}
                              </td>
                              <td className={`${scoreTableCellClass} text-right`}>
                                {stat ? stat.turnovers : 0}
                              </td>
                              <td className={`${scoreTableCellClass} text-right`}>
                                {stat ? Number(stat.fantasy_points).toFixed(1) : "0.0"}
                              </td>
                            </tr>
                          );
                        })}

                        <tr className="bg-slate-50 font-semibold text-slate-900">
                          <td className={scoreTableCellClass}></td>
                          <td className={scoreTableCellClass}>
                            <span className={compactView ? "block truncate" : ""}>Totals</span>
                          </td>
                          <td className={`${scoreTableCellClass} text-right`}>{stats.points}</td>
                          <td className={`${scoreTableCellClass} text-right`}>{stats.rebounds}</td>
                          <td className={`${scoreTableCellClass} text-right`}>{stats.assists}</td>
                          <td className={`${scoreTableCellClass} text-right`}>{stats.steals}</td>
                          <td className={`${scoreTableCellClass} text-right`}>{stats.blocks}</td>
                          <td className={`${scoreTableCellClass} text-right`}>{stats.turnovers}</td>
                          <td className={`${scoreTableCellClass} text-right`}>
                            {typeof stats.total === "number"
                              ? stats.total.toFixed(1)
                              : "0.0"}
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

      {draftingPlayer ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3 className="text-2xl font-semibold text-slate-900">
                  {draftingPlayer.name}
                </h3>
                <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-600">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">
                    {draftingPlayer.position_group}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2.5 py-1">
                    Avg {(playerAverageMap.get(draftingPlayer.id) ?? 0).toFixed(1)}
                  </span>
                  {availablePlayerIdSet.has(draftingPlayer.id) ? (
                    <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">
                      On this slate
                    </span>
                  ) : null}
                  {ownerTeamForDraftingPlayer ? (
                    <span className="rounded-full bg-red-100 px-2.5 py-1 text-red-700">
                      Currently on {ownerTeamForDraftingPlayer.name}
                    </span>
                  ) : (
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700">
                      Not drafted yet
                    </span>
                  )}
                </div>
              </div>

              <button
                type="button"
                onClick={() => setDraftingPlayer(null)}
                className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
              >
                Close
              </button>
            </div>

            {ownerTeamForDraftingPlayer ? (
              <div className="mb-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handleRemovePlayerFromTeam(draftingPlayer)}
                  disabled={isAssigningPlayer || isSaving}
                  className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isAssigningPlayer ? "Working..." : `Remove from ${ownerTeamForDraftingPlayer.name}`}
                </button>
              </div>
            ) : null}

            <div className="mb-2 text-sm font-medium text-slate-700">
              Choose lineup
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {orderedTeamsForSlate.map((team) => {
                const stats = getTeamStats(team.id);
                const status = getTeamAssignmentStatus(team.id, draftingPlayer);
                const isCurrentOwner = getOwnerTeamIdForPlayer(draftingPlayer.id) === team.id;
                const isParticipating = (team as any).is_participating !== false;

                return (
                  <div
                    key={team.id}
                    className={`rounded-2xl border p-4 ${
                      isCurrentOwner
                        ? "border-sky-300 bg-sky-50"
                        : "border-slate-200 bg-white"
                    } ${!isParticipating ? "opacity-70" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-slate-900">{team.name}</div>
                        <div className="mt-1 text-xs text-slate-500">
                          {(team as any).draft_order
                            ? `Order #${(team as any).draft_order}`
                            : ""}
                          {!isParticipating ? " • Out" : ""}
                        </div>
                      </div>

                      <div className="text-right text-xs text-slate-600">
                        <div>{stats.totalPlayers}/5</div>
                        <div>G {stats.guards}/2</div>
                        <div>F/C {stats.fcPlayers}/3</div>
                      </div>
                    </div>

                    <div className="mt-3">
                      <button
                        type="button"
                        onClick={() => handleAssignPlayerToTeam(draftingPlayer, team.id)}
                        disabled={!status.canAssign || isAssigningPlayer || isSaving}
                        className={`w-full rounded-xl border px-4 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${
                          status.canAssign
                            ? "border-emerald-300 bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                            : "border-slate-200 bg-slate-100 text-slate-500"
                        }`}
                      >
                        {isCurrentOwner
                          ? "Already here"
                          : status.canAssign
                          ? "Assign to this team"
                          : status.reason}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
