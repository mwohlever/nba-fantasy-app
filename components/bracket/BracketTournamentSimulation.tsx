"use client";

import { useCallback, useMemo, useState } from "react";
import BracketGameCenter from "./BracketGameCenter";
import type { ImplicationsDataSource } from "./BracketGameImplications";
import type { ImplicationSubject } from "@/lib/bracket/gameImplications.server";
import type { BracketGameCenterTab } from "@/lib/bracket/liveState";
import { initialSimulationState, prepareSimulationMatchup, simulationMatchup, simulationResponse,
  simulationStandings, simulationTopology, simulationTeams, transitionSimulation, simulationPresets, loadSimulationPreset, type SimulationPhase } from "@/lib/bracket/simulation";
import { resolveBracketGame } from "@/lib/bracket/topology";

const round = (key: string) => key.replaceAll("_", " ");

export default function BracketTournamentSimulation() {
  const [state, setState] = useState(initialSimulationState);
  const [gameId, setGameId] = useState("r1-1");
  const [entryId, setEntryId] = useState(1);
  const [tab, setTab] = useState<BracketGameCenterTab>("implications");
  const [contestLocked, setContestLocked] = useState(false);
  const [error, setError] = useState("");
  const [showGame, setShowGame] = useState(true);
  const selected = simulationTopology.games.find((game) => game.id === gameId)!;
  const legalTeams = resolveBracketGame(simulationTopology, gameId, state.results).teamIds;
  const ready = legalTeams.every(Boolean);
  const phase = state.phases[gameId] ?? "pregame";
  const data = simulationMatchup(state, gameId);
  const source = useMemo<ImplicationsDataSource>(() => ({
    version: `${state.revision}:${state.preset ?? "default"}:${contestLocked}`,
    list: async () => simulationResponse(state, undefined, undefined, !contestLocked),
    analyze: async (selection, selectedGameId) => simulationResponse(state, selectedGameId, selection, !contestLocked),
  }), [state, contestLocked]);
  const isolatedSource = useMemo(() => ({ implications: source, detail: null }), [source]);
  const onSelectionChange = useCallback((subject: ImplicationSubject | null) => { if (subject?.entryId) setEntryId(subject.entryId); }, []);
  const changeState = (nextPhase: SimulationPhase, nextWinner?: string) => {
    try { setState(transitionSimulation(state, gameId, nextPhase, nextWinner)); setError(""); }
    catch (error) { setError(error instanceof Error ? error.message : "Unable to simulate this outcome."); }
  };
  const reset = () => { setState(initialSimulationState()); setGameId("r1-1"); setEntryId(1); setTab("implications"); setContestLocked(false); setError(""); setShowGame(true); };
  return <main className="bracket-live-page min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6">
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3"><img src="/logos/logo_all_sports.png" alt="111 Sports" className="h-10 w-10 object-contain" /><div><h1 className="text-lg font-black">111 Sports · CFP Game Center</h1><p className="text-xs text-amber-300">SIMULATION — NOT REAL RESULTS</p></div></header>
      <section aria-label="Simulation controls" className="space-y-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
        <p className="text-xs text-amber-100">Fictional entrants and teams. Everything stays in this tab’s memory; reset or reload starts over.</p>
        <label className="block text-xs font-bold">Story scenario<select aria-label="Simulation scenario" value={state.preset ?? "default"} onChange={(event) => {
          const preset = loadSimulationPreset(event.target.value, state.revision); setState(preset.state); setGameId(preset.gameId); setEntryId(preset.entryId);
          setContestLocked(preset.contestLocked); setTab("implications"); setShowGame(true); setError("");
        }} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-sm">{simulationPresets.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-xs font-bold">CFP game<select aria-label="Simulation game" value={gameId} onChange={(event) => { setGameId(event.target.value); setShowGame(true); setError(""); }} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-sm">
            {simulationTopology.games.map((game) => <option key={game.id} value={game.id}>{round(game.roundKey)} · Game {game.gameOrder}</option>)}
          </select></label>
          <label className="text-xs font-bold">Game state<select aria-label="Simulation game state" value={phase} onChange={(event) => changeState(event.target.value as SimulationPhase)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-sm">
            <option value="pregame">Pregame</option><option value="live" disabled={!ready}>Live</option><option value="provider_final" disabled={!ready}>Provider final · not official</option><option value="official_final" disabled={!ready}>Official final · simulated</option>
          </select></label>
          <label className="text-xs font-bold">{phase === "live" ? "Simulated leader" : "Simulated winner"}<select aria-label="Simulation winner" value={state.winners[gameId] ?? legalTeams[0] ?? ""} disabled={!ready || phase === "pregame"} onChange={(event) => changeState(phase, event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-slate-900 p-2 text-sm disabled:opacity-50">
            {!ready ? <option value="">Participants TBD</option> : legalTeams.map((id) => <option key={id} value={id!}>{simulationTeams.find((team) => team.providerTeamId === id)?.displayName}</option>)}
          </select></label>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs"><label className="font-bold">Contest lock<select aria-label="Simulation contest lock" value={contestLocked ? "after" : "before"} onChange={(event) => setContestLocked(event.target.value === "after")} className="ml-2 rounded-lg border border-slate-600 bg-slate-900 p-2 text-sm"><option value="before">Before contest lock</option><option value="after">After contest lock</option></select></label>
          {!ready ? <button type="button" onClick={() => { setState(prepareSimulationMatchup(state, gameId, entryId)); setError(""); }} className="rounded-lg border border-amber-300/40 px-3 py-2 font-bold text-amber-100">Prepare legal feeder results from viewed picks</button> : null}
          <button type="button" onClick={reset} className="ml-auto rounded-lg border border-slate-600 px-3 py-2 font-bold">Reset simulation</button>
        </div>
        {!contestLocked && phase !== "pregame" ? <p className="text-xs text-amber-200">Privacy test: this simulated game state does not change the contest lock. Production uses its authoritative contest deadline and persisted state.</p> : null}
        {!ready ? <p className="text-xs text-amber-200">Finalize the earlier games to establish the participants, or use the feeder-results button. Future matchups remain conditional until then.</p> : null}
        {error ? <p role="alert" className="text-sm text-red-300">{error}</p> : null}
      </section>
      {showGame ? <BracketGameCenter contestId="cfp-simulation" gameId={gameId} game={data.provider} matchup={data.matchup}
        gameLabel={`${round(selected.roundKey)} · Game ${selected.gameOrder} · Simulation`} tab={tab} onTabChange={setTab}
        selection={{ entryId }} selectionRequested onSelectionChange={onSelectionChange} isolatedSource={isolatedSource}
        onBack={() => setShowGame(false)} /> : <section className="grid gap-2 sm:grid-cols-2" aria-label="Simulation games">{simulationTopology.games.map((game) => <button type="button" key={game.id} onClick={() => { setGameId(game.id); setShowGame(true); }} className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-4 text-left font-bold">{round(game.roundKey)} · Game {game.gameOrder}</button>)}</section>}
      {contestLocked ? <section className="border-t border-slate-700 pt-3" aria-label="Simulated scoring"><h2 className="text-xs font-bold text-slate-400">Fictional contest · current points / points still possible</h2><div className="mt-2 grid gap-2 sm:grid-cols-4">{simulationStandings(state).map((entry) => <p key={entry.id} className="text-xs"><strong>{entry.label}</strong><br />{entry.pointsEarned} earned · {entry.pointsStillAvailable} still possible</p>)}</div></section> : null}
    </div>
  </main>;
}
