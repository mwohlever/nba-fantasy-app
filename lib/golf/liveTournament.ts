import type { GolfScheduleEvent, GolfTournament } from "../providers/golf";
import type { GolfLiveLeaderboardRow } from "../../components/golf/GolfLiveLeaderboard";
import type { GolfCutLine } from "./cutLine";
import { formatGolfTeeTime } from "./status";
import { getGolfLiveRoundStatus, orderGolfLiveLeaderboard } from "./liveLeaderboard";

export type GolfLiveSummary = {
  latestSlate: {
    id: number;
    label: string;
    start_date: string;
    end_date: string;
    external_event_id: string | null;
    is_locked: boolean;
  } | null;
  tournament: GolfScheduleEvent | null;
  latestGolfTournamentIsFinal?: boolean;
  liveTournamentRound?: number | null;
  tournamentLeaderboard?: GolfLiveLeaderboardRow[];
  projectedCut?: GolfCutLine | null;
  tournamentStatus?: GolfTournament["status"];
};

export function golfLiveHref(eventId: string | null) {
  return eventId === null ? "/golf/live" : `/golf/live?${new URLSearchParams({ eventId })}`;
}

/** Only exact external identity in the caller's league-scoped slate list. */
export function matchGolfLiveSlate<T extends { external_event_id: string | null }>(slates: T[], eventId: string) {
  return slates.find(slate => slate.external_event_id?.trim() === eventId) ?? null;
}

export function currentGolfLiveEvent(events: GolfTournament[], today = new Date().toISOString().slice(0, 10)) {
  return events.find(event => event.status === "in_progress") ??
    events.find(event => !event.completed && event.startDate && event.endDate && event.startDate.slice(0, 10) <= today && today <= event.endDate.slice(0, 10)) ?? null;
}

/** Retain a directly linked event even when ESPN's season calendar omits it. */
export function golfLiveOptions(schedule: GolfScheduleEvent[], selected: GolfScheduleEvent | null) {
  const byId = new Map(schedule.map(event => [event.espnEventId, event]));
  if (selected) byId.set(selected.espnEventId, selected);
  return [...byId.values()].sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? "") || a.name.localeCompare(b.name));
}

/** Accepted/provider status is authoritative; calendar dates cover schedule-only events. */
export function golfLiveTournamentPhase(event: GolfScheduleEvent, status?: GolfTournament["status"], today = new Date().toISOString().slice(0, 10)) {
  if (status === "final") return "past";
  if (status === "in_progress") return "current";
  const start = event.startDate?.slice(0, 10);
  const end = event.endDate?.slice(0, 10);
  if (end && end < today) return "past";
  if (start && start > today) return "upcoming";
  if (start && end && start <= today && today <= end) return "current";
  return "unknown";
}

export function golfLiveSummaryStatus(summary: GolfLiveSummary) {
  if (summary.latestGolfTournamentIsFinal) return "final";
  if (summary.tournamentStatus && summary.tournamentStatus !== "unknown") return summary.tournamentStatus;
  if (summary.tournamentLeaderboard?.some(row => row.statusState === "playing")) return "in_progress";
  return "unknown";
}

export function golfLiveDefaultLabel(summary: GolfLiveSummary, today = new Date().toISOString().slice(0, 10)) {
  if (!summary.tournament) return "No current tournament";
  const phase = golfLiveTournamentPhase(summary.tournament, golfLiveSummaryStatus(summary), today);
  return `${phase === "past" ? "Latest" : "Current"}: ${summary.tournament.name}`;
}

export type GolfLiveOptionGroup = { label: string; events: GolfScheduleEvent[] };

