export type SportConfig = {
  key: string;
  label: string;
  emoji: string;
  logo: string;
};

export const SPORTS: SportConfig[] = [
  { key: "nba", label: "NBA", emoji: "🏀", logo: "/logos/nba.png" },
  { key: "nfl", label: "NFL", emoji: "🏈", logo: "/logos/nfl.png" },
];

export function getSportConfig(sportKey: string | null | undefined): SportConfig {
  return SPORTS.find((sport) => sport.key === sportKey) ?? SPORTS[0];
}

export const DEFAULT_SPORT = "nba";
