"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import AppNav from "@/components/AppNav";

type CompetitionSummary = {
  contestId: string;
  contestStatus: string;
  contestLockAt: string | null;
  maxBracketsPerEntrant: number;
  rulesVersion: number;
  rulesSnapshot: Record<string, unknown>;
  competition: {
    id: number;
    sportKey: string;
    formatKey: string;
    season: number;
    name: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
  };
};

type CompetitionsResponse = {
  success?: boolean;
  group?: {
    id: string;
    name: string;
    slug: string;
  };
  competitions?: CompetitionSummary[];
  error?: string;
};

function statusLabel(status: string) {
  if (status === "open") return "Open";
  if (status === "locked") return "Locked";
  if (status === "in_progress") return "Live";
  if (status === "final") return "Final";
  return "Setup";
}

function competitionDescription(competition: CompetitionSummary) {
  if (
    competition.competition.formatKey === "cfp"
  ) {
    return "College Football · 12-team playoff";
  }

  return competition.competition.sportKey
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default function BracketChallengePage() {
  const [data, setData] =
    useState<CompetitionsResponse | null>(null);
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const response = await fetch(
          "/api/bracket-challenge/competitions",
          { cache: "no-store" },
        );

        const result =
          (await response.json()) as CompetitionsResponse;

        if (!response.ok) {
          throw new Error(
            result.error ??
              "Unable to load Bracket Challenge.",
          );
        }

        if (!cancelled) {
          setData(result);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load Bracket Challenge.",
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
  }, []);

  const competitions =
    data?.competitions ?? [];

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-7">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
            111 Sports
          </div>

          <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
            Bracket Challenge
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Build tournament brackets, compete with your Group,
            and follow every round from one place.
          </p>

          {data?.group?.name ? (
            <div className="mt-4 text-xs font-bold uppercase tracking-[0.16em] text-slate-400">
              {data.group.name}
            </div>
          ) : null}
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                Active Challenges
              </div>
              <h2 className="mt-1 text-xl font-black text-white">
                Your brackets
              </h2>
            </div>
          </div>

          {loading ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
              Loading challenges…
            </div>
          ) : error ? (
            <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-200">
              {error}
            </div>
          ) : competitions.length === 0 ? (
            <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
              <div className="font-bold text-white">
                No active challenges
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-400">
                This Group does not have a tournament challenge
                set up yet.
              </p>
            </div>
          ) : (
            <div className="grid gap-3">
              {competitions.map((item) => (
                <Link
                  key={item.contestId}
                  href={`/bracket-challenge/${encodeURIComponent(
                    item.contestId,
                  )}`}
                  className="group rounded-2xl border border-slate-700/70 bg-[linear-gradient(145deg,rgba(15,23,42,0.96),rgba(15,23,42,0.72))] p-4 transition hover:-translate-y-0.5 hover:border-blue-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[10px] font-black uppercase tracking-[0.18em] text-blue-300">
                        {item.competition.season}
                      </div>

                      <h3 className="mt-1 text-lg font-black text-white">
                        {item.competition.name}
                      </h3>

                      <p className="mt-1 text-sm text-slate-400">
                        {competitionDescription(item)}
                      </p>
                    </div>

                    <span className="shrink-0 rounded-full bg-blue-300/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-blue-200">
                      {statusLabel(item.contestStatus)}
                    </span>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-700/70 pt-3">
                    <span className="text-xs text-slate-400">
                      Up to {item.maxBracketsPerEntrant}{" "}
                      {item.maxBracketsPerEntrant === 1
                        ? "bracket"
                        : "brackets"}{" "}
                      per entrant
                    </span>

                    <span className="text-xs font-bold text-blue-300">
                      View Challenge{" "}
                      <span
                        aria-hidden="true"
                        className="inline-block transition group-hover:translate-x-0.5"
                      >
                        →
                      </span>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
