"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import GameCard from "@/components/platform/GameCard";
import { useGroupContext } from "@/components/providers/GroupProvider";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type { GroupGameSummary } from "@/lib/groups/landing";
import {
  PLATFORM_GAMES,
  getPlatformGameConfig,
} from "@/lib/sports";

type Props = {
  group: { name: string; slug: string };
  team: { name: string } | null;
  avatarUrl: string | null;
  isGroupAdmin: boolean;
  canAdministerGroup: boolean;
  games: GroupGameSummary[];
};

export default function GroupLandingPage({ group, team, avatarUrl, isGroupAdmin, canAdministerGroup, games }: Props) {
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

  const enabledGameKeys =
    new Set(
      games.map(
        (game) => game.sportKey,
      ),
    );

  const availableGames =
    PLATFORM_GAMES.filter(
      (game) =>
        !enabledGameKeys.has(game.key),
    );

  return (
    <main className="min-h-screen bg-slate-950 px-4 pb-10 pt-4 text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        <AppNav />
        <section className="relative overflow-hidden border-b border-slate-800 pb-6 pt-2 sm:pb-8 sm:pt-4">
          <div aria-hidden="true" className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-teal-400/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-teal-300">
                Group Home
              </p>
              <h1 className="mt-2 truncate text-3xl font-black tracking-tight sm:text-4xl">
                {group.name}
              </h1>

              <div className="mt-4 flex items-center gap-3">
                <TeamAvatar
                  teamName={team?.name ?? "Team"}
                  avatarUrl={avatarUrl}
                  size="md"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">
                    {team?.name ?? "Team setup pending"}
                  </p>
                  {isGroupAdmin ? (
                    <p className="mt-0.5 text-xs font-semibold text-teal-300">
                      Commissioner
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            {canAdministerGroup ? (
              <Link
                href="/admin/groups?view=commissioner"
                className="shrink-0 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-teal-300 hover:text-white"
              >
                Group Settings
              </Link>
            ) : null}
          </div>
        </section>

        <section className="mt-7">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-300">
              Play together
            </p>
            <h2 className="mt-1 text-xl font-black sm:text-2xl">
              Your Games
            </h2>
          </div>

          {games.length ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {games.map((game) => (
                <GameCard
                  key={game.leagueId}
                  {...game}
                  description={
                    getPlatformGameConfig(
                      game.sportKey,
                    )?.description
                  }
                />
              ))}
            </div>
          ) : (
            <div className="border-y border-slate-800 py-5 text-sm text-slate-300">
              This Group does not have any games enabled yet.
            </div>
          )}
        </section>

        {canAdministerGroup && availableGames.length ? (
          <section className="mt-9 border-t border-slate-800 pt-6">
            <div className="mb-3 flex items-end justify-between gap-4">
              <div>
                <h2 className="text-base font-black text-white">
                  More Games Available
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  Add another way for your Group to compete.
                </p>
              </div>
              <Link
                href="/admin/groups?view=commissioner"
                className="shrink-0 text-xs font-bold text-teal-300 hover:text-teal-200"
              >
                Group Settings →
              </Link>
            </div>

            <div className="divide-y divide-slate-800 border-y border-slate-800">
              {availableGames.map((game) => (
                <Link
                  key={game.key}
                  href="/admin/groups?view=commissioner"
                  className="group flex items-center gap-3 py-3 transition hover:bg-slate-900/40"
                >
                  <Image
                    src={game.logo}
                    alt=""
                    width={36}
                    height={36}
                    className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-100">
                      {game.label}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {game.description}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-bold text-slate-400 group-hover:text-teal-300">
                    Enable →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
