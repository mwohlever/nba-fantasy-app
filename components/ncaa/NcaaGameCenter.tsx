"use client";
import { useCallback, useEffect } from "react";
import FootballGameCenter, { type FootballGameDetail } from "@/components/live-scores/FootballGameCenter";
import type { NcaaScoreGame } from "./NcaaScoreCard";
import { useLiveRequest, type LiveRequestIdentity } from "@/lib/live-scores/useLiveRequest";
import type { GameCenterTab } from "@/lib/live-scores/urlState";

/** Scores supplies the real weekly scoreboard game, including its team logos. */
export default function NcaaGameCenter({ game, scope, tab, period, statsTeam, onDetailChange, onBack }: {
  game: NcaaScoreGame; scope: Omit<Extract<LiveRequestIdentity, { sport: "ncaa" }>, "resource">;
  tab: GameCenterTab; period: number | null; statsTeam: string | null;
  onDetailChange: (change: { tab?: GameCenterTab; period?: number | null; statsTeam?: string }) => void;
  onBack: () => void;
}) {
  const eventId = game.espnEventId;
  const validate = useCallback((body: FootballGameDetail) => body.eventId === eventId
    ? null : "This NCAA game is unavailable. Return to games and choose another matchup.", [eventId]);
  const request = useLiveRequest<FootballGameDetail>({ ...scope, resource: eventId },
    `/api/ncaa-pickem/game-detail?eventId=${encodeURIComponent(eventId)}`, validate);
  const { refresh } = request;
  const isLive = request.data?.header?.competitions?.[0]?.status?.type?.state === "in";
  useEffect(() => {
    if (!isLive) return;
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => window.clearInterval(timer);
  }, [isLive, refresh]);
  return <FootballGameCenter game={game} apiBase="/api/ncaa-pickem" request={request} presentation="inline"
    tab={tab} onTabChange={value => onDetailChange({ tab: value })}
    period={period} onPeriodChange={value => onDetailChange({ period: value })}
    statsTeam={statsTeam} onStatsTeamChange={value => onDetailChange({ statsTeam: value })} onClose={onBack} />;
}
