"use client";

import { useState } from "react";

import FootballGameCenter, { type FootballGameDetail } from "@/components/live-scores/FootballGameCenter";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import BracketGameImplications, { type ImplicationsDataSource } from "./BracketGameImplications";
import BracketMatchupHeader from "./BracketMatchupHeader";
import { unboundBracketGame, type BracketGameCenterMatchup } from "@/lib/bracket/gameCenter";
import type { ImplicationSelection, ImplicationSubject } from "@/lib/bracket/gameImplications.server";
import type { BracketGameCenterTab } from "@/lib/bracket/liveState";
import { refreshedBracketProvider } from "@/lib/bracket/providerContext";

export default function BracketGameCenter({ contestId, game, gameId, gameLabel = "CFP game", selection, selectionRequested, onSelectionChange,
  tab, onTabChange, developmentHarness = false, onBack, matchup, onRefresh, isolatedSource,
}: {
  contestId: string; game: LiveScoreGame | null; gameId?: string;
  gameLabel?: string;
  selection: ImplicationSelection | null; selectionRequested: boolean;
  onSelectionChange: (subject: ImplicationSubject | null, replace?: boolean) => void;
  tab: BracketGameCenterTab; onTabChange: (tab: BracketGameCenterTab) => void;
  developmentHarness?: boolean; onBack: () => void;
  matchup?: BracketGameCenterMatchup;
  onRefresh?: () => void;
  isolatedSource?: { implications: ImplicationsDataSource; detail: FootballGameDetail | null };
}) {
  const [refreshKey, setRefreshKey] = useState(0);
  const refresh = () => { setRefreshKey((value) => value + 1); onRefresh?.(); };
  const implications = (provider: LiveScoreGame | null) => <BracketGameImplications contestId={contestId} gameId={gameId} selection={selection} selectionRequested={selectionRequested} onSelectionChange={onSelectionChange} game={provider} refreshKey={refreshKey} source={isolatedSource?.implications} />;
  const externalRequest = !game || isolatedSource ? { data: isolatedSource?.detail ?? null, loading: false, refreshing: false, error: "", refresh: () => undefined } : undefined;
  return <section className="rounded-xl bg-white text-slate-950" aria-label="CFP Game Center">
    {developmentHarness ? <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-bold text-amber-800">Development ESPN event · not a CFP tournament game</p> : null}
    <p className="border-b border-slate-200 px-4 py-2 text-[11px] font-bold text-slate-500">{gameLabel}</p>
    <FootballGameCenter key={`${contestId}:${game?.espnEventId ?? gameId}`} game={game ?? unboundBracketGame(matchup)} onClose={onBack} presentation="inline"
      request={externalRequest}
      matchupHeader={(detail) => <BracketMatchupHeader matchup={matchup} game={game} detail={detail} />}
      unavailableDetails={isolatedSource ? "This simulation supplies bracket outcomes and scores only. Live stories, plays, and player statistics are not generated." : !game ? "Live game details aren’t available yet for this CFP matchup. Implications still work from the official bracket." : undefined}
      apiBase={`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}`}
      detailQuery={developmentHarness ? "devGameCenter=1" : undefined}
      tab={tab === "implications" ? "summary" : tab} onTabChange={onTabChange}
      extraTab={{ label: "Implications", active: tab === "implications", onSelect: () => onTabChange("implications"),
        onRefresh: refresh,
        content: (detail) => implications(game ? refreshedBracketProvider(game, detail) : null) }} />
  </section>;
}
