export function calculateNflFantasyPoints(stats: {
  passing_yards: number;
  passing_tds: number;
  passing_ints: number;
  rushing_yards: number;
  rushing_tds: number;
  receiving_yards: number;
  receiving_tds: number;
  receptions: number;
  fumbles_lost: number;
}) {
  return (
    stats.passing_yards / 25 +
    stats.passing_tds * 4 -
    stats.passing_ints * 2 +
    stats.rushing_yards / 10 +
    stats.rushing_tds * 6 +
    stats.receiving_yards / 10 +
    stats.receiving_tds * 6 +
    stats.receptions * 1 -
    stats.fumbles_lost * 2
  );
}
