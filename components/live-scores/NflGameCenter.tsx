"use client";
import { useCallback, useEffect } from "react";
import { useLiveRequest } from "@/lib/live-scores/useLiveRequest";
import { useNflLiveScope } from "@/lib/live-scores/useNflLiveScope";
import { validNflEventId, type GameCenterTab, type NflCalendarContext } from "@/lib/live-scores/urlState";
import FootballGameCenter, { type FootballGameDetail } from "./FootballGameCenter";

function validateDetail(body: FootballGameDetail, eventId: string) {
  return body.eventId === eventId && body.game?.espnEventId === eventId
    ? null : "This NFL game is unavailable. Return to games and choose another matchup.";
}

export default function NflGameCenter({ viewerId, eventId, tab, period, statsTeam, onDetailChange, onBack, onCalendar }: {
  viewerId: string; eventId: string; tab: GameCenterTab; period: number | null; statsTeam: string | null;
  onDetailChange: (change: { tab?: GameCenterTab; period?: number | null; statsTeam?: string }) => void;
  onBack: () => void;
  onCalendar: (calendar: NflCalendarContext) => void;
}) {
  const scope = useNflLiveScope(viewerId);
  const validId = validNflEventId(eventId);
  const url = scope && validId ? `/api/live-scores/nfl/game-detail?eventId=${encodeURIComponent(eventId)}&groupId=${encodeURIComponent(scope.groupId)}&leagueId=${encodeURIComponent(scope.leagueId)}&viewerId=${encodeURIComponent(viewerId)}` : null;
  const validate = useCallback((body: FootballGameDetail) => validateDetail(body, eventId), [eventId]);
  const request = useLiveRequest<FootballGameDetail>(scope ? { ...scope, resource: eventId } : null, url, validate);
  useEffect(() => {
    if (request.data?.liveContext) onCalendar(request.data.liveContext);
  }, [request.data?.liveContext, onCalendar]);
  const isLive = request.data?.header?.competitions?.[0]?.status?.type?.state === "in";
  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => void request.refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [isLive, request.refresh]);

  const game = request.data?.game;
  if (!game) return <section className="bg-white p-4">
    <button type="button" onClick={onBack} className="text-xs font-bold text-sky-700">← Back to games</button>
    {!validId || request.error ? <p role="alert" className="mt-4 text-sm text-rose-700">{!validId ? "This NFL game link is invalid." : request.error} Return to NFL games to choose a matchup.</p>
      : <p className="py-8 text-center text-sm text-slate-500">Loading game details…</p>}
  </section>;
  return <FootballGameCenter game={game} apiBase="/api/live-scores/nfl" fantasyScope={scope}
    request={request} presentation="inline" tab={tab} onTabChange={value => onDetailChange({ tab: value })}
    period={period} onPeriodChange={value => onDetailChange({ period: value })}
    statsTeam={statsTeam} onStatsTeamChange={value => onDetailChange({ statsTeam: value })} onClose={onBack} />;
}
