"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useGroupContext } from "@/components/providers/GroupProvider";
import PlayerHeadshot from "@/components/ui/PlayerHeadshot";
import TeamAvatar from "@/components/ui/TeamAvatar";
import type { BestBallHole } from "@/lib/golf/bestBall";
import type { GolfFantasyTeam } from "@/lib/golf/competition";
import { golfPeriodForRound } from "@/lib/golf/eligibleRoster";
import type { GolfRules } from "@/lib/rules/leagueRules";
import { golfHolePar, golfHoleResultClass, golfHoleResultLabel } from "@/lib/golf/scorePresentation";
import type { Player, PlayerStat, OrderedTeam, RosterSlotConfig, Slate } from "./types";

export type GolfFantasyBoard = {
  rules: GolfRules;
  teams: Array<GolfFantasyTeam & { name: string; hiddenRosterPeriods?: Array<"full_tournament" | "opening" | "weekend"> }>;
  events: Array<Record<string, any>>;
  courseHoles?: Array<{ holeNumber: number; par: number | null }>;
};

export function golfFantasyScore(value: number | null | undefined) {
  return value == null ? "—" : value === 0 ? "E" : value > 0 ? `+${value}` : String(value);
}

function golfHoleNavigationLabel(value: number | null | undefined, status: "unscored" | "provisional" | "final") {
  if (value === null || value === undefined) {
    return status === "unscored" ? "not started" : "score pending";
  }
  return golfHoleResultLabel(value) ?? "score pending";
}

function bestBallRoundTotal(holes: Array<{ relativeToPar: number | null }>) {
  const scored = holes.filter(hole => hole.relativeToPar !== null);
  return scored.length ? scored.reduce((total, hole) => total + hole.relativeToPar!, 0) : null;
}

function currentBestBallRound(board: GolfFantasyBoard) {
  const scoredRounds = [1, 2, 3, 4].filter(roundNumber => board.teams.some(team =>
    team.bestBallRounds?.find(round => round.roundNumber === roundNumber)?.holes.some(hole => hole.status !== "unscored"),
  ));
  return scoredRounds.at(-1) ?? 1;
}

function currentGolfScoresRound(board: GolfFantasyBoard) {
  if (board.rules.gameType === "best_ball") return currentBestBallRound(board);
  const scoredRounds = board.events.flatMap(event => event.golf_rounds ?? [])
    .filter((round: any) => Number(round.holes_completed ?? 0) > 0 || round.strokes !== null && round.strokes !== undefined)
    .map((round: any) => Number(round.round_number));
  return scoredRounds.length ? Math.max(...scoredRounds) : 1;
}

