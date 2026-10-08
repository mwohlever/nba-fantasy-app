"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AppNav from "@/components/AppNav";
import ReadOnlyPlayerModal from "@/components/lineups/ReadOnlyPlayerModal";
import type { Player, PlayerStat } from "@/components/lineups/types";
import GolfLiveLeaderboard, {
  type GolfLiveLeaderboardRow,
} from "@/components/golf/GolfLiveLeaderboard";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { refreshGolfFromBrowser } from "@/lib/client/refreshGolfFromBrowser";
import { golfLiveHref, golfLiveOptionGroups, golfLiveDefaultLabel, golfLiveOptionLabel, type GolfLiveSummary } from "@/lib/golf/liveTournament";
import { loadGolfLiveSchedule, loadGolfLiveSummary } from "@/lib/client/golfLiveTournaments";
import type { GolfScheduleEvent } from "@/lib/providers/golf";
import { usePullToRefresh } from "@/lib/client/usePullToRefresh";
import type { RefreshOutcome } from "@/lib/client/refreshOutcome";
import PullToRefreshIndicator from "@/components/ui/PullToRefreshIndicator";

const EMPTY_AVERAGES = new Map<number, number>();
const EMPTY_PROJECTIONS: Record<number, never> = {};

function playerFromRow(row: GolfLiveLeaderboardRow): Player {
  return {
    id: row.playerId,
    name: row.name,
    position_group: "GOLFER",
    is_active: true,
    espn_player_id: row.espnGolfPlayerId,
    headshot_url: row.headshotUrl,
    country: row.country,
    owgr_rank: row.owgrRank,
  };
}

