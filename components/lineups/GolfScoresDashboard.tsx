"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useGroupContext } from "@/components/providers/GroupProvider";
import { getGolfStatusMeta } from "@/lib/golf/status";
import { formatGolfLiveProgress } from "@/lib/golf/liveLeaderboard";
import type { GolfFantasyTeam } from "@/lib/golf/competition";
import type { GolfRules } from "@/lib/rules/leagueRules";
import type { Player, PlayerStat, OrderedTeam, RosterSlotConfig, Slate } from "./types";

export type GolfFantasyBoard = {
  rules: GolfRules;
  teams: Array<GolfFantasyTeam & { name: string }>;
  events: Array<Record<string, any>>;
};

export function golfFantasyScore(value: number | null | undefined) {
  return value == null ? "—" : value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
}

function currentRound(event: Record<string, any> | undefined) {
  const rounds = [...(event?.golf_rounds ?? [])].sort((a, b) => Number(b.round_number) - Number(a.round_number));
  return rounds.find(round => Number(round.holes_completed ?? 0) > 0) ?? rounds[0] ?? null;
}

function StandardRoster({ board, team, onPlayer }: { board: GolfFantasyBoard; team: GolfFantasyBoard['teams'][number]; onPlayer: (player: Player) => void }) {
  return <div className="divide-y divide-slate-800 px-3">
    {team.contributions.length === 0 ? <p className="py-3 text-xs text-slate-400">No saved roster.</p> : null}
    {team.contributions.map(contribution => {
      const event = board.events.find(e => Number(e.player_id) === contribution.playerId);
      const player = event?.golf_players;
      const meta = getGolfStatusMeta({ ...event, rounds: event?.golf_rounds ?? [] });
      const progress = formatGolfLiveProgress({ status: event?.status, statusState: meta.state, progressHoles: meta.holes, teeTime: meta.teeTime });
      const round = currentRound(event);
      const period = contribution.period === "opening" ? "Opening · R1–2" : contribution.period === "weekend" ? "Weekend · R3–4" : "";
      return <div key={`${contribution.period}-${contribution.playerId}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-sm">
        <button type="button" className="min-w-0 text-left" onClick={() => onPlayer({
          id: contribution.playerId, name: player?.display_name ?? "Golfer", position_group: "GOLFER", is_active: true,
          espn_player_id: player?.espn_player_id, headshot_url: player?.headshot_url, country: player?.country, owgr_rank: player?.owgr_rank,
        })}>
          <span className="block truncate font-semibold text-slate-100">{player?.display_name ?? `Golfer ${contribution.playerId}`}</span>
          <span className="block text-[11px] text-slate-400">{period || "Full tournament"}</span>
        </button>
        <div className="grid grid-cols-[3.7rem_2.6rem_4.5rem] items-center gap-1 text-right text-xs tabular-nums">
          <span className="whitespace-nowrap text-slate-300">{round ? `R${round.round_number} ${golfFantasyScore(round.score_to_par)}` : "R—"}</span>
          <span className="whitespace-nowrap text-center font-semibold text-emerald-300">{progress}</span>
          <span className="whitespace-nowrap font-bold text-white">Total {golfFantasyScore(event?.official_score_to_par)}</span>
        </div>
      </div>;
    })}
  </div>;
}

function BestBallRoster({ board, team, onPlayer }: { board: GolfFantasyBoard; team: GolfFantasyBoard['teams'][number]; onPlayer: (player: Player) => void }) {
  const rounds = team.bestBallRounds ?? [];
  const eventByPlayer = new Map(board.events.map(event => [Number(event.player_id), event]));
  return <div className="space-y-4 px-3 py-3">
    {rounds.map(round => {
      const roster = team.contributions.filter(c => c.period === round.period);
      const holes = round.holes.filter(hole => hole.holeNumber >= 1 && hole.holeNumber <= 18);
      return <section key={round.roundNumber} className="overflow-x-auto rounded-lg border border-slate-800" aria-label={`Round ${round.roundNumber} Best Ball scorecard`}>
        <div className="border-b border-slate-800 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300">R{round.roundNumber} · {round.period === 'opening' ? 'Opening roster' : round.period === 'weekend' ? 'Weekend roster' : 'Full tournament'}</div>
        <table className="w-full min-w-[620px] border-collapse text-xs tabular-nums">
          <thead className="bg-slate-900 text-slate-400"><tr><th className="sticky left-0 w-24 bg-slate-900 px-2 py-1.5 text-left">Golfer</th>{holes.map(hole => <th key={hole.holeNumber} className="px-1 py-1.5">{hole.holeNumber}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-800">
            {roster.map(contribution => {
              const event = eventByPlayer.get(contribution.playerId);
              const player = event?.golf_players;
              const playerRound = (event?.golf_rounds ?? []).find((item: any) => Number(item.round_number) === round.roundNumber);
              const playerHoles = new Map<number, { relative_to_par?: number | null }>((playerRound?.golf_holes ?? []).map((hole: any) => [Number(hole.hole_number), hole]));
              return <tr key={contribution.playerId}>
                <th className="sticky left-0 bg-slate-950 px-2 py-1.5 text-left font-semibold text-slate-100"><button type="button" className="max-w-24 truncate text-left" onClick={() => onPlayer({ id: contribution.playerId, name: player?.display_name ?? 'Golfer', position_group: 'GOLFER', is_active: true, espn_player_id: player?.espn_player_id, headshot_url: player?.headshot_url, country: player?.country, owgr_rank: player?.owgr_rank })}>{player?.display_name ?? `Golfer ${contribution.playerId}`}</button></th>
                {holes.map(hole => { const value = playerHoles.get(hole.holeNumber)?.relative_to_par; const contributes = hole.contributorPlayerIds.includes(contribution.playerId); return <td key={hole.holeNumber} className={`px-1 py-1.5 text-center ${contributes ? 'bg-emerald-500/20 font-bold text-emerald-200' : 'text-slate-300'}`}>{golfFantasyScore(value)}</td>; })}
              </tr>;
            })}
            <tr className="border-t-2 border-emerald-700 bg-emerald-950/40"><th className="sticky left-0 bg-emerald-950 px-2 py-2 text-left font-black text-emerald-200">TEAM</th>{holes.map(hole => <td key={hole.holeNumber} className="px-1 py-2 text-center font-black text-white">{golfFantasyScore(hole.relativeToPar)}</td>)}</tr>
          </tbody>
        </table>
      </section>;
    })}
  </div>;
}

export function GolfFantasyRows({ board, onPlayer, scope }: {
  board: GolfFantasyBoard; onPlayer: (player: Player) => void; scope: string;
}) {
  const [expansion, setExpansion] = useState<{ scope: string; ids: number[] }>({ scope, ids: [] });
  const ids = expansion.scope === scope ? expansion.ids : [];
  return (
    <div className="scores-standings" aria-label="Golf fantasy standings">
      {board.teams.map(team => {
        const expanded = ids.includes(team.team_id);
        const rosterId = `golf-roster-${team.team_id}`;
        return (
          <article key={team.team_id} className="scores-standing">
            <button type="button" className="scores-standing-toggle golf-scores-standing-toggle" aria-expanded={expanded} aria-controls={rosterId}
              onClick={() => setExpansion({ scope, ids: expanded ? ids.filter(id => id !== team.team_id) : [...ids, team.team_id] })}>
              <span className="scores-standing-rank">{team.finish_position ?? "—"}</span>
              <span className="scores-standing-name"><strong>{team.name}</strong></span>
              <span className="scores-standing-score">{golfFantasyScore(team.fantasy_points)}</span>
              <span className="scores-standing-chevron" aria-hidden="true">{expanded ? "▴" : "▾"}</span>
              <span className="scores-standing-games">{team.provisional ? "Provisional · " : ""}{team.contributions.length} golfer selections</span>
            </button>
            {expanded ? (
              <div id={rosterId} className="border-t border-slate-800 bg-slate-950/60">
                {board.rules.gameType === "best_ball" ? <BestBallRoster board={board} team={team} onPlayer={onPlayer} /> : <StandardRoster board={board} team={team} onPlayer={onPlayer} />}
              </div>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

type Props = {
  players: Player[]; teams: OrderedTeam[]; selectedSlate: Slate | null; rosterSlots?: RosterSlotConfig[];
  lastRefreshSummary: unknown; getPlayersForTeam: (id: number) => Player[];
  getTeamStats: (id: number) => unknown; getRawPlayerStat: (id: number) => PlayerStat | null;
  controls?: ReactNode; setProfilePlayer: (player: Player | null) => void;
};

export default function GolfScoresDashboard({ selectedSlate, lastRefreshSummary, controls, setProfilePlayer }: Props) {
  const { groupContext, isLoading, isSwitchingGroup } = useGroupContext();
  const scope = `${groupContext?.group.id}:${selectedSlate?.id}`;
  const [state, setState] = useState<{ scope: string; board?: GolfFantasyBoard; error?: string } | null>(null);
  useEffect(() => {
    if (!selectedSlate || !groupContext || isLoading || isSwitchingGroup) return;
    const controller = new AbortController();
    setState(previous => previous?.scope === scope ? previous : null);
    fetch(`/api/golf/fantasy?slateId=${selectedSlate.id}`, { cache: "no-store", signal: controller.signal })
      .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })
      .then(board => { if (!controller.signal.aborted) setState({ scope, board }); })
      .catch(error => { if (!controller.signal.aborted) setState(previous => ({ scope, board: previous?.scope === scope ? previous.board : undefined, error: error.message })); });
    return () => controller.abort();
  }, [scope, lastRefreshSummary, isLoading, isSwitchingGroup]);
  const current = !isLoading && !isSwitchingGroup && state?.scope === scope ? state : null;
  return (
    <section className="scores-page space-y-3">
      <header><h2 className="text-lg font-bold">{selectedSlate?.label ?? "Golf Scores"}</h2>
        <p className="text-xs text-slate-500">Fantasy scoring · Lower is better · Expand teams to compare golfers</p></header>
      {controls}
      {current?.error ? <p role="alert" className="text-sm text-red-700">{current.error}</p> : null}
      {current?.board ? <GolfFantasyRows board={current.board} scope={scope} onPlayer={setProfilePlayer} />
          : <p className="text-sm text-slate-500">Loading fantasy scores…</p>}
    </section>
  );
}
