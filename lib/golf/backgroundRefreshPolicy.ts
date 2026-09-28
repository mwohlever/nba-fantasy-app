const day = 86_400_000;
export type GolfRefreshCandidate = {
  id: number;
  sport: string;
  start_date: string;
  end_date: string;
  external_event_id: string | null;
  is_locked: boolean;
  archived_at: string | null;
};
export type GolfRefreshState = { next_attempt_at: string | null };

/** Keep the legacy field-publication/finalization window; never infer a cut/roster transition here. */
export function golfSlateRefreshEligibility(slate: GolfRefreshCandidate, state: GolfRefreshState | undefined, now = new Date()) {
  const today = now.toISOString().slice(0, 10);
  const start = Date.parse(`${slate.start_date}T00:00:00Z`);
  const end = Date.parse(`${slate.end_date}T00:00:00Z`);
  if (slate.sport !== "golf" || slate.is_locked || slate.archived_at)
    return { eligible: false, reason: "inactive" };
  if (!slate.external_event_id?.trim() || !Number.isFinite(start) || !Number.isFinite(end) || end < start)
    return { eligible: false, reason: "invalid_event_or_dates" };
  if (slate.start_date > new Date(now.getTime() + 8 * day).toISOString().slice(0, 10))
    return { eligible: false, reason: "before_window" };
  if (slate.end_date < new Date(now.getTime() - 2 * day).toISOString().slice(0, 10))
    return { eligible: false, reason: "after_window" };
  if (state?.next_attempt_at && Date.parse(state.next_attempt_at) > now.getTime())
    return { eligible: false, reason: "not_due" };
  return { eligible: true, reason: slate.start_date > today ? "upcoming" : slate.end_date < today ? "finalization" : "active" };
}

/** Use NFL's four-minute minimum on the five-minute trigger, with sparse pre-event polling. */
export function golfRefreshDelaySeconds(startDate: string, now: Date, tournamentStatus: string, waitingForField = false) {
  if (waitingForField) return 3600;
  if (tournamentStatus === "in_progress" || tournamentStatus === "final") return 240;
  const daysUntilStart = (Date.parse(`${startDate}T00:00:00Z`) - Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`)) / day;
  return daysUntilStart > 1 ? 21600 : daysUntilStart > 0 ? 3600 : 240;
}
