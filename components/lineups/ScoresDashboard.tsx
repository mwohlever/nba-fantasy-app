"use client";

import { NflFantasyGameAction } from "./NflFantasyGameCenter";

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import GolfScoresDashboard from "@/components/lineups/GolfScoresDashboard";
import TeamAvatar from "@/components/ui/TeamAvatar";
import { scoresStatLine } from "@/lib/lineups/scoresStatLine";
import { getStatColumns } from "@/lib/statColumns";
import {
  assignPlayersToRosterSlots,
  getDefaultRosterSlotsForSport,
} from "@/lib/rules/leagueRules";
import type {
  OrderedTeam,
  Player,
  PlayerStat,
  RosterSlotConfig,
  Slate,
} from "@/components/lineups/types";

type TeamStats = {
  totalPlayers: number;
  guards: number;
  fcPlayers: number;
  statTotals?: Record<string, number>;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  total: number;
  games_completed: number;
  games_in_progress: number;
  games_remaining: number;
  finish_position: number | null;
};

type PlayerBoxScore = Record<string, number> & {
  fantasy_points: number;
};

type RefreshSummary = {
  gamesFound?: number;
  playerStatsUpserted?: number;
  teamResultsUpserted?: number;
} | null;

type Props = {
  currentTeamId?: number | null;
  scopeKey?: string;
  players: Player[];
  teams: OrderedTeam[];
  selectedSlate: Slate | null;
  rosterSlots?: RosterSlotConfig[];
  lastRefreshSummary: RefreshSummary;
  getPlayersForTeam: (teamId: number) => Player[];
  getTeamStats: (teamId: number) => TeamStats;
  getPlayerStat: (playerId: number) => PlayerBoxScore;
  getRawPlayerStat: (playerId: number) => PlayerStat | null;
  getLiveProjectedTeamTotal: (teamId: number) => number;
  getPregameProjectedTeamTotal: (teamId: number) => number | null;
  liveWinPctMap: Map<number, number>;
  playerProjections: Record<number, any>;
  controls?: ReactNode;
  setProfilePlayer: (player: Player | null) => void;
};

function formatScore(value: number | null | undefined) {
  const numeric = Number(value ?? 0);

  return Number.isFinite(numeric)
    ? numeric.toFixed(1)
    : "0.0";
}

function getPlayerGameStatus(stat: PlayerStat | null) {
  if (!stat) {
    return {
      label: "Upcoming",
      tone: "upcoming",
      detail: "Not started",
    };
  }

  if (
    stat.game_status === 3 ||
    /final/i.test(stat.game_status_text ?? "")
  ) {
    return {
      label: "Final",
      tone: "final",
      detail: "Game complete",
    };
  }

  if (stat.game_status === 2) {
    const periodLabel = stat.period
      ? `Q${stat.period}`
      : "Live";

    const clock =
      stat.game_clock
        ?.replace(/^PT/, "")
        .replace("M", ":")
        .replace(/S$/, "")
        .replace(/\.0$/, "") ?? "";

    return {
      label: "Live",
      tone: "live",
      detail: [periodLabel, clock]
        .filter(Boolean)
        .join(" "),
    };
  }

  return {
    label: "Upcoming",
    tone: "upcoming",
    detail:
      stat.game_status_text?.trim() ||
      "Not started",
  };
}

function medalForPosition(position: number) {
  if (position === 1) return "🥇";
  if (position === 2) return "🥈";
  if (position === 3) return "🥉";
  return `${position}.`;
}

