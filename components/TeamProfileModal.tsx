"use client";

import { useEffect, useState } from "react";

type TeamProfile = {
  success: boolean;
  team: { id: number; name: string };
  latestSeason: number;
  seasonSummary: {
    slatesPlayed: number;
    wins: number;
    runnerUps: number;
    winRate: number | null;
    avgFinish: number | null;
    avgScore: number | null;
    currentWinStreak: number;
    longestWinStreak: number;
  };
  careerSummary: {
    slatesPlayed: number;
    wins: number;
    runnerUps: number;
    winRate: number | null;
    avgFinish: number | null;
    avgScore: number | null;
    bestScore: number | null;
    worstScore: number | null;
    longestWinStreak: number;
    favoritePlayer: { playerName: string; count: number } | null;
    bestAvgPlayer: { playerName: string; avg: number; count: number } | null;
    bestSlate: { slateLabel: string; score: number; finishPosition: number | null } | null;
    worstSlate: { slateLabel: string; score: number; finishPosition: number | null } | null;
  };
  recentSlates: Array<{
    slateId: number;
    slateLabel: string;
    score: number;
    finishPosition: number | null;
    draftPosition: number | null;
    topPlayer: { playerName: string; fantasyPoints: number | null } | null;
  }>;
};

type Props = {
  team: { id: number; name: string } | null;
  setTeam: (team: { id: number; name: string } | null) => void;
};

const TEAM_HEADSHOTS: Record<string, string> = {
  Andy: "/team-headshots/andy.jpg",
  Jon: "/team-headshots/jon.jpg",
  Josh: "/team-headshots/josh.jpg",
  Mark: "/team-headshots/mark.jpg",
};

function fmt(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined) return "—";
  return Number(value).toFixed(digits);
}

function Card({
  label,
  value,
  color = "slate",
  detail,
}: {
  label: string;
  value: string | number;
  color?: "slate" | "green" | "orange" | "red";
  detail?: string;
}) {
  const colorClass =
    color === "green"
      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
      : color === "orange"
        ? "border-orange-200 bg-orange-50 text-orange-900"
        : color === "red"
          ? "border-red-200 bg-red-50 text-red-900"
          : "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`rounded-2xl border p-4 ${colorClass}`}>
      <div className="text-xs font-medium uppercase tracking-wide opacity-75">
        {label}
      </div>
      <div className="mt-2 text-2xl font-bold">{value}</div>
      {detail ? <div className="mt-1 text-xs opacity-70">{detail}</div> : null}
    </div>
  );
}

