import type { EspnGameSummary, EspnStatGroup } from "@/lib/providers/nfl";
import type { NflDstStats } from "@/lib/scoring/nfl";

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

function teamStatValue(
  summary: EspnGameSummary,
  teamId: string,
  name: string,
  label?: string,
) {
  const team = summary.boxscore?.teams?.find(
    (candidate) => String(candidate.team?.id ?? "") === teamId,
  );

  const statistic = team?.statistics?.find(
    (candidate) =>
      candidate.name === name &&
      (!label || candidate.label === label),
  );

  return statistic?.displayValue ?? null;
}

function numericTeamStat(
  summary: EspnGameSummary,
  teamId: string,
  name: string,
  label?: string,
) {
  const value = Number(teamStatValue(summary, teamId, name, label));
  return Number.isFinite(value) ? value : 0;
}

export function aggregateEspnDstBoxscore(
  summary: EspnGameSummary,
  defenseTeamId: string,
): NflDstStats | null {
  const competition = summary.header?.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const defense = competitors.find(
    (competitor) => String(competitor.team?.id ?? "") === defenseTeamId,
  );
  const opponent = competitors.find(
    (competitor) => String(competitor.team?.id ?? "") !== defenseTeamId,
  );
  const opponentTeamId = String(opponent?.team?.id ?? "");
  const opponentTotalYards =
    teamStatValue(summary, opponentTeamId, "totalYards");

  if (!defense || !opponentTeamId || opponentTotalYards === null) {
    return null;
  }

  const sacksYardsLost =
    teamStatValue(summary, opponentTeamId, "sacksYardsLost") ?? "";
  const sackCount = Number(sacksYardsLost.split("-")[0]);
  const pointsAllowed = Number(opponent?.score);
  const safeties = (summary.scoringPlays ?? []).filter(
    (play) =>
      play.type?.id === "20" &&
      String(play.team?.id ?? "") === defenseTeamId,
  ).length;

  return {
    sacks: Number.isFinite(sackCount) ? sackCount : 0,
    interceptions: numericTeamStat(
      summary,
      opponentTeamId,
      "interceptions",
      "Interceptions thrown",
    ),
    fumbleRecoveries: numericTeamStat(
      summary,
      opponentTeamId,
      "fumblesLost",
    ),
    safeties,
    touchdowns: numericTeamStat(
      summary,
      defenseTeamId,
      "defensiveTouchdowns",
    ),
    pointsAllowed: Number.isFinite(pointsAllowed) ? pointsAllowed : 0,
    yardsAllowed: Number(opponentTotalYards),
  };
}
