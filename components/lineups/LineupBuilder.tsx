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
  const [selectedPlayers, setSelectedPlayers] = useState<Player[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedSlateId, setSelectedSlateId] = useState<string>(
    initialSelectedSlateId ? String(initialSelectedSlateId) : ""
  );
  const [message, setMessage] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isSlateLoading, setIsSlateLoading] = useState(false);
  const [isRefreshingStats, setIsRefreshingStats] = useState(false);
  const [isAvailabilityLoading, setIsAvailabilityLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [positionFilter, setPositionFilter] = useState<PositionFilter>("All");
  const [onSlateOnly, setOnSlateOnly] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("scoring");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [lineupsState, setLineupsState] = useState<SavedLineup[]>(
    savedLineupsForInitialSlate
  );
  const [playerStatsState, setPlayerStatsState] = useState<PlayerStat[]>(playerStats);
  const [teamResultsState, setTeamResultsState] = useState<TeamResult[]>(teamResults);
  const [availablePlayerIdsForSlate, setAvailablePlayerIdsForSlate] = useState<number[]>(
    []
  );
  const [lastRefreshSummary, setLastRefreshSummary] = useState<{
    gamesFound?: number;
    playerStatsUpserted?: number;
    teamResultsUpserted?: number;
  } | null>(null);

  const selectedTeamIdNumber = selectedTeamId ? Number(selectedTeamId) : null;
  const selectedSlateIdNumber = selectedSlateId ? Number(selectedSlateId) : null;
  const selectedSlate =
    slates.find((slate) => slate.id === selectedSlateIdNumber) ?? null;

  const selectedSlateDisplay =
    selectedSlate?.label ?? selectedSlate?.date ?? "No slate selected";

  useEffect(() => {
    setPlayerStatsState(playerStats);
  }, [playerStats]);

  useEffect(() => {
    setTeamResultsState(teamResults);
  }, [teamResults]);

  useEffect(() => {
    if (!selectedSlateIdNumber) {
      setAvailablePlayerIdsForSlate([]);
      return;
    }

    void loadSlateAvailability(selectedSlateIdNumber);
  }, [selectedSlateIdNumber]);

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

  const currentTeamSavedLineup = useMemo(() => {
    if (!selectedTeamIdNumber) return null;

    return (
      lineupsState.find((lineup) => lineup.team_id === selectedTeamIdNumber) ?? null
    );
  }, [lineupsState, selectedTeamIdNumber]);

  const takenPlayerIdsByOtherTeams = useMemo(() => {
    if (!selectedTeamIdNumber) {
      return new Set(lineupsState.flatMap((lineup) => lineup.player_ids));
    }

    return new Set(
      lineupsState
        .filter((lineup) => lineup.team_id !== selectedTeamIdNumber)
        .flatMap((lineup) => lineup.player_ids)
    );
  }, [lineupsState, selectedTeamIdNumber]);

  useEffect(() => {
    if (!selectedTeamIdNumber) {
      setSelectedPlayers([]);
      setMessage("");
      setSaveMessage("");
      return;
    }

    if (!currentTeamSavedLineup) {
      setSelectedPlayers([]);
      setMessage("");
      setSaveMessage("");
      return;
    }

    const savedPlayers = players.filter((player) =>
      currentTeamSavedLineup.player_ids.includes(player.id)
    );

    setSelectedPlayers(savedPlayers);
    setMessage("");
    setSaveMessage("Loaded saved lineup for this team.");
  }, [selectedTeamIdNumber, currentTeamSavedLineup, players]);

  const guardCount = useMemo(
    () => selectedPlayers.filter((player) => player.position_group === "G").length,
    [selectedPlayers]
  );

  const fcCount = useMemo(
    () => selectedPlayers.filter((player) => player.position_group === "F/C").length,
    [selectedPlayers]
  );

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

  function getPlayersForTeam(teamId: number) {
    const lineup = lineupsState.find((item) => item.team_id === teamId);
    if (!lineup) return [];

    return players.filter((player) => lineup.player_ids.includes(player.id));
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

    const leader = rows
      .filter((row) => row.is_participating)
      .sort((a, b) => b.total - a.total)[0] ?? null;

    return {
      leader,
      rows,
    };
  }, [orderedTeamsForSlate, teamResultsState, playerStatsState, lineupsState]);

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
      setSelectedPlayers([]);
      setSelectedTeamId("");
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
        fetch(`/api/player-stats?slateId=${selectedSlateIdNumber}`),
        fetch(`/api/team-results?slateId=${selectedSlateIdNumber}`),
        fetch(`/api/slate-availability?slateId=${selectedSlateIdNumber}`),
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

  async function saveLineup(playerList: Player[], successMessage?: string) {
    setSaveMessage("");

    if (!selectedTeamIdNumber) {
      setSaveMessage("Please choose a team before saving.");
      return false;
    }

    if (!selectedSlateIdNumber) {
      setSaveMessage("Please choose a slate before saving.");
      return false;
    }

    if (!participatingTeamIds.has(selectedTeamIdNumber)) {
      setSaveMessage("That team is not participating in this slate.");
      return false;
    }

    if (selectedSlate?.is_locked) {
      setSaveMessage("This slate is locked.");
      return false;
    }

    if (playerList.length === 0) {
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
          teamId: selectedTeamIdNumber,
          playerIds: playerList.map((player) => player.id),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setSaveMessage(result.error || "Failed to save lineup.");
        return false;
      }

      setLineupsState((prev) => {
        const otherTeams = prev.filter(
          (lineup) => lineup.team_id !== selectedTeamIdNumber
        );

        return [
          ...otherTeams,
          {
            team_id: selectedTeamIdNumber,
            player_ids: playerList.map((player) => player.id),
          },
        ];
      });

      setSaveMessage(successMessage ?? "Lineup auto-saved.");
      return true;
    } catch (error) {
      console.error(error);
      setSaveMessage("Something went wrong while saving the lineup.");
      return false;
    } finally {
      setIsSaving(false);
    }
  }

  async function handlePlayerClick(player: Player) {
    if (!selectedTeamIdNumber) {
      setMessage("Choose a team before selecting players.");
      setSaveMessage("");
      return;
    }

    if (!selectedSlateIdNumber) {
      setMessage("Choose a slate first.");
      setSaveMessage("");
      return;
    }

    if (!participatingTeamIds.has(selectedTeamIdNumber)) {
      setMessage("That team is not participating in this slate.");
      setSaveMessage("");
      return;
    }

    if (selectedSlate?.is_locked) {
      setMessage("This slate is locked.");
      setSaveMessage("");
      return;
    }

    const isAlreadySelected = selectedPlayers.some(
      (selectedPlayer) => selectedPlayer.id === player.id
    );

    if (isAlreadySelected) {
      const nextPlayers = selectedPlayers.filter(
        (selectedPlayer) => selectedPlayer.id !== player.id
      );

      if (nextPlayers.length === 0) {
        setMessage(
          "At least 1 player must remain before auto-save. Add another player first."
        );
        setSaveMessage("");
        return;
      }

      setSelectedPlayers(nextPlayers);
      setMessage("");
      await saveLineup(nextPlayers, "Lineup auto-saved.");
      return;
    }

    if (takenPlayerIdsByOtherTeams.has(player.id)) {
      setMessage("That player is already used in another saved lineup for this slate.");
      setSaveMessage("");
      return;
    }

    if (selectedPlayers.length >= 5) {
      setMessage("You can only select up to 5 players.");
      setSaveMessage("");
      return;
    }

    const nextGuardCount = guardCount + (player.position_group === "G" ? 1 : 0);
    const nextFcCount = fcCount + (player.position_group === "F/C" ? 1 : 0);

    if (nextGuardCount > 2) {
      setMessage("You can only select up to 2 Guards.");
      setSaveMessage("");
      return;
    }

    if (nextFcCount > 3) {
      setMessage("You can only select up to 3 F/C players.");
      setSaveMessage("");
      return;
    }

    const nextPlayers = [...selectedPlayers, player];

    setSelectedPlayers(nextPlayers);
    setMessage("");
    await saveLineup(nextPlayers, "Lineup auto-saved.");
  }

  async function handleSaveLineup() {
    await saveLineup(selectedPlayers, "Lineup saved successfully.");
  }

  const pillBase =
    "rounded-full border px-3 py-1.5 text-xs font-medium transition";
  const activePill = "border-sky-300 bg-sky-100 text-sky-900";
  const inactivePill =
    "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50";

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
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
                onChange={async (e) => {
                  const nextId = e.target.value;
                  setSelectedSlateId(nextId);
                  if (nextId) {
                    await loadSlateLineups(Number(nextId));
                  }
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
                Page Mode
              </label>
              <div className="flex flex-wrap gap-2">
                {(["scoring", "draft"] as ViewMode[]).map((mode) => {
                  const isActive = viewMode === mode;

                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setViewMode(mode)}
                      className={`${pillBase} ${isActive ? activePill : inactivePill}`}
                    >
                      {mode === "draft" ? "Draft" : "Scores"}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">
                Stats
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => refreshStatsForSelectedSlate(false)}
                  disabled={!selectedSlateIdNumber || isRefreshingStats}
                  className="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-900 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isRefreshingStats ? "Refreshing..." : "Refresh Stats"}
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

      {viewMode === "draft" ? (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold text-slate-900">Slate Lineups</h2>
              <p className="text-sm text-slate-600">
                Pick a team, build the lineup, and search the player pool.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {orderedTeamsForSlate.map((team) => {
                const teamPlayers = getPlayersForTeam(team.id);
                const stats = getTeamStats(team.id);
                const isSelectedTeam = selectedTeamIdNumber === team.id;
                const isParticipating = (team as any).is_participating !== false;

                return (
                  <div
                    key={team.id}
                    className={`rounded-2xl border p-4 transition ${
                      isSelectedTeam
                        ? "border-sky-300 bg-sky-50"
                        : "border-slate-200 bg-white"
                    } ${!isParticipating ? "opacity-70" : ""}`}
                  >
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{team.name}</h3>
                        <div className="text-xs text-slate-500">
                          {(team as any).draft_order ? `Order #${(team as any).draft_order}` : ""}
                          {!isParticipating ? " • Out" : ""}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => {
                          if (!isParticipating) return;
                          setSelectedTeamId(String(team.id));
                          setMessage("");
                          setSaveMessage("");
                        }}
                        disabled={!isParticipating}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          isSelectedTeam
                            ? "border-sky-300 bg-sky-100 text-sky-900"
                            : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50"
                        } disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        {isSelectedTeam ? "Selected" : isParticipating ? "Open" : "Out"}
                      </button>
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
                          <div
                            key={player.id}
                            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                          >
                            <span className="truncate pr-2 text-sm text-slate-800">
                              {player.name}
                            </span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-[11px] text-slate-600 border border-slate-200">
                              {player.position_group}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Selected Lineup</h2>
                  <p className="text-sm text-slate-600">Auto-saves on each change.</p>
                </div>

                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                  <div className="min-w-[190px]">
                    <label
                      htmlFor="team-select"
                      className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Team
                    </label>
                    <select
                      id="team-select"
                      value={selectedTeamId}
                      onChange={(e) => {
                        setSelectedTeamId(e.target.value);
                        setMessage("");
                        setSaveMessage("");
                      }}
                      className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-300"
                    >
                      <option value="">Select a team</option>
                      {orderedTeamsForSlate.map((team) => {
                        const isParticipating = (team as any).is_participating !== false;

                        return (
                          <option
                            key={team.id}
                            value={team.id}
                            disabled={!isParticipating}
                          >
                            {team.name}
                            {(team as any).draft_order
                              ? ` (#${(team as any).draft_order})`
                              : ""}
                            {!isParticipating ? " - Out" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveLineup}
                    disabled={
                      isSaving ||
                      selectedSlate?.is_locked ||
                      !selectedTeamIdNumber ||
                      !participatingTeamIds.has(selectedTeamIdNumber)
                    }
                    className="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-900 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSaving ? "Saving..." : "Save"}
                  </button>
                </div>
              </div>

              <div className="mb-4 flex flex-wrap gap-2 text-xs text-slate-600">
                <span className="rounded-full bg-slate-100 px-2.5 py-1">
                  Total: {selectedPlayers.length}/5
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1">
                  Guards: {guardCount}/2
                </span>
                <span className="rounded-full bg-slate-100 px-2.5 py-1">
                  F/C: {fcCount}/3
                </span>
              </div>

              {message ? (
                <div className="mb-4 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
                  {message}
                </div>
              ) : null}

              {saveMessage ? (
                <div
                  className={`mb-4 rounded-2xl px-4 py-3 text-sm ${
                    saveMessage.toLowerCase().includes("success") ||
                    saveMessage.toLowerCase().includes("loaded") ||
                    saveMessage.toLowerCase().includes("auto-saved")
                      ? "border border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border border-red-200 bg-red-50 text-red-700"
                  }`}
                >
                  {saveMessage}
                </div>
              ) : null}

              {selectedPlayers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
                  {!selectedTeamId
                    ? "Select a team to start building a lineup."
                    : "No players selected yet."}
                </div>
              ) : (
                <div className="grid gap-3">
                  {selectedPlayers.map((player) => (
                    <button
                      key={player.id}
                      type="button"
                      onClick={() => handlePlayerClick(player)}
                      className="flex items-center justify-between rounded-2xl border border-sky-300 bg-sky-50 px-4 py-3 text-left transition hover:bg-sky-100"
                    >
                      <span className="truncate pr-2 text-sm font-medium text-slate-900">
                        {player.name}
                      </span>
                      <span className="rounded-full border border-sky-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                        {player.position_group}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-4 flex flex-col gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-slate-900">Player Pool</h2>
                  <p className="text-sm text-slate-600">
                    Search first, then pick from a tighter list sorted by best average.
                  </p>
                </div>

                <div className="flex flex-col gap-3">
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
                <div className="max-h-[320px] overflow-y-auto pr-1">
                  <div className="grid gap-3">
                    {filteredPlayers.map((player) => {
                      const isSelected = selectedPlayers.some(
                        (selectedPlayer) => selectedPlayer.id === player.id
                      );

                      const isTakenByOtherTeam = takenPlayerIdsByOtherTeams.has(player.id);
                      const ownerTeam = orderedTeamsForSlate.find((team) =>
                        lineupsState.some(
                          (lineup) =>
                            lineup.team_id === team.id &&
                            lineup.team_id !== selectedTeamIdNumber &&
                            lineup.player_ids.includes(player.id)
                        )
                      );

                      const isOnSlate = availablePlayerIdSet.has(player.id);
                      const avgScore = playerAverageMap.get(player.id) ?? 0;

                      const isDisabled =
                        !selectedTeamId ||
                        !selectedTeamIdNumber ||
                        !participatingTeamIds.has(selectedTeamIdNumber) ||
                        (!isSelected && isTakenByOtherTeam);

                      return (
                        <button
                          key={player.id}
                          type="button"
                          onClick={() => handlePlayerClick(player)}
                          disabled={isDisabled || isSaving || isSlateLoading}
                          className={`flex items-center justify-between rounded-2xl border px-4 py-3 text-left transition ${
                            isSelected
                              ? "border-emerald-300 bg-emerald-50"
                              : isTakenByOtherTeam
                              ? "cursor-not-allowed border-red-200 bg-red-50 opacity-60"
                              : "border-slate-200 bg-white hover:border-sky-200 hover:bg-sky-50"
                          } ${
                            !selectedTeamId || isSaving || isSlateLoading
                              ? "cursor-not-allowed opacity-60"
                              : ""
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-slate-900">
                              {player.name}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-700">
                                Avg {avgScore.toFixed(1)}
                              </span>
                              {isOnSlate ? (
                                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] text-emerald-800">
                                  On this slate
                                </span>
                              ) : null}
                              {isTakenByOtherTeam && !isSelected ? (
                                <span className="text-[11px] text-red-600">
                                  Used by {ownerTeam?.name ?? "another team"}
                                </span>
                              ) : null}
                            </div>
                          </div>

                          <span className="ml-2 rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] text-slate-600">
                            {player.position_group}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </section>
          </section>
        </>
      ) : (
        <>
          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4">
              <h2 className="text-2xl font-semibold text-slate-900">Slate Summary</h2>
              <p className="text-sm text-slate-600">Quick view of the current slate totals.</p>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                <div className="text-xs uppercase tracking-wide text-orange-700">Leader</div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {dailySummary.leader ? dailySummary.leader.teamName : "—"}
                </div>
                <div className="mt-1 text-sm text-slate-600">
                  {dailySummary.leader ? dailySummary.leader.total.toFixed(1) : "0.0"}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Games Completed
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {dailySummary.rows
                    .filter((row) => row.is_participating)
                    .reduce((sum, row) => sum + row.games_completed, 0)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  In Progress
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {dailySummary.rows
                    .filter((row) => row.is_participating)
                    .reduce((sum, row) => sum + row.games_in_progress, 0)}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="text-xs uppercase tracking-wide text-slate-500">
                  Remaining
                </div>
                <div className="mt-2 text-2xl font-bold text-slate-900">
                  {dailySummary.rows
                    .filter((row) => row.is_participating)
                    .reduce((sum, row) => sum + row.games_remaining, 0)}
                </div>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {dailySummary.rows.map((row, index) => (
                <div
                  key={row.teamId}
                  className={`rounded-2xl border px-4 py-3 ${
                    index === 0 && row.is_participating
                      ? "border-orange-200 bg-orange-50"
                      : "border-slate-200 bg-white"
                  } ${!row.is_participating ? "opacity-70" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-slate-900">
                      {row.teamName}
                      {!row.is_participating ? " (Out)" : ""}
                    </span>
                    <span className="text-sm text-slate-600">{row.total.toFixed(1)}</span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    C: {row.games_completed} • P: {row.games_in_progress} • R:{" "}
                    {row.games_remaining}
                  </div>
                </div>
              ))}
            </div>

            {lastRefreshSummary ? (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
                Refresh complete — Games found: {lastRefreshSummary.gamesFound ?? 0},
                Players updated: {lastRefreshSummary.playerStatsUpserted ?? 0}, Teams
                updated: {lastRefreshSummary.teamResultsUpserted ?? 0}
              </div>
            ) : null}
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-semibold text-slate-900">Scores</h2>
                <p className="text-sm text-slate-600">
                  Spreadsheet-style roster grid for the selected slate.
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

            <div className="overflow-x-auto -mx-4 px-4">
              <div className="min-w-[1100px] space-y-4">
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
                      className={`rounded-2xl border border-slate-200 bg-white overflow-hidden ${
                        !isParticipating ? "opacity-70" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between bg-slate-50 px-4 py-3">
                        <div className="text-lg font-semibold text-slate-900">
                          {team.name}
                          {!isParticipating ? " (Out)" : ""}
                          {(team as any).draft_order
                            ? ` • #${(team as any).draft_order}`
                            : ""}
                        </div>
                        <div className="text-sm text-slate-600">
                          Total:{" "}
                          {typeof stats.total === "number"
                            ? stats.total.toFixed(1)
                            : "0.0"}{" "}
                          • C: {stats.games_completed} • P: {stats.games_in_progress} •
                          R: {stats.games_remaining}
                        </div>
                      </div>

                      <table className="w-full border-collapse text-sm">
                        <thead className="bg-slate-100 text-slate-700">
                          <tr className="text-left">
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Position
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Player
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Points (1)
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Rebounds (1.2)
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Assists (1.5)
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Steals (2)
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Blocks (2)
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Turnovers (-1)
                            </th>
                            <th className="border-b border-slate-200 px-3 py-2 font-semibold">
                              Total
                            </th>
                          </tr>
                        </thead>
                        <tbody className="text-slate-800">
                          {rosterRows.map((row, index) => {
                            const stat = row.player ? getPlayerStat(row.player.id) : null;

                            return (
                              <tr key={`${team.id}-${index}`} className="border-b border-slate-100">
                                <td className="px-3 py-2">{row.slot}</td>
                                <td className="px-3 py-2">
                                  {row.player ? (
                                    row.player.name
                                  ) : (
                                    <span className="text-slate-400">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-2 text-right">{stat ? stat.points : 0}</td>
                                <td className="px-3 py-2 text-right">
                                  {stat ? stat.rebounds : 0}
                                </td>
                                <td className="px-3 py-2 text-right">{stat ? stat.assists : 0}</td>
                                <td className="px-3 py-2 text-right">{stat ? stat.steals : 0}</td>
                                <td className="px-3 py-2 text-right">{stat ? stat.blocks : 0}</td>
                                <td className="px-3 py-2 text-right">
                                  {stat ? stat.turnovers : 0}
                                </td>
                                <td className="px-3 py-2 text-right">
                                  {stat ? Number(stat.fantasy_points).toFixed(1) : "0.0"}
                                </td>
                              </tr>
                            );
                          })}

                          <tr className="bg-slate-50 font-semibold text-slate-900">
                            <td className="px-3 py-2"></td>
                            <td className="px-3 py-2">Totals</td>
                            <td className="px-3 py-2 text-right">{stats.points}</td>
                            <td className="px-3 py-2 text-right">{stats.rebounds}</td>
                            <td className="px-3 py-2 text-right">{stats.assists}</td>
                            <td className="px-3 py-2 text-right">{stats.steals}</td>
                            <td className="px-3 py-2 text-right">{stats.blocks}</td>
                            <td className="px-3 py-2 text-right">{stats.turnovers}</td>
                            <td className="px-3 py-2 text-right">
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
        </>
      )}
    </div>
  );
}