export function golfLiveOptionGroups({ schedule, selected, automatic, year, today = new Date().toISOString().slice(0, 10) }: {
  schedule: GolfScheduleEvent[];
  selected: GolfLiveSummary | null;
  automatic: GolfLiveSummary | null;
  year: string;
  today?: string;
}): GolfLiveOptionGroup[] {
  const currentYear = today.slice(0, 4);
  const selectedTournament = selected?.tournament ?? null;
  const retained = selectedTournament && (schedule.some(event => event.espnEventId === selectedTournament.espnEventId) ||
    !selectedTournament.startDate || selectedTournament.startDate.slice(0, 4) === year) ? selectedTournament : null;
  // The requested ESPN calendar defines the season, including events that cross a year boundary.
  const options = golfLiveOptions(schedule, retained);
  const descending = (events: GolfScheduleEvent[]) => [...events].sort((a, b) =>
    (b.endDate ?? b.startDate ?? "").localeCompare(a.endDate ?? a.startDate ?? "") ||
    (b.startDate ?? "").localeCompare(a.startDate ?? "") || a.name.localeCompare(b.name));
  if (year < currentYear) return options.length ? [{ label: `${year} tournaments`, events: descending(options) }] : [];
  if (year > currentYear) return options.length ? [{ label: "Upcoming tournaments", events: options }] : [];

  const buckets = { past: [], current: [], upcoming: [], unknown: [] } as Record<ReturnType<typeof golfLiveTournamentPhase>, GolfScheduleEvent[]>;
  for (const event of options) {
    if (event.espnEventId === automatic?.tournament?.espnEventId) continue;
    const state = selected?.tournament?.espnEventId === event.espnEventId ? golfLiveSummaryStatus(selected) : undefined;
    buckets[golfLiveTournamentPhase(event, state, today)].push(event);
  }
  return [
    { label: "Recent tournaments", events: descending(buckets.past) },
    { label: "In progress", events: buckets.current },
    { label: "Upcoming tournaments", events: buckets.upcoming },
    { label: "Other tournaments", events: buckets.unknown },
  ].filter(group => group.events.length > 0);
}

export function golfLiveOptionLabel(event: GolfScheduleEvent) {
  return `${event.name}${event.startDate ? ` · ${event.startDate.slice(0, 10)}` : ""}`;
}

/** Provider-only tournaments have no fantasy ownership or slate detail context. */
export function golfLiveProviderSummary(tournament: GolfTournament): GolfLiveSummary {
  const currentRound = tournament.currentRound || 1;
  const rows = tournament.competitors.map(player => {
    const round = player.rounds.find(round => round.roundNumber === currentRound);
    const liveStatus = getGolfLiveRoundStatus({ status: player.status,
      round: round ? { round_number: round.roundNumber, holes_completed: round.holesCompleted,
        tee_time: round.teeTime, tee_time_raw: round.teeTimeRaw } : null,
      formatTeeTime: formatGolfTeeTime });
    return {
      playerId: Number(player.espnPlayerId), name: player.displayName,
      shortName: player.shortName ?? player.displayName, espnGolfPlayerId: player.espnPlayerId,
      headshotUrl: null, country: player.country, owgrRank: null,
      providerPosition: player.leaderboardOrder, score: player.officialScoreToPar,
      scoreDisplay: player.officialScoreDisplay, status: player.status, statusLabel: "Upcoming",
      ...liveStatus, currentRound, lastHole: player.lastHole, holesCompleted: player.holesCompleted,
      currentRoundScore: round?.scoreToPar ?? null, currentRoundScoreDisplay: round?.scoreDisplay ?? null,
      isDrafted: false, isCurrentUser: false, draftedBy: [],
    };
  });
  return { latestSlate: null, tournament: { ...tournament, startDate: tournament.startDate?.slice(0, 10) ?? null, endDate: tournament.endDate?.slice(0, 10) ?? null }, tournamentStatus: tournament.status,
    latestGolfTournamentIsFinal: tournament.completed, liveTournamentRound: currentRound,
    tournamentLeaderboard: orderGolfLiveLeaderboard(rows), projectedCut: null };
}
