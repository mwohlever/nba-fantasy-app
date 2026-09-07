type Play = {
  id?: string;
  period?: { number?: number };
  clock?: { displayValue?: string };
  text?: string;
  awayScore?: number;
  homeScore?: number;
  start?: { shortDownDistanceText?: string };
};

/** Drive order is ESPN's chronology; repeated/coarse clocks are not sort keys. */
export function footballPlaysByQuarter<T extends Play>(drives: Array<{ plays?: T[] }>) {
  const quarters = new Map<number, T[]>();
  const seen = new Set<string>();
  for (const drive of drives) {
    for (const play of drive.plays ?? []) {
      const period = play.period?.number;
      if (!period) continue;
      const key = play.id || [period, play.clock?.displayValue ?? "", play.text ?? "",
        play.start?.shortDownDistanceText ?? "", play.awayScore ?? "", play.homeScore ?? ""].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const plays = quarters.get(period) ?? [];
      plays.push(play);
      quarters.set(period, plays);
    }
  }
  return [...quarters.entries()].sort(([a], [b]) => b - a)
    .map(([period, plays]) => ({ period, plays: plays.reverse() }));
}
