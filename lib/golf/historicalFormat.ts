import { resolveGolfRules, type LeagueSettingsInput } from "@/lib/rules/leagueRules";

export type GolfHistoricalGameType = "standard" | "best_ball";
export type GolfHistoricalDraftType = "snake" | "salary_cap";
export type GolfHistoricalFilters = {
  gameType?: GolfHistoricalGameType | "all";
  draftType?: GolfHistoricalDraftType | "all";
};

export type GolfHistoricalFormatAvailability = {
  gameTypes: Record<GolfHistoricalGameType, boolean>;
  draftTypes: Record<GolfHistoricalDraftType, boolean>;
};

export function resolveGolfHistoricalFormat(rulesSnapshot: unknown) {
  const rules = resolveGolfRules(rulesSnapshot as LeagueSettingsInput | null | undefined);
  return { gameType: rules.gameType, draftType: rules.draft.type } as const;
}

export function matchesGolfHistoricalFormat(rulesSnapshot: unknown, filters: GolfHistoricalFilters = {}) {
  const format = resolveGolfHistoricalFormat(rulesSnapshot);
  return (filters.gameType === undefined || filters.gameType === "all" || format.gameType === filters.gameType)
    && (filters.draftType === undefined || filters.draftType === "all" || format.draftType === filters.draftType);
}

export function getGolfHistoricalFormatAvailability(
  qualifyingRulesSnapshots: unknown[],
): GolfHistoricalFormatAvailability {
  const availability: GolfHistoricalFormatAvailability = {
    gameTypes: {
      standard: false,
      best_ball: false,
    },
    draftTypes: {
      snake: false,
      salary_cap: false,
    },
  };

  qualifyingRulesSnapshots.forEach((rulesSnapshot) => {
    const format = resolveGolfHistoricalFormat(rulesSnapshot);
    availability.gameTypes[format.gameType] = true;
    availability.draftTypes[format.draftType] = true;
  });

  return availability;
}
