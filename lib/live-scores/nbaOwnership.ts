export type FantasyOwner = { name: string; isYou: boolean };
export type NbaOwnership = { groupId: string; leagueId: string; slateId: number | null; players: Record<string, FantasyOwner> };
type Slate = { id: number; date: string; start_date?: string | null; end_date?: string | null };

const easternDay = (value: string) => Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleDateString("en-CA", { timeZone: "America/New_York" })
  : null;

/** The NBA Live ownership context is the one unambiguous NBA slate whose Eastern-date window contains the ESPN game. */
export function matchingNbaSlate(slates: Slate[], tipoff: string) {
  const day = easternDay(tipoff);
  if (!day) return null;
  const matches = slates.filter((slate) => {
    const start = slate.start_date ?? slate.date;
    const end = slate.end_date ?? slate.date;
    return Boolean(start && end && day >= start && day <= end);
  });
  return matches.length === 1 ? matches[0] : null;
}

export function nbaAthleteId(value: unknown): string | null {
  const id = String(value ?? "");
  return /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) && Number(id) > 0 ? String(Number(id)) : null;
}

// ESPN does not expose the NBA provider ID in its NBA box-score athlete object.
// This is intentionally exact canonical-name matching, never fuzzy matching.
export function canonicalNbaPlayerName(value: unknown): string | null {
  const name = String(value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\.?\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
  return name.length >= 3 ? name : null;
}

type Athlete = { id: unknown; displayName?: unknown };
type RosteredPlayer = { localPlayerId: number; playerName: string; teamId: number; teamName: string };

export function buildNbaOwnership(athletes: Athlete[], rostered: RosteredPlayer[], ownTeamId?: number) {
  const byName = new Map<string, RosteredPlayer[]>();
  for (const player of rostered) {
    const key = canonicalNbaPlayerName(player.playerName);
    if (key) byName.set(key, [...(byName.get(key) ?? []), player]);
  }
  const players: Record<string, FantasyOwner> = {};
  for (const athlete of athletes) {
    const athleteId = nbaAthleteId(athlete.id);
    const key = canonicalNbaPlayerName(athlete.displayName);
    const matches = key ? byName.get(key) ?? [] : [];
    // One athlete must resolve to exactly one local player and fantasy team.
    if (!athleteId || matches.length !== 1) continue;
    const owner = matches[0];
    players[athleteId] = { name: owner.teamName, isYou: owner.teamId === ownTeamId };
  }
  return players;
}
