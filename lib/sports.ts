export type SportConfig = {
  key: string;
  label: string;
  emoji: string;
};

export const SPORTS: SportConfig[] = [
  { key: "nba", label: "NBA", emoji: "🏀" },
  { key: "nfl", label: "NFL", emoji: "🏈" },
];

export function getSportConfig(sportKey: string | null | undefined): SportConfig {
  return SPORTS.find((sport) => sport.key === sportKey) ?? SPORTS[0];
}

export const DEFAULT_SPORT = "nba";
