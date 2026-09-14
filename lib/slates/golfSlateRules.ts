import {
  resolveGolfRules,
  type GolfDraftType,
  type GolfGameType,
  type GolfRosterPeriodType,
  type GolfRules,
  type LeagueSettingsInput,
  type RosterSlotRule,
} from "../rules/leagueRules";

export type GolfSlateRuleSelection = {
  gameType?: unknown;
  draft?: { type?: unknown; salaryCap?: unknown } | null;
  rosterPeriods?: { type?: unknown } | null;
} | null;

const GAME_TYPES: readonly GolfGameType[] = ["standard", "best_ball"];
const DRAFT_TYPES: readonly GolfDraftType[] = ["snake", "salary_cap"];
const PERIOD_TYPES: readonly GolfRosterPeriodType[] = [
  "full_tournament",
  "split_after_round_2",
];

function selectedValue<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
  label: string,
) {
  if (value === undefined) return fallback;
  if (typeof value === "string" && allowed.includes(value as T)) {
    return value as T;
  }

  throw new Error(`Invalid Golf ${label}.`);
}

/**
 * Build the frozen rules for one newly-created Golf slate. Group settings are
 * defaults only; the returned object is a newly resolved canonical snapshot.
 */
export function buildGolfSlateRulesSnapshot(input: {
  groupSettings: LeagueSettingsInput | null | undefined;
  selection?: GolfSlateRuleSelection;
  rosterSlots?: RosterSlotRule[];
}): GolfRules {
  const defaults = resolveGolfRules(input.groupSettings);
  const selection = input.selection ?? undefined;
  const gameType = selectedValue(
    selection?.gameType,
    GAME_TYPES,
    defaults.gameType,
    "game type",
  );
  const draftType = selectedValue(
    selection?.draft?.type,
    DRAFT_TYPES,
    defaults.draft.type,
    "draft type",
  );
  const rosterPeriodType = selectedValue(
    selection?.rosterPeriods?.type,
    PERIOD_TYPES,
    defaults.rosterPeriods.type,
    "roster period",
  );
  const rosterSlots = input.rosterSlots?.length
    ? input.rosterSlots
    : defaults.roster.slots;

  if (
    rosterSlots.length !== 1 ||
    rosterSlots[0]?.position.trim().toUpperCase() !== "GOLFER"
  ) {
    throw new Error("Golf rosters must use the canonical GOLFER slot.");
  }

  const rosterSize = rosterSlots.reduce(
    (total, slot) => total + slot.slotCount,
    0,
  );

  if (!Number.isSafeInteger(rosterSize) || rosterSize < 1 || rosterSize > 50) {
    throw new Error("Golf roster size must be a whole number from 1 to 50.");
  }

  return resolveGolfRules({
    ...defaults,
    gameType,
    draft:
      draftType === "salary_cap"
        ? { type: "salary_cap", salaryCap: rosterSize * 25 }
        : { type: "snake" },
    rosterPeriods: { type: rosterPeriodType },
    roster: { slots: rosterSlots },
  });
}
