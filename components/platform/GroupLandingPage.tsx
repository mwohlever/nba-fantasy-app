"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import GameCard from "@/components/platform/GameCard";
import { useGroupContext } from "@/components/providers/GroupProvider";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type { GroupGameSummary } from "@/lib/groups/landing";

type Props = {
  group: { name: string; slug: string };
  team: { name: string } | null;
  avatarUrl: string | null;
  canAdministerGroup: boolean;
  games: GroupGameSummary[];
};

export default function GroupLandingPage({ group, team, avatarUrl, canAdministerGroup, games }: Props) {
  const { groupContext, isLoading, refreshGroupContext } = useGroupContext();
  const [syncing, setSyncing] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function synchronize() {
      if (isLoading) return;
      if (groupContext?.group.slug === group.slug) {
        setSyncing(false);
        return;
      }
      try {
        const response = await fetch("/api/groups/active", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ groupSlug: group.slug }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result?.error ?? "Unable to open Group.");
        await refreshGroupContext();
        if (!cancelled) setSyncing(false);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "Unable to open Group.");
          setSyncing(false);
        }
      }
    }
    void synchronize();
    return () => { cancelled = true; };
  }, [group.slug, groupContext?.group.slug, isLoading, refreshGroupContext]);

  if (isLoading || syncing) {
    return <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-semibold text-teal-200">Opening {group.name}…</main>;
  }

  if (error || groupContext?.group.slug !== group.slug) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-5 text-white">
        <div className="max-w-md rounded-3xl border border-slate-700 bg-slate-900 p-6 text-center"><h1 className="text-xl font-bold">Group unavailable</h1><p className="mt-2 text-sm text-slate-300">{error || "You do not have access to this Group."}</p><Link href="/" className="mt-5 inline-block rounded-full bg-teal-300 px-4 py-2 font-bold text-slate-950">Back to 111 Sports</Link></div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 pb-28 pt-4 text-white sm:px-6 sm:pb-10">
      <div className="mx-auto max-w-6xl">
        <AppNav />
        <section className="overflow-hidden rounded-3xl border border-slate-700 bg-[radial-gradient(circle_at_top_right,_rgba(45,212,191,0.16),_transparent_42%),rgba(15,23,42,0.88)] p-5 sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-xs font-bold uppercase tracking-[0.22em] text-teal-300">Group Home</p><h1 className="mt-1 text-3xl font-black tracking-tight">{group.name}</h1><div className="mt-3 flex items-center gap-2"><TeamAvatar teamName={team?.name ?? "Team"} avatarUrl={avatarUrl} size="sm" /><p className="text-sm text-slate-300">{team?.name ?? "Team setup pending"}</p></div></div>
            {canAdministerGroup ? <Link href="/admin/groups?view=commissioner" className="rounded-full border border-slate-600 px-3 py-2 text-xs font-semibold text-slate-200 hover:border-teal-300">Group Settings</Link> : null}
          </div>
        </section>

        <section className="mt-6">
          <div className="mb-3"><h2 className="text-xl font-black">Games</h2><p className="text-sm text-slate-400">Choose a game to enter its Home.</p></div>
          {games.length ? <div className="grid gap-3 sm:grid-cols-2">{games.map((game) => <GameCard key={game.leagueId} {...game} />)}</div> : <div className="rounded-2xl border border-slate-700 bg-slate-900 p-5 text-sm text-slate-300">This Group does not have any games enabled yet.</div>}
        </section>
      </div>
    </main>
  );
}
