export type FantasySport = "nba" | "nfl" | "golf";

export function isFantasySport(value: unknown): value is FantasySport {
  return value === "nba" || value === "nfl" || value === "golf";
}

export function parseDraftSlateId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function draftUrl(sport: FantasySport, slateId?: number | null) {
  return `/lineups/draft?sport=${sport}${slateId ? `&slateId=${slateId}` : ""}`;
}

type DraftResponseContext = {
  groupId: string;
  sport: string;
  slateId: number;
};

/** Validate resource identity in addition to the caller's stale-response guard. */
export function matchesDraftResponse(body: unknown, expected: DraftResponseContext) {
  if (!body || typeof body !== "object") return false;
  const context = body as Partial<DraftResponseContext>;
  return context.groupId === expected.groupId && context.sport === expected.sport &&
    context.slateId === expected.slateId;
}
