import type { PlayerIdentity } from "./types";

export type NbaCrosswalkEntry = {
  sport: "nba";
  provider: "espn";
  providerPlayerId: string;
  /** Namespaced local identity, e.g. 111:nba:players:123. */
  canonicalPlayerId: string;
  nbaPlayerId: string;
  evidence: string;
};

/** Only explicit crosswalks are accepted. No name matching, inferred numeric equivalence, or writes. */
export function resolveEspnNbaIdentity(id: string, entries: readonly NbaCrosswalkEntry[]): PlayerIdentity {
  if (!/^\d+$/.test(id)) throw new Error("Invalid ESPN NBA athlete ID");
  for (const entry of entries) {
    if (entry.sport !== "nba" || entry.provider !== "espn" || !/^\d+$/.test(entry.providerPlayerId)
      || !/^\d+$/.test(entry.nbaPlayerId) || !/^111:nba:players:[1-9]\d*$/.test(entry.canonicalPlayerId)
      || !entry.evidence.trim()) throw new Error("Invalid explicit NBA crosswalk entry");
  }
  const matches = entries.filter(entry => entry.providerPlayerId === id);
  if (!matches.length) return { status: "unresolved", canonicalPlayerId: null, reason: "No verified ESPN/NBA crosswalk" };
  const first = matches[0];
  const conflict = entries.some(entry =>
    (entry.providerPlayerId === id && (entry.canonicalPlayerId !== first.canonicalPlayerId || entry.nbaPlayerId !== first.nbaPlayerId))
    || ((entry.canonicalPlayerId === first.canonicalPlayerId || entry.nbaPlayerId === first.nbaPlayerId)
      && entry.providerPlayerId !== id));
  if (conflict) return { status: "unresolved", canonicalPlayerId: null, reason: "Conflicting NBA crosswalk" };
  return { status: "resolved", canonicalPlayerId: first.canonicalPlayerId, evidence: first.evidence };
}