export default function TeamProfileModal({ team, setTeam }: Props) {
  const [data, setData] = useState<TeamProfile | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!team) {
      setData(null);
      setLoading(false);
      return;
    }

    const currentTeam = team;
    let active = true;

    async function load() {
      try {
        setLoading(true);
        const response = await fetch(`/api/team-profile?teamId=${currentTeam.id}`, {
          cache: "no-store",
        });
        const json = await response.json();
        if (active) setData(json);
      } catch (error) {
        console.error(error);
        if (active) setData(null);
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [team]);

  if (!team) return null;

  const headshot = TEAM_HEADSHOTS[team.name];
  const hasAnyDraftPosition =
    data?.recentSlates?.some((row) => row.draftPosition !== null) ?? false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/60 px-3 py-4 sm:items-center"
      onClick={() => setTeam(null)}
    >
      <div
        className="max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-3xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div className="flex items-center gap-4">
            {headshot ? (
              <img
                src={headshot}
                alt={`${team.name} headshot`}
                className="h-20 w-20 rounded-2xl border border-slate-200 object-cover shadow-sm"
              />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-2xl font-bold text-slate-500">
                {team.name.slice(0, 1)}
              </div>
            )}

            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                Team Profile
              </div>
              <h2 className="mt-1 text-3xl font-bold text-slate-900">
                {team.name}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Owner trends, recent slate results, and draft personality.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setTeam(null)}
            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            Close
          </button>
        </div>

        <div className="max-h-[calc(90vh-112px)] overflow-y-auto p-5">
          {loading || !data ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading team profile...
            </div>
          ) : (
            <div className="space-y-6">
              <section>
                <h3 className="text-xl font-semibold text-slate-900">
                  {data.latestSeason} Season Stats
                </h3>
                <p className="mb-3 text-sm text-slate-500">Current season only.</p>

                <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Card label="Wins" value={data.seasonSummary.wins} color="green" />
                  <Card label="Runner-ups" value={data.seasonSummary.runnerUps} color="orange" />
                  <Card label="Win Rate" value={`${fmt(data.seasonSummary.winRate)}%`} />
                  <Card label="Avg Finish" value={fmt(data.seasonSummary.avgFinish)} />
                  <Card label="Avg Score" value={fmt(data.seasonSummary.avgScore)} />
                  <Card
                    label="Win Streak"
                    value={`Current ${data.seasonSummary.currentWinStreak}`}
                    detail={`Best ${data.seasonSummary.longestWinStreak}`}
                  />
                </div>
              </section>

              <section>
                <h3 className="text-xl font-semibold text-slate-900">Career Stats</h3>
                <p className="mb-3 text-sm text-slate-500">All recorded slates.</p>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Card label="Career Wins" value={data.careerSummary.wins} color="green" />
                  <Card label="Career Runner-ups" value={data.careerSummary.runnerUps} color="orange" />
                  <Card label="Career Avg Finish" value={fmt(data.careerSummary.avgFinish)} />
                  <Card label="Career Avg Score" value={fmt(data.careerSummary.avgScore)} />
                  <Card
                    label="Favorite Player"
                    value={data.careerSummary.favoritePlayer?.playerName ?? "—"}
                    detail={
                      data.careerSummary.favoritePlayer
                        ? `${data.careerSummary.favoritePlayer.count} drafts`
                        : undefined
                    }
                  />
                  <Card
                    label="Best Avg Player"
                    value={data.careerSummary.bestAvgPlayer?.playerName ?? "—"}
                    detail={
                      data.careerSummary.bestAvgPlayer
                        ? `${fmt(data.careerSummary.bestAvgPlayer.avg)} FP over ${data.careerSummary.bestAvgPlayer.count}`
                        : undefined
                    }
                  />
                  <Card
                    label="Best Slate"
                    value={data.careerSummary.bestSlate ? fmt(data.careerSummary.bestSlate.score) : "—"}
                    detail={data.careerSummary.bestSlate?.slateLabel}
                    color="green"
                  />
                  <Card
                    label="Worst Slate"
                    value={data.careerSummary.worstSlate ? fmt(data.careerSummary.worstSlate.score) : "—"}
                    detail={data.careerSummary.worstSlate?.slateLabel}
                    color="red"
                  />
                </div>
              </section>

              <section>
                <h3 className="text-xl font-semibold text-slate-900">
                  Recent Slate Box Scores
                </h3>

                <div className="mt-3 overflow-hidden rounded-2xl border border-slate-200">
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-100 text-slate-700">
                        <tr className="text-left">
                          <th className="px-3 py-2">Slate</th>
                          <th className="px-3 py-2">Finish</th>
                          <th className="px-3 py-2 text-right">Score</th>
                          {hasAnyDraftPosition ? (
                            <th className="px-3 py-2 text-right">Draft Pos</th>
                          ) : null}
                          <th className="px-3 py-2">Top NBA Player</th>
                          <th className="px-3 py-2 text-right">Top FP</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.recentSlates.map((row) => (
                          <tr key={row.slateId} className="border-t border-slate-100">
                            <td className="px-3 py-2">{row.slateLabel}</td>
                            <td className="px-3 py-2">
                              {row.finishPosition ? `#${row.finishPosition}` : "—"}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">
                              {fmt(row.score)}
                            </td>
                            {hasAnyDraftPosition ? (
                              <td className="px-3 py-2 text-right">
                                {row.draftPosition ? `#${row.draftPosition}` : "—"}
                              </td>
                            ) : null}
                            <td className="px-3 py-2">{row.topPlayer?.playerName ?? "—"}</td>
                            <td className="px-3 py-2 text-right">
                              {fmt(row.topPlayer?.fantasyPoints)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
