"use client";

import Link from "next/link";
import AppNav from "@/components/AppNav";

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-5xl space-y-6">
        <AppNav />

        {/* HEADER */}
        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">Admin</h1>
          <p className="mt-2 text-sm text-slate-600">
            Manage players, slates, and league settings.
          </p>
        </section>

        {/* ADMIN CARDS */}
        <section className="grid gap-4 sm:grid-cols-2">
          {/* MANAGE PLAYERS */}
          <Link
            href="/admin/players"
            className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="flex flex-col gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Players
              </div>

              <div className="text-lg font-semibold text-slate-900">
                Manage Players
              </div>

              <p className="text-sm text-slate-600">
                Edit player positions, activate/deactivate players, and manage
                your player pool.
              </p>

              <div className="pt-2 text-sm font-medium text-sky-700 group-hover:underline">
                Go to Player Admin →
              </div>
            </div>
          </Link>

          {/* MANAGE SLATES */}
          <Link
            href="/admin/slates"
            className="group rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
          >
            <div className="flex flex-col gap-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Slates
              </div>

              <div className="text-lg font-semibold text-slate-900">
                Manage Slates
              </div>

              <p className="text-sm text-slate-600">
                Edit participation, adjust draft order, reseed based on results,
                or delete slates.
              </p>

              <div className="pt-2 text-sm font-medium text-sky-700 group-hover:underline">
                Go to Slate Manager →
              </div>
            </div>
          </Link>
        </section>

        {/* OPTIONAL FUTURE SECTION */}
        <section className="rounded-3xl border border-dashed border-slate-300 bg-slate-100 px-5 py-6 text-sm text-slate-500">
          More admin tools coming soon (league settings, scoring tweaks, etc.)
        </section>
      </div>
    </main>
  );
}
