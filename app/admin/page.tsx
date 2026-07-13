"use client";

import Link from "next/link";
import AppNav from "@/components/AppNav";

const adminCards = [
  {
    href: "/slates/new",
    title: "Create Slate",
    description:
      "Create a new slate, set the date range, choose participating teams, and establish draft order.",
    cta: "Create New Slate →",
  },
  {
    href: "/admin/slates",
    title: "Manage Slates",
    description:
      "Edit slate dates, lock status, participating teams, draft order, reseeding, and slate cleanup tools.",
    cta: "Go to Slate Admin →",
  },
  {
    href: "/admin/corrections",
    title: "Corrections",
    description:
      "Fix historical rosters, stat lines, slate totals, and finish positions.",
    cta: "Go to Corrections →",
  },
  {
    href: "/admin/players",
    title: "Manage Players",
    description:
      "Edit player names, NBA ids, team abbreviations, active status, and slate availability support data.",
    cta: "Go to Player Admin →",
  },
  {
    href: "/admin/slate-games",
    title: "Slate NBA Games",
    description:
      "Attach exact NBA game IDs to slates so multi-day slates refresh correctly.",
    cta: "Go to Slate NBA Games →",
  },
  {
    href: "/admin/notification-templates",
    title: "Notification Templates",
    description:
      "Edit the wording used for browser push notifications and preview how messages will appear.",
    cta: "Edit Notifications →",
  },
];

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Admin
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Manage slates, players, and league settings.
          </p>
        </section>

        <section className="grid gap-6 md:grid-cols-2">
          {adminCards.map((card) => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-3xl border border-slate-200 bg-white p-6 shadow-sm transition hover:border-sky-200 hover:bg-sky-50"
            >
              <div className="space-y-3">
                <h2 className="text-xl font-semibold text-slate-900">
                  {card.title}
                </h2>
                <p className="text-sm leading-6 text-slate-600">
                  {card.description}
                </p>
                <div className="text-sm font-medium text-sky-700 group-hover:text-sky-900">
                  {card.cta}
                </div>
              </div>
            </Link>
          ))}

        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-500">
            More admin tools can live here later, like scoring settings, lock
            rules, roster maintenance, and season controls.
          </p>
        </section>
      </div>
    </main>
  );
}
