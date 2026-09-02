"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import AppNav from "@/components/AppNav";
import GameCard from "@/components/platform/GameCard";
import { useGroupContext } from "@/components/providers/GroupProvider";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type { GroupGameSummary, GroupPulseFact } from "@/lib/groups/landing";
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
  pulse: GroupPulseFact[];
};

function mobilePulseText(fact: GroupPulseFact) {
  if (fact.label === "Completed matchups") {
    return `${fact.value} completed matchups`;
  }

  if (fact.label === "NBA slates") {
    return `NBA: ${fact.value.replace(/ completed$/, "")}`;
  }

  if (fact.label === "NFL slates") {
    return `NFL: ${fact.value.replace(/ completed$/, "")}`;
  }

  if (fact.label === "Golf tournaments") {
    return `Golf: ${fact.value.replace(/ completed$/, "")}`;
  }

  if (fact.label === "Most fantasy wins") {
    return `Most wins: ${fact.value}`;
  }

  return `${fact.label}: ${fact.value}`;
}

export default function GroupLandingPage({ group, team, avatarUrl, isGroupAdmin, canAdministerGroup, games, pulse }: Props) {
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

  const pulseDurationSeconds = Math.max((pulse.length + 1) * 3.2, 12);

  return (
    <main className="min-h-screen bg-slate-950 px-4 pb-10 pt-4 text-white sm:px-6">
      <div className="mx-auto max-w-6xl">
        <AppNav />
        <section className="relative overflow-hidden border-b border-slate-800 pb-6 pt-2 sm:pb-7 sm:pt-4">
          <div aria-hidden="true" className="absolute -right-10 -top-20 h-64 w-64 rounded-full bg-teal-400/10 blur-3xl" />
          <div aria-hidden="true" className="absolute bottom-0 left-1/3 h-px w-1/2 bg-gradient-to-r from-transparent via-teal-300/30 to-transparent" />
          <div className="relative grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-teal-300">
                111 Sports Group
              </p>
              <h1 className="mt-1 truncate text-4xl font-black tracking-[-0.04em] sm:text-5xl">
                {group.name}
              </h1>
              <p className="mt-2 text-sm text-slate-400">
                Your clubhouse for every game this Group plays.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 sm:justify-end">
              <div className="flex min-w-0 items-center gap-3 border-l-2 border-teal-300/50 pl-3">
                <TeamAvatar
                  teamName={team?.name ?? "Team"}
                  avatarUrl={avatarUrl}
                  size="md"
                />
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">
                    Your team
                  </p>
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

              {canAdministerGroup ? (
                <Link
                  href="/admin/groups?view=commissioner"
                  className="shrink-0 rounded-full border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-bold text-slate-200 transition hover:border-teal-300 hover:text-white"
                >
                  Group Settings
                </Link>
              ) : null}
            </div>
          </div>
        </section>

        {pulse.length ? (
          <section className="mt-5" aria-labelledby="group-pulse-heading">
            <h2 id="group-pulse-heading" className="sr-only">
              Group Pulse
            </h2>
            <div className="group-pulse-mobile overflow-hidden border-y border-slate-800 py-2 sm:hidden">
              <div
                className="group-pulse-ticker flex w-max whitespace-nowrap text-xs font-bold text-slate-200"
                style={{ animationDuration: `${pulseDurationSeconds}s` }}
              >
                {[0, 1].map((copyIndex) => (
                  <div
                    key={copyIndex}
                    aria-hidden={copyIndex === 1 ? "true" : undefined}
                    className="flex shrink-0 items-center gap-3 pr-3"
                  >
                    <span className="font-black uppercase tracking-[0.16em] text-teal-300">
                      Group Pulse
                    </span>
                    {pulse.map((fact) => (
                      <span key={`${copyIndex}:${fact.label}:${fact.value}`} className="flex items-center gap-3">
                        <span aria-hidden="true" className="text-teal-400/70">•</span>
                        <span>{mobilePulseText(fact)}</span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <div className="hidden snap-x gap-5 overflow-x-auto border-y border-slate-800 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex sm:gap-7">
              <div className="flex min-w-max snap-start items-center gap-2 pr-1">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-teal-300" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-300">
                  Group Pulse
                </span>
              </div>
              {pulse.map((fact) => (
                <div key={`${fact.label}:${fact.value}`} className="min-w-max snap-start">
                  <p className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-500">
                    {fact.label}
                  </p>
                  <p className="mt-0.5 text-sm font-bold text-slate-100">
                    {fact.value}
                  </p>
                </div>
              ))}
            </div>

            <style jsx>{`
              .group-pulse-ticker {
                animation-name: group-pulse-scroll;
                animation-timing-function: linear;
                animation-iteration-count: infinite;
              }

              .group-pulse-mobile:hover .group-pulse-ticker,
              .group-pulse-mobile:focus-within .group-pulse-ticker {
                animation-play-state: paused;
              }

              @keyframes group-pulse-scroll {
                from {
                  transform: translateX(0);
                }

                to {
                  transform: translateX(-50%);
                }
              }

              @media (prefers-reduced-motion: reduce) {
                .group-pulse-mobile {
                  overflow-x: auto;
                  scrollbar-width: none;
                }

                .group-pulse-mobile::-webkit-scrollbar {
                  display: none;
                }

                .group-pulse-ticker {
                  animation: none;
                }
              }
            `}</style>
          </section>
        ) : null}

        <section className="mt-6">
          <div className="mb-4">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-teal-300">
              Play together
            </p>
            <h2 className="mt-1 text-xl font-black sm:text-2xl">
              Your Games
            </h2>
          </div>

          {games.length ? (
            <div className="grid auto-rows-fr gap-3 sm:grid-cols-2 sm:[&>*:last-child:nth-child(odd)]:col-span-2">
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
