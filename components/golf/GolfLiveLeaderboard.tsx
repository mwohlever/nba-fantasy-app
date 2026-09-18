"use client";

import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import type { GolfCutLine } from "@/lib/golf/cutLine";
import { formatGolfLiveProgress } from "@/lib/golf/liveLeaderboard";

export type GolfLiveLeaderboardRow = {
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
  statusState?: string | null;
  teeTime?: string | null;
  currentRound: number | null;
  progressHoles?: number | null;
  lastHole: number | null;
  holesCompleted: number | null;
  currentRoundScore?: number | null;
  currentRoundScoreDisplay?: string | null;
  isDrafted: boolean;
  isCurrentUser?: boolean;
  draftedBy: string[];
  isProjectedCutEligible?: boolean;
};

function scoreLabel(row: GolfLiveLeaderboardRow) {
  if (row.scoreDisplay?.trim()) return row.scoreDisplay;
  if (row.score === null || row.score === undefined) return "—";
  const score = Number(row.score ?? 0);
  return score === 0 ? "E" : score > 0 ? `+${score}` : String(score);
}

export default function GolfLiveLeaderboard({
  rows,
  maxRows,
  onSelect,
  projectedCut,
  currentTournamentRound,
}: {
  rows: GolfLiveLeaderboardRow[];
  maxRows?: number;
  onSelect?: (row: GolfLiveLeaderboardRow) => void;
  projectedCut?: GolfCutLine | null;
  currentTournamentRound?: number | null;
}) {
  const visibleRows = typeof maxRows === "number" ? rows.slice(0, maxRows) : rows;
  const inlineProjectedCut = projectedCut && !projectedCut.official && Number(currentTournamentRound ?? 1) <= 2
    ? projectedCut
    : null;
  const finalProjectedCutIndex = inlineProjectedCut
    ? visibleRows.reduce((index, row, rowIndex) => row.isProjectedCutEligible ? rowIndex : index, -1)
    : -1;

  if (visibleRows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-slate-400">
        Tournament standings will appear after accepted results are refreshed.
      </div>
    );
  }

  return (
    <div>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)_2.8rem_4.2rem] items-center gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">
        <span className="text-center">Pos</span>
        <span>Golfer</span>
        <span className="text-right">Rnd</span>
        <span className="text-right">Total</span>
      </div>

      {visibleRows.map((row, rowIndex) => {
        const progress = formatGolfLiveProgress(row);
        const ownerLabel = row.isCurrentUser
          ? "Your golfer"
          : row.draftedBy.join(", ");

        return (
          <div key={row.playerId}>
          <div
            className={`grid grid-cols-[2rem_minmax(0,1fr)_2.8rem_4.2rem] items-center gap-2 border-b border-slate-800/90 px-3 py-2 ${
              row.isCurrentUser
                ? "bg-emerald-900/55 ring-inset ring-1 ring-emerald-500/35"
                : row.isDrafted
                  ? "bg-emerald-950/30"
                  : "bg-slate-900/75"
            }`}
          >
            <span className="text-center text-sm font-bold text-slate-300">
              {row.position ?? "—"}
            </span>

            <button
              type="button"
              onClick={() => onSelect?.(row)}
              disabled={!onSelect}
              className="flex min-w-0 items-center gap-2 text-left disabled:cursor-default"
            >
              <PlayerHeadshot
                espnGolfPlayerId={row.espnGolfPlayerId}
                imageUrl={row.headshotUrl}
                playerName={row.name}
                size="sm"
              />
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-white">
                  {row.name}
                </span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-slate-400">
                  <span className={progress === "Upcoming" ? "text-slate-500" : "text-emerald-300"}>
                    {progress}
                  </span>
                  {ownerLabel ? (
                    <span
                      className={`truncate rounded px-1.5 py-0.5 ${
                        row.isCurrentUser
                          ? "bg-emerald-400/20 font-bold text-emerald-200"
                          : "bg-slate-800 text-slate-300"
                      }`}
                    >
                      {ownerLabel}
                    </span>
                  ) : null}
                </span>
              </span>
            </button>

            <span className="text-right text-sm font-semibold text-slate-300">
              {row.currentRoundScoreDisplay ?? "—"}
            </span>

            <span className={`text-right text-lg font-black ${row.isCurrentUser ? "text-emerald-300" : "text-white"}`}>
              {scoreLabel(row)}
            </span>
          </div>
          {rowIndex === finalProjectedCutIndex ? (
            <div className="border-b border-amber-700/50 bg-amber-950/30 px-3 py-2 text-center text-[10px] font-black uppercase tracking-wide text-amber-200">
              PROJECTED CUT: {inlineProjectedCut?.display}
            </div>
          ) : null}
          </div>
        );
      })}
    </div>
  );
}
