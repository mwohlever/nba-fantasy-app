"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import AppNav from "@/components/AppNav";
import ReadOnlyPlayerModal from "@/components/lineups/ReadOnlyPlayerModal";
import type { Player, PlayerStat } from "@/components/lineups/types";
import GolfLiveLeaderboard, {
  type GolfLiveLeaderboardRow,
} from "@/components/golf/GolfLiveLeaderboard";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { useSelectedSport } from "@/components/providers/SportProvider";
import { refreshGolfFromBrowser } from "@/lib/client/refreshGolfFromBrowser";
import type { GolfCutLine } from "@/lib/golf/cutLine";
import { usePullToRefresh } from "@/lib/client/usePullToRefresh";
import type { RefreshOutcome } from "@/lib/client/refreshOutcome";
import PullToRefreshIndicator from "@/components/ui/PullToRefreshIndicator";

type GolfLiveSummary = {
  latestSlate: {
    id: number;
    label: string;
    start_date: string;
    end_date: string;
    is_locked: boolean;
  } | null;
  latestGolfTournamentIsFinal?: boolean;
  tournamentLeaderboard?: GolfLiveLeaderboardRow[];
  projectedCut?: GolfCutLine | null;
};

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
  const [summary, setSummary] = useState<GolfLiveSummary | null>(null);
  const [playerStats, setPlayerStats] = useState<PlayerStat[]>([]);
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const requestRef = useRef(0);
  const surfaceRef = useRef<HTMLElement | null>(null);
  const refreshingRef = useRef(false);
  const scopeRef = useRef(groupContext?.group.id);
  scopeRef.current = groupContext?.group.id;

  useEffect(() => {
    if (selectedSport !== "golf") setSelectedSport("golf");
  }, [selectedSport, setSelectedSport]);

  const loadSummary = useCallback(async () => {
    if (!groupContext?.group.id || isGroupLoading || isSwitchingGroup) return;
    const requestId = ++requestRef.current;

    try {
      setIsLoading(true);
      setMessage("");
      const response = await fetch("/api/home-summary?sport=golf", {
        cache: "no-store",
      });
      const result = await response.json();
      if (requestId !== requestRef.current) return;
      if (!response.ok) throw new Error(result.error || "Golf Live is unavailable.");

      setSummary(result);
      const slateId = Number(result.latestSlate?.id);
      if (Number.isInteger(slateId) && slateId > 0) {
        const statsResponse = await fetch(`/api/player-stats?slateId=${slateId}`, {
          cache: "no-store",
        });
        const statsResult = await statsResponse.json();
        if (requestId !== requestRef.current) return;
        setPlayerStats(statsResponse.ok ? statsResult.playerStats ?? [] : []);
      } else {
        setPlayerStats([]);
      }
    } catch (error) {
      if (requestId !== requestRef.current) return;
      setMessage(error instanceof Error ? error.message : "Golf Live is unavailable.");
      setSummary(null);
      setPlayerStats([]);
    } finally {
      if (requestId === requestRef.current) setIsLoading(false);
    }
  }, [groupContext?.group.id, isGroupLoading, isSwitchingGroup]);

  useEffect(() => {
    setSelectedPlayer(null);
    void loadSummary();
    return () => {
      requestRef.current += 1;
    };
  }, [loadSummary]);

  async function refreshLive(): Promise<RefreshOutcome> {
    const slateId = summary?.latestSlate?.id;
    if (!slateId || refreshingRef.current || isGroupLoading || isSwitchingGroup) return { status: "skipped" };
    const scope = scopeRef.current;
    refreshingRef.current = true;
    try {
      setIsRefreshing(true);
      setMessage("");
      await refreshGolfFromBrowser(slateId);
      if (scope !== scopeRef.current) return { status: "skipped" };
      await loadSummary();
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
    enabled: Boolean(summary?.latestSlate && !isLoading && !isGroupLoading && !isSwitchingGroup && !selectedPlayer),
    isRefreshing, scopeKey: `${groupContext?.group.id}:${summary?.latestSlate?.id}` });

  const rows = summary?.tournamentLeaderboard ?? [];
  const selectedStat = selectedPlayer
    ? playerStats.find((stat) => Number(stat.player_id) === selectedPlayer.id) ?? null
    : null;
  const slate = summary?.latestSlate ?? null;
  const statusLabel =
    summary?.latestGolfTournamentIsFinal
      ? "Final"
      : rows.some((row) => row.statusState === "playing")
        ? "Live"
        : "Tournament";

  return (
    <main ref={surfaceRef} className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <AppNav />
        <PullToRefreshIndicator pull={pull} feedback={isRefreshing ? "Refreshing…" : ""} />

        <header className="flex items-end justify-between gap-3 border-b border-emerald-900/70 pb-4">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-400">
              Golf Live
            </p>
            <h1 className="mt-1 truncate text-2xl font-black text-white sm:text-3xl">
              {slate?.label ?? "Tournament Leaderboard"}
            </h1>
            <p className="mt-1 text-xs text-slate-400">
              {slate ? `${slate.start_date} – ${slate.end_date} · ${statusLabel}` : "No active Golf slate"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshLive()}
            disabled={!slate || isRefreshing || isLoading}
            className="shrink-0 rounded-xl border border-emerald-700 bg-emerald-950 px-3 py-2 text-xs font-bold text-emerald-100 transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isRefreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
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
              Loading accepted tournament state…
            </div>
          ) : (
            <GolfLiveLeaderboard
              rows={rows}
              onSelect={(row) => setSelectedPlayer(playerFromRow(row))}
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
        player={selectedPlayer}
        setPlayer={setSelectedPlayer}
        playerAverageMap={EMPTY_AVERAGES}
        playerProjections={EMPTY_PROJECTIONS}
        golfStat={selectedStat}
        golfSlateId={slate?.id ?? null}
      />
    </main>
  );
}
