import { nflSlateWindow } from "./nflFantasyGames";

export type FantasyOwner = { name: string; isYou: boolean };
export type NflOwnership = { groupId: string; leagueId: string; slateId: number | null; players: Record<string, FantasyOwner> };
type Slate = { id: number; date: string; start_date?: string | null; end_date?: string | null };

// Same Eastern calendar-day window used by NFL fantasy -> Game Center links.
// Ambiguous overlapping slates deliberately produce no ownership.
export function matchingNflSlate(slates: Slate[], kickoff: string) {
  if (!Number.isFinite(Date.parse(kickoff))) return null;
  const day = new Date(kickoff).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  const matches = slates.filter(slate => {
    const window = nflSlateWindow(slate);
    return window && day >= window.start && day <= window.end;
  });
  return matches.length === 1 ? matches[0] : null;
}

export function nflAthleteId(value: unknown): string | null {
  const id = String(value ?? "");
  // Numeric ESPN IDs only; synthetic D/ST rows are excluded by the loader.
  return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? String(Number(id)) : null;
}

export function buildNflOwnership(rows: Array<{ providerId: unknown; teamId: number; name: string }>, ownTeamId?: number) {
  const players: Record<string, FantasyOwner> = {};
  const owners = new Map<string, number>();
  const ambiguous = new Set<string>();
  for (const row of rows) {
    const id = nflAthleteId(row.providerId);
    if (!id || ambiguous.has(id)) continue;
    if (owners.has(id) && owners.get(id) !== row.teamId) {
      delete players[id]; ambiguous.add(id); continue;
    }
    owners.set(id, row.teamId);
    players[id] = { name: row.name, isYou: row.teamId === ownTeamId };
  }
  return players;
}
