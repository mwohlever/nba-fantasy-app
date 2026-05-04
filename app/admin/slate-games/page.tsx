"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Slate = {
  id: number;
  start_date: string;
  end_date: string;
};

type SavedGame = {
  id: number;
  slate_id: number;
  game_date: string | null;
  game_id: string;
  game_code: string | null;
  note: string | null;
};

export default function SlateGamesAdmin() {
  const [slates, setSlates] = useState<Slate[]>([]);
  const [selectedSlate, setSelectedSlate] = useState<number | null>(null);
  const [games, setGames] = useState<SavedGame[]>([]);
  const [message, setMessage] = useState("");

  const [manualGameId, setManualGameId] = useState("");
  const [manualGameCode, setManualGameCode] = useState("");
  const [manualNote, setManualNote] = useState("");

  async function load(slateId = selectedSlate) {
    const res = await fetch(
      `/api/admin/slate-nba-games${slateId ? `?slateId=${slateId}` : ""}`
    );
    const data = await res.json();

    setSlates(data.slates || []);
    setGames(data.savedGames || []);

    if (!selectedSlate && data.slates?.[0]?.id) {
      setSelectedSlate(data.slates[0].id);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedSlate) load(selectedSlate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlate]);

  async function pullToday() {
    if (!selectedSlate) return;

    setMessage("Pulling today’s NBA games...");

    const res = await fetch("/api/admin/slate-nba-games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "pullToday", slateId: selectedSlate }),
    });

    const data = await res.json();

    if (data.error) {
      setMessage(data.error);
      return;
    }

    setGames(data.savedGames || []);
    setMessage(data.message || "Saved today’s games.");
  }

  async function addManual() {
    if (!selectedSlate || !manualGameId.trim()) return;

    const res = await fetch("/api/admin/slate-nba-games", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "manual",
        slateId: selectedSlate,
        gameId: manualGameId,
        gameCode: manualGameCode,
        note: manualNote,
      }),
    });

    const data = await res.json();

    if (data.error) {
      setMessage(data.error);
      return;
    }

    await load(selectedSlate);
    setManualGameId("");
    setManualGameCode("");
    setManualNote("");
    setMessage("Game saved.");
  }

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4">
      <nav className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <Link href="/admin" className="text-sky-700 hover:underline">
          ← Back to Admin
        </Link>
      </nav>

      <section className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-4xl font-bold text-slate-900">Slate NBA Games</h1>
        <p className="mt-4 text-slate-600">
          Save exact NBA game IDs for a slate. This makes multi-day slate refreshes reliable.
        </p>
      </section>

      {message && (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {message}
        </div>
      )}

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Slate
            </span>
            <select
              className="mt-2 w-full rounded-2xl border border-slate-200 px-4 py-3 text-slate-900"
              value={selectedSlate ?? ""}
              onChange={(e) => setSelectedSlate(Number(e.target.value))}
            >
              {slates.map((s) => (
                <option key={s.id} value={s.id}>
                  #{s.id} — {s.start_date}
                  {s.end_date !== s.start_date ? ` to ${s.end_date}` : ""}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={pullToday}
            className="rounded-2xl bg-sky-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-sky-700"
          >
            Pull Today’s Games
          </button>
        </div>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Manual Add</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <input
            placeholder="Game ID"
            value={manualGameId}
            onChange={(e) => setManualGameId(e.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3"
          />
          <input
            placeholder="Game Code, e.g. 20260504/PHINYK"
            value={manualGameCode}
            onChange={(e) => setManualGameCode(e.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3"
          />
          <input
            placeholder="Note, e.g. 76ers at Knicks"
            value={manualNote}
            onChange={(e) => setManualNote(e.target.value)}
            className="rounded-2xl border border-slate-200 px-4 py-3"
          />
        </div>

        <button
          onClick={addManual}
          className="mt-4 rounded-2xl bg-emerald-600 px-5 py-3 font-semibold text-white shadow-sm hover:bg-emerald-700"
        >
          Add Game
        </button>
      </section>

      <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-2xl font-bold text-slate-900">Saved Games</h2>

        {games.length === 0 ? (
          <p className="mt-4 text-slate-500">No games saved for this slate yet.</p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-100 text-slate-700">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Game ID</th>
                  <th className="px-4 py-3">Game Code</th>
                  <th className="px-4 py-3">Note</th>
                </tr>
              </thead>
              <tbody>
                {games.map((g) => (
                  <tr key={g.id} className="border-t border-slate-100">
                    <td className="px-4 py-3">{g.game_date ?? "—"}</td>
                    <td className="px-4 py-3 font-mono">{g.game_id}</td>
                    <td className="px-4 py-3 font-mono">{g.game_code ?? "—"}</td>
                    <td className="px-4 py-3">{g.note ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
