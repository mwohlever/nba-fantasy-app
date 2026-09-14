"use client";

import { useEffect, useState } from "react";

type Participant = { teamId: number; name: string };
type Game = {
  id: number;
  kickoff_at: string;
  away_team_id: string;
  away_team_name: string;
  home_team_id: string;
  home_team_name: string;
  status_detail: string | null;
  winner_team_id: string | null;
};
type Card = { participant: Participant; games: Game[]; picks: Array<{ game_id: number; picked_team_id: string; is_correct: boolean | null }> };

export default function NcaaPickEmCorrections({ weekId, weekStatus }: { weekId: number; weekStatus: string }) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [teamId, setTeamId] = useState("");
  const [card, setCard] = useState<Card | null>(null);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setTeamId(""); setCard(null); setChoices({}); setMessage("");
    void fetch(`/api/admin/ncaa-pickem/pick-corrections?weekId=${weekId}`, { signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => { if (!response.ok) throw new Error(data.error || "Unable to load participants."); setParticipants(data.participants ?? []); })
      .catch((error) => { if (error.name !== "AbortError") setMessage(error.message || "Unable to load participants."); });
    return () => controller.abort();
  }, [weekId]);

  useEffect(() => {
    if (!teamId) return;
    const controller = new AbortController();
    setCard(null); setChoices({}); setMessage("");
    void fetch(`/api/admin/ncaa-pickem/pick-corrections?weekId=${weekId}&teamId=${teamId}`, { signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() }))
      .then(({ response, data }) => {
        if (!response.ok) throw new Error(data.error || "Unable to load participant picks.");
        const loaded = data as Card;
        setCard(loaded);
        setChoices(Object.fromEntries((loaded.picks ?? []).map((pick) => [Number(pick.game_id), String(pick.picked_team_id)])));
      })
      .catch((error) => { if (error.name !== "AbortError") setMessage(error.message || "Unable to load participant picks."); });
    return () => controller.abort();
  }, [teamId, weekId]);

  async function save() {
    if (!teamId || !card) return;
    const picks = Object.entries(choices).filter(([, pickedTeamId]) => pickedTeamId).map(([gameId, pickedTeamId]) => ({ gameId: Number(gameId), pickedTeamId }));
    if (!picks.length) { setMessage("Choose at least one pick to save."); return; }
    try {
      setWorking(true); setMessage("");
      const response = await fetch("/api/admin/ncaa-pickem/pick-corrections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekId, teamId: Number(teamId), picks }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save correction.");
      setCard((previous) => previous ? { ...previous, picks: picks.map((pick) => ({ game_id: pick.gameId, picked_team_id: pick.pickedTeamId, is_correct: previous.games.find((game) => game.id === pick.gameId)?.winner_team_id ? pick.pickedTeamId === previous.games.find((game) => game.id === pick.gameId)?.winner_team_id : null })) } : previous);
      setMessage(`Commissioner correction saved${data.graded ? `; ${data.graded} completed pick${data.graded === 1 ? "" : "s"} graded immediately.` : "."}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save correction."); }
    finally { setWorking(false); }
  }

  return <section className="rounded-3xl border border-amber-500/35 bg-slate-900 p-5">
    <div className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">Commissioner correction</div>
    <h2 className="mt-1 text-xl font-black">Edit Participant Picks</h2>
    <p className="mt-1 text-sm leading-5 text-slate-400">Privileged corrections may be saved while this week is {weekStatus}. Existing picks are prefilled; leaving a game unselected never deletes its stored pick.</p>
    <label className="mt-4 block max-w-md space-y-1"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Participant</span>
      <select value={teamId} onChange={(event) => setTeamId(event.target.value)} disabled={working} className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 disabled:opacity-40">
        <option value="">Select participant…</option>{participants.map((participant) => <option key={participant.teamId} value={participant.teamId}>{participant.name}</option>)}
      </select>
    </label>
    {card ? <div className="mt-4 space-y-2">{card.games.map((game) => <div key={game.id} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
      <div className="text-xs text-slate-500">{new Date(game.kickoff_at).toLocaleString()} {game.status_detail ? `· ${game.status_detail}` : ""}</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {[{ id: game.away_team_id, name: game.away_team_name }, { id: game.home_team_id, name: game.home_team_name }].map((team) => <label key={team.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${choices[game.id] === team.id ? "border-amber-400 bg-amber-500/15 text-amber-100" : "border-slate-800 text-slate-300"}`}><input type="radio" name={`game-${game.id}`} checked={choices[game.id] === team.id} onChange={() => setChoices((previous) => ({ ...previous, [game.id]: team.id }))} disabled={working} />{team.name}</label>)}
      </div>
      {game.winner_team_id ? <div className="mt-2 text-xs text-amber-300">Final result stored — this correction will be graded on save.</div> : null}
    </div>)}</div> : teamId ? <div className="mt-4 text-sm text-slate-500">Loading participant picks…</div> : null}
    {card ? <button type="button" onClick={() => void save()} disabled={working} className="mt-4 rounded-xl bg-amber-500 px-4 py-2 text-sm font-bold text-slate-950 disabled:opacity-40">{working ? "Saving…" : "Save Commissioner Correction"}</button> : null}
    {message ? <div className="mt-3 text-sm text-slate-300" role="status">{message}</div> : null}
  </section>;
}
