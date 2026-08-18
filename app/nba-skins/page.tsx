"use client";

import Link from "next/link";
import AppNav from "@/components/AppNav";

export default function NbaSkinsHomePage() {
  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppNav />

        <section className="overflow-hidden rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 via-slate-900 to-blue-950 p-6 shadow-xl">
          <div className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">
            111 Sports
          </div>

          <h1 className="mt-1 text-3xl font-black tracking-tight text-white">
            NBA Skins
          </h1>

          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
            Draft seven NBA teams and choose Wins or Losses.
            Every win or loss that matches your pick becomes one point.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Link
            href="/nba-skins/draft"
            className="rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-sm transition hover:border-blue-500/60"
          >
            <div className="text-xs font-bold uppercase tracking-widest text-blue-300">
              Draft
            </div>

            <div className="mt-2 text-xl font-black text-white">
              Seven teams. One choice each.
            </div>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Pick each NBA team once league-wide and choose whether
              you are scoring its wins or its losses.
            </p>
          </Link>

          <Link
            href="/nba-skins/standings"
            className="rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-sm transition hover:border-blue-500/60"
          >
            <div className="text-xs font-bold uppercase tracking-widest text-blue-300">
              Standings
            </div>

            <div className="mt-2 text-xl font-black text-white">
              Track the season
            </div>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              View current or historical NBA Skins standings and each
              player&apos;s seven selections.
            </p>
          </Link>

          <Link
            href="/nba-skins/standings?season=2025"
            className="rounded-3xl border border-slate-700 bg-slate-900 p-5 shadow-sm transition hover:border-blue-500/60"
          >
            <div className="text-xs font-bold uppercase tracking-widest text-blue-300">
              History
            </div>

            <div className="mt-2 text-xl font-black text-white">
              2022-23 through 2025-26
            </div>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Browse the normalized historical picks and results from
              past NBA Skins seasons.
            </p>
          </Link>

          <Link
            href="/nba-skins/profile"
            className="rounded-3xl border border-blue-500/25 bg-gradient-to-br from-slate-900 to-blue-950/50 p-5 shadow-sm transition hover:border-blue-400/60"
          >
            <div className="text-xs font-bold uppercase tracking-widest text-blue-300">
              Profile
            </div>

            <div className="mt-2 text-xl font-black text-white">
              Career Stats
            </div>

            <p className="mt-2 text-sm leading-6 text-slate-400">
              Championships, career points, best picks, season history,
              and your Wins vs. Losses performance.
            </p>
          </Link>
        </section>
      </div>
    </main>
  );
}