export default function GolfLivePage() {
  const { groupContext, isLoading: isGroupLoading, isSwitchingGroup } =
    useGroupContext();
  const { selectedSport, setSelectedSport } = useSelectedSport();
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get("eventId");
  const scopeKey = `${groupContext?.group.id}:${eventId ?? "auto"}`;
  const [loaded, setLoaded] = useState<{ scope: string; summary: GolfLiveSummary } | null>(null);
  const summary = loaded?.scope === scopeKey && !isGroupLoading && !isSwitchingGroup ? loaded.summary : null;
  const [defaultLoaded, setDefaultLoaded] = useState<{ groupId: string; summary: GolfLiveSummary | null } | null>(null);
  const [schedule, setSchedule] = useState<{ year: string; events: GolfScheduleEvent[] } | null>(null);
  const [scheduleFailure, setScheduleFailure] = useState<{ year: string; error: string } | null>(null);
  const [browseYear, setBrowseYear] = useState<{ eventId: string | null; year: string } | null>(null);
  const currentYear = new Date().getUTCFullYear();
  const scheduleYear = (browseYear?.eventId === eventId ? browseYear.year : null) ?? (eventId === null ? String(currentYear) : summary?.tournament?.startDate?.slice(0, 4)) ?? String(currentYear);
  const scheduleError = scheduleFailure?.year === scheduleYear ? scheduleFailure.error : "";
  const showCurrentOption = scheduleYear === String(currentYear);
  const needsDefaultLabel = eventId !== null && showCurrentOption;
  const defaultSummary = eventId === null ? summary
    : defaultLoaded && defaultLoaded.groupId === groupContext?.group.id && !isGroupLoading && !isSwitchingGroup ? defaultLoaded.summary : null;
  const optionGroups = golfLiveOptionGroups({ schedule: schedule?.year === scheduleYear ? schedule.events : [],
    selected: summary, automatic: defaultSummary, year: scheduleYear });
  const options = optionGroups.flatMap(group => group.events);
  const currentOptionLabel = defaultSummary ? golfLiveDefaultLabel(defaultSummary) : "Loading current tournament…";
  const retainedSelectionLabel = eventId !== null && eventId === defaultSummary?.tournament?.espnEventId
    ? currentOptionLabel : summary?.tournament ? golfLiveOptionLabel(summary.tournament) : "Requested tournament";
  const [playerStats, setPlayerStats] = useState<PlayerStat[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isPlayerStatsLoading, setIsPlayerStatsLoading] = useState(false);
  const [playerStatsError, setPlayerStatsError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const requestRef = useRef(0);
  const playerStatsCacheRef = useRef<{ slateId: number; stats: PlayerStat[] } | null>(null);
  const playerStatsRequestRef = useRef<{ slateId: number; promise: Promise<void> } | null>(null);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const refreshingRef = useRef(false);
  const resolvedSlateRef = useRef<number | null>(null);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;

  useEffect(() => {
    if (selectedSport !== "golf") setSelectedSport("golf");
  }, [selectedSport, setSelectedSport]);

  const loadSummary = useCallback(async () => {
    if (!groupContext?.group.id || isGroupLoading || isSwitchingGroup) return;
    const requestId = ++requestRef.current;

    try {
      setIsLoading(true);
      setMessage("");
      const result = await loadGolfLiveSummary(eventId);
      if (requestId !== requestRef.current || scopeKey !== scopeRef.current) return;

      const slateId = Number(result.latestSlate?.id);
      if (resolvedSlateRef.current !== (result.latestSlate?.id ?? null)) setSelectedPlayer(null);
      resolvedSlateRef.current = result.latestSlate?.id ?? null;
      if (playerStatsCacheRef.current?.slateId !== slateId) {
        playerStatsCacheRef.current = null;
        playerStatsRequestRef.current = null;
        setPlayerStats([]);
        setPlayerStatsError(null);
        setIsPlayerStatsLoading(false);
      }
      setLoaded({ scope: scopeKey, summary: result });
    } catch (error) {
      if (requestId !== requestRef.current || scopeKey !== scopeRef.current) return;
      setMessage(error instanceof Error ? error.message : "Golf Live is unavailable.");
      setLoaded(null);
      setPlayerStats([]);
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, [eventId, scopeKey, groupContext?.group.id, isGroupLoading, isSwitchingGroup, setSelectedPlayer]);

  const loadPlayerStats = useCallback(async (slateId: number) => {
    if (playerStatsCacheRef.current?.slateId === slateId) return;
    if (playerStatsRequestRef.current?.slateId === slateId) {
      return playerStatsRequestRef.current.promise;
    }

    setIsPlayerStatsLoading(true);
    setPlayerStatsError(null);
    const scope = scopeRef.current;
    const request = { slateId, promise: Promise.resolve() };
    const promise = fetch(`/api/player-stats?slateId=${slateId}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) {
          throw new Error(result.error || "Player scorecard details are unavailable.");
        }
        if (playerStatsRequestRef.current !== request || scope !== scopeRef.current) return;
        const stats = result.playerStats ?? [];
        playerStatsCacheRef.current = { slateId, stats };
        setPlayerStats(stats);
      })
      .catch((error) => {
        if (playerStatsRequestRef.current !== request || scope !== scopeRef.current) return;
        setPlayerStats([]);
        setPlayerStatsError(
          error instanceof Error ? error.message : "Player scorecard details are unavailable.",
        );
      })
      .finally(() => {
        if (playerStatsRequestRef.current !== request || scope !== scopeRef.current) return;
        playerStatsRequestRef.current = null;
        setIsPlayerStatsLoading(false);
      });
    request.promise = promise;
    playerStatsRequestRef.current = request;
    return promise;
  }, []);

  useEffect(() => {
    setSelectedPlayer(null);
    setLoaded(null);
    playerStatsCacheRef.current = null;
    playerStatsRequestRef.current = null;
    setPlayerStats([]);
    setPlayerStatsError(null);
    setIsPlayerStatsLoading(false);
    void loadSummary();
    return () => {
      requestRef.current += 1;
    };
  }, [loadSummary]);

  useEffect(() => {
    let active = true;
    void loadGolfLiveSchedule(scheduleYear).then(events => {
      if (active) {
        setSchedule({ year: scheduleYear, events });
        setScheduleFailure(null);
      }
    }).catch(error => {
      if (active) setScheduleFailure({ year: scheduleYear, error: error instanceof Error ? error.message : "Tournament schedule is unavailable." });
    });
    return () => { active = false; };
  }, [scheduleYear]);

  // Resolve the named default option independently of an explicit selection.
  // This reads the existing resolver once; it never refreshes or replaces the displayed event.
  useEffect(() => {
    const groupId = groupContext?.group.id;
    if (!needsDefaultLabel || !groupId || isGroupLoading || isSwitchingGroup) return;
    let active = true;
    void loadGolfLiveSummary(null).then(result => {
      if (active) setDefaultLoaded({ groupId, summary: result });
    }).catch(() => {
      if (active) setDefaultLoaded({ groupId, summary: null });
    });
    return () => { active = false; };
  }, [needsDefaultLabel, groupContext?.group.id, isGroupLoading, isSwitchingGroup]);

  async function refreshLive(): Promise<RefreshOutcome> {
    const slateId = summary?.latestSlate?.id;
    if ((!summary?.tournament && !slateId) || refreshingRef.current || isGroupLoading || isSwitchingGroup) return { status: "skipped" };
    const scope = scopeRef.current;
    refreshingRef.current = true;
    try {
      setIsRefreshing(true);
      setMessage("");
      if (slateId) await refreshGolfFromBrowser(slateId);
      if (scope !== scopeRef.current) return { status: "skipped" };
      playerStatsCacheRef.current = null;
      playerStatsRequestRef.current = null;
      setPlayerStats([]);
      setPlayerStatsError(null);
      setIsPlayerStatsLoading(false);
      await loadSummary();
      if (selectedPlayer && slateId && resolvedSlateRef.current === slateId && scope === scopeRef.current) void loadPlayerStats(Number(slateId));
      return { status: "success" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Golf refresh failed.";
      if (scope === scopeRef.current) setMessage(message);
      return { status: "error", message };
    } finally {
      refreshingRef.current = false;
      setIsRefreshing(false);
    }
  }
  const pull = usePullToRefresh({ targetRef: surfaceRef, onRefresh: refreshLive,
    enabled: Boolean((summary?.tournament || summary?.latestSlate) && !isLoading && !isGroupLoading && !isSwitchingGroup && !selectedPlayer),
    isRefreshing, scopeKey });

  const rows = summary?.tournamentLeaderboard ?? [];
  const slate = summary?.latestSlate ?? null;
  const tournament = summary?.tournament;
  const selectedStat = selectedPlayer && playerStatsCacheRef.current?.slateId === Number(slate?.id)
    ? playerStats.find((stat) => Number(stat.player_id) === selectedPlayer.id) ?? null
    : null;
  const statusLabel =
    summary?.latestGolfTournamentIsFinal
      ? "Final"
      : rows.some((row) => row.statusState === "playing")
        ? "Live"
        : summary?.tournamentStatus === "scheduled" || (tournament?.startDate && tournament.startDate > new Date().toISOString().slice(0, 10))
          ? "Upcoming"
          : "Tournament";

  return (
    <main ref={surfaceRef} className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <AppNav />
        <PullToRefreshIndicator pull={pull} feedback={isRefreshing ? "Refreshing…" : ""} />

        <header className="space-y-2 border-b border-emerald-900/70 pb-4">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">Golf Live</p>
          <div className="flex min-w-0 gap-2">
            <select
              aria-label="Golf Live tournament"
              value={eventId ?? ""}
              onChange={event => router.push(golfLiveHref(event.target.value || null), { scroll: false })}
              className="min-w-0 flex-1 rounded-lg border border-emerald-900 bg-slate-900 px-2 py-2 text-xs text-slate-100"
            >
              {showCurrentOption ? (
                <option value="" disabled={!defaultSummary?.tournament}>
                  {defaultLoaded && defaultLoaded.groupId === groupContext?.group.id && defaultLoaded.summary === null && eventId !== null ? "Current tournament unavailable" : currentOptionLabel}
                </option>
              ) : <option value="" disabled hidden>Choose a tournament</option>}
              {/* Keep direct/out-of-season selections visible in the closed control without duplicating menu entries. */}
              {eventId !== null && !options.some(option => option.espnEventId === eventId) ? <option value={eventId} hidden>{retainedSelectionLabel}</option> : null}
              {optionGroups.map(group => (
                <optgroup key={group.label} label={group.label}>
                  {group.events.map(event => <option key={event.espnEventId} value={event.espnEventId}>{golfLiveOptionLabel(event)}</option>)}
                </optgroup>
              ))}
            </select>
            <select aria-label="Golf tournament season" value={scheduleYear} onChange={event => setBrowseYear({ eventId, year: event.target.value })}
              className="w-20 shrink-0 rounded-lg border border-emerald-900 bg-slate-900 px-2 py-2 text-xs text-slate-100">
              {Array.from({ length: currentYear - 2000 + 2 }, (_, index) => String(currentYear + 1 - index)).map(year => <option key={year} value={year}>{year}</option>)}
            </select>
          </div>
          {scheduleError ? <p role="status" className="text-xs text-amber-200">{scheduleError} Try another season.</p> : null}
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-black text-white sm:text-3xl">{tournament?.name ?? slate?.label ?? "Tournament Leaderboard"}</h1>
              <p className="mt-1 text-xs text-slate-400">
                {tournament ? `${[tournament.startDate, tournament.endDate].filter(Boolean).join(" – ")} · ${statusLabel}` : isLoading ? "Loading tournament…" : "No tournament available"}
              </p>
            </div>
            <button type="button" onClick={() => void refreshLive()} disabled={(!tournament && !slate) || isRefreshing || isLoading}
              className="shrink-0 rounded-xl border border-emerald-700 bg-emerald-950 px-3 py-2 text-xs font-bold text-emerald-100 transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50">
              {isRefreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
          </div>
        </header>

        {message ? (
          <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">
            {message}
          </div>
        ) : null}

        {summary?.projectedCut ? (
          <div className="flex items-center justify-between border-y border-amber-700/40 bg-amber-950/25 px-3 py-2.5 text-sm">
            <span className="font-bold text-amber-200">
              {summary.projectedCut.official ? "Cut line" : "Projected cut"}
            </span>
            <span className="font-black text-white">{summary.projectedCut.display}</span>
          </div>
        ) : null}

        <section className="overflow-hidden rounded-2xl border border-emerald-900/70 bg-slate-900">
          {isLoading ? (
            <div className="px-4 py-10 text-center text-sm text-slate-400">
              Loading tournament leaderboard…
            </div>
          ) : rows.length === 0 && tournament ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              {statusLabel === "Upcoming" ? "This tournament has not started. The leaderboard will appear when results are available." : "Leaderboard results are not available for this tournament yet."}
            </div>
          ) : (
            <GolfLiveLeaderboard
              rows={rows}
              projectedCut={summary?.projectedCut}
              currentTournamentRound={summary?.liveTournamentRound}
              onSelect={(row) => {
                const player = playerFromRow(row);
                setSelectedPlayer(player);
                const slateId = Number(slate?.id);
                if (Number.isInteger(slateId) && slateId > 0) {
                  void loadPlayerStats(slateId);
                }
              }}
            />
          )}
        </section>

        <p className="text-center text-xs text-slate-500">
          <Link href="/home?sport=golf" className="font-semibold text-emerald-300">
            Back to Golf Home
          </Link>
        </p>
      </div>

      <ReadOnlyPlayerModal
        key={`${scopeKey}:${slate?.id ?? "no-slate"}`}
        player={summary ? selectedPlayer : null}
        setPlayer={setSelectedPlayer}
        playerAverageMap={EMPTY_AVERAGES}
        playerProjections={EMPTY_PROJECTIONS}
        golfStat={selectedStat}
        golfSlateId={slate?.id ?? null}
        golfStatsLoading={isPlayerStatsLoading}
        golfStatsError={playerStatsError ?? (slate ? null : "Scorecard details are unavailable for this tournament in this Group.")}
      />
    </main>
  );
}
