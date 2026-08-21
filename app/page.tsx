"use client";

import { refreshGolfFromBrowser } from "@/lib/client/refreshGolfFromBrowser";

import { formatSlateDateLabel } from "@/lib/formatSlateLabel";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import AppNav from "@/components/AppNav";
import FunFactCarousel from "@/components/home/FunFactCarousel";
import TeamProfileModal from "@/components/TeamProfileModal";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import TeamAvatar from "@/components/ui/TeamAvatar";
import SeasonAwards from "@/components/home/SeasonAwards";
import ReadOnlyPlayerModal from "@/components/lineups/ReadOnlyPlayerModal";
import type {
  Player,
  PlayerStat,
} from "@/components/lineups/types";
import { getStatColumns, type StatColumn } from "@/lib/statColumns";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { useGroupContext } from "@/components/providers/GroupProvider";
import type { GolfCutLine } from "@/lib/golf/cutLine";

type LatestSlate = {
  id: number;
  date: string;
  start_date: string;
  end_date: string;
  label: string;
  display_name?: string | null;
  is_locked: boolean;
  first_game_start_time: string | null;
  tournament_analysis?: string | null;
  show_tournament_analysis?: boolean;
};

type LatestSlateRow = {
  slate_id: number;
  team_id: number;
  teamName: string;
  avatarUrl: string | null;
  fantasy_points: number | null;
  finish_position: number | null;
  games_completed: number | null;
  games_in_progress: number | null;
  games_remaining: number | null;
  projected_points?: number | null;
  pregame_projected_points?: number | null;
  win_probability?: number | null;
  golf_status_label?: string | null;
};

type SeasonSnapshotRow = {
  team_id: number;
  name: string;
  wins: number;
  runner_ups: number;
  avg_finish: number | null;
  avg_score: number | null;
  slates_played: number;
};

type FunFact = {
  label: string;
  value: string;
  detail?: string;
};

type SeasonAwardsResponse = {
  success: boolean;
  awards: Array<{
    title: string;
    emoji: string;
    winner: string;
    detail: string;
  }>;
  firstTeam: {
    guards: any[];
    frontcourt: any[];
  };
};

type GolfTournamentLeaderboardRow = {
  playerId: number;
  name: string;
  shortName: string;
  espnGolfPlayerId: string | null;
  headshotUrl: string | null;
  country: string | null;
  owgrRank: number | null;
  position: number | null;
  score: number | null;
  scoreDisplay: string | null;
  status: string | null;
  statusLabel: string;
  currentRound: number | null;
  lastHole: number | null;
  holesCompleted: number | null;
  isDrafted: boolean;
  draftedBy: string[];
};

type HomeSummaryResponse = {
  success: boolean;
  latestSlate: LatestSlate | null;
  nextSlate: LatestSlate | null;
  latestSlateRows: LatestSlateRow[];
  tournamentLeaderboard?: GolfTournamentLeaderboardRow[];
  projectedCut?: GolfCutLine | null;
  seasonSnapshot: SeasonSnapshotRow[];
  funFacts: FunFact[];
  latestSeason: number;
  latestGolfTournamentIsFinal?: boolean;
};

type SlateRosterModalState = {
  slateId: number;
  teamId: number;
  teamName: string;
  slateLabel: string;
} | null;

type SlateRosterRow = {
  playerId: number;
  name: string;
  nbaPlayerId: number | null;
  nflPlayerId: number | null;
  espnGolfPlayerId?: string | null;
  headshotUrl?: string | null;
  positionGroup: string | null;
  fantasyPoints: number;
  officialScore?: number | null;
  penaltyStrokes?: number;
  leaderboardOrder?: number | null;
  status?: string | null;
  statusLabel?: string | null;
  currentRound?: number | null;
  lastHole?: number | null;
  holesCompleted?: number | null;
  roundScores?: Array<{
    roundNumber: number;
    scoreToPar: number | null;
    scoreDisplay: string | null;
    strokes: number | null;
    holesCompleted: number;
    status: string | null;
  }>;
  gameStatus?: number | null;
  gameStatusText?: string | null;
  [statKey: string]: any;
};

const EMPTY_PLAYER_AVERAGE_MAP = new Map<number, number>();
const EMPTY_PLAYER_PROJECTIONS: Record<number, any> = {};

function rosterRowToPlayer(row: SlateRosterRow): Player | null {
  if (!row.positionGroup) {
    return null;
  }

  return {
    id: row.playerId,
    name: row.name,
    position_group: row.positionGroup,
    is_active: true,
    nba_player_id: row.nbaPlayerId,
    nfl_player_id: row.nflPlayerId,
    espn_player_id:
      row.espnGolfPlayerId ?? null,
    headshot_url:
      row.headshotUrl ?? null,
  };
}

function GamesStatus({
  completed,
  inProgress,
  remaining,
}: {
  completed: number | null;
  inProgress: number | null;
  remaining: number | null;
}) {
  const finalCount = Number(completed ?? 0);
  const liveCount = Number(inProgress ?? 0);
  const leftCount = Number(remaining ?? 0);

  return (
    <div
      className="home-games-status-v2"
      aria-label={`${finalCount} final, ${liveCount} live, ${leftCount} remaining`}
    >
      <span className="home-games-status-v2-final">{finalCount} Final</span>

      {liveCount > 0 ? (
        <>
          <span className="home-games-status-v2-divider" aria-hidden="true">
            ·
          </span>

          <span className="home-games-status-v2-live">
            <span className="home-games-status-v2-dot" aria-hidden="true" />
            {liveCount} Live
          </span>
        </>
      ) : null}

      {leftCount > 0 ? (
        <>
          <span className="home-games-status-v2-divider" aria-hidden="true">
            ·
          </span>

          <span className="home-games-status-v2-left">{leftCount} Left</span>
        </>
      ) : null}
    </div>
  );
}

