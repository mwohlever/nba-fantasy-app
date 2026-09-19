import { resolveGolfRules, type LeagueSettingsInput } from "../rules/leagueRules";

export type GolfRosterPeriodFact = {
  period_key: "full_tournament" | "opening" | "weekend";
  opened_at?: string | null;
  completed_at?: string | null;
  started_rounds?: number[] | null;
};

/** Resolve the active public/scoring period from retained lifecycle facts.
 * Weekend being opened only grants its owner a private acquisition window.
 */
export function relevantGolfRosterPeriodKey(
  snapshot: LeagueSettingsInput | null | undefined,
  periods: readonly GolfRosterPeriodFact[],
) {
  const rules = resolveGolfRules(snapshot);
  if (rules.rosterPeriods.type === "full_tournament") return "full_tournament" as const;

  const weekend = periods.find((period) => period.period_key === "weekend");
  return weekend &&
    (weekend.completed_at ||
      (weekend.started_rounds ?? []).some((round) => round >= 3))
    ? "weekend" as const
    : "opening" as const;
}
