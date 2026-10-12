"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import type { ImplicationSubject } from "@/lib/bracket/gameImplications.server";

import AppNav from "@/components/AppNav";
import BracketLiveScoreCard, {
  type BracketLiveScoreCardGame,
} from "@/components/bracket/BracketLiveScoreCard";
import BracketGameCenterDevHarness, { developmentGame } from "@/components/bracket/BracketGameCenterDevHarness";
import BracketGameCenter from "@/components/bracket/BracketGameCenter";
import { bracketLiveSearch, parseBracketLiveState } from "@/lib/bracket/liveState";

type LiveScoresResponse = {
  success?: boolean;
  error?: string;
  group: { id: string; name: string; slug: string };
  contest: { id: string; status: string; lockAt: string | null };
  competition: { id: number; season: number; name: string; status: string };
  provider: { availability: "available" | "unavailable" };
  rounds: Array<{ key: string; label: string; order: number }>;
  games: Array<BracketLiveScoreCardGame & {
    bracketGameId: number;
    roundKey: string;
    roundOrder: number;
    regionKey: string | null;
    providerEventId: string | null;
  }>;
};

function dateKey(scheduledAt: string | null) {
  if (!scheduledAt) return null;
  return new Date(scheduledAt).toLocaleDateString("en-US", {
    year: "numeric", month: "2-digit", day: "2-digit",
  });
}

function dateLabel(scheduledAt: string) {
  return new Date(scheduledAt).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}

