import type { EspnGameSummary, EspnStatGroup } from "@/lib/providers/nfl";

export type AggregatedNflStat = {
  espnPlayerId: string;
  playerName: string;
  passing_yards: number;
  passing_tds: number;
  passing_ints: number;
  rushing_yards: number;
  rushing_tds: number;
  receiving_yards: number;
  receiving_tds: number;
  receptions: number;
  fumbles_lost: number;
};

function blank(espnPlayerId: string, playerName: string): AggregatedNflStat {
  return {
    espnPlayerId,
    playerName,
    passing_yards: 0,
    passing_tds: 0,
    passing_ints: 0,
    rushing_yards: 0,
    rushing_tds: 0,
    receiving_yards: 0,
    receiving_tds: 0,
    receptions: 0,
    fumbles_lost: 0,
  };
}

function statValue(group: EspnStatGroup, stats: string[], label: string): number {
  const index = group.labels.indexOf(label);
  if (index === -1) return 0;
  const raw = stats[index];
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function aggregateEspnBoxscore(
  summary: EspnGameSummary
): Map<string, AggregatedNflStat> {
  const byPlayer = new Map<string, AggregatedNflStat>();

  function get(id: string, name: string) {
    const existing = byPlayer.get(id);
    if (existing) return existing;
    const fresh = blank(id, name);
    byPlayer.set(id, fresh);
    return fresh;
  }

  const teams = summary.boxscore?.players ?? [];

  for (const team of teams) {
    for (const group of team.statistics ?? []) {
      for (const row of group.athletes ?? []) {
        const id = row.athlete?.id;
        if (!id) continue;

        const stat = get(id, row.athlete.displayName);

        if (group.name === "passing") {
          stat.passing_yards = statValue(group, row.stats, "YDS");
          stat.passing_tds = statValue(group, row.stats, "TD");
          stat.passing_ints = statValue(group, row.stats, "INT");
        }

        if (group.name === "rushing") {
          stat.rushing_yards = statValue(group, row.stats, "YDS");
          stat.rushing_tds = statValue(group, row.stats, "TD");
        }

        if (group.name === "receiving") {
          stat.receiving_yards = statValue(group, row.stats, "YDS");
          stat.receiving_tds = statValue(group, row.stats, "TD");
          stat.receptions = statValue(group, row.stats, "REC");
        }

        if (group.name === "fumbles") {
          stat.fumbles_lost = statValue(group, row.stats, "LOST");
        }
      }
    }
  }

  return byPlayer;
}
