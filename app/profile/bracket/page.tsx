"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import { bracketDisplayLabel } from "@/lib/bracket/names";
import TeamAvatar from "@/components/ui/TeamAvatar";
import { bracketChallengeRoutes } from "@/lib/bracket/navigation";

type Profile = {
  entrant: { id: string; displayName: string; kind: "account" | "managed"; claimedAt: string | null; avatarUrl: string | null };
  navigationContestId: string | null;
  summary: { challengesEntered: number; championships: number; runnerUps: number; topHalfFinishes: number; averageFinish: number | null; bestFinish: number | null; totalPoints: number; correctPicks: number; resolvedPicks: number; pickAccuracy: number | null };
  history: { entryId: number; contestId: string; season: number; competitionName: string; bracketNumber: number; bracketName: string | null; rank: number | null; entrantCount: number | null; points: number; correctPicks: number; resolvedPicks: number; championCorrect: boolean }[];
  achievements: { bracketChampion: boolean; runnerUp: boolean; championCalled: boolean; topHalf: boolean; perfectRound: boolean; perfectBracket: boolean; perfectRoundCount: number };
};

function Metric({ label, value, detail }: { label: string; value: string | number; detail?: string }) {
  return <article className="rounded-2xl border border-slate-700 bg-slate-900 p-4">
    <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p>
    <p className="mt-2 text-3xl font-black text-white">{value}</p>
    {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
  </article>;
}

const rank = (value: number | null) => value === null ? "Finalizing" : value === 1 ? "1st" : value === 2 ? "2nd" : value === 3 ? "3rd" : `${value}th`;

function BracketProfilePageContent() {
  const params = useSearchParams();
  const entrantId = params.get("entrantId");
  const requestedContestId = params.get("contestId");
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setProfile(null);
    setError("");
    const query = new URLSearchParams();
    if (entrantId) query.set("entrantId", entrantId);
    if (requestedContestId) query.set("contestId", requestedContestId);
    void fetch(`/api/bracket-challenge/profile?${query.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Unable to load profile.");
        return body as Profile;
      })
      .then((body) => { if (!cancelled) setProfile(body); })
      .catch((reason: unknown) => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load profile."); });
    return () => { cancelled = true; };
  }, [entrantId, requestedContestId]);

  // AppNav and the return action receive only server-authorized context.
  const authorizedContestId = profile?.navigationContestId === requestedContestId
    ? profile.navigationContestId
    : null;
  const contestRoutes = authorizedContestId ? bracketChallengeRoutes(authorizedContestId) : null;

  return <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6">
    <div className="mx-auto max-w-5xl space-y-6">
      <AppNav authorizedBracketContestId={authorizedContestId} />
      {!profile && !error && <p className="text-sm text-slate-400">Loading Bracket Challenge profile…</p>}
      {error && <p className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 text-sm text-red-200">{error}</p>}
      {profile && <>
        {contestRoutes && <Link href={contestRoutes.leaderboard} className="inline-flex min-h-9 items-center text-sm font-bold text-blue-300 hover:text-blue-200">← Back to Leaderboard</Link>}
        <section className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-5 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-blue-300">Bracket Challenge résumé</p>
          <div className="mt-3 flex items-center gap-3">
            <TeamAvatar teamName={profile.entrant.displayName} avatarUrl={profile.entrant.avatarUrl} useLegacyFallback={false} size="lg" />
            <div className="min-w-0">
              <h1 className="truncate text-3xl font-black tracking-tight text-white">{profile.entrant.displayName}</h1>
              <p className="mt-1 text-sm text-slate-400">{profile.entrant.kind === "managed" ? "Managed entrant · historical bracket identity" : "Account entrant"} · Active Group history</p>
            </div>
          </div>
        </section>
        <section>
          <h2 className="text-xl font-black">Career</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Metric label="Challenges" value={profile.summary.challengesEntered} detail="Final contest entries" />
            <Metric label="Championships" value={profile.summary.championships} />
            <Metric label="Runner-up" value={profile.summary.runnerUps} />
            <Metric label="Top half" value={profile.summary.topHalfFinishes} />
            <Metric label="Average finish" value={profile.summary.averageFinish ?? "—"} />
            <Metric label="Best finish" value={profile.summary.bestFinish ? rank(profile.summary.bestFinish) : "—"} />
            <Metric label="Pick accuracy" value={profile.summary.pickAccuracy === null ? "—" : `${profile.summary.pickAccuracy}%`} detail={`${profile.summary.correctPicks}/${profile.summary.resolvedPicks} resolved`} />
            <Metric label="Points scored" value={profile.summary.totalPoints} />
          </div>
        </section>
        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">History</p>
          <h2 className="mt-1 text-2xl font-black">Final bracket entries</h2>
          <div className="mt-4 divide-y divide-slate-700">
            {profile.history.length ? profile.history.map((entry) => <article key={entry.entryId} className="py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-black text-white">{entry.season} {entry.competitionName}{entry.bracketName || entry.bracketNumber > 1 ? ` · ${bracketDisplayLabel(entry.bracketNumber, entry.bracketName)}` : ""}</p>
                  <p className="mt-1 text-sm text-slate-400">{rank(entry.rank)}{entry.entrantCount ? ` of ${entry.entrantCount}` : ""} · {entry.points} pts · {entry.correctPicks}/{entry.resolvedPicks} correct</p>
                  <p className="mt-1 text-xs text-slate-500">Champion pick: {entry.championCorrect ? "Correct" : "Not correct"}</p>
                </div>
                <Link href={`${bracketChallengeRoutes(entry.contestId).bracket}?entryId=${entry.entryId}`} className="shrink-0 text-sm font-bold text-blue-300">View bracket</Link>
              </div>
            </article>) : <p className="py-8 text-sm text-slate-500">No final Bracket Challenge entries in this Group yet.</p>}
          </div>
        </section>
        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-5 sm:p-6">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-blue-300">Milestones</p>
          <h2 className="mt-1 text-2xl font-black">Bracket achievements</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[["🏆", "Bracket Champion", profile.achievements.bracketChampion, "Finish first in a final contest."], ["🥈", "Runner-Up", profile.achievements.runnerUp, "Finish second in a final contest."], ["👑", "Champion Called", profile.achievements.championCalled, "Pick the official champion."], ["📈", "Top Half", profile.achievements.topHalf, "Finish in the top half of a final contest."], ["💯", "Perfect Round", profile.achievements.perfectRound, `Complete rounds swept: ${profile.achievements.perfectRoundCount}`], ["✨", "Perfect Bracket", profile.achievements.perfectBracket, "Pick every game correctly in a completed competition."]].map(([emoji, name, unlocked, detail]) => <article key={String(name)} className={`rounded-2xl border p-4 ${unlocked ? "border-blue-400/40 bg-blue-950/30" : "border-slate-700 bg-slate-950/40 opacity-65"}`}>
              <p className="text-2xl">{unlocked ? emoji : "🔒"}</p>
              <p className="mt-3 font-black">{name}</p>
              <p className="mt-1 text-xs text-slate-400">{detail}</p>
            </article>)}
          </div>
        </section>
      </>}
    </div>
  </main>;
}

export default function BracketProfilePage() {
  return <Suspense fallback={
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <p className="text-sm text-slate-400">Loading Bracket Challenge profile…</p>
      </div>
    </main>
  }>
    <BracketProfilePageContent />
  </Suspense>;
}
