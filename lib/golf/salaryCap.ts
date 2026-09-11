/**
 * Salary Cap acquisition only. These helpers deliberately know nothing about
 * Golf scoring, draft order, or how a period became available.
 */
export type GolfSalaryCapPrice = {
  playerId: number;
  effectiveSalary: number | null;
  eligible: boolean;
  isAmateur?: boolean;
};

export type GolfSalaryCapValidation =
  | { ok: true; totalSalary: number }
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
    if (price.effectiveSalary !== null &&
      (!Number.isInteger(price.effectiveSalary) || price.effectiveSalary < 10 || price.effectiveSalary > 42)) {
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
  salaryCap: number;
}): GolfSalaryCapValidation {
  if (!Number.isInteger(input.rosterSize) || input.rosterSize < 1 ||
    !Number.isInteger(input.salaryCap) || input.salaryCap < 1) {
    throw new Error("Invalid Salary Cap configuration");
  }
  if (input.playerIds.length !== input.rosterSize) {
    return { ok: false, error: `Select exactly ${input.rosterSize} golfers.` };
  }
  if (new Set(input.playerIds).size !== input.playerIds.length || input.playerIds.some(id => !validPlayerId(id))) {
    return { ok: false, error: "Each golfer may be selected only once." };
  }
  const byId = priceMap(input.prices);
  let totalSalary = 0;
  for (const playerId of input.playerIds) {
    const price = byId.get(playerId);
    if (!price?.eligible) return { ok: false, error: "A selected golfer is not eligible for this roster period." };
    if (price.effectiveSalary === null) return { ok: false, error: "A selected golfer does not have a frozen salary." };
    totalSalary += price.effectiveSalary;
  }
  if (totalSalary > input.salaryCap) return { ok: false, error: `Lineup exceeds the $${input.salaryCap} salary cap.` };
  return { ok: true, totalSalary };
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
  salaryCap: number;
}) {
  if (input.selectedPlayerIds.length >= input.rosterSize || input.selectedPlayerIds.includes(input.candidatePlayerId)) return false;
  const byId = priceMap(input.prices);
  const selected = [...input.selectedPlayerIds, input.candidatePlayerId];
  if (new Set(selected).size !== selected.length || selected.some(id => !validPlayerId(id))) return false;
  const selectedPrices = selected.map(id => byId.get(id));
  if (selectedPrices.some(price => !price?.eligible || price.effectiveSalary === null)) return false;
  const used = selectedPrices.reduce((sum, price) => sum + price!.effectiveSalary!, 0);
  if (used > input.salaryCap) return false;
  const slotsLeft = input.rosterSize - selected.length;
  const cheapestRemaining = input.prices
    .filter(price => price.eligible && price.effectiveSalary !== null && !selected.includes(price.playerId))
    .map(price => price.effectiveSalary!)
    .sort((a, b) => a - b)
    .slice(0, slotsLeft);
  return cheapestRemaining.length === slotsLeft && used + cheapestRemaining.reduce((sum, salary) => sum + salary, 0) <= input.salaryCap;
}
