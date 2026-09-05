export type CreateSlateSport = "nba" | "nfl" | "golf";

export function resolveCreateSlateSport(
  value: string | null | undefined,
): CreateSlateSport {
  return value === "nfl" || value === "golf" ? value : "nba";
}

export function getCreateSlateHref(sport: CreateSlateSport) {
  return `/slates/new?sport=${sport}`;
}
