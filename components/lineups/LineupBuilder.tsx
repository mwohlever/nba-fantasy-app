"use client";
import DraftOrder from "./DraftOrder";
import { effectiveDraftPick, draftStateLabel, type DraftPick, type DraftHistory } from "@/lib/lineups/draftHistory";

import { usePathname } from "next/navigation";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { usePullToRefresh } from "@/lib/client/usePullToRefresh";
import { createRefreshScope } from "@/lib/client/refreshScope";
import type { RefreshOutcome } from "@/lib/client/refreshOutcome";
import PullToRefreshIndicator from "@/components/ui/PullToRefreshIndicator";
import ScoresRefreshButton from "@/components/ui/ScoresRefreshButton";
import { nflSeasonForSlate } from "@/lib/lineups/nflDraftStats";

import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import { NflFantasyGameCenter } from "@/components/lineups/NflFantasyGameCenter";

import { refreshGolfFromBrowser, shouldApplyGolfSnapshot } from "@/lib/client/refreshGolfFromBrowser";

import DraftPlayerModal from "@/components/lineups/DraftPlayerModal";
import ReadOnlyPlayerModal from "@/components/lineups/ReadOnlyPlayerModal";
import PlayerResearchModal from "@/components/lineups/PlayerResearchModal";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import SlotDraftModal from "@/components/lineups/SlotDraftModal";
import PlayerPool from "@/components/lineups/PlayerPool";
import DraftRosterCourt from "@/components/lineups/DraftRosterCourt";
import SecondaryControlsPanel from "@/components/ui/SecondaryControlsPanel";
import RefreshPlayersButton from "@/components/lineups/RefreshPlayersButton";
import Link from "next/link";
import ScoresDashboard from "@/components/lineups/ScoresDashboard";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import LineupControls from "@/components/lineups/LineupControls";
import { getStatColumns } from "@/lib/statColumns";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { getSportConfig } from "@/lib/sports";
import {
  assignPlayersToRosterSlots,
  canPlayerFillRosterSlot,
  getRosterSlotsFromRulesSnapshot,
} from "@/lib/rules/leagueRules";
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
  const pathname = usePathname();
  const isDraftPage = pathname === "/lineups/draft";
  const isScoresPage = pathname === "/lineups/scores";
  const { groupContext, isLoading: isGroupLoading, isSwitchingGroup } = useGroupContext();
  const scoresSurfaceRef = useRef<HTMLDivElement>(null);
  const refreshScopeRef = useRef(createRefreshScope(""));
  const refreshMountedRef = useRef(true);
  const refreshHandlerRef = useRef<(silent?: boolean) => Promise<RefreshOutcome>>(async () => ({ status: "skipped" }));
  const [refreshFeedback, setRefreshFeedback] = useState<{ scope: string; text: string } | null>(null);

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
  const [draftSettingsOpen, setDraftSettingsOpen] = useState(false);
  const [draftContext, setDraftContext] = useState<{
    history?: DraftHistory | null;
    scope: string;
    participants: Team[];
    canProxyDraft: boolean;
    gamesByTeam: Record<string, LiveScoreGame>;
    slate: { id: number; is_locked: boolean; rules_snapshot?: Record<string, unknown> | null };
  } | null>(null);
  // Display-only intent; the server still determines every pick's chronology.
  const [editPicksScope, setEditPicksScope] = useState<string | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<{ scope: string; pick: DraftPick; playerId: number; playerName: string; expectedIds: number[] } | null>(null);
  const [orderPickTarget, setOrderPickTarget] = useState<{ scope: string; teamId: number; overallPick: number } | null>(null);
  const [viewedParticipant, setViewedParticipant] = useState<{ scope: string; id: number } | null>(null);
  const draftMutationRef = useRef(false);
  const [message, setMessage] = useState("");
  const latestSlateLoadRef = useRef(0);
  const activeGolfSlateRef = useRef<number | null>(null);
  const acceptedGolfRevisionRef = useRef({ slateId: 0, revision: -1 });
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
  const [refreshTimestamp, setRefreshTimestamp] = useState<{ scope: string; value: string } | null>(null);
  const refreshInFlightRef = useRef(false);
  const lastGolfAutoRefreshRef = useRef(0);
  const [isGolfSlateMenuOpen, setIsGolfSlateMenuOpen] =
    useState(false);

  const [compactView, setCompactView] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [currentUser, setCurrentUser] = useState<{
    teamId: number;
    displayName: string;
    role: "player" | "admin";
    systemRole?: "user" | "super_admin";

    /*
     * teamId is the legacy/default-team pointer.
     * Group-aware drafting must use the active Group's team.
     */
    activeGroupTeamId: number | null;
    activeGroupTeamName: string | null;
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
  const [leagueResearchPlayer, setLeagueResearchPlayer] =
    useState<Player | null>(null);
  const [targetDraftSlot, setTargetDraftSlot] =
    useState<TargetDraftSlot | null>(null);


  const [
    pendingRosterSlotChoice,
    setPendingRosterSlotChoice,
  ] =
    useState<{
      player: Player;
      teamId: number;

      slots: Array<{
        position: string;
        slotIndex: number;
      }>;
    } | null>(
      null,
    );


  const [draftPageTab, setDraftPageTab] = useState<
    "lineup" | "players" | "order"
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
  activeGolfSlateRef.current = selectedSlateIdNumber;
  const baseSelectedSlate = slates.find((slate) => slate.id === selectedSlateIdNumber) ?? null;
  const scopeReady = Boolean(groupContext?.group.id && baseSelectedSlate) && !isGroupLoading && !isSwitchingGroup &&
    (!sport || sport === selectedSport);
  const refreshScopeKey = JSON.stringify([groupContext?.group.id, selectedSport, sport,
    selectedSlateIdNumber, baseSelectedSlate?.sport, pathname, scopeReady]);
  const selectedSlate = isDraftPage && draftContext?.scope === refreshScopeKey
    ? { ...baseSelectedSlate!, ...draftContext.slate } : baseSelectedSlate;
  refreshScopeRef.current.update(refreshScopeKey);
  const isRenderScopeCurrent = refreshScopeRef.current.capture();
  const lastUpdatedAt = refreshTimestamp?.scope === refreshScopeKey ? refreshTimestamp.value : null;
  useEffect(() => {
    setRefreshFeedback(null);
    setLastRefreshSummary(null);
    setRefreshTimestamp(null);
  }, [refreshScopeKey]);
  useEffect(() => {
    if (refreshFeedback?.text !== "Updated just now") return;
    const timer = window.setTimeout(() => setRefreshFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [refreshFeedback]);
  useEffect(() => {
    refreshMountedRef.current = true;
    return () => {
      refreshMountedRef.current = false;
      refreshScopeRef.current.invalidate();
    };
  }, []);

  // Golf completion belongs to its accepted tournament lifecycle, not game counts.
  const scoresStatus = selectedSlate?.is_locked ? "Final" : selectedSlate?.sport === "golf" ? "Upcoming" :
    teamResultsState.some(row => Number(row.games_in_progress) > 0) ? "Live" :
    teamResultsState.some(row => Number(row.games_completed) > 0) &&
      teamResultsState.every(row => Number(row.games_remaining) === 0) ? "Final" :
    teamResultsState.some(row => Number(row.games_completed) > 0) ? "Live" : "Upcoming";
  const refreshUnavailable = !scopeReady || !selectedSlateIdNumber || isSlateLoading ||
    Boolean(selectedSlate?.is_locked) || (selectedSlate?.sport !== "golf" && scoresStatus === "Final");
  const pull = usePullToRefresh({
    targetRef: scoresSurfaceRef,
    buttonStartSelector: isDraftPage ? 'button[data-draft-pull-start="true"]' : undefined,
    onRefresh: () => isDraftPage ? refreshDraft() : refreshStatsForSelectedSlate(false),
    enabled: isDraftPage
      ? scopeReady && !isSlateLoading && !isSaving && !isAssigningPlayer && !draftSettingsOpen &&
        !draftingPlayer && !targetDraftSlot && !profilePlayer && !leagueResearchPlayer && !pendingRosterSlotChoice
      : isScoresPage && !refreshUnavailable && !profilePlayer && !isGolfSlateMenuOpen,
    isRefreshing: isRefreshingStats,
    scopeKey: refreshScopeKey,
  });
  const refreshIndicator = <PullToRefreshIndicator pull={pull}
    feedback={refreshFeedback?.scope === refreshScopeKey ? refreshFeedback.text : ""} />;



  const effectiveRosterSlots =
    useMemo(
      () => {
        const activeSport =
          (
            selectedSlate?.sport ??
            sport ??
            selectedSport
          ) as
            | "nba"
            | "nfl"
            | "golf";


        /*
         * New slates use their immutable rules snapshot.
         *
         * Historical slates have no snapshot, so the rule helper
         * deliberately returns the legacy 111 defaults.
         */
        return getRosterSlotsFromRulesSnapshot(
          selectedSlate?.rules_snapshot ??
            null,
          activeSport,
        );
      },
      [
        selectedSlate?.id,
        selectedSlate?.sport,
        selectedSlate?.rules_snapshot,
        sport,
        selectedSport,
      ],
    );


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

        const loadedUser =
          result.user ??
          null;

        const activeGroupTeam =
          result.groupContext?.team ??
          null;

        setCurrentUser(
          loadedUser
            ? {
                ...loadedUser,

                activeGroupTeamId:
                  activeGroupTeam?.id !==
                    null &&
                  activeGroupTeam?.id !==
                    undefined
                    ? Number(
                        activeGroupTeam.id,
                      )
                    : null,

                activeGroupTeamName:
                  activeGroupTeam?.name ??
                  null,
              }
            : null,
        );
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
    if (selectedSlate?.sport === "golf" && acceptedGolfRevisionRef.current.slateId === selectedSlateIdNumber) {
      // Parent props have no slate revision. Reload a consistent accepted snapshot.
      window.dispatchEvent(new CustomEvent("golf-accepted-change", { detail: { slateId: selectedSlateIdNumber } }));
      return;
    }
    setPlayerStatsState(playerStats);
  }, [playerStats]);

  useEffect(() => {
    if (selectedSlate?.sport === "golf" && acceptedGolfRevisionRef.current.slateId === selectedSlateIdNumber) {
      // Parent props have no slate revision. Reload a consistent accepted snapshot.
      window.dispatchEvent(new CustomEvent("golf-accepted-change", { detail: { slateId: selectedSlateIdNumber } }));
      return;
    }
    setTeamResultsState(teamResults);
  }, [teamResults]);

  useEffect(() => {
    if (!selectedSlateIdNumber) return;

    let isActive = true;

    if (isDraftPage) return;

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
    if (!selectedSlateIdNumber || isDraftPage) return;

    if (!scopeReady) return;
    const isGolf = selectedSlate?.sport === "golf";
    const shouldAutoRefresh = isGolf || autoRefreshEnabled;

    if (!shouldAutoRefresh) return;
    if (selectedSlate?.is_locked) return;

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      const minimumGapMs = isGolf ? 4.5 * 60 * 1000 : 25 * 1000;

      if (
        lastGolfAutoRefreshRef.current &&
        now - lastGolfAutoRefreshRef.current < minimumGapMs
      ) {
        return;
      }

      lastGolfAutoRefreshRef.current = now;
      void refreshHandlerRef.current(true);
    };

    // An open Golf page becomes a live-score updater immediately.
    refreshIfVisible();

    const intervalMs = isGolf ? 5 * 60 * 1000 : 30 * 1000;
    const interval = window.setInterval(refreshIfVisible, intervalMs);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfVisible();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [
    autoRefreshEnabled,
    selectedSlateIdNumber,
    selectedSlate?.sport,
    selectedSlate?.is_locked,
    refreshScopeKey,
  ]);

  useEffect(() => {
    if (!selectedSlateIdNumber) return;
    if (isDraftPage) {
      setDraftingPlayer(null); setTargetDraftSlot(null); setPendingRosterSlotChoice(null); setOrderPickTarget(null);
      setLeagueResearchPlayer(null); setProfilePlayer(null); setEditPicksScope(null); setCorrectionTarget(null);
    }
    void loadSlateLineups(selectedSlateIdNumber);
  }, [selectedSlateIdNumber, refreshScopeKey]);

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
    if (isDraftPage) {
      if (!scopeReady) return [];
      if (draftContext?.scope === refreshScopeKey) return draftContext.participants;
      // Server props may still describe the previous Group during navigation.
      // Wait for this scope's authorized participant response instead of guessing.
      return [];
    }
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
  }, [selectedSlateIdNumber, slateTeamConfigs, teams, teamsById, isDraftPage, scopeReady, draftContext, refreshScopeKey]);

  const currentTeamId = isDraftPage
    ? orderedTeamsForSlate.find(team => team.id === groupContext?.team?.id)?.id ?? null
    : currentUser?.activeGroupTeamId ?? currentUser?.teamId ?? null;
  const canProxyDraft = scopeReady && draftContext?.scope === refreshScopeKey && draftContext.canProxyDraft === true;
  const orderHistory = draftContext?.scope === refreshScopeKey ? draftContext.history : null;
  const orderTurn = orderHistory?.available ? orderHistory.turn : null;
  const orderTeam = orderedTeamsForSlate.find(team => team.id === orderTurn?.teamId);
  const canEnterOrderPick = Boolean(scopeReady && orderTeam && orderTurn?.overallPick &&
    (orderTurn.state === "active" || orderTurn.state === "empty") && !selectedSlate?.is_locked &&
    (orderTeam.id === currentTeamId || canProxyDraft));
  const activeOrderTarget = orderPickTarget?.scope === refreshScopeKey ? orderPickTarget : null;

  useEffect(() => {
    if (orderPickTarget && (!activeOrderTarget || !canEnterOrderPick ||
      orderTurn?.teamId !== orderPickTarget.teamId || orderTurn?.overallPick !== orderPickTarget.overallPick)) {
      setOrderPickTarget(null); setDraftingPlayer(null); setPendingRosterSlotChoice(null);
    }
  }, [orderPickTarget, activeOrderTarget, canEnterOrderPick, orderTurn?.teamId, orderTurn?.overallPick]);

  const canEditPicks = Boolean(isDraftPage && scopeReady && orderHistory?.available &&
    (groupContext?.canAdministerGroup || currentUser?.systemRole === "super_admin"));
  const editingPicks = canEditPicks && editPicksScope === refreshScopeKey;
  const activeCorrection = editingPicks && correctionTarget?.scope === refreshScopeKey ? correctionTarget : null;
  function canEditPick(pick: DraftPick) {
    const effective = orderHistory && effectiveDraftPick(pick, orderHistory.corrections);
    return Boolean(canEditPicks && effective?.playerId && getPlayersForTeam(pick.team_id).some(p => p.id === effective.playerId));
  }
  function cancelCorrection() { setCorrectionTarget(null); setDraftingPlayer(null); setPendingRosterSlotChoice(null); }
  function beginCorrection(pick: DraftPick) {
    if (!canEditPick(pick) || isSaving || isAssigningPlayer || isSlateLoading || !orderHistory) return;
    const effective = effectiveDraftPick(pick, orderHistory.corrections);
    setOrderPickTarget(null); setTargetDraftSlot(null); setDraftingPlayer(null);
    setCorrectionTarget({ scope: refreshScopeKey, pick, playerId: effective.playerId!, playerName: effective.playerName,
      expectedIds: getPlayersForTeam(pick.team_id).map(p => p.id) });
  }
  async function replaceOrderPick(player: Player, teamId: number) {
    if (!activeCorrection || !canEditPicks || !isRenderScopeCurrent() || teamId !== activeCorrection.pick.team_id ||
      draftMutationRef.current || isSaving || isSlateLoading) return false;
    if (getOwnerTeamIdForPlayer(player.id)) { setSaveMessage("That player is already rostered."); return false; }
    if (!window.confirm(`Replace ${activeCorrection.playerName} with ${player.name} for ${activeCorrection.pick.team_name} at pick #${activeCorrection.pick.overall_pick}?`)) return false;
    const current = refreshScopeRef.current.capture();
    draftMutationRef.current = true; ++latestSlateLoadRef.current; setIsAssigningPlayer(true);
    try {
      const response = await fetch("/api/admin/lineup-correction", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slateId: selectedSlateIdNumber, teamId, action: "replace", pickId: activeCorrection.pick.id,
          oldPlayerId: activeCorrection.playerId, newPlayerId: player.id, expectedPlayerIds: activeCorrection.expectedIds }) });
      const result = await response.json();
      if (!current()) return false;
      setSaveMessage(response.ok ? "Pick corrected successfully." : result.error || "Correction failed. Review the refreshed roster.");
      return response.ok;
    } catch {
      if (current()) setSaveMessage("Could not confirm correction. Review the refreshed roster before retrying.");
      return false;
    } finally {
      draftMutationRef.current = false; setIsAssigningPlayer(false);
      if (current()) { cancelCorrection(); if (selectedSlateIdNumber) void loadSlateLineups(selectedSlateIdNumber); }
    }
  }

  function beginOrderPick() {
    if (!canEnterOrderPick || !orderTeam || !orderTurn?.overallPick || isSlateLoading || isSaving || isAssigningPlayer) return;
    setCorrectionTarget(null); setEditPicksScope(null);
    setTargetDraftSlot(null); setPendingRosterSlotChoice(null); setDraftingPlayer(null);
    setOrderPickTarget({ scope: refreshScopeKey, teamId: orderTeam.id, overallPick: orderTurn.overallPick });
  }

  const viewedTeam = orderedTeamsForSlate.find(team => viewedParticipant?.scope === refreshScopeKey && team.id === viewedParticipant.id)
    ?? orderedTeamsForSlate.find(team => team.id === currentTeamId) ?? orderedTeamsForSlate[0] ?? null;

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

        if (positionFilter !== "All") {
          const matchesPositionFilter =
            selectedSport === "nfl"
              ? canPlayerFillRosterSlot(
                  "nfl",
                  player.position_group,
                  positionFilter,
                )
              : player.position_group === positionFilter;

          if (!matchesPositionFilter) {
            return false;
          }
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
    return effectiveRosterSlots;
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

  function getDraftNeeds(
    teamId:
      number,
  ) {
    const teamPlayers =
      getPlayersForTeam(
        teamId,
      );


    const activeSport =
      (
        selectedSlate?.sport ??
        sport ??
        selectedSport
      ) as
        | "nba"
        | "nfl"
        | "golf";


    const assignment =
      assignPlayersToRosterSlots({
        sport:
          activeSport,

        playerPositions:
          teamPlayers.map(
            (player) =>
              player.position_group,
          ),

        rosterSlots:
          getEffectiveRosterSlots(),
      });


    const needCounts =
      new Map<
        string,
        number
      >();


    for (
      const slot
      of assignment.remainingSlots
    ) {
      needCounts.set(
        slot.position,
        (
          needCounts.get(
            slot.position,
          ) ??
          0
        ) +
          1,
      );
    }


    const parts =
      Array.from(
        needCounts.entries(),
      ).map(
        (
          [
            position,
            count,
          ],
        ) =>
          `${count} ${position}`,
      );


    if (
      parts.length ===
      0
    ) {
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

    if (isDraftPage && (!team || (teamId !== currentTeamId && !canProxyDraft))) {
      return { canAssign: false, reason: "Commissioner access required" };
    }
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

    const activeSport =
      (
        selectedSlate?.sport ??
        sport ??
        selectedSport
      ) as
        | "nba"
        | "nfl"
        | "golf";


    const assignment =
      assignPlayersToRosterSlots({
        sport:
          activeSport,

        playerPositions:
          nextPlayers.map(
            (item) =>
              item.position_group,
          ),

        rosterSlots:
          getEffectiveRosterSlots(),
      });


    if (
      !assignment.fits
    ) {
      return {
        canAssign:
          false,

        reason:
          "No compatible roster spot",
      };
    }


    return {
      canAssign:
        true,

      reason:
        "",
    };
  }

  function applyAcceptedGolfSnapshot(slateId: number, snapshot: {
    acceptedRevision?: number;
    playerStats?: PlayerStat[];
    teamResults?: TeamResult[];
  }) {
    const revision = Number(snapshot.acceptedRevision ?? -1);
    const current = acceptedGolfRevisionRef.current;
    if (activeGolfSlateRef.current !== slateId || !shouldApplyGolfSnapshot(current, slateId, revision)) return;
    acceptedGolfRevisionRef.current = { slateId, revision };
    setPlayerStatsState(snapshot.playerStats ?? []);
    setTeamResultsState(snapshot.teamResults ?? []);
  }

  async function refreshDraft(): Promise<RefreshOutcome> {
    if (!refreshMountedRef.current || !isRenderScopeCurrent() || !scopeReady || !selectedSlateIdNumber ||
      refreshInFlightRef.current || draftMutationRef.current || isSaving || isAssigningPlayer || isSlateLoading) return { status: "skipped" };
    refreshInFlightRef.current = true;
    setIsRefreshingStats(true);
    setRefreshFeedback({ scope: refreshScopeKey, text: "Refreshing…" });
    try { return await loadDraftState(selectedSlateIdNumber, true); }
    finally { refreshInFlightRef.current = false; if (refreshMountedRef.current) setIsRefreshingStats(false); }
  }

  async function loadDraftState(slateId: number, routine = false): Promise<RefreshOutcome> {
    if (!scopeReady || !isRenderScopeCurrent()) return { status: "skipped" };
    const loadId = ++latestSlateLoadRef.current;
    const isCurrent = refreshScopeRef.current.capture();
    const valid = () => refreshMountedRef.current && isCurrent() && loadId === latestSlateLoadRef.current;
    if (!routine) setIsSlateLoading(true);
    try {
      const responses = await Promise.all([
        fetch(`/api/lineups?slateId=${slateId}&draft=true`, { cache: "no-store" }),
        fetch(`/api/slate-availability?slateId=${slateId}`, { cache: "no-store" }),
        fetch(`/api/player-stats?slateId=${slateId}`, { cache: "no-store" }),
        fetch(`/api/team-results?slateId=${slateId}`, { cache: "no-store" }),
        ...((sport ?? selectedSport) === "nfl" ? [fetch(`/api/lineups/nfl-games?slateId=${slateId}`, { cache: "no-store" })] : []),
      ]);
      const [lineups, availability, stats, results, games] = await Promise.all(responses.map(response => response.json()));
      if (!valid()) return { status: "skipped" };
      if (responses.some(response => !response.ok) || !Array.isArray(lineups.lineups) ||
        !Array.isArray(lineups.draftContext?.participants) || !Array.isArray(availability.availablePlayerIds) ||
        !Array.isArray(stats.playerStats) || !Array.isArray(results.teamResults) ||
        lineups.draftContext.groupId !== groupContext?.group.id || lineups.draftContext.slateId !== slateId ||
        lineups.draftContext.slate?.id !== slateId ||
        ((sport ?? selectedSport) === "nfl" && (games?.slateId !== slateId || !games?.gamesByTeam))) throw new Error("Could not refresh Draft. Try again.");
      setLineupsState(lineups.lineups);
      // These GETs read stored data only; Draft never initiates scoring reconciliation.
      if (stats.sport === "golf") applyAcceptedGolfSnapshot(slateId, stats);
      else {
        setPlayerStatsState(stats.playerStats);
        setTeamResultsState(results.teamResults);
      }
      setAvailablePlayerIdsForSlate(availability.availablePlayerIds);
      setDraftContext({ scope: refreshScopeKey, history: lineups.draftContext.history, participants: lineups.draftContext.participants, canProxyDraft: lineups.draftContext.canProxyDraft === true, slate: lineups.draftContext.slate, gamesByTeam: games?.gamesByTeam ?? {} });
      setRefreshTimestamp({ scope: refreshScopeKey, value: new Date().toISOString() });
      setRefreshFeedback({ scope: refreshScopeKey, text: routine ? "Updated just now" : "" });
      setSaveMessage("");
      return { status: "success" };
    } catch (error) {
      if (!valid()) return { status: "skipped" };
      const text = error instanceof Error ? error.message : "Could not refresh Draft.";
      setRefreshFeedback({ scope: refreshScopeKey, text });
      return { status: "error", message: text };
    } finally { if (valid()) setIsSlateLoading(false); }
  }

  async function loadSlateLineups(nextSlateId: number) {
    if (isDraftPage) { await loadDraftState(nextSlateId); return; }
    const loadId = ++latestSlateLoadRef.current;
    const isCurrent = refreshScopeRef.current.capture();

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

      if (!isCurrent() || loadId !== latestSlateLoadRef.current) return;

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
      if (statsResult.sport === "golf") {
        applyAcceptedGolfSnapshot(nextSlateId, statsResult);
      } else {
        setPlayerStatsState(statsResult.playerStats ?? []);
        setTeamResultsState(resultsResult.teamResults ?? []);
      }
      setSaveMessage("");
    } catch (error) {
      if (!isCurrent() || loadId !== latestSlateLoadRef.current) return;
      console.error(error);
      setSaveMessage("Something went wrong while loading the slate.");
    } finally {
      if (isCurrent() && loadId === latestSlateLoadRef.current) {
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

      if (!isCurrent() || loadId !== latestSlateLoadRef.current) return;

      if (!availabilityResponse.ok) {
        console.error(
          availabilityResult.error || "Failed to load slate availability."
        );
        setAvailablePlayerIdsForSlate([]);
        return;
      }

      setAvailablePlayerIdsForSlate(availabilityResult.availablePlayerIds ?? []);
    } catch (error) {
      if (!isCurrent() || loadId !== latestSlateLoadRef.current) return;
      console.error(error);
      setAvailablePlayerIdsForSlate([]);
    } finally {
      if (isCurrent() && loadId === latestSlateLoadRef.current) {
        setIsAvailabilityLoading(false);
      }
    }
  }

  useEffect(() => {
    if (selectedSlate?.sport !== "golf" || !selectedSlateIdNumber) return;
    let cancelled = false;
    let requestNumber = 0;
    const isCurrent = refreshScopeRef.current.capture();
    const reloadAcceptedGolf = async (event: Event) => {
      if ((event as CustomEvent).detail?.slateId !== selectedSlateIdNumber) return;
      const request = ++requestNumber;
      try {
        const stats = await fetch(`/api/player-stats?slateId=${selectedSlateIdNumber}`, { cache: "no-store" });
        if (!stats.ok) throw new Error("Could not reload accepted Golf results.");
        const statsBody = await stats.json();
        if (!isCurrent() || cancelled || request !== requestNumber) return;
        applyAcceptedGolfSnapshot(selectedSlateIdNumber, statsBody);
      } catch (error) { console.error(error); }
    };
    window.addEventListener("golf-accepted-change", reloadAcceptedGolf);
    return () => { cancelled = true; window.removeEventListener("golf-accepted-change", reloadAcceptedGolf); };
  }, [selectedSlateIdNumber, selectedSlate?.sport, refreshScopeKey]);

  async function refreshStatsForSelectedSlate(isSilent = false): Promise<RefreshOutcome> {
    if (!refreshMountedRef.current || !isRenderScopeCurrent() || !selectedSlate || !selectedSlateIdNumber || !scopeReady || selectedSlate.is_locked ||
      (isScoresPage && selectedSlate.sport !== "golf" && scoresStatus === "Final") ||
      (!isSilent && isScoresPage && isSlateLoading) || refreshInFlightRef.current) {
      return { status: "skipped" };
    }
    const isCurrent = refreshScopeRef.current.capture();
    const slateId = selectedSlateIdNumber;
    const refreshSport = selectedSlate?.sport ?? selectedSport;
    refreshInFlightRef.current = true;
    setIsRefreshingStats(true);
    if (!isSilent) {
      setMessage("");
      setSaveMessage("");
      setRefreshFeedback({ scope: refreshScopeKey, text: "Refreshing…" });
    }
    try {
      let refreshResult: Record<string, unknown>;
      if (refreshSport === "golf") {
        refreshResult = await refreshGolfFromBrowser(slateId);
      } else {
        const response = await fetch(refreshSport === "nfl" ? "/api/refresh-stats-nfl" : "/api/refresh-stats", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slateId }), cache: "no-store",
        });
        refreshResult = await response.json();
        if (!response.ok) throw new Error(String(refreshResult.error ?? "Failed to refresh stats."));
      }
      if (!isCurrent()) return { status: "skipped" };
      // Golf's player-stats response is the atomic accepted player/team snapshot.
      const [statsResponse, resultsResponse] = await Promise.all([
        fetch(`/api/player-stats?slateId=${slateId}`, { cache: "no-store" }),
        refreshSport === "golf" ? Promise.resolve(null) :
          fetch(`/api/team-results?slateId=${slateId}`, { cache: "no-store" }),
      ]);
      const statsResult = await statsResponse.json();
      const resultsResult = resultsResponse ? await resultsResponse.json() : null;
      if (!isCurrent()) return { status: "skipped" };
      if (!statsResponse.ok || (resultsResponse && !resultsResponse.ok)) {
        throw new Error("Could not reload refreshed results.");
      }
      if (refreshSport === "golf") {
        if (!Number.isSafeInteger(statsResult.acceptedRevision) || statsResult.acceptedRevision < 0 ||
          statsResult.acceptedRevision < Number(refreshResult.acceptedRevision ?? 0)) {
          throw new Error("Could not reload accepted Golf results.");
        }
        applyAcceptedGolfSnapshot(slateId, statsResult);
      } else {
        setPlayerStatsState(statsResult.playerStats ?? []);
        setTeamResultsState(resultsResult?.teamResults ?? []);
      }
      setLastRefreshSummary({
        gamesFound: typeof refreshResult.gamesFound === "number" ? refreshResult.gamesFound : undefined,
        playerStatsUpserted: typeof refreshResult.playerStatsUpserted === "number" ? refreshResult.playerStatsUpserted : undefined,
        teamResultsUpserted: typeof refreshResult.teamResultsUpserted === "number" ? refreshResult.teamResultsUpserted : undefined,
      });
      setRefreshTimestamp({ scope: refreshScopeKey, value: new Date().toISOString() });
      if (!isSilent) {
        setRefreshFeedback({ scope: refreshScopeKey, text: "Updated just now" });
        if (!isScoresPage) setSaveMessage("Stats refreshed successfully.");
      }
      void fetch(`/api/slate-availability?slateId=${slateId}`, { cache: "no-store" })
        .then(async response => {
          if (!response.ok) return;
          const result = await response.json();
          if (isCurrent()) setAvailablePlayerIdsForSlate(result.availablePlayerIds ?? []);
        }).catch(error => { if (isCurrent()) console.error(error); });
      return { status: "success" };
    } catch (error) {
      if (!isCurrent()) return { status: "skipped" };
      const message = error instanceof Error ? error.message : "Something went wrong while refreshing stats.";
      const waiting = refreshSport === "golf" && message.toLowerCase().includes("tournament field is not available yet");
      if (!waiting) console.error(error);
      if (!isSilent) {
        setRefreshFeedback({ scope: refreshScopeKey, text: waiting
          ? "Unable to refresh: ESPN has not published the field yet."
          : `Unable to refresh: ${message}` });
        if (!isScoresPage) alert(message);
      }
      return { status: "error", message };
    } finally {
      // This lock spans scope changes as well: never start a second provider refresh.
      refreshInFlightRef.current = false;
      if (refreshMountedRef.current) setIsRefreshingStats(false);
    }
  }
  // Timers keep their existing cadence but execute against the latest loaded state.
  refreshHandlerRef.current = refreshStatsForSelectedSlate;

  function getCompatibleOpenSlotsForPlayer(
    teamId: number,
    player: Player,
  ) {
    const activeSport =
      (
        selectedSlate?.sport ??
        sport ??
        selectedSport
      ) as
        | "nba"
        | "nfl"
        | "golf";


    const teamPlayers =
      getPlayersForTeam(
        teamId,
      );


    const lineupWithSlots =
      getLineupForTeam(
        teamId,
      ) as
        | (
            SavedLineup & {
              player_slots?: Array<{
                player_id: number;
                roster_slot_position:
                  string | null;
                roster_slot_index:
                  number | null;
              }>;
            }
          )
        | null;


    const savedSlots =
      lineupWithSlots?.player_slots ??
      [];


    const savedSlotByPlayerId =
      new Map<
        number,
        {
          position: string;
          slotIndex: number;
        }
      >();


    for (
      const savedSlot
      of savedSlots
    ) {
      if (
        !savedSlot.roster_slot_position ||
        savedSlot.roster_slot_index ===
          null ||
        savedSlot.roster_slot_index ===
          undefined
      ) {
        continue;
      }


      savedSlotByPlayerId.set(
        savedSlot.player_id,
        {
          position:
            savedSlot.roster_slot_position,

          slotIndex:
            savedSlot.roster_slot_index,
        },
      );
    }


    /*
     * For new configurable-roster slates, persisted slot
     * assignments are authoritative.
     *
     * Do not re-run the generic position matcher here:
     * a Guard intentionally saved to UTIL must remain in
     * UTIL when determining whether G is still open.
     */
    const hasCompleteSavedSlotState =
      teamPlayers.every(
        (teamPlayer) =>
          savedSlotByPlayerId.has(
            teamPlayer.id,
          ),
      );


    let openSlots: Array<{
      position: string;
      slotIndex: number;
    }>;


    if (
      hasCompleteSavedSlotState
    ) {
      const occupiedSlotKeys =
        new Set(
          Array.from(
            savedSlotByPlayerId.values(),
          ).map(
            (slot) =>
              `${slot.position}:${slot.slotIndex}`,
          ),
        );


      openSlots =
        getEffectiveRosterSlots()
          .flatMap(
            (slotConfig) =>
              Array.from(
                {
                  length:
                    slotConfig.slot_count,
                },
                (
                  _,
                  slotIndex,
                ) => ({
                  position:
                    slotConfig.position,

                  slotIndex,
                }),
              ),
          )
          .filter(
            (slot) =>
              !occupiedSlotKeys.has(
                `${slot.position}:${slot.slotIndex}`,
              ),
          );
    } else {
      /*
       * Legacy lineups may not have persisted slot metadata.
       * Keep the existing inferred behavior for those rows.
       */
      const assignment =
        assignPlayersToRosterSlots({
          sport:
            activeSport,

          playerPositions:
            teamPlayers.map(
              (teamPlayer) =>
                teamPlayer.position_group,
            ),

          rosterSlots:
            getEffectiveRosterSlots(),
        });


      openSlots =
        assignment.remainingSlots.map(
          (slot) => ({
            position:
              slot.position,

            slotIndex:
              slot.slotIndex,
          }),
        );
    }


    return openSlots
      .filter(
        (slot) =>
          canPlayerFillRosterSlot(
            activeSport,
            player.position_group,
            slot.position,
          ),
      )
      .sort(
        (
          a,
          b,
        ) => {
          /*
           * Present the player's natural roster position
           * before FLEX/UTIL-style alternatives.
           */
          const aNatural =
            a.position.toUpperCase() ===
            player.position_group.toUpperCase();

          const bNatural =
            b.position.toUpperCase() ===
            player.position_group.toUpperCase();


          if (
            aNatural !==
            bNatural
          ) {
            return aNatural
              ? -1
              : 1;
          }


          const positionCompare =
            a.position.localeCompare(
              b.position,
            );


          if (
            positionCompare !==
            0
          ) {
            return positionCompare;
          }


          return (
            a.slotIndex -
            b.slotIndex
          );
        },
      );
  }


  async function persistLineupForTeam(
    teamId: number,
    playerList: Player[],
    successMessage?: string,
    options?: {
      allowEmpty?: boolean;
      notifyNextDrafter?: boolean;

      rosterSlot?: {
        playerId: number;
        position: string;
        slotIndex: number;
      };
    }
  ) {
    setSaveMessage("");
    setMessage("");

    if (isDraftPage && (teamId !== currentTeamId && !canProxyDraft)) return false;
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

    const totalSlots =
      getRosterTotalSlots();

    const slots =
      getEffectiveRosterSlots();


    if (
      playerList.length >
      totalSlots
    ) {
      setSaveMessage(
        `A lineup can have at most ${totalSlots} players.`,
      );

      return false;
    }


    const activeSport =
      (
        selectedSlate?.sport ??
        sport ??
        selectedSport
      ) as
        | "nba"
        | "nfl"
        | "golf";


    const assignment =
      assignPlayersToRosterSlots({
        sport:
          activeSport,

        playerPositions:
          playerList.map(
            (player) =>
              player.position_group,
          ),

        rosterSlots:
          slots,
      });


    if (
      !assignment.fits
    ) {
      setSaveMessage(
        "That player combination does not fit the configured roster.",
      );

      return false;
    }

    try {
      if (isDraftPage && (!isRenderScopeCurrent() || !scopeReady)) return false;
      const isSaveCurrent = refreshScopeRef.current.capture();
      setIsSaving(true);

      const response = await fetch("/api/lineups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slateId: selectedSlateIdNumber,
          teamId,
          expectedPlayerIds: lineupsState.find(lineup => lineup.team_id === teamId)?.player_ids ?? [],
          playerIds:
            playerList.map(
              (player) =>
                player.id,
            ),

          notifyNextDrafter:
            options?.notifyNextDrafter ===
            true,

          rosterSlot:
            options?.rosterSlot ??
            null,
        }),
        cache: "no-store",
      });

      const result = await response.json();
      if (isDraftPage && !isSaveCurrent()) return false;

      if (!response.ok) {
        setSaveMessage(
          result.error ||
            "Failed to save lineup.",
        );

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

  async function handleAssignPlayerToTeam(
    player: Player,
    targetTeamId: number,

    explicitSlot?: {
      position: string;
      slotIndex: number;
    },
  ) {
    if (isDraftPage && (!scopeReady || !isRenderScopeCurrent() || isSlateLoading || draftMutationRef.current || (targetTeamId !== currentTeamId && !canProxyDraft))) return false;
    if (activeOrderTarget && (!canEnterOrderPick || targetTeamId !== activeOrderTarget.teamId ||
      orderTurn?.teamId !== activeOrderTarget.teamId || orderTurn?.overallPick !== activeOrderTarget.overallPick)) {
      setSaveMessage("The draft has advanced. Review the current pick.");
      setOrderPickTarget(null); setDraftingPlayer(null); setPendingRosterSlotChoice(null);
      if (selectedSlateIdNumber) void loadSlateLineups(selectedSlateIdNumber);
      return false;
    }
    const targetTeam = orderedTeamsForSlate.find((team) => team.id === targetTeamId);
    if (!targetTeam) return false;

    /*
     * Normal Players-tab drafting needs the generic assignment check.
     *
     * Explicit slot drafting already has a concrete destination
     * (for example GOLFER #1). Let the explicit-slot path continue
     * to the authoritative API validation instead of rejecting it
     * through the generic roster-fit check first.
     */
    if (!explicitSlot) {
      const assignmentStatus =
        getTeamAssignmentStatus(
          targetTeamId,
          player,
        );

      if (!assignmentStatus.canAssign) {
        setSaveMessage(
          assignmentStatus.reason,
        );

        return false;
      }
    }

    const currentOwnerTeamId =
      getOwnerTeamIdForPlayer(
        player.id,
      );

    const targetPlayers =
      getPlayersForTeam(
        targetTeamId,
      );


    let chosenSlot =
      explicitSlot ??
      null;


    if (
      !chosenSlot
    ) {
      const compatibleSlots =
        getCompatibleOpenSlotsForPlayer(
          targetTeamId,
          player,
        );


      if (
        compatibleSlots.length ===
        0
      ) {
        setSaveMessage(
          `${player.name} does not fit an open roster spot.`,
        );

        return false;
      }


      const compatiblePositionSlots =
        Array.from(
          new Map(
            compatibleSlots.map(
              (slot) => [
                slot.position,
                slot,
              ],
            ),
          ).values(),
        );


      if (
        compatiblePositionSlots.length >
        1
      ) {
        /*
         * Players-tab flow:
         * team is known, but there is more than one legal
         * roster-position type.
         *
         * Multiple physical slots of the same type collapse
         * to one choice. For example, two open G slots plus
         * UTIL should present:
         *
         *   G
         *   UTIL
         *
         * The first open physical slot for the chosen position
         * is retained behind that choice.
         */
        setDraftingPlayer(
          null,
        );

        setPendingRosterSlotChoice({
          player,
          teamId:
            targetTeamId,

          slots:
            compatiblePositionSlots,
        });

        return false;
      }


      chosenSlot =
        compatiblePositionSlots[
          0
        ];
    }


    if (currentOwnerTeamId === targetTeamId) {
      setSaveMessage(`${player.name} is already on ${targetTeam.name}.`);
      return false;
    }

    const isOrderAssignmentCurrent = refreshScopeRef.current.capture();
    if (activeOrderTarget && !window.confirm(`Draft ${player.name} for ${targetTeam.name} at pick #${activeOrderTarget.overallPick}?`)) return false;

    try {
      if (isDraftPage) { draftMutationRef.current = true; ++latestSlateLoadRef.current; setRefreshFeedback(null); }
      setIsAssigningPlayer(true);

      if (currentOwnerTeamId && currentOwnerTeamId !== targetTeamId) {
        if ((selectedSlate?.sport ?? sport ?? selectedSport) !== "golf") {
          setSaveMessage("That player is already rostered. Use commissioner corrections to change ownership.");
          return false;
        }
        const ownerPlayers = getPlayersForTeam(currentOwnerTeamId).filter(
          (item) => item.id !== player.id
        );

        const removed = await persistLineupForTeam(
          currentOwnerTeamId,
          ownerPlayers,
          undefined,
          { allowEmpty: true }
        );

        if (!removed) return false;
      }

      const isAdminProxyPick =
        currentUser?.role === "admin" &&
        targetTeamId !== currentTeamId;

      const shouldNotifyNextDrafter = isAdminProxyPick
        ? notifyNextDrafterForProxyPicks
        : true;

      const added = await persistLineupForTeam(
        targetTeamId,
        [...targetPlayers, player],
        `${player.name} drafted to ${targetTeam.name}.`,
        {
          notifyNextDrafter:
            shouldNotifyNextDrafter,

          rosterSlot: {
            playerId:
              player.id,

            position:
              chosenSlot.position,

            slotIndex:
              chosenSlot.slotIndex,
          },
        }
      );

      if (activeOrderTarget && !isOrderAssignmentCurrent()) return false;
      if (!added) {
        if (activeOrderTarget) {
          setOrderPickTarget(null); setDraftingPlayer(null); setPendingRosterSlotChoice(null);
          if (selectedSlateIdNumber) void loadSlateLineups(selectedSlateIdNumber);
        }
        return false;
      }
      if (activeOrderTarget) setOrderPickTarget(null);

      setDraftingPlayer(null);
      if (!activeOrderTarget) setSearchTerm("");

      if (selectedSlateIdNumber) {
        void loadSlateLineups(selectedSlateIdNumber);
      }

      return true;
    } finally {
      draftMutationRef.current = false;
      setIsAssigningPlayer(false);
    }
  }

  async function handleRemovePlayerFromTeam(player: Player) {
    if (isDraftPage && (!scopeReady || !isRenderScopeCurrent() || isSlateLoading || draftMutationRef.current)) return;
    const ownerTeamId = getOwnerTeamIdForPlayer(player.id);
    const ownerTeam = getOwnerTeamForPlayer(player.id);

    if (!ownerTeamId || !ownerTeam || (isDraftPage && ownerTeamId !== currentTeamId && !canProxyDraft)) return;

    try {
      if (isDraftPage) { draftMutationRef.current = true; ++latestSlateLoadRef.current; setRefreshFeedback(null); }
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
      draftMutationRef.current = false;
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

        setIsInspectingPlayerFromSlot(
          Boolean(nextPlayer),
        );

        return nextPlayer;
      });
    };

  async function handleDraftToTargetSlot(
    player: Player
  ) {
    if (!targetDraftSlot) return;

    await handleAssignPlayerToTeam(
      player,
      targetDraftSlot.teamId,
      {
        position:
          targetDraftSlot.positionGroup,

        slotIndex:
          targetDraftSlot.slotIndex,
      },
    );

    setDraftingPlayer(null);
    setIsInspectingPlayerFromSlot(false);
    setTargetDraftSlot(null);
  }

  const golfScoresControls = (
    <>
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <ScoresRefreshButton onRefresh={() => refreshStatsForSelectedSlate(false)}
            disabled={refreshUnavailable || isRefreshingStats} isRefreshing={isRefreshingStats} />

          <button
            type="button"
            onClick={() =>
              setIsGolfSlateMenuOpen(true)
            }
            className="flex shrink-0 items-center justify-center rounded-xl border border-slate-600 bg-slate-800 px-3 py-2.5 text-sm font-black text-slate-100 transition hover:border-sky-500"
          >
            Slates
            <span
              aria-hidden="true"
              className="ml-1"
            >
              ▾
            </span>
          </button>
        </div>

        <div className="flex items-center justify-between gap-3 px-1 text-[11px] text-slate-500">
          <span className="truncate">
            {selectedSlateDisplay}
          </span>

          <span className="shrink-0">
            {lastUpdatedAt
              ? `Updated ${new Date(
                  lastUpdatedAt,
                ).toLocaleTimeString([], {
                  hour: "numeric",
                  minute: "2-digit",
                })}`
              : "Not refreshed yet"}
          </span>
        </div>
      </div>

      {isScoresPage ? refreshIndicator : null}

      {hasMounted &&
      isGolfSlateMenuOpen
        ? createPortal(
            <div
              className="fixed inset-0 z-[12000] flex items-end justify-center bg-slate-950/70 px-3 py-4 backdrop-blur-sm sm:items-center"
              onMouseDown={(event) => {
                if (
                  event.target ===
                  event.currentTarget
                ) {
                  setIsGolfSlateMenuOpen(
                    false,
                  );
                }
              }}
            >
              <section
                role="dialog"
                aria-modal="true"
                aria-label="Golf slate and score settings"
                className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 text-slate-100 shadow-2xl"
              >
                <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-5 py-4">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-400">
                      Golf scores
                    </span>

                    <h3 className="mt-1 text-xl font-black">
                      Slate & Settings
                    </h3>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setIsGolfSlateMenuOpen(
                        false,
                      )
                    }
                    aria-label="Close slate settings"
                    className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-xl text-slate-300 transition hover:bg-slate-800 hover:text-white"
                  >
                    ×
                  </button>
                </header>

                <div className="space-y-4 p-5">
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Season
                    </span>

                    <select
                      value={selectedSeason}
                      onChange={(event) =>
                        setSelectedSeason(
                          event.target.value,
                        )
                      }
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-base text-white"
                    >
                      {seasons.map(
                        (season) => (
                          <option
                            key={season}
                            value={season}
                          >
                            {season}
                          </option>
                        ),
                      )}
                    </select>
                  </label>

                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Tournament
                    </span>

                    <select
                      value={selectedSlateId}
                      onChange={(event) => {
                        setSelectedSlateId(
                          event.target.value,
                        );

                        setIsGolfSlateMenuOpen(
                          false,
                        );
                      }}
                      disabled={isSlateLoading}
                      className="mt-1 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-3 text-base text-white disabled:opacity-60"
                    >
                      {filteredSlates.map(
                        (slate) => (
                          <option
                            key={slate.id}
                            value={String(
                              slate.id,
                            )}
                          >
                            {slate.label ??
                              slate.date}
                          </option>
                        ),
                      )}
                    </select>
                  </label>

                  <label className="flex items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
                    <span>
                      <strong className="block text-sm">
                        Auto-refresh
                      </strong>

                      <span className="mt-0.5 block text-xs text-slate-500">
                        Refresh while this page is visible
                      </span>
                    </span>

                    <input
                      type="checkbox"
                      checked={
                        autoRefreshEnabled
                      }
                      onChange={(event) =>
                        setAutoRefreshEnabled(
                          event.target.checked,
                        )
                      }
                      className="h-5 w-5"
                    />
                  </label>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900 px-4 py-3">
                    <span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">
                      Current slate
                    </span>

                    <strong className="mt-1 block text-base text-white">
                      {selectedSlateDisplay}
                    </strong>

                    <span className="mt-1 block text-xs text-slate-500">
                      {lastUpdatedAt
                        ? `Last refreshed ${new Date(
                            lastUpdatedAt,
                          ).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}`
                        : "Scores have not been refreshed during this visit."}
                    </span>
                  </div>
                </div>
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );

  const lineupControls = (
    <LineupControls
      refreshUnavailable={refreshUnavailable}
      scoresStatus={scoresStatus}
      refreshFeedback={isScoresPage ? refreshIndicator : null}
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
    <NflFantasyGameCenter
      slateId={(selectedSlate?.sport ?? selectedSport) === "nfl" ? selectedSlateIdNumber : null}
      refreshKey={lastUpdatedAt}
      draftGames={isDraftPage ? draftContext?.scope === refreshScopeKey
        ? { slateId: selectedSlateIdNumber!, gamesByTeam: draftContext.gamesByTeam } : null : undefined}
    >
    <div ref={isScoresPage || isDraftPage ? scoresSurfaceRef : undefined} className={isScoresPage ? `scores-page-content${["nba", "nfl"].includes(sport ?? selectedSport) ? " scores-pull-surface" : ""}` : "draft-workspace"}>
      {viewMode === "draft" && <>
        <header className="draft-header">
          <div><h1>Draft</h1><p>{selectedSlateDisplay} · {(sport ?? selectedSport) === "golf" ? selectedSlate?.is_locked ? "Locked" : "Open" : draftStateLabel(orderHistory, Boolean(selectedSlate?.is_locked))}</p>
            <p>{currentTeamId ? `${getPlayersForTeam(currentTeamId).length}/${getRosterTotalSlots()} rostered` : "Viewing participants"}</p></div>
          <div className="draft-header-actions">
            <ScoresRefreshButton label="Refresh Draft" onRefresh={() => { void refreshDraft(); }}
              disabled={!scopeReady || isSlateLoading || isSaving || isAssigningPlayer || isRefreshingStats}
              isRefreshing={isRefreshingStats} />
            <SecondaryControlsPanel open={draftSettingsOpen} onOpenChange={setDraftSettingsOpen} label="Draft settings">
              <label>Season<select value={selectedSeason} disabled={isSaving || isAssigningPlayer}
                onChange={event => setSelectedSeason(event.target.value)}>{seasons.map(season => <option key={season}>{season}</option>)}</select></label>
              <label>Slate<select value={selectedSlateId} disabled={isSaving || isAssigningPlayer}
                onChange={event => setSelectedSlateId(event.target.value)}>{filteredSlates.map(slate => <option key={slate.id} value={slate.id}>{slate.label ?? slate.date}</option>)}</select></label>
              <Link href={`/standings?sport=${sport ?? selectedSport}`}>View Standings →</Link>
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

              {currentUser?.systemRole === "super_admin" && (sport ?? selectedSport) !== "golf" &&
                <RefreshPlayersButton sport={(sport ?? selectedSport) as "nba" | "nfl"} />}
            </SecondaryControlsPanel>
          </div>
        </header>
        {refreshIndicator}
      </>}

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
          <section className="draft-page-tabs" aria-label="Draft view" style={(sport ?? selectedSport) !== "golf" ? { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" } : undefined}>
            <button
              type="button"
              data-draft-pull-start="true"
              aria-pressed={draftPageTab === "lineup"}
              onClick={() => { setOrderPickTarget(null); cancelCorrection(); setEditPicksScope(null); setDraftPageTab("lineup"); }}
              className={`draft-page-tab ${
                draftPageTab === "lineup"
                  ? "draft-page-tab--active"
                  : ""
              }`}
            >
              <span aria-hidden="true">{getSportConfig(selectedSport).emoji}</span>
              <span>Positions</span>

            </button>

            <button
              type="button"
              data-draft-pull-start="true"
              aria-pressed={draftPageTab === "players"}
              onClick={() => { setOrderPickTarget(null); cancelCorrection(); setEditPicksScope(null); setDraftPageTab("players"); }}
              className={`draft-page-tab ${
                draftPageTab === "players"
                  ? "draft-page-tab--active"
                  : ""
              }`}
            >
              <span aria-hidden="true">🔎</span>
              <span>Players</span>
            </button>
            {(sport ?? selectedSport) !== "golf" && <button type="button" data-draft-pull-start="true"
              aria-pressed={draftPageTab === "order"} onClick={() => setDraftPageTab("order")}
              className={`draft-page-tab ${draftPageTab === "order" ? "draft-page-tab--active" : ""}`}>
              <span>Draft Order</span>
            </button>}
          </section>

          {draftPageTab === "order" && (sport ?? selectedSport) !== "golf" &&
            <DraftOrder history={draftContext?.scope === refreshScopeKey ? draftContext.history ?? null : null} teams={orderedTeamsForSlate}
              actionLabel={canEnterOrderPick ? orderTeam?.id === currentTeamId ? "Make My Pick" : `Make Pick for ${orderTeam?.name}` : undefined}
              canEdit={canEditPicks} editing={editingPicks} canEditPick={canEditPick} onEdit={beginCorrection}
              playerPosition={id => players.find(p => p.id === id)?.position_group}
              onToggleEdit={() => { cancelCorrection(); setOrderPickTarget(null); setEditPicksScope(editingPicks ? null : refreshScopeKey); }}
              onMakePick={beginOrderPick} busy={isSlateLoading || isSaving || isAssigningPlayer || Boolean(activeOrderTarget)} />}

          <div hidden={draftPageTab !== "lineup"}>
            <div className="draft-participants" aria-label="View participant roster">
              {orderedTeamsForSlate.map(team => <button key={team.id} type="button" data-draft-pull-start="true"
                aria-pressed={viewedTeam?.id === team.id} onClick={() => { setTargetDraftSlot(null); setPendingRosterSlotChoice(null); setDraftingPlayer(null); setViewedParticipant({ scope: refreshScopeKey, id: team.id }); }}>
                {team.name}{team.id === currentTeamId ? " · You" : ""}
              </button>)}
            </div>
            {isSlateLoading || draftContext?.scope !== refreshScopeKey ? <p role="status">{isSlateLoading ? "Loading roster…" : "Roster unavailable. Refresh to try again."}</p> : !viewedTeam ? <p>No active participants for this slate.</p> : <DraftRosterCourt
              teamId={viewedTeam?.id ?? null}
              teamName={viewedTeam?.name ?? null}
              canProxyDraft={Boolean(canProxyDraft && viewedTeam?.id !== currentTeamId)}
              proxyBusy={isSlateLoading || isSaving || isAssigningPlayer}
              canDraft={Boolean(viewedTeam && viewedTeam.id === currentTeamId && scopeReady && !isSlateLoading && !isSaving && !isAssigningPlayer)}
              players={
                viewedTeam
                  ? getPlayersForTeam(viewedTeam.id)
                  : []
              }
              rosterSlots={effectiveRosterSlots}

              slotAssignments={
                (
                  lineupsState.find(
                    (lineup) =>
                      lineup.team_id ===
                      viewedTeam?.id,
                  ) as
                    | {
                        player_slots?: Array<{
                          player_id: number;
                          roster_slot_position: string | null;
                          roster_slot_index: number | null;
                        }>;
                      }
                    | undefined
                )?.player_slots ??
                []
              }

              isLocked={Boolean(selectedSlate?.is_locked)}
              setDraftingPlayer={(value) => {
                const player =
                  typeof value === "function"
                    ? value(null)
                    : value;

                if (player) {
                  if (viewedTeam?.id === currentTeamId) inspectPlayerFromSlot(player);
                  else setLeagueResearchPlayer(player);
                }
              }}
              setTargetDraftSlot={setTargetDraftSlot}
            />}
          </div>
          <div hidden={draftPageTab !== "players" && !(draftPageTab === "order" && (activeOrderTarget || activeCorrection))}>
            {activeCorrection && <div className="flex items-center justify-between py-2 text-sm">
              <div>Edit Pick #{activeCorrection.pick.overall_pick} · {activeCorrection.pick.team_name}<p>Current: {activeCorrection.playerName}</p></div>
              <button type="button" disabled={isSaving || isAssigningPlayer} onClick={cancelCorrection}>Cancel</button>
            </div>}
            {activeOrderTarget && <div className="flex items-center justify-between py-2 text-sm">
              <span>Pick #{activeOrderTarget.overallPick} · Draft for {orderedTeamsForSlate.find(t => t.id === activeOrderTarget.teamId)?.name}</span>
              <button type="button" disabled={isSaving || isAssigningPlayer} onClick={() => { setOrderPickTarget(null); setDraftingPlayer(null); setPendingRosterSlotChoice(null); }}>Cancel</button>
            </div>}
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
              speedEntry={draftPageTab === "order" && (activeCorrection || activeOrderTarget) ? {
                onSelect: player => activeCorrection
                  ? replaceOrderPick(player, activeCorrection.pick.team_id)
                  : handleAssignPlayerToTeam(player, activeOrderTarget!.teamId),
                onResearch: setLeagueResearchPlayer,
              } : undefined}
              isAssigningPlayer={isAssigningPlayer || isSaving || isSlateLoading}
              pillBase={pillBase}
              activePill={activePill}
              inactivePill={inactivePill}
              rosterSlots={effectiveRosterSlots}
              selectedSeason={selectedSeason}
              nflSeason={selectedSport === "nfl" ? nflSeasonForSlate(selectedSlate, selectedSeason) : undefined}
            />
          </div>
        </>
      ) : (
        <ScoresDashboard
          currentTeamId={groupContext?.team?.id ?? null}
          scopeKey={refreshScopeKey}
          players={players}
          teams={orderedTeamsForSlate}
          selectedSlate={selectedSlate}
          rosterSlots={effectiveRosterSlots}
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
          controls={
            (selectedSlate?.sport ??
              selectedSport) === "golf"
              ? golfScoresControls
              : lineupControls
          }
          setProfilePlayer={setProfilePlayer}
        />
      )}

      {pendingRosterSlotChoice ? (
        <div
          className="fixed inset-0 z-[13000] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setPendingRosterSlotChoice(
                null,
              );
            }
          }}
        >
          <section className="w-full max-w-sm overflow-hidden rounded-3xl border border-slate-700 bg-slate-950 text-white shadow-2xl">
            <header className="border-b border-slate-800 px-5 py-4">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-sky-400">
                Choose roster spot
              </div>

              <h3 className="mt-1 text-xl font-black">
                {pendingRosterSlotChoice.player.name}
              </h3>

              <p className="mt-1 text-sm text-slate-400">
                This player can fill more than one open spot.
              </p>
            </header>

            <div className="grid gap-2 p-4">
              {pendingRosterSlotChoice.slots.map(
                (
                  slot,
                ) => (
                  <button
                    key={`${slot.position}-${slot.slotIndex}`}
                    type="button"
                    disabled={
                      isAssigningPlayer ||
                      isSaving
                    }
                    onClick={() => {
                      const pending =
                        pendingRosterSlotChoice;

                      setPendingRosterSlotChoice(
                        null,
                      );

                      void handleAssignPlayerToTeam(
                        pending.player,
                        pending.teamId,
                        slot,
                      );
                    }}
                    className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 text-left transition hover:border-sky-500 hover:bg-slate-800 disabled:opacity-50"
                  >
                    <span className="font-bold">
                      {slot.position}
                    </span>

                    <span className="text-xs font-semibold uppercase tracking-wide text-sky-400">
                      Draft here
                    </span>
                  </button>
                ),
              )}
            </div>

            <div className="border-t border-slate-800 p-4">
              <button
                type="button"
                onClick={() =>
                  setPendingRosterSlotChoice(
                    null,
                  )
                }
                className="w-full rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-bold text-slate-300"
              >
                Cancel
              </button>
            </div>
          </section>
        </div>
      ) : null}


      <SlotDraftModal
        targetDraftSlot={targetDraftSlot}
        setTargetDraftSlot={setTargetDraftSlot}
        players={players}
        playerAverageMap={playerAverageMap}
        playerProjections={playerProjections}
        availablePlayerIdsForSlate={availablePlayerIdsForSlate}
        availablePlayerIdSet={availablePlayerIdSet}
        isAvailabilityLoading={isAvailabilityLoading}
        getOwnerTeamForPlayer={getOwnerTeamForPlayer}
        setDraftingPlayer={setDraftingPlayerWithSlotRestore}
        handleAssignPlayerToTeam={handleAssignPlayerToTeam}
        selectedSeason={selectedSeason}
        nflSeason={selectedSport === "nfl" ? nflSeasonForSlate(selectedSlate, selectedSeason) : undefined}
        rosterSlots={effectiveRosterSlots}
        hidden={isInspectingPlayerFromSlot}
        isAssigningPlayer={isAssigningPlayer}
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
        golfSlateId={
          selectedSlate?.sport === "golf"
            ? selectedSlate.id
            : null
        }
      />

      <PlayerResearchModal
        player={
          leagueResearchPlayer
            ? {
                id: leagueResearchPlayer.id,
                name: leagueResearchPlayer.name,
                nbaPlayerId:
                  leagueResearchPlayer.nba_player_id ??
                  null,
                nflPlayerId:
                  leagueResearchPlayer.nfl_player_id ??
                  null,
                espnGolfPlayerId:
                  leagueResearchPlayer.espn_player_id ??
                  null,
                headshotUrl:
                  leagueResearchPlayer.headshot_url ??
                  null,
                positionGroup:
                  leagueResearchPlayer.position_group ??
                  null,
                owgrRank:
                  leagueResearchPlayer.owgr_rank ??
                  null,
              }
            : null
        }
        sport={
          (selectedSlate?.sport ??
            selectedSport) as
            | "nba"
            | "nfl"
            | "golf"
        }
        season={Number(selectedSeason)}
        defaultMode="season"
        onClose={() =>
          setLeagueResearchPlayer(null)
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
        ownerTeamForDraftingPlayer={activeCorrection ? null : ownerTeamForDraftingPlayer}
        isAssigningPlayer={isAssigningPlayer}
        isSaving={isSaving}
        handleRemovePlayerFromTeam={activeCorrection ? async () => {} : handleRemovePlayerFromTeam}
        draftingPlayerHistory={draftingPlayerHistory}
        isDraftingPlayerHistoryLoading={isDraftingPlayerHistoryLoading}
        orderedTeamsForSlate={activeCorrection ? orderedTeamsForSlate.filter(t => t.id === activeCorrection.pick.team_id) : activeOrderTarget ? orderedTeamsForSlate.filter(t => t.id === activeOrderTarget.teamId) : orderedTeamsForSlate}
        getTeamStats={getTeamStats}
        getTeamAssignmentStatus={activeCorrection ? (teamId, player) => ({ canAssign: teamId === activeCorrection.pick.team_id && !getOwnerTeamIdForPlayer(player.id), reason: "Replacement must be available; roster eligibility is validated on save." }) : getTeamAssignmentStatus}
        getOwnerTeamIdForPlayer={getOwnerTeamIdForPlayer}
        handleAssignPlayerToTeam={activeCorrection ? replaceOrderPick : handleAssignPlayerToTeam}
        targetDraftSlot={targetDraftSlot}
        handleDraftToTargetSlot={
          handleDraftToTargetSlot
        }
      />
    </div>
    </NflFantasyGameCenter>
  );
}
