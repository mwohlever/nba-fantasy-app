import type { EspnScoreboardEvent, EspnGameStatusType } from "@/lib/providers/nfl";

const hour = 3_600_000;
const ambiguous = /CANCELED|CANCELLED|POSTPONED|SUSPENDED/i;
export function nflEventStatus(event: EspnScoreboardEvent): EspnGameStatusType | undefined {
  return event.competitions?.[0]?.status?.type ?? event.status?.type;
}
export function nflGameIsFinal(status?: EspnGameStatusType) {
  return Boolean(status && !ambiguous.test(status.name ?? "") && status.completed === true && status.state === "post");
}
export function relevantNflEvents(events: EspnScoreboardEvent[], teams: Set<string>) {
  return events.filter(event => (event.competitions?.[0]?.competitors ?? []).some(c => teams.has(String(c.team?.abbreviation ?? "").toUpperCase())));
}
export function nflScheduleResolved(events: EspnScoreboardEvent[], teams: Set<string>) {
  if (!events.length || !teams.size) return false;
  return [...teams].every(team => events.filter(event => (event.competitions?.[0]?.competitors ?? []).some(c => String(c.team?.abbreviation ?? "").toUpperCase() === team)).length === 1);
}
export function nflRelevantScheduleUnambiguous(events: EspnScoreboardEvent[], teams: Set<string>) {
  if (!relevantNflEvents(events, teams).length) return false;
  return [...teams].every(team => events.filter(event => (event.competitions?.[0]?.competitors ?? []).some(c => String(c.team?.abbreviation ?? "").toUpperCase() === team)).length <= 1);
}

export function nflSlateEligibility(events: EspnScoreboardEvent[], teams: Set<string>, lastSuccessAt: string | null, now = Date.now(), lifecycleComplete = false) {
  const relevant = relevantNflEvents(events, teams);
  if (!teams.size || !nflRelevantScheduleUnambiguous(events, teams)) return { eligible: false, reason: "unresolved_schedule", relevant };
  const kicks = relevant.map(e => Date.parse(e.date));
  if (kicks.some(k => !Number.isFinite(k))) return { eligible: false, reason: "unresolved_schedule", relevant };
  const statuses = relevant.map(nflEventStatus);
  const allFinal = statuses.every(nflGameIsFinal);
  const latestKick = Math.max(...kicks);
  const nextKick = Math.min(...kicks.filter((kick, i) => !nflGameIsFinal(statuses[i]) && kick >= now));
  const firstKick = Math.min(...kicks);
  const finalKicks = kicks.filter((_, i) => nflGameIsFinal(statuses[i]));
  const latestFinalKick = finalKicks.length ? Math.max(...finalKicks) : -Infinity;
  const recentFinal = now <= latestFinalKick + 28 * hour;
  if (Number.isFinite(nextKick) && nextKick > now + hour && !statuses.some(s => s?.state === "in") && !recentFinal)
    return { eligible: false, reason: "before_window", relevant };
  if (now < firstKick - hour) return { eligible: false, reason: "before_window", relevant };
  if (allFinal && now > latestKick + 28 * hour && lifecycleComplete) return { eligible: false, reason: "stale_final", relevant };
  // A completed game may be corrected for a day. After two hours, sample hourly.
  const sparse = now > latestFinalKick + 6 * hour && !statuses.some(s => s?.state === "in") &&
    (!Number.isFinite(nextKick) || nextKick > now + hour);
  if (sparse && lastSuccessAt && now - Date.parse(lastSuccessAt) < hour) return { eligible: false, reason: "recent_success", relevant };
  if (allFinal && now > latestKick + 28 * hour && lastSuccessAt && now - Date.parse(lastSuccessAt) < 6 * hour)
    return { eligible: false, reason: "recent_success", relevant };
  if (lastSuccessAt && now - Date.parse(lastSuccessAt) < 4 * 60_000) return { eligible: false, reason: "recent_success", relevant };
  return { eligible: true, reason: "due", relevant };
}

export function nflSlateEndPassed(endDate: string, now = new Date()) {
  // Compare Eastern calendar days, avoiding server-local timezone parsing.
  const easternDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return easternDay > endDate;
}
