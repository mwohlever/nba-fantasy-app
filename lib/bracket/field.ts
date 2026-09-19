export type BracketFieldTeamInput = {
  seed: number;
  providerTeamId: string;
  displayName: string;
  abbreviation?: string | null;
  logoUrl?: string | null;
};

export type BracketFieldIdentity = Pick<
  BracketFieldTeamInput,
  "seed" | "providerTeamId"
>;

export type FixedSeedGameSlot = {
  gameId: number;
  side: "a" | "b";
  seed: number;
};

type SeededGameRow = {
  id: number | string;
  source_a_game_id: number | string | null;
  source_b_game_id: number | string | null;
  source_a_seed: number | null;
  source_b_seed: number | null;
};

function optionalText(value: string | null | undefined) {
  const normalized = value?.trim() ?? "";
  return normalized || null;
}

/** Validates and canonically orders the complete, CFP-only field payload. */
export function normalizeCfpField(
  teams: BracketFieldTeamInput[],
): BracketFieldTeamInput[] {
  if (!Array.isArray(teams) || teams.length !== 12) {
    throw new Error("The CFP field must contain exactly 12 teams.");
  }

  const normalized = teams.map((team) => ({
    seed: Number(team.seed),
    providerTeamId: String(team.providerTeamId ?? "").trim(),
    displayName: String(team.displayName ?? "").trim(),
    abbreviation: optionalText(team.abbreviation),
    logoUrl: optionalText(team.logoUrl),
  }));

  const seeds = normalized.map((team) => team.seed).sort((a, b) => a - b);
  if (seeds.some((seed, index) => !Number.isInteger(seed) || seed !== index + 1)) {
    throw new Error("The CFP field must contain seeds 1 through 12 exactly once.");
  }

  if (normalized.some((team) => !team.providerTeamId || !team.displayName)) {
    throw new Error("Every CFP seed must have a valid ESPN team.");
  }

  const providerIds = normalized.map((team) => team.providerTeamId);
  if (new Set(providerIds).size !== providerIds.length) {
    throw new Error("The same ESPN team cannot occupy multiple CFP seeds.");
  }

  return normalized.sort((a, b) => a.seed - b.seed);
}

/** Returns only direct seed slots; winner/dependency slots are intentionally excluded. */
export function fixedSeedGameSlots(rows: SeededGameRow[]): FixedSeedGameSlot[] {
  const slots: FixedSeedGameSlot[] = [];

  for (const row of rows) {
    if (row.source_a_seed != null && row.source_a_game_id == null) {
      slots.push({ gameId: Number(row.id), side: "a", seed: Number(row.source_a_seed) });
    }
    if (row.source_b_seed != null && row.source_b_game_id == null) {
      slots.push({ gameId: Number(row.id), side: "b", seed: Number(row.source_b_seed) });
    }
  }

  return slots.sort((left, right) => left.seed - right.seed);
}

export function hasCfpFieldIdentityChanged(
  current: BracketFieldIdentity[],
  next: BracketFieldIdentity[],
) {
  const identity = (teams: BracketFieldIdentity[]) =>
    teams
      .map((team) => `${Number(team.seed)}:${String(team.providerTeamId).trim()}`)
      .sort()
      .join("|");

  return identity(current) !== identity(next);
}
