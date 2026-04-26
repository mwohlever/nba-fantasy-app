"use client";

import Link from "next/link";
import AppNav from "@/components/AppNav";
import { useEffect, useState } from "react";

const adminCards = [
  {
    href: "/admin/players",
    title: "Manage Players",
    description:
      "Edit player names, NBA ids, team abbreviations, active status, and slate availability support data.",
    cta: "Go to Player Admin →",
  },
  {
    href: "/admin/slates",
    title: "Manage Slates",
    description:
      "Edit slate dates, lock status, participating teams, draft order, reseeding, and slate cleanup tools.",
    cta: "Go to Slate Admin →",
  },
  {
    href: "/slates/new",
    title: "Create Slate",
    description:
      "Create a new slate, set the date range, choose participating teams, and establish draft order.",
    cta: "Create New Slate →",
  },
];

type TeamOption = {
  id: number;
  name: string;
};

export default function AdminPage() {
  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [phone, setPhone] = useState("");
  const [smsEnabled, setSmsEnabled] = useState(true);

  useEffect(() => {
    async function loadTeams() {
      const res = await fetch("/api/teams");
      const data = await res.json();
      setTeams(data?.teams ?? []);
    }
    loadTeams();
  }, []);

  async function saveContact() {
    if (!selectedTeamId) return;

    const team = teams.find(t => String(t.id) === selectedTeamId);

    await fetch("/api/team-contacts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        teamId: selectedTeamId,
        name: team?.name ?? "",
        phone,
        smsEnabled,
      }),
    });

    alert("Saved!");
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <AppNav />
      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              Admin
            </h1>
            <p className="max-w-3xl text-sm text-slate-600">
              League setup and maintenance tools. Use this area for player
              management, slate management, and creating new slates.
            </p>
          </div>

          <Link
            href="/"
            className="shrink-0 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50"
          >
            ← Back
          </Link>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
        <h2 className="text-lg font-semibold text-slate-900 mb-4">
          Team Contacts
        </h2>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            value={selectedTeamId}
            onChange={(e) => setSelectedTeamId(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          >
            <option value="">Select Team</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Phone (+1614...)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={smsEnabled}
              onChange={(e) => setSmsEnabled(e.target.checked)}
            />
            SMS Enabled
          </label>

          <button
            onClick={saveContact}
            className="rounded-lg bg-sky-600 px-4 py-2 text-sm text-white hover:bg-sky-700"
          >
            Save
          </button>
        </div>
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
