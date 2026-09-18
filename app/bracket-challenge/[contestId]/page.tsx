"use client";

import Link from "next/link";
import {
  useEffect,
  useState,
} from "react";
import { useParams } from "next/navigation";

import AppNav from "@/components/AppNav";
import BracketTopologyPreview from "@/components/bracket/BracketTopologyPreview";

type Game = {
  id: number;
  gameKey: string;
  roundKey: string;
  roundOrder: number;
  gameOrder: number;
  sourceATeamId: string | null;
  sourceAGameId: number | null;
  sourceASeed: number | null;
  sourceBTeamId: string | null;
  sourceBGameId: number | null;
  sourceBSeed: number | null;
};

type ChallengeResponse = {
  success?: boolean;
  error?: string;
  group?: {
    id: string;
    name: string;
    slug: string;
  };
  contest?: {
    id: string;
    status: string;
    lockAt: string | null;
    maxBracketsPerEntrant: number;
    rulesVersion: number;
    rulesSnapshot: Record<
      string,
      unknown
    >;
  };
  competition?: {
    id: number;
    sportKey: string;
    formatKey: string;
    season: number;
    name: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    topologyVersion: number;
  };
  games?: Game[];
};

function statusLabel(
  status: string,
) {
  if (status === "open")
    return "Open";
  if (status === "locked")
    return "Locked";
  if (status === "in_progress")
    return "Live";
  if (status === "final")
    return "Final";
  return "Setup";
}

export default function BracketChallengeDetailPage() {
  const params = useParams<{
    contestId: string;
  }>();

  const contestId =
    params.contestId;

  const [data, setData] =
    useState<ChallengeResponse | null>(
      null,
    );
  const [loading, setLoading] =
    useState(true);
  const [error, setError] =
    useState("");
  const [picks, setPicks] =
    useState<Record<string, string | null | undefined>>({});
  const [masterBracketId, setMasterBracketId] =
    useState<string | null>(null);
  const [savingGameKey, setSavingGameKey] =
    useState<string | null>(null);
  const [saveError, setSaveError] =
    useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError("");

        const [
          response,
          masterResponse,
        ] = await Promise.all([
          fetch(
            `/api/bracket-challenge/contests/${encodeURIComponent(
              contestId,
            )}`,
            {
              cache: "no-store",
            },
          ),
          fetch(
            `/api/bracket-challenge/contests/${encodeURIComponent(
              contestId,
            )}/master-bracket`,
            {
              cache: "no-store",
            },
          ),
        ]);

        const result =
          (await response.json()) as ChallengeResponse;

        const masterResult =
          (await masterResponse.json()) as {
            success?: boolean;
            error?: string;
            masterBracket?: {
              id: string;
              picks: Record<
                string,
                string | null | undefined
              >;
            };
          };

        if (!response.ok) {
          throw new Error(
            result.error ??
              "Unable to load challenge.",
          );
        }

        if (!masterResponse.ok) {
          throw new Error(
            masterResult.error ??
              "Unable to load your bracket.",
          );
        }

        if (!cancelled) {
          setData(result);
          setPicks(
            masterResult.masterBracket
              ?.picks ?? {},
          );
          setMasterBracketId(
            masterResult.masterBracket
              ?.id ?? null,
          );
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof
              Error
              ? loadError.message
              : "Unable to load challenge.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    if (contestId) {
      void load();
    }

    return () => {
      cancelled = true;
    };
  }, [contestId]);

  async function handlePick(
    gameKey: string,
    teamId: string,
  ) {
    if (
      !contestId ||
      savingGameKey
    ) {
      return;
    }

    try {
      setSavingGameKey(gameKey);
      setSaveError("");

      const response =
        await fetch(
          `/api/bracket-challenge/contests/${encodeURIComponent(
            contestId,
          )}/master-bracket`,
          {
            method: "PATCH",
            headers: {
              "Content-Type":
                "application/json",
            },
            body: JSON.stringify({
              gameKey,
              teamId,
            }),
          },
        );

      const result =
        (await response.json()) as {
          success?: boolean;
          error?: string;
          masterBracketId?: string;
          picks?: Record<
            string,
            string | null | undefined
          >;
        };

      if (!response.ok) {
        throw new Error(
          result.error ??
            "Unable to save pick.",
        );
      }

      setPicks(result.picks ?? {});
      setMasterBracketId(
        result.masterBracketId ??
          masterBracketId,
      );
    } catch (pickError) {
      setSaveError(
        pickError instanceof Error
          ? pickError.message
          : "Unable to save pick.",
      );
    } finally {
      setSavingGameKey(null);
    }
  }

  const competition =
    data?.competition;
  const contest = data?.contest;
  const games = data?.games ?? [];

  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-7xl space-y-5">
        <AppNav />

        <Link
          href="/bracket-challenge"
          className="inline-flex text-sm font-bold text-blue-300 transition hover:text-blue-200"
        >
          ← Bracket Challenge
        </Link>

        {loading ? (
          <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
            Loading challenge…
          </section>
        ) : error ? (
          <section className="rounded-2xl border border-red-500/30 bg-red-950/20 p-5 text-sm text-red-200">
            {error}
          </section>
        ) : competition &&
          contest ? (
          <>
            <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 shadow-xl sm:p-7">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
                    {competition.season} ·
                    College Football
                  </div>

                  <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-4xl">
                    {competition.name}
                  </h1>

                  <p className="mt-2 text-sm text-slate-300">
                    12-team playoff ·
                    11 games ·{" "}
                    {data?.group?.name}
                  </p>
                </div>

                <span className="rounded-full bg-blue-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-wide text-blue-200">
                  {statusLabel(
                    contest.status,
                  )}
                </span>
              </div>
            </section>

            <section className="rounded-2xl border border-slate-800 bg-slate-950/40">
              <div className="border-b border-slate-800 px-4 py-4 sm:px-5">
                <div className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">
                  Bracket
                </div>

                <div className="mt-1 flex flex-wrap items-end justify-between gap-2">
                  <h2 className="text-xl font-black text-white">
                    Tournament structure
                  </h2>

                  <span className="text-xs text-slate-500">
                    Topology v
                    {
                      competition.topologyVersion
                    }
                  </span>
                </div>

                <p className="mt-1 text-sm text-slate-400">
                  Make your picks below.
                  Progress saves automatically
                  to your master bracket.
                </p>
              </div>

              <div className="p-4 sm:p-5">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-400">
                    {masterBracketId
                      ? "Bracket #1 · Auto-save on"
                      : "Preparing Bracket #1…"}
                  </span>

                  {saveError ? (
                    <span className="text-xs font-bold text-red-300">
                      {saveError}
                    </span>
                  ) : null}
                </div>

                <BracketTopologyPreview
                  games={games}
                  picks={picks}
                  editable={Boolean(
                    masterBracketId,
                  )}
                  savingGameKey={
                    savingGameKey
                  }
                  onPick={handlePick}
                />
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}
