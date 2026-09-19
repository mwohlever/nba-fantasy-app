"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import CfpFieldSetup from "./CfpFieldSetup";

type ChallengeDetail = {
  group: {
    id: string;
    name: string;
    slug: string;
  };
  league: {
    id: string;
    name: string;
    slug: string;
  };
  contest: {
    id: string;
    status: string;
    lockAt: string | null;
    maxBracketsPerEntrant: number;
    rulesVersion: number;
    rulesSnapshot: Record<string, unknown>;
  };
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
  games: unknown[];
  canManageCompetitionField: boolean;
};

function formatStatus(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function BracketChallengeHomePage() {
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
            result?.error ?? "Unable to load bracket challenge.",
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
              : "Unable to load bracket challenge.",
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
        <div className="mx-auto max-w-5xl">
          <p className="text-sm text-slate-400">Loading challenge…</p>
        </div>
      </main>
    );
  }

  if (error || !detail) {
    return (
      <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
        <div className="mx-auto max-w-5xl">
        <div className="rounded-2xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">
          {error || "Unable to load bracket challenge."}
        </div>
      </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
        <div className="mx-auto max-w-5xl">
      <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
              Bracket Challenge · {detail.group.name}
            </p>

            <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
              {detail.competition.name}
            </h1>

            <p className="mt-1 text-sm text-slate-400">
              {detail.competition.sportKey === "college_football"
                ? "College Football"
                : detail.competition.sportKey.replaceAll("_", " ")}
              {" · "}
              {detail.games.length} games
            </p>
          </div>

          <span className="rounded-full bg-blue-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-blue-200">
            {formatStatus(detail.contest.status)}
          </span>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <Link
            href={`/bracket-challenge/${contestId}/bracket`}
            className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4 transition hover:border-blue-400/60 hover:bg-slate-900"
          >
            <div className="text-lg font-black text-white">
              My Bracket
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Make, edit, and review your tournament picks.
            </p>
          </Link>

          <Link
            href={`/bracket-challenge/${contestId}/live`}
            className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4 transition hover:border-blue-400/60 hover:bg-slate-900"
          >
            <div className="text-lg font-black text-white">
              Live Scores
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Follow tournament games and results.
            </p>
          </Link>

          <div className="rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
            <div className="text-lg font-black text-white">
              Leaderboard
            </div>
            <p className="mt-1 text-sm text-slate-400">
              Pool standings will appear here once entries are submitted.
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-slate-700/70 bg-slate-950/40 p-4">
          <div className="text-sm font-bold text-white">
            Challenge setup
          </div>

          <div className="mt-2 grid gap-2 text-sm text-slate-400 sm:grid-cols-2">
            <div>
              Max brackets per entrant:{" "}
              <span className="font-semibold text-slate-100">
                {detail.contest.maxBracketsPerEntrant}
              </span>
            </div>

            <div>
              Competition status:{" "}
              <span className="font-semibold text-slate-100">
                {formatStatus(detail.competition.status)}
              </span>
            </div>
          </div>

          {detail.canManageCompetitionField && detail.competition.formatKey === "cfp" ? (
            <CfpFieldSetup competitionId={detail.competition.id} />
          ) : null}
        </div>
      </section>
      </div>
    </main>
  );
}
