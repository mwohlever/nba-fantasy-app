export const NBA_STATS = ["points", "rebounds", "assists", "steals", "blocks", "turnovers"] as const;
export type NbaStat = typeof NBA_STATS[number];
export type NbaStatLine = Record<NbaStat, number>;
export type NbaProvider = "espn" | "nba";
export type SeasonPhase = "regular" | "postseason" | "preseason" | "unknown";
export type PlayerIdentity =
  | { status: "resolved"; canonicalPlayerId: string; evidence: string }
  | { status: "unresolved"; canonicalPlayerId: null; reason: string };

/** One real player/event revision; never an app slate total or fantasy selection. */
export type NbaObservation = {
  sport: "nba";
  identity: PlayerIdentity;
  provider: NbaProvider;
  providerPlayerId: string;
  eventId: string;
  season: number; // Basketball season END year, e.g. 2025 = 2024-25.
  phase: SeasonPhase;
  gameAt: string | null;
  completedAt: string | null;
  team: { providerId: string | null; abbreviation: string | null };
  opponent: { providerId: string | null; abbreviation: string | null };
  homeAway: "home" | "away" | null;
  gameStatus: "final" | "in_progress" | "scheduled" | "unknown";
  finalEvidence: "explicit" | "result" | null;
  participation: "played" | "dnp" | "unknown";
  minutes: number | null;
  starter: boolean | null;
  stats: Record<NbaStat, number | null>;
  shooting: { fieldGoalsMade: number | null; fieldGoalsAttempted: number | null;
    freeThrowsMade: number | null; freeThrowsAttempted: number | null;
    threePointersMade: number | null; threePointersAttempted: number | null };
  provenance: {
    source: string;
    fetchedAt: string;
    /** First time THIS revision was recorded. Null means retrospective retrieval, not known historically. */
    knownAt: string | null;
  };
  missing: string[];
};

/** Strict timezone-bearing instant; reject date-only values and impossible calendar dates. */
export function instant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$/);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59
    || Number(match[7] ?? 0) > 23 || Number(match[8] ?? 0) > 59) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

export function completeStats(stats: NbaObservation["stats"]): NbaStatLine | null {
  return NBA_STATS.every(key => typeof stats[key] === "number" && Number.isFinite(stats[key]) && stats[key]! >= 0)
    ? { ...stats } as NbaStatLine : null;
}
export function observationKey(row: NbaObservation): string {
  return `${row.sport}:${row.provider}:${row.providerPlayerId}:${row.eventId}`;
}