function TeamProfileButton({
  teamName,
  avatarUrl,
  featured = false,
  onClick,
}: {
  teamName: string;
  avatarUrl?: string | null;
  featured?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`home-team-profile-button ${
        featured ? "home-team-profile-button--featured" : ""
      }`}
      aria-label={`View ${teamName}'s profile`}
      title={`View ${teamName}'s profile`}
    >
      <TeamAvatar
        teamName={teamName}
        avatarUrl={avatarUrl}
        size={featured ? "md" : "sm"}
      />

      <span className="home-team-profile-name">{teamName}</span>

      <span className="home-team-profile-chevron" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

function roundTo(value: number, digits = 1) {
  return Number(value.toFixed(digits));
}

function formatGolfScore(
  value: number | null | undefined,
) {
  const score = Number(value ?? 0);

  if (score === 0) return "E";
  return score > 0 ? `+${score}` : String(score);
}

function formatGolfRosterStatus(
  row: SlateRosterRow,
) {
  const rawLabel =
    row.statusLabel?.trim() ?? "";

  const normalizedStatus =
    row.status?.trim().toLowerCase() ?? "";

  /*
   * Trust the persisted provider status before interpreting a stale
   * display label. This prevents a scheduled golfer from being shown
   * as "Round 1 complete".
   */
  if (
    normalizedStatus === "scheduled"
  ) {
    return rawLabel &&
      /tee|upcoming|scheduled|not started/i.test(
        rawLabel,
      )
      ? rawLabel
      : "⏰ Upcoming";
  }

  if (normalizedStatus === "did_not_start") {
    return "DNS";
  }

  if (normalizedStatus === "cut") {
    return "✂ Cut";
  }

  if (normalizedStatus === "withdrawn") {
    return "⚠ Withdrawn";
  }

  if (normalizedStatus === "disqualified") {
    return "⛔ Disqualified";
  }

  const thruMatch = rawLabel.match(
    /^R(\d+)\s*·\s*Thru\s+(\d+)$/i,
  );

  if (thruMatch) {
    return `🟢 Round ${thruMatch[1]} · Thru ${thruMatch[2]}`;
  }

  const finishedRoundMatch = rawLabel.match(
    /^R(\d+)\s*·\s*Finished$/i,
  );

  if (finishedRoundMatch) {
    return `✓ Round ${finishedRoundMatch[1]} complete`;
  }

  const upcomingRoundMatch = rawLabel.match(
    /^R(\d+)\s*·\s*(Upcoming|Scheduled|Not started)$/i,
  );

  if (upcomingRoundMatch) {
    return `⏰ Round ${upcomingRoundMatch[1]} upcoming`;
  }

  if (/^finished$/i.test(rawLabel)) {
    return "✓ Tournament complete";
  }

  if (
    /^upcoming$/i.test(rawLabel) ||
    /^scheduled$/i.test(rawLabel) ||
    /^not started$/i.test(rawLabel)
  ) {
    return "⏰ Upcoming";
  }

  if (rawLabel) {
    return rawLabel;
  }

  if (
    normalizedStatus === "scheduled" ||
    normalizedStatus === "did_not_start"
  ) {
    return "⏰ Upcoming";
  }

  return "—";
}

function HomePageContent() {
  const { selectedSport, setSelectedSport } = useSelectedSport();

  const {
    groupContext,
  } =
    useGroupContext();

  const activeGroupId =
    groupContext?.group.id ??
    null;

  const searchParams = useSearchParams();
  const sportFromUrl = searchParams.get("sport");
  const sport =
    sportFromUrl === "nfl" ||
    sportFromUrl === "nba" ||
    sportFromUrl === "golf"
      ? sportFromUrl
      : selectedSport;

  const isGolf = sport === "golf";

  useEffect(() => {
    if (sportFromUrl && sportFromUrl !== selectedSport) {
      setSelectedSport(sportFromUrl);
    }
  }, [sportFromUrl]);
  const [data, setData] = useState<HomeSummaryResponse | null>(null);

  /*
   * Home data is asynchronous, while the selected sport can
   * change immediately from the URL.
   *
   * Keep track of which sport produced the current response so
   * auto-refresh can never combine:
   *
   *   new sport + previous sport's slate
   */
  const [dataSport, setDataSport] = useState<string | null>(null);

  /*
   * Also keep the current rendered sport in a ref so an older
   * request cannot overwrite Home after the user has switched.
   */
  const activeHomeSportRef = useRef(sport);
  activeHomeSportRef.current = sport;

  const activeHomeGroupIdRef =
    useRef<string | null>(
      activeGroupId,
    );

  activeHomeGroupIdRef.current =
    activeGroupId;

  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [profileTeam, setProfileTeam] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [slateRosterModal, setSlateRosterModal] =
    useState<SlateRosterModalState>(null);
  const [slateRosterRows, setSlateRosterRows] = useState<SlateRosterRow[]>([]);
  const [slateRosterTotal, setSlateRosterTotal] = useState(0);
  const [slateRosterStatColumns, setSlateRosterStatColumns] =
    useState<StatColumn[]>(getStatColumns("nba"));
  const [selectedRosterPlayer, setSelectedRosterPlayer] =
    useState<Player | null>(null);

  const [golfPlayerStats, setGolfPlayerStats] =
    useState<PlayerStat[]>([]);

  const [seasonAwards, setSeasonAwards] = useState<SeasonAwardsResponse | null>(
    null,
  );

  const [golfHomeTab, setGolfHomeTab] =
    useState<"fantasy" | "tournament">(
      "fantasy",
    );

  function parseStatusTextMinutesRemaining(statusText?: string | null) {
    if (!statusText) return null;

    const trimmed = statusText.trim();

    if (/final/i.test(trimmed)) return 0;

    const match = trimmed.match(/^Q(\d+)\s+(?:(\d*)?:)?(\d+(?:\.\d+)?)$/i);

    if (!match) return null;

    const period = Number(match[1]);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] ?? 0);

    const clockMinutes = minutes + seconds / 60;
    const periodsRemainingAfterCurrent = Math.max(4 - period, 0);

    return periodsRemainingAfterCurrent * 12 + clockMinutes;
  }

  function getProjectedFantasyPoints(row: any) {
    const current = Number(row.fantasyPoints ?? 0);
    const baseline = Number(row.projection ?? row.averageProjection ?? 30);

    const remainingMinutes = parseStatusTextMinutesRemaining(
      row.gameStatusText,
    );

    if (remainingMinutes === 0) return current;

    if (remainingMinutes === null) return baseline;

    return current + baseline * (remainingMinutes / 48);
  }

  function getPlayerStatusLabel(row: any) {
    const text = row.gameStatusText;

    if (!text) return "Pregame";

    if (/final/i.test(text)) return "Final";

    return text;
  }
  const [isSlateRosterLoading, setIsSlateRosterLoading] = useState(false);
  const [isRefreshingHomeStats, setIsRefreshingHomeStats] = useState(false);
  const autoRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const homeGolfRefreshInFlightRef = useRef(false);
  const lastHomeGolfAutoRefreshRef = useRef(0);

  async function refreshSlateStatsById(slateId: number) {
    if (homeGolfRefreshInFlightRef.current) return;

    homeGolfRefreshInFlightRef.current = true;

    try {
      setIsRefreshingHomeStats(true);
      setMessage("");

      if (sport === "golf") {
        await refreshGolfFromBrowser(
          slateId,
        );
      } else {
        const refreshEndpoint =
          sport === "nfl"
            ? "/api/refresh-stats-nfl"
            : "/api/refresh-stats";

        const response =
          await fetch(
            refreshEndpoint,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                slateId,
              }),
            },
          );

        const result =
          await response.json();

        if (!response.ok) {
          setMessage(
            result.error ||
              "Failed to refresh stats.",
          );
          return;
        }
      }

      await loadHomeSummary();
    } catch (err) {
      console.error("Failed to refresh stats", err);
      setMessage("Failed to refresh stats.");
    } finally {
      homeGolfRefreshInFlightRef.current = false;
      setIsRefreshingHomeStats(false);
    }
  }

  async function handleRefreshStats() {
    if (!latestSlate?.id) {
      setMessage("No active slate found to refresh.");
      return;
    }

    await refreshSlateStatsById(latestSlate.id);
  }

  async function loadHomeSummary() {
    /*
     * Capture the sport this request belongs to.
     *
     * If the user switches sports before the request completes,
     * its response is discarded instead of becoming stale Home
     * state for the newly selected sport.
     */
    const requestedSport = sport;
    const requestedGroupId =
      activeGroupId;

    /*
     * GroupProvider briefly has no resolved Group during initial
     * hydration. Do not issue an unscoped Home request while
     * that context is still loading.
     */
    if (!requestedGroupId) {
      setData(null);
      setSeasonAwards(null);
      setGolfPlayerStats([]);
      return;
    }

    try {
      setIsLoading(true);
      setMessage("");

      const response = await fetch(
        `/api/home-summary?sport=${requestedSport}`,
        { cache: "no-store" }
      );

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to load home summary.");
        return;
      }

      /*
       * A different sport may have been selected while this
       * request was in flight.
       */
      if (
        activeHomeSportRef.current !==
          requestedSport ||
        activeHomeGroupIdRef.current !==
          requestedGroupId
      ) {
        return;
      }

      setData(result);
      setDataSport(requestedSport);

      if (
        requestedSport === "golf" &&
        result.latestSlate?.id
      ) {
        try {
          const statsResponse = await fetch(
            `/api/player-stats?slateId=${result.latestSlate.id}`,
            { cache: "no-store" },
          );

          const statsResult =
            await statsResponse.json();

          if (statsResponse.ok) {
            setGolfPlayerStats(
              statsResult.playerStats ?? [],
            );
          } else {
            console.error(
              statsResult.error ||
                "Failed to load Golf player stats.",
            );
            setGolfPlayerStats([]);
          }
        } catch (statsError) {
          console.error(
            "Failed to load Golf player stats",
            statsError,
          );
          setGolfPlayerStats([]);
        }
      } else {
        setGolfPlayerStats([]);
      }

      if (requestedSport === "nba") {
        const awardsResponse = await fetch(
          `/api/season-awards?sport=${requestedSport}`,
          {
          cache: "no-store",
        });
        const awardsResult = await awardsResponse.json();

        if (awardsResponse.ok) {
          setSeasonAwards(awardsResult);
        } else {
          console.error("Failed to load season awards", awardsResult);
          setSeasonAwards(null);
        }
      } else {
        setSeasonAwards(null);
      }
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while loading the home page.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    /*
     * Sport and Group are both part of the Home data scope.
     *
     * Clear the previous scope immediately so a Group switch can
     * never render the previous Group's slate, standings, ticker,
     * awards, or Golf data while the new request is loading.
     */
    setDataSport(null);
    setData(null);
    setSeasonAwards(null);
    setGolfPlayerStats([]);
    setMessage("");

    if (activeGroupId) {
      void loadHomeSummary();
    }
  }, [
    sport,
    activeGroupId,
  ]);

  useEffect(() => {
    if (!slateRosterModal) {
      setSlateRosterRows([]);
      setSlateRosterTotal(0);
      return;
    }

    let isActive = true;
    const activeSlateRosterModal = slateRosterModal;

    async function loadSlateRoster() {
      try {
        setIsSlateRosterLoading(true);

        const response = await fetch(
          `/api/team-slate-roster?slateId=${activeSlateRosterModal.slateId}&teamId=${activeSlateRosterModal.teamId}&sport=${sport}`,
          { cache: "no-store" },
        );

        const result = await response.json();

        if (!isActive) return;

        if (!response.ok) {
          console.error(result.error || "Failed to load slate roster.");
          setSlateRosterRows([]);
          setSlateRosterTotal(0);
          return;
        }

        setSlateRosterRows(result.roster ?? []);
        setSlateRosterTotal(Number(result.total ?? 0));
        setSlateRosterStatColumns(
          result.statColumns ?? getStatColumns(result.sport ?? "nba"),
        );
      } catch (error) {
        console.error(error);
        if (!isActive) return;
        setSlateRosterRows([]);
        setSlateRosterTotal(0);
      } finally {
        if (isActive) setIsSlateRosterLoading(false);
      }
    }

    void loadSlateRoster();

    return () => {
      isActive = false;
    };
  }, [slateRosterModal]);

  const latestSlate = data?.latestSlate ?? null;
  const latestSlateRows = data?.latestSlateRows ?? [];

  const tournamentLeaderboard =
    data?.tournamentLeaderboard ?? [];

  const projectedCut =
    data?.projectedCut ?? null;

  const seasonSnapshot = data?.seasonSnapshot ?? [];
  const funFacts = data?.funFacts ?? [];
  const latestSeason = data?.latestSeason ?? new Date().getFullYear();

  const leader = latestSlateRows[0] ?? null;

  const selectedGolfPlayerStat =
    isGolf && selectedRosterPlayer
      ? golfPlayerStats.find(
          (stat) =>
            Number(stat.player_id) ===
            Number(selectedRosterPlayer.id),
        ) ?? null
      : null;

  const hasLiveGames = latestSlateRows.some(
    (row) => Number(row.games_in_progress ?? 0) > 0,
  );

  const hasCompletedGames = latestSlateRows.some(
    (row) => Number(row.games_completed ?? 0) > 0,
  );

  const hasRemainingGames = latestSlateRows.some(
    (row) => Number(row.games_remaining ?? 0) > 0,
  );

  const slateHeading =
    isGolf
      ? latestSlate?.display_name?.trim() ||
        latestSlate?.label ||
        "Current Tournament"
      : "Current Slate";

  const activeSlateStartTime = latestSlate?.first_game_start_time
    ? new Date(latestSlate.first_game_start_time)
    : null;

  const hasSlateStarted =
    activeSlateStartTime !== null &&
    activeSlateStartTime.getTime() <= Date.now();

  const isFinalSlate =
    isGolf
      ? (
          latestSlate?.is_locked === true ||
          data?.latestGolfTournamentIsFinal === true
        )
      : (
          latestSlate?.is_locked === true ||
          (
            !hasLiveGames &&
            hasCompletedGames &&
            !hasRemainingGames
          )
        );

  const scoreColumnLabel =
    isGolf
      ? "Score"
      : isFinalSlate
        ? "Final"
        : "Current";

  const projectionColumnLabel = isFinalSlate
    ? "vs Proj."
    : hasSlateStarted
      ? "Proj. Final"
      : "Pregame Proj.";

  const slateBadge =
    isGolf
      ? isFinalSlate
        ? "FINAL"
        : hasSlateStarted
          ? "LIVE"
          : null
      : hasLiveGames
        ? "LIVE"
        : hasCompletedGames && !hasRemainingGames
          ? "FINAL"
          : null;

  const leaderLabel =
    isFinalSlate ? "Winner" : "Leader";

  const nextSlate = data?.nextSlate ?? null;

  useEffect(() => {
    if (sport !== "golf") return;

    /*
     * Critical sport-switch guard:
     *
     * Do not let the new Golf sport state consume a latestSlate
     * that came from the previous NBA/NFL Home response.
     */
    if (dataSport !== sport) return;

    if (!latestSlate?.id) return;
    if (latestSlate.is_locked) return;

    const refreshIfVisible = () => {
      if (document.visibilityState !== "visible") return;

      const now = Date.now();
      const minimumGapMs = 4.5 * 60 * 1000;

      if (
        lastHomeGolfAutoRefreshRef.current &&
        now - lastHomeGolfAutoRefreshRef.current < minimumGapMs
      ) {
        return;
      }

      lastHomeGolfAutoRefreshRef.current = now;
      void refreshSlateStatsById(latestSlate.id);
    };

    // Opening Home during an active Golf slate immediately
    // makes this browser/device an updater.
    refreshIfVisible();

    const interval = window.setInterval(
      refreshIfVisible,
      5 * 60 * 1000,
    );

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refreshIfVisible();
      }
    };

    document.addEventListener(
      "visibilitychange",
      handleVisibilityChange,
    );

    return () => {
      window.clearInterval(interval);
      document.removeEventListener(
        "visibilitychange",
        handleVisibilityChange,
      );
    };
  }, [
    sport,
    dataSport,
    latestSlate?.id,
    latestSlate?.is_locked,
  ]);

  useEffect(() => {
    /*
     * nextSlate must belong to the currently rendered sport.
     * This also forces cleanup/recreation when sport changes.
     */
    if (dataSport !== sport) return;

    if (!nextSlate?.id || !nextSlate.first_game_start_time) return;

    const tipoffMs = new Date(nextSlate.first_game_start_time).getTime();
    const delayMs = tipoffMs - Date.now();

    if (delayMs <= 0) return;

    if (autoRefreshTimerRef.current) {
      clearTimeout(autoRefreshTimerRef.current);
    }

    autoRefreshTimerRef.current = setTimeout(() => {
      void refreshSlateStatsById(nextSlate.id);
    }, delayMs);

    return () => {
      if (autoRefreshTimerRef.current) {
        clearTimeout(autoRefreshTimerRef.current);
      }
    };
  }, [
    sport,
    dataSport,
    nextSlate?.id,
    nextSlate?.first_game_start_time,
  ]);

  const nextSlateStartTime = nextSlate?.first_game_start_time
    ? new Date(nextSlate.first_game_start_time)
    : null;

  const shouldShowRefreshStats =
    Boolean(latestSlate) &&
    !latestSlate?.is_locked &&
    (isGolf || hasSlateStarted);

  const latestSlateIsFinal = latestSlate?.is_locked === true;

  const shouldShowTipoff =
    Boolean(nextSlateStartTime) &&
    !shouldShowRefreshStats &&
    !hasLiveGames &&
    latestSlateIsFinal;

  const tipoffTime =
    shouldShowTipoff && nextSlateStartTime
      ? nextSlateStartTime.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: "America/New_York",
        })
      : null;

  const tipoffLabel =
    shouldShowTipoff && nextSlate ? `Next slate ${nextSlate.label}` : null;

  const slateStatusLabel =
    isGolf
      ? isFinalSlate
        ? "Final"
        : hasSlateStarted
          ? "Live"
          : "Open"
      : hasLiveGames
        ? "Live"
        : hasCompletedGames && !hasRemainingGames
          ? "Final"
          : latestSlate?.is_locked
            ? "Locked"
            : "Open";

  const slateDateLabel = latestSlate
    ? formatSlateDateLabel({
        date: latestSlate.date,
        start_date: latestSlate.start_date,
        end_date: latestSlate.end_date,
      })
    : "No slate";

  return (
    <main
      className={`min-h-screen px-3 py-5 pb-24 sm:px-4 sm:py-6 sm:pb-6 ${
        isGolf
          ? "bg-slate-950 text-slate-100"
          : "bg-slate-50 text-slate-900"
      }`}
    >
      <div
        className={`mx-auto space-y-6 ${
          isGolf ? "max-w-6xl" : "max-w-7xl"
        }`}
      >
        <AppNav />

        <FunFactCarousel facts={funFacts} sport={sport} />

        {message ? (
          <section className="rounded-3xl border border-orange-200 bg-orange-50 px-5 py-4 text-sm text-orange-800 shadow-sm">
            {message}
          </section>
        ) : null}

        <section
          className={`home-current-slate rounded-3xl p-5 shadow-sm ${
            isGolf
              ? "golf-home-current-slate golf-home-current-slate--compact border border-emerald-800/60 bg-slate-900"
              : "border border-slate-200 bg-white"
          }`}
        >
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2
                  className={`text-2xl font-semibold ${
                    isGolf
                      ? "text-white"
                      : "text-slate-900"
                  }`}
                >
                  {slateHeading}
                </h2>

                {slateBadge === "LIVE" ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-red-600">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-red-500"></span>
                    LIVE
                  </span>
                ) : slateBadge === "FINAL" ? (
                  <span className="text-xs font-medium text-slate-500">
                    FINAL
                  </span>
                ) : null}
              </div>

              <div
                className={`mt-1 text-sm ${
                  isGolf
                    ? "text-emerald-100/70"
                    : "text-slate-500"
                }`}
              >
                {latestSlate ? slateDateLabel : "No slate available"}
              </div>
            </div>

            <Link
              href={`/lineups/scores?sport=${sport}`}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-sky-200 hover:bg-sky-50"
            >
              View Scores
            </Link>
          </div>

          {latestSlate?.show_tournament_analysis === true &&
          latestSlate.tournament_analysis?.trim() ? (
            <details
              className={`group mb-4 overflow-hidden rounded-2xl border ${
                isGolf
                  ? "border-emerald-800/70 bg-emerald-950/25"
                  : sport === "nfl"
                    ? "border-violet-800/70 bg-violet-950/25"
                    : "border-orange-800/70 bg-orange-950/25"
              }`}
            >
              <summary
                className={`flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-bold [&::-webkit-details-marker]:hidden ${
                  isGolf
                    ? "text-emerald-100"
                    : sport === "nfl"
                      ? "text-violet-100"
                      : "text-orange-100"
                }`}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden="true">📝</span>
                  MW Analysis
                </span>

                <span
                  aria-hidden="true"
                  className={`text-xs transition-transform group-open:rotate-180 ${
                    isGolf
                      ? "text-emerald-300"
                      : sport === "nfl"
                        ? "text-violet-300"
                        : "text-orange-300"
                  }`}
                >
                  ▼
                </span>
              </summary>

              <div
                className={`border-t px-4 py-4 ${
                  isGolf
                    ? "border-emerald-900/70"
                    : sport === "nfl"
                      ? "border-violet-900/70"
                      : "border-orange-900/70"
                }`}
              >
                <p className="whitespace-pre-wrap text-sm leading-6 text-slate-200">
                  {latestSlate.tournament_analysis.trim()}
                </p>
              </div>
            </details>
          ) : null}

          {isLoading ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading current slate...
            </div>
          ) : latestSlateRows.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No current slate data available yet.
            </div>
          ) : (
            <>
              <div
                className={`mb-3 overflow-hidden rounded-2xl border ${
                  isGolf
                    ? "border-emerald-700/60 bg-slate-950/70"
                    : "border-slate-200 bg-slate-50"
                }`}
              >
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 sm:px-4 sm:py-3">
                  <div className="min-w-0">
                    <span
                      className={`block text-[9px] font-black uppercase tracking-[0.16em] ${
                        isGolf
                          ? "text-emerald-300"
                          : "text-orange-700"
                      }`}
                    >
                      {leaderLabel}
                    </span>

                    {leader ? (
                      <div className="mt-1">
                        <TeamProfileButton
                          teamName={leader.teamName}
                          avatarUrl={leader.avatarUrl}
                          onClick={() =>
                            setProfileTeam({
                              id: leader.team_id,
                              name: leader.teamName,
                            })
                          }
                        />
                      </div>
                    ) : (
                      <strong
                        className={`mt-1 block text-lg ${
                          isGolf
                            ? "text-white"
                            : "text-slate-900"
                        }`}
                      >
                        —
                      </strong>
                    )}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <strong
                      className={`text-2xl font-black leading-none sm:text-3xl ${
                        isGolf
                          ? "text-white"
                          : "text-slate-950"
                      }`}
                    >
                      {leader
                        ? isGolf
                          ? formatGolfScore(
                              leader.fantasy_points,
                            )
                          : `${roundTo(
                              Number(
                                leader.fantasy_points ?? 0,
                              ),
                            )} pts`
                        : "—"}
                    </strong>

                    <button
                      type="button"
                      onClick={() =>
                        shouldShowRefreshStats
                          ? void handleRefreshStats()
                          : void loadHomeSummary()
                      }
                      disabled={
                        isRefreshingHomeStats ||
                        isLoading
                      }
                      className={`inline-flex h-9 items-center justify-center rounded-xl border px-2.5 text-[11px] font-bold transition disabled:cursor-not-allowed disabled:opacity-60 sm:h-10 sm:px-3 sm:text-xs ${
                        isGolf
                          ? "border-emerald-700 bg-emerald-950 text-emerald-100 hover:bg-emerald-900"
                          : "border-sky-200 bg-white text-sky-800 hover:bg-sky-50"
                      }`}
                    >
                      {isRefreshingHomeStats ||
                      isLoading
                        ? "Refreshing..."
                        : "↻ Refresh"}
                    </button>
                  </div>
                </div>

                <div
                  className={`flex flex-wrap items-center gap-x-2 gap-y-1 border-t px-3 py-2 text-[10px] sm:px-4 sm:text-[11px] ${
                    isGolf
                      ? "border-slate-800 text-slate-400"
                      : "border-slate-200 text-slate-500"
                  }`}
                >
                  <span>{slateDateLabel}</span>

                  <span
                    aria-hidden="true"
                    className={
                      isGolf
                        ? "text-slate-600"
                        : "text-slate-300"
                    }
                  >
                    •
                  </span>

                  <span
                    className={
                      slateStatusLabel === "Live"
                        ? isGolf
                          ? "font-bold text-emerald-300"
                          : "font-bold text-red-600"
                        : ""
                    }
                  >
                    {slateStatusLabel}
                  </span>

                  <span
                    aria-hidden="true"
                    className={
                      isGolf
                        ? "text-slate-600"
                        : "text-slate-300"
                    }
                  >
                    •
                  </span>

                  <span>
                    {latestSlateRows.length}{" "}
                    {latestSlateRows.length === 1
                      ? "Team"
                      : "Teams"}
                  </span>

                  {tipoffTime ? (
                    <>
                      <span
                        aria-hidden="true"
                        className="text-slate-300"
                      >
                        •
                      </span>

                      <span className="font-bold text-sky-700">
                        Next: {tipoffTime} ET
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              {isGolf ? (
                <div>
                  <div className="mb-3 flex rounded-xl border border-emerald-800/60 bg-slate-950/80 p-1">
                    <button
                      type="button"
                      onClick={() =>
                        setGolfHomeTab("fantasy")
                      }
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
                        golfHomeTab === "fantasy"
                          ? "bg-emerald-700 text-white shadow-sm"
                          : "text-slate-400 hover:text-emerald-200"
                      }`}
                    >
                      Fantasy
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setGolfHomeTab("tournament")
                      }
                      className={`flex-1 rounded-lg px-3 py-2 text-sm font-bold transition ${
                        golfHomeTab === "tournament"
                          ? "bg-emerald-700 text-white shadow-sm"
                          : "text-slate-400 hover:text-emerald-200"
                      }`}
                    >
                      Tournament
                    </button>
                  </div>

                  {golfHomeTab === "fantasy" ? (
                <div className="overflow-hidden rounded-2xl border border-emerald-800/50 bg-slate-950">
                  <div className="sm:hidden">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center bg-emerald-950/80 px-4 py-3 text-xs font-bold uppercase tracking-wide text-emerald-100">
                      <span>Team</span>
                      <span className="pr-1 text-right">
                        Score
                      </span>
                    </div>

                    <div>
                      {latestSlateRows.map(
                        (row, index) => (
                          <div
                            key={`mobile-${row.slate_id}-${row.team_id}`}
                            className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t border-slate-800 px-4 py-2.5 ${
                              index === 0
                                ? "bg-emerald-950/50"
                                : "bg-slate-900"
                            }`}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setProfileTeam({
                                  id: row.team_id,
                                  name: row.teamName,
                                })
                              }
                              className="flex min-w-0 items-center gap-2.5 text-left"
                              aria-label={`View ${row.teamName}'s profile`}
                            >
                              <TeamAvatar
                                teamName={row.teamName}
                                avatarUrl={row.avatarUrl}
                                size="sm"
                              />

                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-white">
                                  {row.teamName}
                                </span>

                                <span className="mt-0.5 block truncate text-[11px] font-semibold text-emerald-300">
                                  {row.golf_status_label ?? "—"}
                                </span>
                              </span>
                            </button>

                            <button
                              type="button"
                              onClick={() =>
                                setSlateRosterModal({
                                  slateId:
                                    row.slate_id,
                                  teamId:
                                    row.team_id,
                                  teamName:
                                    row.teamName,
                                  slateLabel:
                                    latestSlate
                                      ? slateDateLabel
                                      : String(
                                          row.slate_id,
                                        ),
                                })
                              }
                              className="inline-flex min-w-14 shrink-0 items-center justify-end gap-1 rounded-full border border-emerald-600/50 bg-emerald-950/70 px-2.5 py-1 text-base font-black text-white transition hover:bg-emerald-900"
                              aria-label={`View ${row.teamName}'s Golf lineup`}
                            >
                              {formatGolfScore(
                                row.fantasy_points,
                              )}

                              <span
                                className="text-emerald-300"
                                aria-hidden="true"
                              >
                                ›
                              </span>
                            </button>
                          </div>
                        ),
                      )}
                    </div>
                  </div>

                  <table className="hidden w-full table-fixed border-collapse text-sm sm:table">
                    <colgroup>
                      <col className="w-[48%]" />
                      <col className="w-[22%]" />
                      <col className="w-[30%]" />
                    </colgroup>

                    <thead className="bg-emerald-950/80 text-emerald-100">
                      <tr className="text-left">
                        <th className="px-4 py-3 font-semibold">
                          Team
                        </th>

                        <th className="px-3 py-3 text-right font-semibold">
                          Score
                        </th>

                        <th className="px-4 py-3 text-right font-semibold">
                          Status
                        </th>
                      </tr>
                    </thead>

                    <tbody className="text-slate-100">
                      {latestSlateRows.map(
                        (row, index) => (
                          <tr
                            key={`${row.slate_id}-${row.team_id}`}
                            className={`border-t border-slate-800 ${
                              index === 0
                                ? "bg-emerald-950/50"
                                : "bg-slate-900"
                            }`}
                          >
                            <td className="px-4 py-3">
                              <TeamProfileButton
                                teamName={row.teamName}
                                avatarUrl={row.avatarUrl}
                                onClick={() =>
                                  setProfileTeam({
                                    id: row.team_id,
                                    name: row.teamName,
                                  })
                                }
                              />
                            </td>

                            <td className="px-3 py-3 text-right">
                              <button
                                type="button"
                                onClick={() =>
                                  setSlateRosterModal({
                                    slateId:
                                      row.slate_id,
                                    teamId:
                                      row.team_id,
                                    teamName:
                                      row.teamName,
                                    slateLabel:
                                      latestSlate
                                        ? slateDateLabel
                                        : String(
                                            row.slate_id,
                                          ),
                                  })
                                }
                                className="inline-flex min-w-14 items-center justify-end gap-1 rounded-full border border-emerald-600/50 bg-emerald-950/70 px-2.5 py-1 text-base font-black text-white transition hover:bg-emerald-900 sm:min-w-16 sm:px-3 sm:py-1.5 sm:text-lg"
                              >
                                {formatGolfScore(
                                  row.fantasy_points,
                                )}
                                <span
                                  className="text-emerald-300"
                                  aria-hidden="true"
                                >
                                  ›
                                </span>
                              </button>
                            </td>

                            <td className="px-4 py-3 text-right">
                              <span
                                className={`inline-flex max-w-full items-center justify-end rounded-full px-2.5 py-1 text-xs font-bold ${
                                  row.golf_status_label?.includes(
                                    "complete",
                                  ) ||
                                  row.golf_status_label ===
                                    "Finished"
                                    ? "bg-slate-800 text-slate-300"
                                    : row.golf_status_label?.includes(
                                          "live",
                                        )
                                      ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/30"
                                      : "bg-slate-800 text-slate-300"
                                }`}
                              >
                                {row.golf_status_label ?? "—"}
                              </span>
                            </td>
                          </tr>
                        ),
                      )}
                    </tbody>
                  </table>
                </div>

                  ) : (
                    <div className="overflow-hidden rounded-2xl border border-emerald-800/50 bg-slate-950">
                      <div className="flex items-center justify-between border-b border-emerald-900/70 bg-emerald-950/70 px-4 py-3">
                        <div>
                          <h3 className="font-bold text-emerald-50">
                            Tournament Leaderboard
                          </h3>

                          <p className="mt-0.5 text-xs text-emerald-300/70">
                            Drafted golfers are highlighted
                          </p>
                        </div>

                        <span className="text-xs font-semibold text-slate-400">
                          Top {Math.min(
                            tournamentLeaderboard.length,
                            50,
                          )}
                        </span>
                      </div>

                      {projectedCut ? (
                        <div className="border-b border-amber-500/30 bg-amber-950/30 px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <span className="block text-[9px] font-black uppercase tracking-[0.16em] text-amber-300">
                                {projectedCut.official
                                  ? "Cut line"
                                  : "Projected cut"}
                              </span>

                              <div className="mt-1 flex items-baseline gap-2">
                                <strong className="text-2xl font-black text-white">
                                  {projectedCut.display}
                                </strong>

                                <span className="text-xs font-semibold text-amber-200/80">
                                  {projectedCut.ruleLabel}
                                </span>
                              </div>
                            </div>

                            <div className="text-right text-[11px] leading-5 text-slate-300">
                              <div>
                                <strong className="text-white">
                                  {projectedCut.inside}
                                </strong>{" "}
                                currently inside
                              </div>
                              <div>
                                {projectedCut.tiedAtCut} tied at{" "}
                                {projectedCut.display}
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : null}

                      {tournamentLeaderboard.length ===
                      0 ? (
                        <div className="px-4 py-8 text-center text-sm text-slate-400">
                          Tournament standings will
                          appear after stats are refreshed.
                        </div>
                      ) : (
                        <div className="max-h-[56dvh] overflow-y-auto">
                          <div className="sm:hidden">
                            <div className="sticky top-0 z-10 grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 bg-slate-900 px-3 py-2.5 text-xs font-bold uppercase tracking-wide text-slate-400">
                              <span className="text-center">
                                Pos
                              </span>

                              <span>Golfer</span>

                              <span className="text-right">
                                Score
                              </span>
                            </div>

                            <div>
                              {tournamentLeaderboard
                                .slice(0, 50)
                                .map((golfer) => (
                                  <div
                                    key={`mobile-tournament-${golfer.playerId}`}
                                    className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 border-t border-slate-800 px-3 py-2.5 ${
                                      golfer.isDrafted
                                        ? "bg-emerald-950/55"
                                        : "bg-slate-900/70"
                                    }`}
                                  >
                                    <div className="text-center text-sm font-bold text-slate-300">
                                      {golfer.position ??
                                        "—"}
                                    </div>

                                    <button
                                      type="button"
                                      onClick={() =>
                                        setSelectedRosterPlayer(
                                          {
                                            id:
                                              golfer.playerId,
                                            name:
                                              golfer.name,
                                            position_group:
                                              "GOLFER",
                                            is_active:
                                              true,
                                            espn_player_id:
                                              golfer.espnGolfPlayerId,
                                            headshot_url:
                                              golfer.headshotUrl,
                                            country:
                                              golfer.country,
                                            owgr_rank:
                                              golfer.owgrRank,
                                          },
                                        )
                                      }
                                      className="flex min-w-0 items-center gap-2 text-left"
                                    >
                                      <PlayerHeadshot
                                        espnGolfPlayerId={
                                          golfer.espnGolfPlayerId
                                        }
                                        imageUrl={
                                          golfer.headshotUrl
                                        }
                                        playerName={
                                          golfer.name
                                        }
                                        size="sm"
                                      />

                                      <span className="min-w-0 flex-1">
                                        <span className="flex min-w-0 items-center gap-1">
                                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
                                            {golfer.name}
                                          </span>

                                          {golfer.isDrafted ? (
                                            <span
                                              className="shrink-0 text-base text-emerald-300"
                                              aria-label="Drafted golfer"
                                              title="Drafted golfer"
                                            >
                                              ★
                                            </span>
                                          ) : null}
                                        </span>

                                        <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                                          {golfer.statusLabel}

                                          {golfer.draftedBy
                                            .length > 0
                                            ? ` · ${golfer.draftedBy.join(
                                                ", ",
                                              )}`
                                            : ""}
                                        </span>
                                      </span>
                                    </button>

                                    <div
                                      className={`shrink-0 text-right text-lg font-black ${
                                        golfer.isDrafted
                                          ? "text-emerald-300"
                                          : "text-white"
                                      }`}
                                    >
                                      {formatGolfScore(
                                        golfer.score,
                                      )}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>

                          <table className="hidden w-full table-fixed border-collapse text-sm sm:table">
                            <colgroup>
                              <col className="w-11" />
                              <col />
                              <col className="w-[5.25rem]" />
                            </colgroup>

                            <thead className="sticky top-0 z-10 bg-slate-900 text-xs uppercase tracking-wide text-slate-400">
                              <tr>
                                <th className="px-2 py-2.5 text-center">
                                  Pos
                                </th>

                                <th className="px-2 py-2.5 text-left">
                                  Golfer
                                </th>

                                <th className="px-3 py-2.5 text-right">
                                  Score
                                </th>
                              </tr>
                            </thead>

                            <tbody>
                              {tournamentLeaderboard
                                .slice(0, 50)
                                .map((golfer) => (
                                  <tr
                                    key={
                                      golfer.playerId
                                    }
                                    className={`border-t border-slate-800 ${
                                      golfer.isDrafted
                                        ? "bg-emerald-950/55"
                                        : "bg-slate-900/70"
                                    }`}
                                  >
                                    <td className="px-2 py-2.5 text-center font-bold text-slate-300">
                                      {golfer.position ??
                                        "—"}
                                    </td>

                                    <td className="min-w-0 px-2 py-2.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setSelectedRosterPlayer(
                                            {
                                              id:
                                                golfer.playerId,
                                              name:
                                                golfer.name,
                                              position_group:
                                                "GOLFER",
                                              is_active:
                                                true,
                                              espn_player_id:
                                                golfer.espnGolfPlayerId,
                                              headshot_url:
                                                golfer.headshotUrl,
                                              country:
                                                golfer.country,
                                              owgr_rank:
                                                golfer.owgrRank,
                                            },
                                          )
                                        }
                                        className="flex w-full min-w-0 items-center gap-2 text-left"
                                      >
                                        <PlayerHeadshot
                                          espnGolfPlayerId={
                                            golfer.espnGolfPlayerId
                                          }
                                          imageUrl={
                                            golfer.headshotUrl
                                          }
                                          playerName={
                                            golfer.name
                                          }
                                          size="sm"
                                        />

                                        <span className="min-w-0 flex-1">
                                          <span className="flex min-w-0 items-center gap-1">
                                            <span className="min-w-0 flex-1 truncate font-semibold text-white">
                                              {golfer.name}
                                            </span>

                                            {golfer.isDrafted ? (
                                              <span
                                                className="shrink-0 text-emerald-300"
                                                aria-label="Drafted golfer"
                                                title="Drafted golfer"
                                              >
                                                ★
                                              </span>
                                            ) : null}
                                          </span>

                                          <span className="mt-0.5 block truncate text-[11px] text-slate-400">
                                            {golfer.statusLabel}

                                            {golfer.draftedBy
                                              .length > 0
                                              ? ` · ${golfer.draftedBy.join(
                                                  ", ",
                                                )}`
                                              : ""}
                                          </span>
                                        </span>
                                      </button>
                                    </td>

                                    <td className="px-3 py-2.5 text-right">
                                      <span
                                        className={`text-lg font-black ${
                                          golfer.isDrafted
                                            ? "text-emerald-300"
                                            : "text-white"
                                        }`}
                                      >
                                        {formatGolfScore(
                                          golfer.score,
                                        )}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="-mx-4 overflow-x-auto px-4">
                  <table className="w-full table-fixed border-collapse text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr className="text-left">
                        <th className="px-3 py-3 font-semibold">Team</th>
                        <th className="px-2 py-3 font-semibold">
                          {scoreColumnLabel}
                        </th>
                        <th className="px-2 py-3 font-semibold">
                          {projectionColumnLabel}
                        </th>
                        <th className="px-2 py-3 font-semibold">Win %</th>
                        <th className="px-2 py-3 font-semibold">Games</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white text-slate-800">
                      {latestSlateRows.map((row, index) => (
                        <tr
                          key={`${row.slate_id}-${row.team_id}`}
                          className={`border-t border-slate-100 ${
                            index === 0 ? "home-winner-row bg-orange-50/50" : ""
                          }`}
                        >
                          <td className="px-3 py-2.5">
                            <TeamProfileButton
                              teamName={row.teamName}
                              avatarUrl={row.avatarUrl}
                              onClick={() =>
                                setProfileTeam({
                                  id: row.team_id,
                                  name: row.teamName,
                                })
                              }
                            />
                          </td>
                          <td className="px-2 py-3">
                            <button
                              type="button"
                              onClick={() =>
                                setSlateRosterModal({
                                  slateId: row.slate_id,
                                  teamId: row.team_id,
                                  teamName: row.teamName,
                                  slateLabel: latestSlate
                                    ? slateDateLabel
                                    : String(row.slate_id),
                                })
                              }
                              className="home-score-pill-v2"
                              aria-label={`View ${row.teamName}'s box score`}
                              title={`View ${row.teamName}'s box score`}
                            >
                              <span>
                                {roundTo(Number(row.fantasy_points ?? 0))}
                              </span>

                              <span
                                className="home-score-pill-v2-chevron"
                                aria-hidden="true"
                              >
                                ›
                              </span>
                            </button>
                          </td>
                          <td className="home-projection-value-v2 px-2 py-3">
                            {isFinalSlate ? (
                              row.pregame_projected_points !== null &&
                              row.pregame_projected_points !== undefined ? (
                                (() => {
                                  const difference = roundTo(
                                    Number(row.fantasy_points ?? 0) -
                                      Number(row.pregame_projected_points),
                                    1
                                  );

                                  const isNeutral = Math.abs(difference) <= 1;
                                  const isPositive = difference > 1;

                                  const displayDifference =
                                    difference > 0
                                      ? `+${difference.toFixed(1)}`
                                      : difference.toFixed(1);

                                  return (
                                    <span
                                      className={`home-projection-delta ${
                                        isNeutral
                                          ? "home-projection-delta--neutral"
                                          : isPositive
                                            ? "home-projection-delta--positive"
                                            : "home-projection-delta--negative"
                                      }`}
                                      title={`Pregame projection: ${roundTo(
                                        Number(row.pregame_projected_points),
                                        1
                                      )}`}
                                      aria-label={`${
                                        isNeutral
                                          ? "Matched projection"
                                          : isPositive
                                            ? "Exceeded projection"
                                            : "Finished below projection"
                                      } by ${Math.abs(difference).toFixed(
                                        1
                                      )} fantasy points. Pregame projection ${roundTo(
                                        Number(row.pregame_projected_points),
                                        1
                                      )}.`}
                                    >
                                      <span
                                        className="home-projection-delta-icon"
                                        aria-hidden="true"
                                      >
                                        {isNeutral
                                          ? "—"
                                          : isPositive
                                            ? "▲"
                                            : "▼"}
                                      </span>

                                      <span>{displayDifference}</span>
                                    </span>
                                  );
                                })()
                              ) : (
                                "—"
                              )
                            ) : row.projected_points !== null &&
                              row.projected_points !== undefined ? (
                              roundTo(Number(row.projected_points))
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-2 py-3">
                            {row.win_probability !== null &&
                            row.win_probability !== undefined ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-100">
                                {roundTo(Number(row.win_probability), 0)}%
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <GamesStatus
                              completed={row.games_completed}
                              inProgress={row.games_in_progress}
                              remaining={row.games_remaining}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              )}
            </>
          )}
        </section>
      </div>

      {slateRosterModal && isGolf ? (
        <div
          className="mobile-modal-safe fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 px-3 py-4 backdrop-blur-sm sm:items-center"
          onClick={() =>
            setSlateRosterModal(null)
          }
        >
          <div
            className="mobile-modal-panel-safe flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-emerald-700/60 bg-slate-950 text-slate-100 shadow-2xl"
            onClick={(event) =>
              event.stopPropagation()
            }
          >
            <div className="shrink-0 border-b border-emerald-900/80 bg-gradient-to-r from-emerald-950 to-slate-950 px-4 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-300">
                    Golf Lineup
                  </div>

                  <h3 className="mt-1 text-2xl font-bold text-white">
                    {slateRosterModal.teamName}
                  </h3>

                  <p className="mt-1 text-sm text-slate-400">
                    {slateRosterModal.slateLabel}
                    <span className="mx-2 text-slate-600">
                      •
                    </span>
                    <span className="font-bold text-emerald-300">
                      {formatGolfScore(
                        slateRosterTotal,
                      )}
                    </span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    setSlateRosterModal(null)
                  }
                  className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-emerald-600 hover:text-white"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-6">
              {isSlateRosterLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
                  Loading golfers...
                </div>
              ) : slateRosterRows.length ===
                0 ? (
                <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-400">
                  No golfers found for this lineup.
                </div>
              ) : (
                <div className="overflow-x-auto rounded-2xl border border-slate-800">
                  <table className="w-full min-w-[620px] border-collapse text-sm">
                    <thead className="bg-emerald-950/80 text-emerald-100">
                      <tr>
                        <th className="px-3 py-3 text-left font-semibold">
                          Golfer
                        </th>

                        <th className="px-3 py-3 text-center font-semibold text-emerald-200">
                          Total
                        </th>

                        {[1, 2, 3, 4].map(
                          (roundNumber) => (
                            <th
                              key={roundNumber}
                              className="px-2 py-3 text-center font-semibold"
                            >
                              R{roundNumber}
                            </th>
                          ),
                        )}
                      </tr>
                    </thead>

                    <tbody>
                      {slateRosterRows.map(
                        (row) => (
                          <tr
                            key={row.playerId}
                            className="border-t border-slate-800 bg-slate-900/70"
                          >
                            <td className="px-3 py-3">
                              <button
                                type="button"
                                className="flex max-w-[230px] items-center gap-2 text-left"
                                onClick={() => {
                                  const player =
                                    rosterRowToPlayer(
                                      row,
                                    );

                                  if (player) {
                                    setSelectedRosterPlayer(
                                      player,
                                    );
                                  }
                                }}
                              >
                                <PlayerHeadshot
                                  espnGolfPlayerId={
                                    row.espnGolfPlayerId
                                  }
                                  imageUrl={
                                    row.headshotUrl
                                  }
                                  playerName={
                                    row.name
                                  }
                                  size="sm"
                                />

                                <span className="min-w-0">
                                  <span className="block truncate font-semibold text-white">
                                    {row.name}
                                  </span>

                                  <span className="block truncate text-xs text-slate-400">
                                    {formatGolfRosterStatus(
                                      row,
                                    )}
                                  </span>
                                </span>
                              </button>
                            </td>

                            <td className="px-3 py-3 text-center text-lg font-black text-emerald-300">
                              {formatGolfScore(
                                row.fantasyPoints,
                              )}
                            </td>

                            {[1, 2, 3, 4].map(
                              (roundNumber) => {
                                const round =
                                  row.roundScores?.find(
                                    (item) =>
                                      item.roundNumber ===
                                      roundNumber,
                                  );

                                return (
                                  <td
                                    key={
                                      roundNumber
                                    }
                                    className="px-2 py-3 text-center font-bold text-slate-200"
                                  >
                                    {round
                                      ?.scoreToPar ===
                                      null ||
                                    round
                                      ?.scoreToPar ===
                                      undefined
                                      ? "—"
                                      : formatGolfScore(
                                          round.scoreToPar,
                                        )}
                                  </td>
                                );
                              },
                            )}

                          </tr>
                        ),
                      )}

                      <tr className="border-t border-emerald-900/80 bg-emerald-950/60">
                        <td
                          className="px-3 py-3 font-bold text-emerald-100"
                          colSpan={5}
                        >
                          Team Score
                        </td>

                        <td className="px-3 py-3 text-right text-xl font-black text-white">
                          {formatGolfScore(
                            slateRosterTotal,
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {slateRosterModal && !isGolf ? (
        <div
          className="mobile-modal-safe fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 px-3 py-4 sm:items-center"
          onClick={() => setSlateRosterModal(null)}
        >
          <div
            className="mobile-modal-panel-safe flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="shrink-0 border-b border-slate-200 px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Box Score
                  </div>
                  <h3 className="mt-1 text-2xl font-bold text-slate-900">
                    {slateRosterModal.teamName}&apos;s Lineup
                  </h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {slateRosterModal.slateLabel}
                    <span className="mx-2 text-slate-300">•</span>
                    <span className="font-semibold text-slate-700">
                      {slateRosterTotal.toFixed(1)} Fantasy Points
                    </span>
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setSlateRosterModal(null)}
                  className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {isSlateRosterLoading ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                  Loading roster...
                </div>
              ) : slateRosterRows.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
                  No roster found for this slate.
                </div>
              ) : (
                <div>
                  <div className="home-lineup-breakdown-heading">
                    <h4>Player Breakdown</h4>

                    <div className="home-lineup-breakdown-total">
                      <span>Total</span>
                      <strong>{slateRosterTotal.toFixed(1)}</strong>
                    </div>
                  </div>

                  <div className="space-y-2 sm:hidden">
                    {slateRosterRows.map((row) => (
                      <div
                        key={row.playerId}
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button
                            type="button"
                            className="home-lineup-player-link"
                            onClick={() => {
                              const player = rosterRowToPlayer(row);
                              if (player) setSelectedRosterPlayer(player);
                            }}
                            aria-label={`View ${row.name}'s player profile`}
                          >
                            <PlayerHeadshot
                              nbaPlayerId={row.nbaPlayerId}
                              nflPlayerId={row.nflPlayerId}
                              playerName={row.name}
                              size="sm"
                            />

                            <span>
                              <span className="block text-xs font-semibold text-slate-500">
                                {row.positionGroup ?? "—"}
                              </span>
                              <span className="block text-base font-semibold text-slate-900">
                                {row.name}
                              </span>
                            </span>
                          </button>
                          <div className="text-right text-base font-bold text-slate-900">
                            {Number(row.fantasyPoints ?? 0).toFixed(1)}
                          </div>
                        </div>

                        <div className="mt-2 text-xs leading-relaxed text-slate-600">
                          {slateRosterStatColumns
                            .map(
                              (column) =>
                                `${row[column.key] ?? 0} ${column.label}`,
                            )
                            .join(" • ")}
                        </div>

                        <div className="mt-2 flex items-center justify-between text-xs">
                          <div className="font-semibold text-sky-700">
                            Proj: {getProjectedFantasyPoints(row).toFixed(1)}
                          </div>

                          <div className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">
                            {getPlayerStatusLabel(row)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden overflow-x-auto rounded-2xl border border-slate-200 sm:block">
                    <table className="min-w-[720px] w-full text-sm">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr className="text-left">
                          <th className="px-3 py-2">Pos</th>
                          <th className="px-3 py-2">Player</th>
                          {slateRosterStatColumns.map((column) => (
                            <th
                              key={column.key}
                              className="px-3 py-2 text-right"
                            >
                              {column.label}
                            </th>
                          ))}
                          <th className="px-3 py-2 text-right">Total</th>
                          <th className="px-3 py-2 text-right">Proj</th>
                          <th className="px-3 py-2 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {slateRosterRows.map((row) => (
                          <tr
                            key={row.playerId}
                            className="border-t border-slate-100"
                          >
                            <td className="px-3 py-2 font-medium">
                              {row.positionGroup ?? "—"}
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="home-lineup-player-link home-lineup-player-link--table"
                                onClick={() => {
                                  const player = rosterRowToPlayer(row);
                                  if (player) setSelectedRosterPlayer(player);
                                }}
                                aria-label={`View ${row.name}'s player profile`}
                              >
                                <PlayerHeadshot
                                  nbaPlayerId={row.nbaPlayerId}
                                  nflPlayerId={row.nflPlayerId}
                                  playerName={row.name}
                                  size="xs"
                                />
                                <span>{row.name}</span>
                              </button>
                            </td>
                            {slateRosterStatColumns.map((column) => (
                              <td
                                key={column.key}
                                className="px-3 py-2 text-right"
                              >
                                {row[column.key] ?? 0}
                              </td>
                            ))}
                            <td className="px-3 py-2 text-right font-semibold">
                              {Number(row.fantasyPoints ?? 0).toFixed(1)}
                            </td>

                            <td className="px-3 py-2 text-right font-semibold text-sky-700">
                              {getProjectedFantasyPoints(row).toFixed(1)}
                            </td>

                            <td className="px-3 py-2 text-right text-xs font-medium text-slate-500">
                              {getPlayerStatusLabel(row)}
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t border-slate-200 bg-slate-50 font-semibold">
                          <td className="px-3 py-2" />
                          <td className="px-3 py-2">Total</td>
                          <td
                            className="px-3 py-2 text-right"
                            colSpan={slateRosterStatColumns.length}
                          />
                          <td className="px-3 py-2 text-right">
                            {slateRosterTotal.toFixed(1)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <ReadOnlyPlayerModal
        player={selectedRosterPlayer}
        setPlayer={setSelectedRosterPlayer}
        playerAverageMap={EMPTY_PLAYER_AVERAGE_MAP}
        playerProjections={EMPTY_PLAYER_PROJECTIONS}
        golfStat={selectedGolfPlayerStat}
        golfSlateId={
          isGolf
            ? slateRosterModal?.slateId ??
              latestSlate?.id ??
              null
            : null
        }
      />

      <TeamProfileModal team={profileTeam} setTeam={setProfileTeam} />
    </main>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomePageContent />
    </Suspense>
  );
}
