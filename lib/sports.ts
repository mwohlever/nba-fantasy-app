export type SportConfig = {
  key: string;
  label: string;
  emoji: string;
  logo: string;
};

export type PlatformGameConfig = {
  key: "nba" | "nfl" | "golf" | "ncaa" | "nba-skins" | "bracket-challenge";
  label: string;
  description: string;
  logo: string;
};

export const SPORTS: SportConfig[] = [
  { key: "nba", label: "NBA", emoji: "🏀", logo: "/logos/nba.webp" },
  {
    key: "nba-skins",
    label: "NBA Skins",
    emoji: "🏀",
    logo: "/logos/nba.webp",
  },
  { key: "nfl", label: "NFL", emoji: "🏈", logo: "/logos/nfl.webp" },
  {
    key: "ncaa",
    label: "NCAA Pick 'Em",
    emoji: "🏈",
    logo: "/logos/nfl.webp",
  },
  { key: "golf", label: "Golf", emoji: "⛳", logo: "/logos/golf.webp" },
  {
    key: "bracket-challenge",
    label: "Bracket Challenge",
    emoji: "🏆",
    logo: "/logos/bracket.png",
  },
];

export const PLATFORM_GAMES: PlatformGameConfig[] = [
  {
    key: "nba",
    label: "NBA",
    description:
      "Daily fantasy drafts throughout the NBA calendar.",
    logo: "/logos/nba.webp",
  },
  {
    key: "nfl",
    label: "NFL",
    description:
      "Weekly fantasy drafts.",
    logo: "/logos/nfl.webp",
  },
  {
    key: "golf",
    label: "Golf",
    description:
      "Fantasy drafts for PGA TOUR tournaments.",
    logo: "/logos/golf.webp",
  },
  {
    key: "ncaa",
    label: "College Football Pick'em",
    description:
      "Weekly picks against your friends.",
    logo: "/logos/nfl.webp",
  },
  {
    key: "nba-skins",
    label: "NBA Skins",
    description:
      "A season-long NBA prediction game.",
    logo: "/logos/nba.webp",
  },
  {
    key: "bracket-challenge",
    label: "Bracket Challenge",
    description:
      "Tournament brackets for college football, March Madness, and more.",
    logo: "/logos/bracket.png",
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

  if (
    leagueSportKey ===
    "bracket_challenge"
  ) {
    return "bracket-challenge";
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

  if (
    sportKey ===
    "bracket-challenge"
  ) {
    return "bracket_challenge";
  }

  return sportKey;
}
