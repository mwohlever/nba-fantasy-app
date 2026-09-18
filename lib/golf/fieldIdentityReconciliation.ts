import {
  searchEspnPgaAthletesByName,
  type EspnGolfAthleteIdentity,
  type GolfCompetitor,
} from "@/lib/providers/golf";

type GolfDatabase = { from(table: string): any };

type CanonicalGolfer = {
  id: number;
  display_name: string | null;
  espn_player_id: string;
};

export type GolfIdentityDiagnostic = {
  espnPlayerId: string;
  displayName: string;
  status: "retained" | "resolved" | "created" | "ambiguous" | "unresolved";
  playerId?: number;
  source?: "event_competitor" | "analytics_history" | "athlete_search";
  reason?: string;
};

export function normalizeGolfIdentityName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function playerRow(competitor: GolfCompetitor, updatedAt: string) {
  return {
    espn_player_id: competitor.espnPlayerId,
    display_name: competitor.displayName,
    short_name: competitor.shortName,
    country: competitor.country,
    country_flag_url: competitor.countryFlagUrl,
    player_url: competitor.playerUrl,
    is_active: true,
    updated_at: updatedAt,
  };
}

/**
 * Reconciles ESPN competitors to canonical golfers without touching event/scoring
 * state. A uniquely named temporary PGA identity is updated in place so its ID
 * remains stable for field, roster, and historical references.
 */
export async function reconcileGolfFieldIdentities(input: {
  db: GolfDatabase;
  competitors: readonly GolfCompetitor[];
  refreshedAt: string;
}) {
  if (!input.competitors.length) {
    return { playerIdByEspnId: new Map<string, number>(), diagnostics: [] as GolfIdentityDiagnostic[], counts: { retained: 0, resolved: 0, created: 0, ambiguous: 0, unresolved: 0 } };
  }

  const existingResult = await input.db.from("golf_players").select("id, display_name, espn_player_id");
  if (existingResult.error) throw new Error(`Existing Golf players could not be loaded: ${existingResult.error.message}`);
  const existing = (existingResult.data ?? []) as CanonicalGolfer[];
  const byEspn = new Map(existing.map(player => [String(player.espn_player_id), player]));
  const byName = new Map<string, CanonicalGolfer[]>();
  for (const player of existing) {
    const name = normalizeGolfIdentityName(String(player.display_name ?? ""));
    if (!name) continue;
    const matches = byName.get(name) ?? [];
    matches.push(player);
    byName.set(name, matches);
  }

  const playerIdByEspnId = new Map<string, number>();
  const diagnostics: GolfIdentityDiagnostic[] = [];
  const rowsToUpsert: ReturnType<typeof playerRow>[] = [];
  const pending = new Map<string, GolfCompetitor>();

  for (const competitor of input.competitors) {
    const exact = byEspn.get(competitor.espnPlayerId);
    if (exact) {
      playerIdByEspnId.set(competitor.espnPlayerId, Number(exact.id));
      rowsToUpsert.push(playerRow(competitor, input.refreshedAt));
      diagnostics.push({ espnPlayerId: competitor.espnPlayerId, displayName: competitor.displayName, status: "retained", playerId: Number(exact.id) });
      continue;
    }
    const matches = byName.get(normalizeGolfIdentityName(competitor.displayName)) ?? [];
    const temporary = matches.length === 1 && String(matches[0].espn_player_id).startsWith("pga:") ? matches[0] : null;
    if (temporary) {
      const updated = await input.db.from("golf_players").update(playerRow(competitor, input.refreshedAt)).eq("id", temporary.id);
      if (updated.error) throw new Error(`Could not reconcile ${competitor.displayName} from PGA TOUR to ESPN: ${updated.error.message}`);
      playerIdByEspnId.set(competitor.espnPlayerId, Number(temporary.id));
      diagnostics.push({ espnPlayerId: competitor.espnPlayerId, displayName: competitor.displayName, status: "resolved", playerId: Number(temporary.id) });
      continue;
    }
    if (matches.length > 1) {
      diagnostics.push({ espnPlayerId: competitor.espnPlayerId, displayName: competitor.displayName, status: "ambiguous" });
      continue;
    }
    pending.set(competitor.espnPlayerId, competitor);
    rowsToUpsert.push(playerRow(competitor, input.refreshedAt));
  }

  if (rowsToUpsert.length) {
    const saved = await input.db.from("golf_players").upsert(rowsToUpsert, { onConflict: "espn_player_id" }).select("id, display_name, espn_player_id");
    if (saved.error) throw new Error(`Failed to save Golf players: ${saved.error.message}`);
    for (const player of (saved.data ?? []) as CanonicalGolfer[]) {
      playerIdByEspnId.set(String(player.espn_player_id), Number(player.id));
    }
  }
  for (const competitor of pending.values()) {
    const playerId = playerIdByEspnId.get(competitor.espnPlayerId);
    diagnostics.push({ espnPlayerId: competitor.espnPlayerId, displayName: competitor.displayName,
      status: playerId === undefined ? "unresolved" : "created", playerId });
  }
  for (const competitor of input.competitors) {
    if (!playerIdByEspnId.has(competitor.espnPlayerId) && !diagnostics.some(row => row.espnPlayerId === competitor.espnPlayerId && ["ambiguous", "unresolved"].includes(row.status))) {
      diagnostics.push({ espnPlayerId: competitor.espnPlayerId, displayName: competitor.displayName, status: "unresolved" });
    }
  }
  const counts = { retained: 0, resolved: 0, created: 0, ambiguous: 0, unresolved: 0 };
  for (const row of diagnostics) counts[row.status]++;
  return { playerIdByEspnId, diagnostics, counts };
}