function TraditionalScoresDashboard({
  teams, selectedSlate, rosterSlots, currentTeamId = null, scopeKey = "",
  getPlayersForTeam, getTeamStats, getPlayerStat, getRawPlayerStat,
  getLiveProjectedTeamTotal, getPregameProjectedTeamTotal, liveWinPctMap,
  controls, setProfilePlayer,
}: Props) {
  const sport = selectedSlate?.sport ?? "nba";
  const statColumns = getStatColumns(sport);
  const effectiveRosterSlots = rosterSlots?.length ? rosterSlots :
    getDefaultRosterSlotsForSport(sport as "nba" | "nfl" | "golf");
  const leaderboard = useMemo(() => teams
    .filter(team => team.is_participating !== false)
    .map(team => {
      const stats = getTeamStats(team.id);
      return { team, stats, score: Number(stats.total ?? 0),
        projected: getLiveProjectedTeamTotal(team.id), winPct: liveWinPctMap.get(team.id) ?? 0 };
    }).sort((a, b) => b.score - a.score),
    [teams, getTeamStats, getLiveProjectedTeamTotal, liveWinPctMap]);

  const expansionScope = JSON.stringify([scopeKey, sport, selectedSlate?.id]);
  const [expansion, setExpansion] = useState<{ scope: string; teamId: number | null }>(
    () => ({ scope: expansionScope, teamId: null }),
  );
  const needsReset = expansion.scope !== expansionScope ||
    (expansion.teamId !== null && !leaderboard.some(row => row.team.id === expansion.teamId));
  const expandedTeamId = needsReset ? null : expansion.teamId;
  useEffect(() => {
    if (needsReset) setExpansion({ scope: expansionScope, teamId: null });
  }, [needsReset, expansionScope]);

  return <section className="scores-dashboard-shell scores-vertical-board">
    <h1 className="sr-only">Scores</h1>
    {controls ? <div className="scores-dashboard-controls">{controls}</div> : null}
    {leaderboard.length === 0 && <p className="scores-dashboard-empty">No participating teams are available.</p>}
    <div className="scores-standings" aria-label="Fantasy standings">
      {leaderboard.map((row, index) => {
        const expanded = expandedTeamId === row.team.id;
        const rosterId = `scores-roster-${sport}-${selectedSlate?.id ?? "none"}-${row.team.id}`;
        const headingId = `${rosterId}-heading`;
        const ownTeam = row.team.id === currentTeamId;
        const teamPlayers = expanded ? getPlayersForTeam(row.team.id) : [];
        const assignment = expanded ? assignPlayersToRosterSlots({
          sport: sport as "nba" | "nfl" | "golf",
          playerPositions: teamPlayers.map(player => player.position_group),
          rosterSlots: effectiveRosterSlots,
        }) : null;
        const pregame = expanded ? getPregameProjectedTeamTotal(row.team.id) : null;
        const isFinal = selectedSlate?.is_locked || (row.stats.games_completed > 0 &&
          row.stats.games_in_progress === 0 && row.stats.games_remaining === 0);
        const difference = pregame === null ? null : row.score - pregame;
        return <article key={row.team.id}
          className={`scores-standing${index === 0 ? " scores-standing--leader" : ""}${expanded ? " scores-standing--expanded" : ""}`}>
          <button type="button" id={headingId} className="scores-standing-toggle"
            data-scores-pull-start="true"
            aria-expanded={expanded} aria-controls={rosterId}
            onClick={() => setExpansion({ scope: expansionScope,
              teamId: expanded ? null : row.team.id })}>
            <span className="scores-standing-rank">
              <span className="sr-only">Rank {index + 1}</span>
              <span aria-hidden="true">{medalForPosition(index + 1)}</span>
            </span>
            <TeamAvatar teamName={row.team.name} avatarUrl={row.team.avatarUrl} size="sm" />
            <span className="scores-standing-name"><strong>{row.team.name}</strong>{ownTeam && <small>You</small>}</span>
            <span className="scores-standing-score">{formatScore(row.score)}<small> FP</small></span>
            <span className="scores-standing-chevron" aria-hidden="true">{expanded ? "▴" : "▾"}</span>
            <span className="scores-standing-games">{row.stats.games_completed} final · {row.stats.games_in_progress} live · {row.stats.games_remaining} left</span>
          </button>
          <div id={rosterId} hidden={!expanded} role="region" aria-labelledby={headingId}>
            {expanded && <div className="scores-expanded-roster">
              {assignment?.slots.map((slot, index) => {
                const player = slot.playerIndex >= 0 ? teamPlayers[slot.playerIndex] : null;
                if (!player) return <div key={`empty-${slot.position}-${index}`} className="scores-roster-empty">
                  <strong>{slot.position}</strong><span>No player drafted</span>
                </div>;
                const stat = getPlayerStat(player.id);
                const raw = getRawPlayerStat(player.id);
                const status = getPlayerGameStatus(raw);
                return <div key={player.id} className="scores-roster-row" data-pull-refresh-exclude>
                  <button type="button" className="scores-roster-player"
                    aria-label={`${player.name}, ${slot.position}, ${formatScore(stat.fantasy_points)} fantasy points. View player details`}
                    onClick={() => setProfilePlayer(player)}>
                    <PlayerHeadshot nbaPlayerId={player.nba_player_id} nflPlayerId={player.nfl_player_id}
                      playerName={player.name} imageUrl={player.headshot_url} size="sm" className="scores-roster-headshot" />
                    <span className="scores-roster-name"><strong>{player.name}</strong><small>{slot.position}</small></span>
                    <span className="scores-roster-points">{formatScore(stat.fantasy_points)}<small> FP</small></span>
                    <span className="scores-roster-statline">{scoresStatLine(sport, player.position_group, raw)}</span>
                    <span className={`scores-roster-status scores-roster-status--${status.tone}`} title={status.detail}>
                      {status.label}{status.tone === "live" && status.detail !== "Live" ? ` · ${status.detail}` : ""}
                    </span>
                  </button>
                  {sport === "nfl" && <div className="scores-roster-game"><NflFantasyGameAction player={player} /></div>}
                </div>;
              })}
              <details className="scores-roster-totals" data-pull-refresh-exclude>
                <summary>{sport === "nba" ? "Team totals / Pregame comparison" : "Team totals"}</summary>
                {sport === "nba" && <>
                {!isFinal && <p>Projected final: {formatScore(row.projected)} FP · {row.winPct.toFixed(0)}% win probability</p>}
                <p>{pregame === null ? "No saved pregame projection for this lineup." :
                  `Pregame projection: ${formatScore(pregame)} FP${isFinal && difference !== null
                    ? ` · ${difference > 0 ? "+" : ""}${difference.toFixed(1)} FP vs projection` : ""}`}</p>
                </>}
                <dl>{statColumns.map(column => <div key={column.key}><dt>{column.label}</dt>
                  <dd>{row.stats.statTotals?.[column.key] ?? 0}</dd></div>)}</dl>
              </details>
            </div>}
          </div>
        </article>;
      })}
    </div>
  </section>;
}


export default function ScoresDashboard(props: Props) {
  const sport = props.selectedSlate?.sport ?? "nba";

  if (sport === "golf") {
    return (
      <GolfScoresDashboard
        players={props.players}
        teams={props.teams}
        selectedSlate={props.selectedSlate}
        rosterSlots={props.rosterSlots}
        lastRefreshSummary={props.lastRefreshSummary}
        getPlayersForTeam={props.getPlayersForTeam}
        getTeamStats={props.getTeamStats}
        getRawPlayerStat={props.getRawPlayerStat}
        controls={props.controls}
        setProfilePlayer={props.setProfilePlayer}
      />
    );
  }

  return <TraditionalScoresDashboard {...props} />;
}
