"use client";

import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";

const eventId = process.env.NEXT_PUBLIC_BRACKET_GAME_CENTER_DEV_EVENT_ID;

function developmentGame(id: string): LiveScoreGame {
  return {
    espnEventId: id,
    name: "Development ESPN event",
    shortName: "Development event",
    kickoffAt: new Date().toISOString(),
    awayTeam: { id: "development-away", displayName: "Loading away team", abbreviation: null, logo: null, rank: null, record: null, conferenceId: null, score: null, winner: false },
    homeTeam: { id: "development-home", displayName: "Loading home team", abbreviation: null, logo: null, rank: null, record: null, conferenceId: null, score: null, winner: false },
    status: "pre",
    statusDetail: null,
    completed: false,
    winnerTeamId: null,
    odds: null,
  };
}

/** Deliberately absent from production; event ID comes from a local development env var. */
export default function BracketGameCenterDevHarness({
  onOpen,
}: {
  onOpen: (game: LiveScoreGame) => void;
}) {
  if (process.env.NODE_ENV === "production" || !eventId) return null;

  return (
    <aside className="rounded-xl border border-dashed border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-100">
      <p className="font-bold">Development Game Center</p>
      <p className="mt-1 text-xs leading-5 text-amber-100/80">Opens a local ESPN event without associating it with this bracket.</p>
      <button type="button" onClick={() => onOpen(developmentGame(eventId))} className="mt-3 min-h-10 rounded-lg bg-amber-300 px-3 py-2 text-sm font-black text-slate-950">Open development event</button>
    </aside>
  );
}