function orderedRoundGames(games: LiveScoresResponse["games"], roundKey: string) {
  return games.filter((game) => game.roundKey === roundKey).sort((left, right) => {
    const leftTime = left.scheduledAt ? new Date(left.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    const rightTime = right.scheduledAt ? new Date(right.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
    return leftTime - rightTime || left.gameOrder - right.gameOrder;
  });
}

function BracketChallengeLivePage() {
  const { contestId } = useParams<{ contestId: string }>();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const state = useMemo(() => parseBracketLiveState(search), [search]);
  const navigate = useCallback((change: Parameters<typeof bracketLiveSearch>[1], replace = false) => {
    const next = bracketLiveSearch(window.location.search, change);
    window.history[replace ? "replaceState" : "pushState"](null, "", `?${next}`);
  }, []);
  const selectSubject = useCallback((subject: ImplicationSubject | null, replace = false) => navigate({ subject }, replace), [navigate]);
  const backToGames = () => navigate({ gameId: null, devEventId: null });
  const [data, setData] = useState<LiveScoresResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const requestRef = useRef<AbortController | null>(null);
  const tournamentGame = data?.contest.id === contestId ? data.games.find((game) => game.gameKey === state.gameId) : undefined;
  const developmentEventId = process.env.NODE_ENV !== "production" ? process.env.NEXT_PUBLIC_BRACKET_GAME_CENTER_DEV_EVENT_ID : undefined;
  const developmentHarness = state.devEventId !== null && state.devEventId === developmentEventId && state.gameId === null;
  const selectedGame = developmentHarness ? developmentGame(state.devEventId!) : tournamentGame?.provider.mappingState === "valid" ? tournamentGame.provider.game ?? null : null;
  const detailRequested = state.gameId !== null || state.devEventId !== null;

  const load = useCallback(async (initial = false) => {
    if (!contestId || (!initial && requestRef.current)) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    if (initial) setLoading(true);
    setError("");

    try {
      // The explicit authenticated POST is the only provider-to-official write boundary.
      // A failed sync must not hide the read-only live scoreboard.
      await fetch(`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}/sync-results`, {
        method: "POST", cache: "no-store", signal: controller.signal,
      }).catch(() => undefined);
      const response = await fetch(`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}/live`, {
        cache: "no-store", signal: controller.signal,
      });
      const result = (await response.json()) as LiveScoresResponse;
      if (!response.ok) throw new Error(result.error ?? "Unable to load live scores.");
      if (!controller.signal.aborted) setData(result);
    } catch (loadError) {
      if (!controller.signal.aborted) {
        setError(loadError instanceof Error ? loadError.message : "Unable to load live scores.");
      }
    } finally {
      if (requestRef.current !== controller) return;
      requestRef.current = null;
      if (initial) setLoading(false);
    }
  }, [contestId]);

  useEffect(() => {
    void load(true);
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [load]);

  const hasLiveGame = Boolean(data?.games.some((game) =>
    game.provider.mappingState === "valid" && game.provider.game?.status === "in",
  ));

  useEffect(() => {
    const interval = window.setInterval(() => { void load(); }, hasLiveGame ? 20_000 : 120_000);
    return () => window.clearInterval(interval);
  }, [hasLiveGame, load]);

  const rounds = useMemo(
    () => data?.rounds.slice().sort((left, right) => left.order - right.order) ?? [],
    [data?.rounds],
  );

  if ((loading && !data) || (data && data.contest.id !== contestId)) {
    return <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6"><div className="mx-auto max-w-5xl space-y-6"><AppNav /><p className="text-sm text-slate-400">Loading live scores…</p></div></main>;
  }

  if (!data) {
    return <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6"><div className="mx-auto max-w-5xl space-y-6"><AppNav /><p className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">{error || "Unable to load live scores."}</p></div></main>;
  }

  return (
    <main className="bracket-live-page min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />
        <header>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">Bracket Challenge · {data.group.name}</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-white sm:text-3xl">Live Scores</h1>
          <p className="mt-1 text-sm text-slate-400">{data.competition.name} · {data.competition.season} season</p>
        </header>
        {data.provider.availability === "unavailable" ? <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-sm text-amber-100">Live game data is temporarily unavailable. The official tournament schedule is still shown below.</p> : null}
        {error ? <p className="rounded-xl border border-amber-400/20 bg-amber-400/5 px-3 py-2 text-sm text-amber-100">Live game data could not be refreshed. Showing the latest available tournament slate.</p> : null}
        {detailRequested ? tournamentGame || developmentHarness ? <BracketGameCenter
          key={`${contestId}:${state.gameId ?? state.devEventId}`} contestId={contestId} game={selectedGame}
          gameId={tournamentGame?.gameKey} developmentHarness={developmentHarness}
          matchup={tournamentGame} onRefresh={() => { void load(); }}
          gameLabel={tournamentGame ? `${rounds.find((round) => round.key === tournamentGame.roundKey)?.label ?? "CFP"} · Game ${tournamentGame.gameOrder}` : undefined}
          tab={state.tab} onTabChange={(tab) => navigate({ tab })} selection={state.selection}
          selectionRequested={state.selectionRequested} onSelectionChange={selectSubject} onBack={backToGames}
        /> : <section className="rounded-xl bg-white p-4 text-slate-700">
          <button type="button" aria-label="Back to games" onClick={backToGames} className="text-xs font-bold text-sky-700">← Back to games</button>
          <p role="alert" className="mt-3 text-sm">This game is unavailable in this CFP contest. Return to games and choose a matchup.</p>
        </section> : <>
        <BracketGameCenterDevHarness onOpen={(game) => navigate({ devEventId: game.espnEventId, gameId: null, tab: state.tab })} />

        {rounds.length ? <section className="space-y-7">
          {rounds.map((round) => {
            const games = orderedRoundGames(data.games, round.key);
            const scheduledDates = new Set(games.map((game) => dateKey(game.scheduledAt)).filter(Boolean));
            const showDateHeadings = scheduledDates.size > 1;
            let previousDate: string | null = null;

            return <section key={round.key} className="space-y-3">
              <div className="flex items-center gap-3"><h2 className="text-lg font-black text-white">{round.label}</h2><span className="h-px flex-1 bg-slate-800" /><span className="text-xs font-semibold text-slate-500">{games.length} game{games.length === 1 ? "" : "s"}</span></div>
              <div className="grid gap-3 lg:grid-cols-2">
                {games.map((game) => {
                  const gameDate = dateKey(game.scheduledAt);
                  const showDate = showDateHeadings && gameDate !== previousDate;
                  previousDate = gameDate;
                  return <div key={game.bracketGameId} className="min-w-0">
                    {showDate && game.scheduledAt ? <p className="mb-1 px-1 text-[11px] font-black uppercase tracking-wide text-slate-500">{dateLabel(game.scheduledAt)}</p> : null}
                    <BracketLiveScoreCard game={game} onOpenGameCenter={() => navigate({ gameId: game.gameKey, devEventId: null, tab: state.tab })} onOpenImplications={() => navigate({ gameId: game.gameKey, devEventId: null, tab: "implications" })} />
                  </div>;
                })}
              </div>
            </section>;
          })}
        </section> : <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-sm text-slate-400">Tournament games are not available yet.</section>}
        </>}
      </div>

    </main>
  );
}

export default function BracketChallengeLivePageWithSuspense() {
  return <Suspense fallback={<p className="p-4 text-slate-400">Loading live scores…</p>}><BracketChallengeLivePage /></Suspense>;
}
