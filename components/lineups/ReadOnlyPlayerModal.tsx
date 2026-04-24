"use client";

import { useEffect, useState } from "react";
import type { Player } from "@/components/lineups/types";

type Profile = {
  player: {
    id: number;
    name: string;
    position_group: string | null;
  };
  summary: {
    timesDrafted: number;
    wins: number;
    runnerUps: number;
    winRate: number | null;
    draftedMostBy: { teamName: string; count: number } | null;
    draftedByBreakdown: Array<{ teamName: string; count: number }>;
    averageFantasyPoints: number | null;
    bestFantasyPoints: number | null;
    worstFantasyPoints: number | null;
  };
  recentHistory: Array<{
    slateLabel: string;
    teamName: string;
    finishPosition: number | null;
    points: number;
    rebounds: number;
    assists: number;
    steals: number;
    blocks: number;
    turnovers: number;
    fantasyPoints: number | null;
  }>;
};

type Props = {
  player: Player | null;
  setPlayer: (p: Player | null) => void;
  playerAverageMap: Map<number, number>;
};

function fmt(value: number | null | undefined) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(1);
}

export default function ReadOnlyPlayerModal({ player, setPlayer, playerAverageMap }: Props) {
  const [data, setData] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!player) return;

    async function load() {
      setLoading(true);
      const res = await fetch(`/api/player-league-profile?playerId=${player!.id}`, {
        cache: "no-store",
      });
      const json = await res.json();
      setData(json);
      setLoading(false);
    }

    void load();
  }, [player]);

  if (!player) return null;

  const displayPosition = data?.player?.position_group ?? player.position_group ?? "—";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 px-3 py-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
              Player Profile
            </div>
            <h2 className="mt-1 text-2xl font-bold text-slate-900">{player.name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              {displayPosition} • Season avg {fmt(playerAverageMap.get(player.id))}
            </p>
          </div>

          <button
            type="button"
            onClick={() => setPlayer(null)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="max-h-[calc(90vh-88px)] overflow-y-auto p-5">
          {loading || !data ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading player profile...
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-5">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs uppercase text-slate-500">Drafted</div>
                  <div className="mt-2 text-2xl font-bold">{data.summary.timesDrafted}</div>
                </div>
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="text-xs uppercase text-emerald-700">Wins</div>
                  <div className="mt-2 text-2xl font-bold">{data.summary.wins}</div>
                </div>
                <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4">
                  <div className="text-xs uppercase text-sky-700">Win Rate</div>
                  <div className="mt-2 text-2xl font-bold">{fmt(data.summary.winRate)}%</div>
                </div>
                <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
                  <div className="text-xs uppercase text-orange-700">Runner-ups</div>
                  <div className="mt-2 text-2xl font-bold">{data.summary.runnerUps}</div>
                </div>
                <div className="rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
                  <div className="text-xs uppercase text-indigo-700">Drafted Most By</div>
                  <div className="mt-2 text-lg font-bold">
                    {data.summary.draftedMostBy
                      ? `${data.summary.draftedMostBy.teamName} (${data.summary.draftedMostBy.count})`
                      : "—"}
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase text-slate-500">Avg When Drafted</div>
                  <div className="mt-2 text-xl font-semibold">{fmt(data.summary.averageFantasyPoints)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase text-slate-500">Best</div>
                  <div className="mt-2 text-xl font-semibold">{fmt(data.summary.bestFantasyPoints)}</div>
                </div>
                <div className="rounded-2xl border border-slate-200 p-4">
                  <div className="text-xs uppercase text-slate-500">Worst</div>
                  <div className="mt-2 text-xl font-semibold">{fmt(data.summary.worstFantasyPoints)}</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-lg font-semibold text-slate-900">Drafted By Breakdown</h3>
                {data.summary.draftedByBreakdown.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No draft history yet.</p>
                ) : (
                  <div className="mt-3 grid gap-2 sm:grid-cols-4">
                    {data.summary.draftedByBreakdown.map((row) => (
                      <div
                        key={row.teamName}
                        className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                      >
                        <div className="font-semibold text-slate-900">{row.teamName}</div>
                        <div className="text-sm text-slate-500">{row.count} draft(s)</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-lg font-semibold text-slate-900">Recent Box Scores</h3>
                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr className="text-left">
                          <th className="px-3 py-2">Slate</th>
                          <th className="px-3 py-2">Team</th>
                          <th className="px-3 py-2">Finish</th>
                          <th className="px-3 py-2 text-right">PTS</th>
                          <th className="px-3 py-2 text-right">REB</th>
                          <th className="px-3 py-2 text-right">AST</th>
                          <th className="px-3 py-2 text-right">STL</th>
                          <th className="px-3 py-2 text-right">BLK</th>
                          <th className="px-3 py-2 text-right">TO</th>
                          <th className="px-3 py-2 text-right">FP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentHistory.map((row, i) => (
                          <tr key={`${row.slateLabel}-${i}`} className="border-t border-slate-100">
                            <td className="px-3 py-2">{row.slateLabel}</td>
                            <td className="px-3 py-2">{row.teamName}</td>
                            <td className="px-3 py-2">{row.finishPosition ? `#${row.finishPosition}` : "—"}</td>
                            <td className="px-3 py-2 text-right">{row.points}</td>
                            <td className="px-3 py-2 text-right">{row.rebounds}</td>
                            <td className="px-3 py-2 text-right">{row.assists}</td>
                            <td className="px-3 py-2 text-right">{row.steals}</td>
                            <td className="px-3 py-2 text-right">{row.blocks}</td>
                            <td className="px-3 py-2 text-right">{row.turnovers}</td>
                            <td className="px-3 py-2 text-right font-semibold">{fmt(row.fantasyPoints)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
