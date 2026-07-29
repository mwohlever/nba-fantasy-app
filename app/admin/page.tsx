"use client";

import Link from "next/link";
import AppNav from "@/components/AppNav";

const adminGroups = [
  {
    title: "Slates & Draft",
    description: "Create, configure, and maintain fantasy slates.",
    cards: [
      {
        href: "/slates/new",
        title: "Create Slate",
        description:
          "Choose dates, participating teams, and the initial draft order.",
      },
      {
        href: "/admin/slates",
        title: "Manage Slates",
        description:
          "Edit slate settings, participation, order, lock status, and reseeding.",
      },
      {
        href: "/admin/slate-games",
        title: "Slate NBA Games",
        description:
          "Attach exact NBA game IDs for reliable multi-day refreshes.",
      },
      {
        href: "/admin/corrections",
        title: "Corrections",
        description:
          "Fix historical rosters, stats, totals, and finish positions.",
      },
    ],
  },
  {
    title: "Notifications",
    description:
      "Control push notification wording and review delivery results.",
    cards: [
      {
        href: "/admin/notification-templates",
        title: "Notification Templates",
        description:
          "Edit draft-turn, final-pick, and player-finished messages.",
      },
      {
        href: "/admin/notification-history",
        title: "Notification History",
        description:
          "Review sends, skips, failures, recipients, and device delivery.",
      },
    ],
  },
  {
    title: "Players & League",
    description: "Maintain player records and future league settings.",
    cards: [
      {
        href: "/admin/players",
        title: "Manage NBA Players",
        description:
          "Edit names, NBA IDs, teams, active status, and availability.",
      },
      {
        href: "/admin/players-nfl",
        title: "Manage NFL Players",
        description:
          "Edit positions, teams, and active status for NFL players.",
      },
      {
        href: "/admin/league-awards",
        title: "League Awards",
        description:
          "Create and manage custom seasonal awards for each league member.",
      },
    ],
  },
];

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-3xl font-bold tracking-tight">
            Commissioner Control Center
          </h1>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            Manage slates, players, notifications, corrections, and league
            operations.
          </p>
        </section>

        {adminGroups.map((group) => (
          <section
            key={group.title}
            className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <h2 className="text-xl font-semibold">{group.title}</h2>
            <p className="mt-1 text-sm text-slate-600">
              {group.description}
            </p>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              {group.cards.map((card) => (
                <Link
                  key={card.href}
                  href={card.href}
                  className="group rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-sky-300 hover:bg-sky-50"
                >
                  <h3 className="font-semibold text-slate-950">
                    {card.title}
                  </h3>

                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    {card.description}
                  </p>

                  <div className="mt-4 text-sm font-semibold text-sky-700">
                    Open →
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
