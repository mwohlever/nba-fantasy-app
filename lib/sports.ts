export type SportConfig = {
  key: string;
  label: string;
  emoji: string;
  logo: string;
};

export type PlatformGameConfig = {
  key: "nba" | "nfl" | "golf" | "ncaa" | "nba-skins";
  label: string;
  description: string;
  logo: string;
};

export const SPORTS: SportConfig[] = [
  { key: "nba", label: "NBA", emoji: "🏀", logo: "/logos/nba.png" },
  {
    key: "nba-skins",
    label: "NBA Skins",
    emoji: "🏀",
    logo: "/logos/nba.png",
  },
  { key: "nfl", label: "NFL", emoji: "🏈", logo: "/logos/nfl.png" },
  {
    key: "ncaa",
    label: "NCAA Pick 'Em",
    emoji: "🏈",
    logo: "/logos/nfl.png",
  },
  { key: "golf", label: "Golf", emoji: "⛳", logo: "/logos/golf.png" },
];

export const PLATFORM_GAMES: PlatformGameConfig[] = [
  {
    key: "nba",
    label: "NBA",
    description:
      "Daily fantasy drafts throughout the NBA calendar.",
    logo: "/logos/nba.png",
  },
  {
    key: "nfl",
    label: "NFL",
    description:
      "Weekly fantasy drafts.",
    logo: "/logos/nfl.png",
  },
  {
    key: "golf",
    label: "Golf",
    description:
      "Fantasy drafts for PGA TOUR tournaments.",
    logo: "/logos/golf.png",
  },
  {
    key: "ncaa",
    label: "College Football Pick'em",
    description:
      "Weekly picks against your friends.",
    logo: "/logos/nfl.png",
  },
  {
    key: "nba-skins",
    label: "NBA Skins",
    description:
      "A season-long NBA prediction game.",
    logo: "/logos/nba.png",
  },
];

export function getPlatformGameConfig(
  sportKey: string | null | undefined,
) {
  return PLATFORM_GAMES.find(
    (game) => game.key === sportKey,
  ) ?? null;
}

export function getSportConfig(
  sportKey: string | null | undefined,
): SportConfig {
  return SPORTS.find((sport) => sport.key === sportKey) ?? SPORTS[0];
}

export const DEFAULT_SPORT = "nba";


export function sportKeyFromLeagueSportKey(
  leagueSportKey:
    string,
) {
  if (
    leagueSportKey ===
    "nba_skins"
  ) {
    return "nba-skins";
  }

  if (
    leagueSportKey ===
    "ncaa_pickem"
  ) {
    return "ncaa";
  }

  return leagueSportKey;
}


export function leagueSportKeyFromSportKey(
  sportKey:
    string,
) {
  if (
    sportKey ===
    "nba-skins"
  ) {
    return "nba_skins";
  }

  if (
    sportKey ===
    "ncaa"
  ) {
    return "ncaa_pickem";
  }

  return sportKey;
}
