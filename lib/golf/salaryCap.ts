import { resolveGolfRules } from "../rules/leagueRules";
import { golfCentsToMoney, golfMoneyToCents, type GolfMoney } from "./money";

/** Read acquisition limits from this slate only; never recalculate a frozen cap. */
export function getGolfSalaryCapRules(snapshot: unknown) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const raw = snapshot as Record<string, unknown>;
  const draft = raw.draft as Record<string, unknown> | null;
  const roster = raw.roster as { slots?: Array<{ position?: unknown; slotCount?: unknown }> } | null;
  const slots = roster?.slots;
  if (draft?.type !== "salary_cap" || !Array.isArray(slots) || slots.length !== 1 ||
    slots[0]?.position !== "GOLFER" || typeof slots[0].slotCount !== "number" ||
    !Number.isSafeInteger(slots[0].slotCount) || slots[0].slotCount < 1 || slots[0].slotCount > 50 ||
    typeof draft.salaryCap !== "number" || !Number.isSafeInteger(draft.salaryCap) || draft.salaryCap < 1) return null;

  const rules = resolveGolfRules(raw);
  if (rules.draft.type !== "salary_cap") return null;
  return {
    rosterSize: rules.roster.slots[0].slotCount,
    budget: rules.draft.salaryCap,
    periodType: rules.rosterPeriods.type,
  };
}

/**
 * Salary Cap acquisition only. These helpers deliberately know nothing about
 * Golf scoring, draft order, or how a period became available.
 */
export type GolfSalaryCapPrice = {
  playerId: number;
  effectiveSalary: GolfMoney | null;
  eligible: boolean;
  isAmateur?: boolean;
};

export type GolfSalaryCapValidation =
  | { ok: true; totalSalary: string }
  | { ok: false; error: string };

function validPlayerId(value: number) {
  return Number.isSafeInteger(value) && value > 0;
}

function priceMap(prices: readonly GolfSalaryCapPrice[]) {
  const result = new Map<number, GolfSalaryCapPrice>();
  for (const price of prices) {
    if (!validPlayerId(price.playerId) || result.has(price.playerId)) {
      throw new Error("Invalid or duplicate Salary Cap price entry");
    }
    const cents = price.effectiveSalary === null ? null : golfMoneyToCents(price.effectiveSalary);
    if (price.effectiveSalary !== null && (cents === null || cents < 1000 || cents > 4200)) {
      throw new Error("Invalid frozen golfer salary");
    }
    result.set(price.playerId, price);
  }
  return result;
}

export function validateGolfSalaryCapLineup(input: {
  playerIds: readonly number[];
  prices: readonly GolfSalaryCapPrice[];
  rosterSize: number;
  salaryCap: GolfMoney;
}): GolfSalaryCapValidation {
  const capCents = golfMoneyToCents(input.salaryCap);
  if (!Number.isInteger(input.rosterSize) || input.rosterSize < 1 || capCents === null || capCents < 1) {
    throw new Error("Invalid Salary Cap configuration");
  }
  if (input.playerIds.length !== input.rosterSize) {
    return { ok: false, error: `Select exactly ${input.rosterSize} golfers.` };
  }
  if (new Set(input.playerIds).size !== input.playerIds.length || input.playerIds.some(id => !validPlayerId(id))) {
    return { ok: false, error: "Each golfer may be selected only once." };
  }
  const byId = priceMap(input.prices);
  let totalCents = 0;
  for (const playerId of input.playerIds) {
    const price = byId.get(playerId);
    if (!price?.eligible) return { ok: false, error: "A selected golfer is not eligible for this roster period." };
    if (price.effectiveSalary === null) return { ok: false, error: "A selected golfer does not have a frozen salary." };
    totalCents += golfMoneyToCents(price.effectiveSalary)!;
  }
  if (totalCents > capCents) return { ok: false, error: `Lineup exceeds the $${golfCentsToMoney(capCents)} salary cap.` };
  return { ok: true, totalSalary: golfCentsToMoney(totalCents) };
}

/**
 * True only when adding the player leaves enough money to fill every remaining
 * slot with distinct, eligible, frozen-price golfers. This is intentionally a
 * pure preview; save-time validation recalculates all salaries server-side.
 */
export function canAddGolfSalaryCapPlayer(input: {
  selectedPlayerIds: readonly number[];
  candidatePlayerId: number;
  prices: readonly GolfSalaryCapPrice[];
  rosterSize: number;
  salaryCap: GolfMoney;
}) {
  if (input.selectedPlayerIds.length >= input.rosterSize || input.selectedPlayerIds.includes(input.candidatePlayerId)) return false;
  const byId = priceMap(input.prices);
  const selected = [...input.selectedPlayerIds, input.candidatePlayerId];
  if (new Set(selected).size !== selected.length || selected.some(id => !validPlayerId(id))) return false;
  const selectedPrices = selected.map(id => byId.get(id));
  if (selectedPrices.some(price => !price?.eligible || price.effectiveSalary === null)) return false;
  const capCents = golfMoneyToCents(input.salaryCap);
  if (capCents === null) return false;
  const used = selectedPrices.reduce((sum, price) => sum + golfMoneyToCents(price!.effectiveSalary!)!, 0);
  if (used > capCents) return false;
  const slotsLeft = input.rosterSize - selected.length;
  const cheapestRemaining = input.prices
    .filter(price => price.eligible && price.effectiveSalary !== null && !selected.includes(price.playerId))
    .map(price => golfMoneyToCents(price.effectiveSalary!)!)
    .sort((a, b) => a - b)
    .slice(0, slotsLeft);
  return cheapestRemaining.length === slotsLeft && used + cheapestRemaining.reduce((sum, salary) => sum + salary, 0) <= capCents;
}