function uniqueCandidates(
  candidates: readonly EspnGolfAthleteIdentity[],
  normalizedName: string,
) {
  return [...new Map(
    candidates
      .filter((candidate) =>
        /^\d+$/.test(candidate.espnPlayerId) &&
        normalizeGolfIdentityName(candidate.displayName) === normalizedName,
      )
      .map((candidate) => [candidate.espnPlayerId, candidate]),
  ).values()];
}

/**
 * Resolves only already-canonical PGA placeholders.  A source must provide one
 * exact normalized name and one numeric ESPN athlete ID; otherwise it is left
 * untouched for commissioner review.
 */
export async function reconcileGolfPgaPlaceholderIdentities(input: {
  db: GolfDatabase;
  playerIds: readonly number[];
  refreshedAt: string;
  athleteSearch?: (names: readonly string[]) => Promise<Map<string, EspnGolfAthleteIdentity[]>>;
}) {
  const targetIds = new Set(input.playerIds.map(Number).filter(Number.isSafeInteger));
  if (!targetIds.size) {
    return { counts: { resolved: 0, ambiguous: 0, unresolved: 0 }, diagnostics: [] as GolfIdentityDiagnostic[] };
  }

  const existingResult = await input.db.from("golf_players").select("id, display_name, espn_player_id");
  if (existingResult.error) throw new Error(`Existing Golf players could not be loaded: ${existingResult.error.message}`);
  const existing = (existingResult.data ?? []) as CanonicalGolfer[];
  const byName = new Map<string, CanonicalGolfer[]>();
  const byEspn = new Map(existing.map((player) => [String(player.espn_player_id), player]));
  for (const player of existing) {
    const name = normalizeGolfIdentityName(String(player.display_name ?? ""));
    if (name) byName.set(name, [...(byName.get(name) ?? []), player]);
  }
  const targets = existing.filter((player) => targetIds.has(Number(player.id)) && String(player.espn_player_id).startsWith("pga:"));
  if (!targets.length) {
    return { counts: { resolved: 0, ambiguous: 0, unresolved: 0 }, diagnostics: [] as GolfIdentityDiagnostic[] };
  }

  const targetNames = [...new Set(targets.map((player) => String(player.display_name ?? "").trim()).filter(Boolean))];
  const historyResult = await input.db.from("golf_analytics_observations")
    .select("provider_player_id, provider_name")
    .in("provider_name", targetNames);
  if (historyResult.error) throw new Error(`Golf analytics identities could not be loaded: ${historyResult.error.message}`);
  const historyByName = new Map<string, EspnGolfAthleteIdentity[]>();
  for (const row of historyResult.data ?? []) {
    const name = typeof row.provider_name === "string" ? row.provider_name : "";
    const id = String(row.provider_player_id ?? "");
    if (!name || !/^\d+$/.test(id)) continue;
    historyByName.set(name, [...(historyByName.get(name) ?? []), { espnPlayerId: id, displayName: name }]);
  }
  let searched = new Map<string, EspnGolfAthleteIdentity[]>();
  try {
    searched = await (input.athleteSearch ?? searchEspnPgaAthletesByName)(targetNames);
  } catch (error) {
    // ESPN search is supplemental. PGA's field remains authoritative even
    // when its broader identity directory is temporarily unavailable.
    console.warn("Supplemental ESPN Golf athlete search unavailable:", error);
  }
  const diagnostics: GolfIdentityDiagnostic[] = [];

  for (const target of targets) {
    const displayName = String(target.display_name ?? "");
    const normalizedName = normalizeGolfIdentityName(displayName);
    const canonicalMatches = byName.get(normalizedName) ?? [];
    const history = uniqueCandidates(historyByName.get(displayName) ?? [], normalizedName);
    const search = uniqueCandidates(searched.get(displayName) ?? [], normalizedName);
    const candidateIds = new Set([...history, ...search].map((candidate) => candidate.espnPlayerId));

    if (canonicalMatches.length !== 1 || candidateIds.size > 1) {
      diagnostics.push({ espnPlayerId: String(target.espn_player_id), displayName, status: "ambiguous", playerId: Number(target.id), reason: canonicalMatches.length !== 1 ? "ambiguous_canonical_name" : "conflicting_provider_evidence" });
      continue;
    }
    const candidate = history[0] ?? search[0];
    if (!candidate) {
      diagnostics.push({ espnPlayerId: String(target.espn_player_id), displayName, status: "unresolved", playerId: Number(target.id), reason: "no_unique_espn_identity" });
      continue;
    }
    if (byEspn.has(candidate.espnPlayerId)) {
      diagnostics.push({ espnPlayerId: String(target.espn_player_id), displayName, status: "ambiguous", playerId: Number(target.id), reason: "espn_identity_already_canonical" });
      continue;
    }
    const updated = await input.db.from("golf_players")
      .update({ espn_player_id: candidate.espnPlayerId, updated_at: input.refreshedAt })
      .eq("id", target.id);
    if (updated.error) throw new Error(`Could not reconcile ${displayName} to ESPN: ${updated.error.message}`);
    byEspn.set(candidate.espnPlayerId, { ...target, espn_player_id: candidate.espnPlayerId });
    diagnostics.push({ espnPlayerId: candidate.espnPlayerId, displayName, status: "resolved", playerId: Number(target.id), source: history.length ? "analytics_history" : "athlete_search" });
  }
  const counts = { resolved: 0, ambiguous: 0, unresolved: 0 };
  for (const row of diagnostics) counts[row.status as keyof typeof counts]++;
  return { counts, diagnostics };
}
