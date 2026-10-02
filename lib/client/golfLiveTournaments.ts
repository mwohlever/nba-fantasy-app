"use client";

import { parseGolfScheduleFromPayload, parseGolfTournamentsFromPayload, parseGolfTournamentByEventIdFromPayload,
  type GolfScheduleEvent, type GolfTournament } from "../providers/golf";
import { currentGolfLiveEvent, golfLiveProviderSummary, type GolfLiveSummary } from "../golf/liveTournament";
import { fetchGolfEventScoreboardFromBrowser } from "./refreshGolfFromBrowser";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/golf/pga/scoreboard";
const LEADERBOARD = "https://site.api.espn.com/apis/site/v2/sports/golf/leaderboard";
const schedules = new Map<string, { expires: number; promise: Promise<GolfScheduleEvent[]> }>();
let current: { expires: number; promise: Promise<GolfTournament[]> } | null = null;

async function espnJson(url: string) {
  const response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json, text/plain, */*" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`ESPN Golf is unavailable (${response.status}).`);
  return response.json();
}

/** Reuse the same calendar/parser as /api/golf/schedule and the browser creation flow.
 * Cache only normalized schedule data; never poll the season-sized scoreboard. */
export function loadGolfLiveSchedule(year: string): Promise<GolfScheduleEvent[]> {
  const cached = schedules.get(year);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const entry: { expires: number; promise: Promise<GolfScheduleEvent[]> } = { expires: Date.now() + 60 * 60_000,
    promise: Promise.resolve().then(async (): Promise<GolfScheduleEvent[]> => {
      if (year === String(new Date().getUTCFullYear())) {
        await loadCurrentGolfLiveEvents().catch(() => []);
        const discovered = schedules.get(year);
        if (discovered && discovered !== entry) return discovered.promise;
      }
      return parseGolfScheduleFromPayload(await espnJson(`${SCOREBOARD}?dates=${encodeURIComponent(year)}`));
    }) };
  schedules.set(year, entry);
  entry.promise.catch(() => { if (schedules.get(year) === entry) schedules.delete(year); });
  return entry.promise;
}

export function loadCurrentGolfLiveEvents() {
  if (current && current.expires > Date.now()) return current.promise;
  const entry = { expires: Date.now() + 5 * 60_000, promise: espnJson(SCOREBOARD).then(payload => {
    const year = String(payload.season?.year ?? new Date().getUTCFullYear());
    schedules.set(year, { expires: Date.now() + 60 * 60_000, promise: Promise.resolve(parseGolfScheduleFromPayload(payload)) });
    return parseGolfTournamentsFromPayload(payload);
  }) };
  current = entry;
  entry.promise.catch(() => { if (current === entry) current = null; });
  return entry.promise;
}

async function acceptedSummary(eventId: string | null): Promise<GolfLiveSummary> {
  const params = new URLSearchParams({ sport: "golf", view: "live" });
  if (eventId !== null) params.set("eventId", eventId);
  const response = await fetch(`/api/home-summary?${params}`, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Golf Live is unavailable.");
  const slate = result.latestSlate;
  return { ...result, tournament: slate ? { espnEventId: slate.external_event_id ?? "", name: slate.label,
    startDate: slate.start_date, endDate: slate.end_date } : null };
}

export async function loadGolfLiveSummary(requestedEventId: string | null): Promise<GolfLiveSummary> {
  if (requestedEventId !== null && !/^\d+$/.test(requestedEventId)) throw new Error("Invalid Golf event ID. Choose a tournament below.");
  const [fallback, events] = await Promise.all([
    acceptedSummary(requestedEventId),
    requestedEventId === null ? loadCurrentGolfLiveEvents().catch(() => []) : Promise.resolve([]),
  ]);
  const live = requestedEventId === null ? currentGolfLiveEvent(events) : null;
  const eventId = requestedEventId ?? live?.espnEventId ?? null;
  const accepted = live && fallback.latestSlate?.external_event_id !== eventId
    ? await acceptedSummary(eventId) : fallback;
  if (accepted.latestSlate || eventId === null) return accepted;

  // The event-specific leaderboard resolves historical IDs without guessing a season.
  const leaderboard = await espnJson(`${LEADERBOARD}?event=${encodeURIComponent(eventId)}`);
  const metadata = parseGolfTournamentByEventIdFromPayload(leaderboard, eventId);
  if (!metadata) {
    const known = await Promise.all([...schedules.values()].map(entry => entry.promise.catch(() => [])));
    const scheduled = known.flat().find(event => event.espnEventId === eventId) ??
      (await loadGolfLiveSchedule(String(new Date().getUTCFullYear()))).find(event => event.espnEventId === eventId);
    if (!scheduled) throw new Error("This Golf tournament could not be found. Choose another tournament below.");
    return golfLiveProviderSummary({ ...scheduled, status: scheduled.startDate && scheduled.startDate > new Date().toISOString().slice(0, 10) ? "scheduled" : "unknown",
      statusDescription: null, completed: false, currentRound: null, competitors: [] });
  }
  if (metadata.competitors.length === 0) return golfLiveProviderSummary(metadata);
  const year = metadata.startDate?.slice(0, 4);
  if (!year) throw new Error("ESPN has no season date for this tournament.");
  const { scoreboardPayload } = await fetchGolfEventScoreboardFromBrowser(eventId, year, leaderboard);
  const tournament = parseGolfTournamentByEventIdFromPayload(scoreboardPayload, eventId);
  if (!tournament) throw new Error("The selected tournament leaderboard is unavailable.");
  return golfLiveProviderSummary(tournament);
}
