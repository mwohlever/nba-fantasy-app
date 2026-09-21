"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";

type ChallengeDetail = {
  group: {
    id: string;
    name: string;
    slug: string;
  };
  contest: {
    id: string;
    status: string;
  };
  competition: {
    id: number;
    sportKey: string;
    formatKey: string;
    season: number;
    name: string;
    status: string;
  };
};

export default function BracketChallengeLivePage() {
  const params = useParams<{ contestId: string }>();
  const contestId = params.contestId;

  const [detail, setDetail] = useState<ChallengeDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError("");

      try {
        const response = await fetch(
          `/api/bracket-challenge/contests/${contestId}`,
          { cache: "no-store" },
        );

        const result = await response.json();

        if (!response.ok) {
          throw new Error(
            result?.error ?? "Unable to load live scores.",
          );
        }

        if (!cancelled) {
          setDetail(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load live scores.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [contestId]);

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <AppNav />
          <p className="text-sm text-slate-400">Loading live scores…</p>
        </div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
        <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />
        <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
          {error || "Unable to load live scores."}
        </div>
      </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
        <div className="mx-auto max-w-5xl space-y-6">
      <AppNav />
      <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
          Bracket Challenge · {detail.group.name}
        </p>

        <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
          Live Scores
        </h1>

        <p className="mt-2 text-sm text-slate-300">
          {detail.competition.name}
        </p>

        <div className="mt-5 rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-5">
          <div className="font-bold text-white">
            Tournament games will live here.
          </div>

          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
            This page will use the shared college-football live score and
            Game Center architecture once the CFP field and ESPN event
            mappings are connected.
          </p>
        </div>
      </section>
      </div>
    </main>
  );
}
