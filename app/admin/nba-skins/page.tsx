"use client";

import Link from "next/link";
import AppNav from "@/components/AppNav";

export default function NbaSkinsAdminPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-blue-500/30 bg-slate-900 p-6 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
            Commissioner
          </div>

          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">
            NBA Skins Control
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            This will control the annual Skins season, draft lock,
            record refresh, and commissioner corrections.
          </p>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
              <div className="font-bold text-white">
                Draft Lock
              </div>

              <div className="mt-1 text-sm text-slate-400">
                Open/lock/reopen controls will live here.
              </div>
            </div>

            <div className="rounded-2xl border border-slate-700 bg-slate-950/40 p-4">
              <div className="font-bold text-white">
                Records
              </div>

              <div className="mt-1 text-sm text-slate-400">
                Manual refresh and live NBA record status will live here.
              </div>
            </div>
          </div>

          <Link
            href="/nba-skins"
            className="mt-6 inline-flex rounded-xl border border-blue-500/40 bg-blue-950/50 px-4 py-2.5 text-sm font-semibold text-blue-100 transition hover:border-blue-400"
          >
            View NBA Skins
          </Link>
        </section>
      </div>
    </main>
  );
}
