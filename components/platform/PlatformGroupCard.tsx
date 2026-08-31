"use client";

import { useState } from "react";
import GameCard from "@/components/platform/GameCard";
import { getSportConfig, sportKeyFromLeagueSportKey } from "@/lib/sports";

type GroupCard = {
  name: string;
  slug: string;
  role: "member" | "admin";
  teamName: string | null;
  isActive: boolean;
  leagues: Array<{ id: string; sportKey: string; name: string }>;
};

function hrefForSport(sportKey: string) {
  if (sportKey === "ncaa") return "/ncaa-pickem";
  if (sportKey === "nba-skins") return "/nba-skins";
  return `/home?sport=${encodeURIComponent(sportKey)}`;
}

export default function PlatformGroupCard({ group }: { group: GroupCard }) {
  const [opening, setOpening] = useState<string | null>(null);

  async function activate(destination: string) {
    setOpening(destination);
    try {
      const response = await fetch("/api/groups/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupSlug: group.slug }),
      });
      if (!response.ok) throw new Error("Unable to open Group.");
      window.location.assign(destination);
    } catch (error) {
      console.error(error);
      window.alert("Unable to open that Group right now.");
      setOpening(null);
    }
  }

  return (
    <section className={`rounded-3xl border p-4 ${group.isActive ? "border-teal-400/50 bg-teal-300/[0.06]" : "border-slate-700 bg-slate-900/65"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-lg font-bold text-white">{group.name}</h3>
            {group.isActive ? <span className="text-[10px] font-bold uppercase tracking-wider text-teal-300">Active</span> : null}
          </div>
          <p className="truncate text-sm text-slate-400">{group.teamName ?? "Team setup pending"}{group.role === "admin" ? " · Commissioner" : ""}</p>
        </div>
        <button
          type="button"
          disabled={opening !== null}
          onClick={() => void activate(`/groups/${encodeURIComponent(group.slug)}`)}
          className="shrink-0 rounded-full bg-teal-300 px-3 py-2 text-xs font-bold text-slate-950 disabled:opacity-50"
        >
          Open Group
        </button>
      </div>
      {group.leagues.length ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {group.leagues.map((league) => {
            const sportKey = sportKeyFromLeagueSportKey(league.sportKey);
            const destination = hrefForSport(sportKey);
            return (
              <GameCard
                key={league.id}
                sportKey={sportKey}
                name={league.name || getSportConfig(sportKey).label}
                href={destination}
                detail={opening === destination ? "Opening…" : "Enter game"}
                onClick={(event) => {
                  event.preventDefault();
                  void activate(destination);
                }}
              />
            );
          })}
        </div>
      ) : <p className="mt-4 text-sm text-slate-400">No games are enabled yet.</p>}
    </section>
  );
}