export function BestBallRoster({ board, team, onPlayer, onHole, selectedRound }: { board: GolfFantasyBoard; team: GolfFantasyBoard['teams'][number]; onPlayer: (player: Player) => void; onHole?: (player: Player, focus: { roundNumber: number; holeNumber: number }) => void; selectedRound: number }) {
  const round = team.bestBallRounds?.find(candidate => candidate.roundNumber === selectedRound);
  const eventByPlayer = new Map(board.events.map(event => [Number(event.player_id), event]));
  const hidden = round && (team.hiddenRosterPeriods ?? []).includes(round.period);
  const roster = round ? team.contributions.filter(contribution => contribution.period === round.period) : [];
  const roundHoles = new Map((round?.holes ?? []).map(hole => [hole.holeNumber, hole]));
  const holes: BestBallHole[] = Array.from({ length: 18 }, (_, index) => roundHoles.get(index + 1) ?? {
    holeNumber: index + 1, strokes: null, relativeToPar: null, par: null, contributorPlayerIds: [], primaryContributorPlayerId: null, unresolvedPlayerIds: [], status: "unscored",
  });
  const teamTotal = bestBallRoundTotal(holes);
  const hasScoring = holes.some(hole => hole.status !== "unscored");
  const courseParByHole = new Map((board.courseHoles ?? []).map(hole => [hole.holeNumber, hole.par]));
  return <div className="space-y-3 px-3 py-3">
    {hidden ? <p className="text-xs text-amber-300">{round.period === "weekend" ? "Weekend lineup hidden until lock." : round.period === "opening" ? "Roster hidden until Round 1." : "Lineup hidden until lock."}</p> : null}
    {!round ? <p className="text-xs text-slate-400">Round {selectedRound} is not available.</p> : hidden ? null : !roster.length ? <p className="text-xs text-slate-400">{round.period === "weekend" ? "Weekend roster is not available for this round yet." : "No saved roster for this round."}</p> : <section className="overflow-x-auto rounded-lg border border-slate-800" aria-label={`Round ${round.roundNumber} Best Ball scorecard`}>
      <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300"><span>R{round.roundNumber} · {round.period === 'opening' ? 'Opening roster' : round.period === 'weekend' ? 'Weekend roster' : 'Full tournament'}</span><span>Best Ball {hasScoring ? golfFantasyScore(teamTotal) : 'Not started'}</span></div>
      {!hasScoring ? <p className="px-2 py-3 text-xs text-slate-400">Round {round.roundNumber} has not started.</p> : <table className="w-full min-w-[840px] border-collapse text-xs tabular-nums sm:min-w-[620px]">
        <thead className="bg-slate-900 text-slate-400"><tr><th className="sticky left-0 w-36 bg-slate-900 px-2 py-1.5 text-left">Golfer</th><th className="px-2 py-1.5 text-right">R{round.roundNumber}</th>{holes.map(hole => <th key={hole.holeNumber} className="w-10 min-w-10 px-1 py-1 sm:w-auto sm:min-w-0"><div>{hole.holeNumber}</div><div className="text-[9px] font-bold text-slate-500">{courseParByHole.get(hole.holeNumber) ?? hole.par ?? "—"}</div></th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">
          {roster.map(contribution => {
            const event = eventByPlayer.get(contribution.playerId);
            const player = event?.golf_players;
            const playerRound = (event?.golf_rounds ?? []).find((item: any) => Number(item.round_number) === round.roundNumber);
            const playerHoles = new Map<number, { relative_to_par?: number | null }>((playerRound?.golf_holes ?? []).map((hole: any) => [Number(hole.hole_number), hole]));
            const golfer = { id: contribution.playerId, name: player?.display_name ?? 'Golfer', position_group: 'GOLFER' as const, is_active: true,
              espn_player_id: player?.espn_player_id, headshot_url: player?.headshot_url, country: player?.country, owgr_rank: player?.owgr_rank };
            return <tr key={contribution.playerId}>
              <th className="sticky left-0 bg-slate-950 px-2 py-1.5 text-left font-semibold text-slate-100"><button type="button" aria-label={`View ${golfer.name} details`} className="flex max-w-36 items-center gap-2 text-left" onClick={() => onPlayer(golfer)}><PlayerHeadshot espnGolfPlayerId={golfer.espn_player_id} imageUrl={golfer.headshot_url} playerName={golfer.name} size="xs" className="shrink-0 border-slate-700 bg-slate-900" /><span className="truncate">{golfer.name}</span></button></th>
              <td className="px-2 py-1.5 text-right font-bold text-white">{golfFantasyScore(playerRound?.score_to_par)}</td>
              {holes.map(hole => { const value = playerHoles.get(hole.holeNumber)?.relative_to_par; const contributes = hole.contributorPlayerIds.includes(contribution.playerId); return <td key={hole.holeNumber} className="w-10 min-w-10 px-1 py-1.5 text-center sm:w-auto sm:min-w-0">{onHole ? <button type="button" aria-label={`View ${golfer.name}, Round ${round.roundNumber}, Hole ${hole.holeNumber} — ${golfHoleNavigationLabel(value, hole.status)}${contributes ? " · Best Ball contributor" : ""}`} onClick={() => onHole(golfer, { roundNumber: round.roundNumber, holeNumber: hole.holeNumber })} className={`flex h-7 w-full min-w-[38px] cursor-pointer items-center justify-center rounded-lg border text-xs font-black hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 sm:min-w-0 ${golfHoleResultClass(value)}`}>{golfFantasyScore(value)}</button> : golfFantasyScore(value)}</td>; })}
            </tr>;
          })}
          <tr className="border-t-2 border-emerald-700 bg-emerald-950/40"><th className="sticky left-0 bg-emerald-950 px-2 py-2 text-left font-black text-emerald-200">BEST BALL</th><td className="bg-emerald-950 px-2 py-2 text-right font-black text-white">{golfFantasyScore(teamTotal)}</td>{holes.map(hole => <td key={hole.holeNumber} className="w-10 min-w-10 px-1 py-2 text-center font-black text-white sm:w-auto sm:min-w-0">{golfFantasyScore(hole.relativeToPar)}</td>)}</tr>
        </tbody>
      </table>}
    </section>}
  </div>;
}

export function StandardRoster({ board, team, onPlayer, onHole, selectedRound }: { board: GolfFantasyBoard; team: GolfFantasyBoard['teams'][number]; onPlayer: (player: Player) => void; onHole?: (player: Player, focus: { roundNumber: number; holeNumber: number }) => void; selectedRound: number }) {
  const period = golfPeriodForRound(board.rules.rosterPeriods.type, selectedRound as 1 | 2 | 3 | 4);
  const hidden = (team.hiddenRosterPeriods ?? []).includes(period);
  const roster = team.contributions.filter(contribution => contribution.period === period);
  const eventByPlayer = new Map(board.events.map(event => [Number(event.player_id), event]));
  const holes = Array.from({ length: 18 }, (_, index) => index + 1);
  const courseParByHole = new Map((board.courseHoles ?? []).map(hole => [hole.holeNumber, hole.par]));
  const fallbackParByHole = new Map<number, number | null>((((eventByPlayer.get(roster[0]?.playerId)?.golf_rounds ?? [])
    .find((round: any) => Number(round.round_number) === selectedRound)?.golf_holes ?? [])
    .map((hole: any) => [Number(hole.hole_number), golfHolePar(hole)])));
  const hasScoring = roster.some(contribution => {
    const round = (eventByPlayer.get(contribution.playerId)?.golf_rounds ?? []).find((item: any) => Number(item.round_number) === selectedRound);
    return Number(round?.holes_completed ?? 0) > 0 || round?.strokes !== null && round?.strokes !== undefined;
  });
  return <div className="space-y-3 px-3 py-3">
    {hidden ? <p className="text-xs text-amber-300">{period === "weekend" ? "Weekend lineup hidden until lock." : period === "opening" ? "Roster hidden until Round 1." : "Lineup hidden until lock."}</p> : null}
    {!hidden && !roster.length ? <p className="text-xs text-slate-400">No saved roster for this round.</p> : null}
    {!hidden && roster.length ? <section className="overflow-x-auto rounded-lg border border-slate-800" aria-label={`Round ${selectedRound} Golf scorecard`}>
      <div className="flex items-center justify-between border-b border-slate-800 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wide text-emerald-300"><span>R{selectedRound} · {period === "opening" ? "Opening roster" : period === "weekend" ? "Weekend roster" : "Full tournament"}</span><span>{hasScoring ? "Round scoring" : "Not started"}</span></div>
      {!hasScoring ? <p className="px-2 py-3 text-xs text-slate-400">Round {selectedRound} has not started.</p> : <table className="w-full min-w-[840px] border-collapse text-xs tabular-nums sm:min-w-[620px]">
        <thead className="bg-slate-900 text-slate-400"><tr><th className="sticky left-0 w-36 bg-slate-900 px-2 py-1.5 text-left">Golfer</th><th className="px-2 py-1.5 text-right">R{selectedRound}</th>{holes.map(hole => <th key={hole} className="w-10 min-w-10 px-1 py-1 sm:w-auto sm:min-w-0"><div>{hole}</div><div className="text-[9px] font-bold text-slate-500">{courseParByHole.get(hole) ?? fallbackParByHole.get(hole) ?? "—"}</div></th>)}</tr></thead>
        <tbody className="divide-y divide-slate-800">{roster.map(contribution => {
          const event = eventByPlayer.get(contribution.playerId); const player = event?.golf_players;
          const playerRound = (event?.golf_rounds ?? []).find((item: any) => Number(item.round_number) === selectedRound);
          const playerHoles = new Map<number, { relative_to_par?: number | null }>((playerRound?.golf_holes ?? []).map((hole: any) => [Number(hole.hole_number), hole]));
          const golfer = { id: contribution.playerId, name: player?.display_name ?? "Golfer", position_group: "GOLFER" as const, is_active: true, espn_player_id: player?.espn_player_id, headshot_url: player?.headshot_url, country: player?.country, owgr_rank: player?.owgr_rank };
          return <tr key={contribution.playerId}><th className="sticky left-0 bg-slate-950 px-2 py-1.5 text-left font-semibold text-slate-100"><button type="button" aria-label={`View ${golfer.name} details`} className="flex max-w-36 items-center gap-2 text-left" onClick={() => onPlayer(golfer)}><PlayerHeadshot espnGolfPlayerId={golfer.espn_player_id} imageUrl={golfer.headshot_url} playerName={golfer.name} size="xs" className="shrink-0 border-slate-700 bg-slate-900" /><span className="truncate">{golfer.name}</span></button></th><td className="px-2 py-1.5 text-right font-bold text-white">{golfFantasyScore(playerRound?.score_to_par)}</td>{holes.map(hole => { const value = playerHoles.get(hole)?.relative_to_par; return <td key={hole} className="w-10 min-w-10 px-1 py-1.5 text-center sm:w-auto sm:min-w-0">{onHole ? <button type="button" aria-label={`View ${golfer.name}, Round ${selectedRound}, Hole ${hole} — ${value == null ? "not started" : golfHoleNavigationLabel(value, "final")}`} onClick={() => onHole(golfer, { roundNumber: selectedRound, holeNumber: hole })} className={`flex h-7 w-full min-w-[38px] cursor-pointer items-center justify-center rounded-lg border text-xs font-black hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300 sm:min-w-0 ${golfHoleResultClass(value)}`}>{golfFantasyScore(value)}</button> : golfFantasyScore(value)}</td>; })}</tr>;
        })}</tbody>
      </table>}
    </section> : null}
  </div>;
}

export function GolfFantasyRows({ board, onPlayer, onHole, scope, teamAvatarById = new Map<number, string | null>() }: {
  board: GolfFantasyBoard; onPlayer: (player: Player) => void; onHole?: (player: Player, focus: { roundNumber: number; holeNumber: number }) => void; scope: string; teamAvatarById?: Map<number, string | null>;
}) {
  const [expansion, setExpansion] = useState<{ scope: string; ids: number[] }>({ scope, ids: [] });
  const ids = expansion.scope === scope ? expansion.ids : [];
  const [roundSelection, setRoundSelection] = useState<{ scope: string; round: number }>({ scope: "", round: 1 });
  const selectedRound = roundSelection.scope === scope ? roundSelection.round : currentGolfScoresRound(board);
  return (
    <div aria-label="Golf fantasy standings">
      <div className="mb-3 flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-1" aria-label="Golf round selector">
        {[1, 2, 3, 4].map(round => <button key={round} type="button" aria-label={`Select round ${round}`} aria-pressed={selectedRound === round} onClick={() => setRoundSelection({ scope, round })}
          className={`min-h-9 flex-1 rounded px-2 text-xs font-bold ${selectedRound === round ? "bg-emerald-700 text-white" : "text-slate-300"}`}>R{round}</button>)}
      </div>
      <div className="scores-standings">
      {board.teams.map(team => {
        const expanded = ids.includes(team.team_id);
        const rosterId = `golf-roster-${team.team_id}`;
        return (
          <article key={team.team_id} className="scores-standing">
            <button type="button" className="scores-standing-toggle golf-scores-standing-toggle" aria-expanded={expanded} aria-controls={rosterId}
              onClick={() => setExpansion({ scope, ids: expanded ? ids.filter(id => id !== team.team_id) : [...ids, team.team_id] })}>
              <span className="scores-standing-rank">{team.finish_position ?? "—"}</span>
              <TeamAvatar teamName={team.name} avatarUrl={teamAvatarById.get(team.team_id) ?? null} size="chip" />
              <span className="scores-standing-name"><strong>{team.name}</strong></span>
              <span className="scores-standing-score">{golfFantasyScore(team.fantasy_points)}</span>
              <span className="scores-standing-chevron" aria-hidden="true">{expanded ? "▴" : "▾"}</span>
              <span className="scores-standing-games">{team.provisional ? "Live scoring · " : ""}{(team.hiddenRosterPeriods?.length ?? 0) > 0 ? "Lineup hidden until lock" : `${team.contributions.length} golfer selections`}</span>
            </button>
            {expanded ? (
              <div id={rosterId} className="border-t border-slate-800 bg-slate-950/60">
                {board.rules.gameType === "best_ball" ? <BestBallRoster board={board} team={team} onPlayer={onPlayer} onHole={onHole} selectedRound={selectedRound} /> : <StandardRoster board={board} team={team} onPlayer={onPlayer} onHole={onHole} selectedRound={selectedRound} />}
              </div>
            ) : null}
          </article>
        );
      })}
      </div>
    </div>
  );
}

type Props = {
  players: Player[]; teams: OrderedTeam[]; selectedSlate: Slate | null; rosterSlots?: RosterSlotConfig[];
  lastRefreshSummary: unknown; getPlayersForTeam: (id: number) => Player[];
  getTeamStats: (id: number) => unknown; getRawPlayerStat: (id: number) => PlayerStat | null;
  controls?: ReactNode; setProfilePlayer: (player: Player | null) => void;
  openGolfHole?: (player: Player, focus: { roundNumber: number; holeNumber: number }) => void;
};

export default function GolfScoresDashboard({ teams, selectedSlate, lastRefreshSummary, controls, setProfilePlayer, openGolfHole }: Props) {
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
  useEffect(() => {
    if (!selectedSlate || !groupContext || isLoading || isSwitchingGroup) return;
    let cancelled = false;
    const reloadAcceptedBoard = (event: Event) => {
      if ((event as CustomEvent).detail?.slateId !== selectedSlate.id) return;
      fetch(`/api/golf/fantasy?slateId=${selectedSlate.id}`, { cache: "no-store" })
        .then(async response => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; })
        .then(board => { if (!cancelled) setState({ scope, board }); })
        .catch(error => { if (!cancelled) setState(previous => ({ scope, board: previous?.scope === scope ? previous.board : undefined, error: error.message })); });
    };
    window.addEventListener("golf-accepted-change", reloadAcceptedBoard);
    return () => { cancelled = true; window.removeEventListener("golf-accepted-change", reloadAcceptedBoard); };
  }, [scope, selectedSlate?.id, isLoading, isSwitchingGroup]);
  const current = !isLoading && !isSwitchingGroup && state?.scope === scope ? state : null;
  return (
    <section className="scores-page space-y-3">
      <header><h2 className="text-lg font-bold">{selectedSlate?.label ?? "Golf Scores"}</h2>
        <p className="text-xs text-slate-500">Fantasy scoring · Lower is better · Expand teams to compare golfers</p></header>
      {controls}
      {current?.error ? <p role="alert" className="text-sm text-red-700">{current.error}</p> : null}
      {current?.board ? <GolfFantasyRows board={current.board} scope={scope} onPlayer={setProfilePlayer} onHole={openGolfHole}
        teamAvatarById={new Map(teams.map(team => [team.id, team.avatarUrl ?? null]))} />
          : <p className="text-sm text-slate-500">Loading fantasy scores…</p>}
    </section>
  );
}
