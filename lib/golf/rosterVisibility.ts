import { resolveGolfRules, type LeagueSettingsInput } from "../rules/leagueRules";
import type { GolfPeriod } from "./eligibleRoster";

export type GolfRosterVisibilityPeriod = {
  period_key: GolfPeriod;
  locked_at?: string | null;
  completed_at?: string | null;
  started_rounds?: number[] | null;
  evidence_snapshot?: { acquisitionDeadline?: unknown } | null;
};

function deadlineReached(period: GolfRosterVisibilityPeriod, now: number) {
  const value = period.evidence_snapshot?.acquisitionDeadline;
  const deadline = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(deadline) && deadline <= now;
}

/** Salary Cap roster secrecy is period-scoped; Snake selections retain their established public model. */
export function isGolfRosterPeriodRevealed(snapshot: LeagueSettingsInput | null | undefined,
  period: GolfRosterVisibilityPeriod | null | undefined, now = Date.now()) {
  if (resolveGolfRules(snapshot).draft.type !== "salary_cap") return true;
  if (!period) return false;
  if (period.locked_at || period.completed_at || deadlineReached(period, now)) return true;
  const started = period.started_rounds ?? [];
  return period.period_key === "weekend" ? started.some(round => round >= 3) : started.some(round => round >= 1);
}

export function canViewerSeeGolfRosterPeriod(input: {
  snapshot: LeagueSettingsInput | null | undefined;
  period: GolfRosterVisibilityPeriod | null | undefined;
  viewerTeamId: number | null | undefined;
  rosterTeamId: number;
  now?: number;
}) {
  return input.viewerTeamId === input.rosterTeamId || isGolfRosterPeriodRevealed(input.snapshot, input.period, input.now);
}
