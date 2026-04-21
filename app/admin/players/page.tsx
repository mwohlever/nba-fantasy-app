"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";

type PlayerRow = {
  id: number;
  name: string;
  position_group: "G" | "F/C";
  is_active: boolean;
  team_abbreviation?: string | null;
  nba_display_name?: string | null;
};

type ApiResponse = {
  success: boolean;
  players: PlayerRow[];
};

export default function AdminPlayersPage() {
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [originalPlayers, setOriginalPlayers] = useState<PlayerRow[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showInactiveOnly, setShowInactiveOnly] = useState(false);
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadPlayers();
  }, []);

  async function loadPlayers() {
    try {
      setIsLoading(true);
      setMessage("");

      const response = await fetch("/api/admin/players");
      const result = (await response.json()) as ApiResponse | { error?: string };

      if (!response.ok) {
        setMessage(
          "error" in result && result.error
            ? result.error
            : "Failed to load players."
        );
        return;
      }

      const safePlayers = (result as ApiResponse).players ?? [];
      setPlayers(safePlayers);
      setOriginalPlayers(safePlayers);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while loading players.");
    } finally {
      setIsLoading(false);
    }
  }

  function updatePlayer(
    playerId: number,
    field: "position_group" | "is_active",
    value: string | boolean
  ) {
    setPlayers((prev) =>
      prev.map((player) =>
        player.id === playerId
          ? {
              ...player,
              [field]: value,
            }
          : player
      )
    );
  }

  const changedPlayerIds = useMemo(() => {
    const originalMap = new Map(originalPlayers.map((player) => [player.id, player]));

    return new Set(
      players
        .filter((player) => {
          const original = originalMap.get(player.id);
          if (!original) return false;

          return (
            original.position_group !== player.position_group ||
            original.is_active !== player.is_active
          );
        })
        .map((player) => player.id)
    );
  }, [players, originalPlayers]);

  const filteredPlayers = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();

    return players.filter((player) => {
      const matchesSearch =
        normalizedSearch === "" ||
        player.name.toLowerCase().includes(normalizedSearch) ||
        (player.nba_display_name ?? "").toLowerCase().includes(normalizedSearch) ||
        (player.team_abbreviation ?? "").toLowerCase().includes(normalizedSearch);

      const matchesInactive = !showInactiveOnly || !player.is_active;
      const matchesChanged = !showChangedOnly || changedPlayerIds.has(player.id);

      return matchesSearch && matchesInactive && matchesChanged;
    });
  }, [players, searchTerm, showInactiveOnly, showChangedOnly, changedPlayerIds]);

  async function handleSave() {
    const originalMap = new Map(originalPlayers.map((player) => [player.id, player]));

    const updates = players
      .filter((player) => {
        const original = originalMap.get(player.id);
        if (!original) return false;

        return (
          original.position_group !== player.position_group ||
          original.is_active !== player.is_active
        );
      })
      .map((player) => ({
        id: player.id,
        position_group: player.position_group,
        is_active: player.is_active,
      }));

    if (updates.length === 0) {
      setMessage("No changes to save.");
      return;
    }

    try {
      setIsSaving(true);
      setMessage("");

      const response = await fetch("/api/admin/players", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ updates }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to save player updates.");
        return;
      }

      setMessage(`Saved ${result.updatedCount} player updates.`);
      setOriginalPlayers(players);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while saving player updates.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-sky-700">
                Admin
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">Players</h1>
              <p className="mt-2 text-sm text-slate-600">
                Edit positions and active/inactive status without using the raw table editor.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => void loadPlayers()}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-sky-200 hover:bg-sky-50"
              >
                Reload
              </button>

              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-2.5 text-sm font-medium text-sky-900 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search players, NBA display name, or team abbreviation"
              className="rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-sky-300"
            />

            <button
              type="button"
              onClick={() => setShowInactiveOnly((prev) => !prev)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                showInactiveOnly
                  ? "border-orange-300 bg-orange-100 text-orange-900"
                  : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50"
              }`}
            >
              {showInactiveOnly ? "Showing Inactive Only" : "All Active + Inactive"}
            </button>

            <button
              type="button"
              onClick={() => setShowChangedOnly((prev) => !prev)}
              className={`rounded-xl border px-4 py-3 text-sm font-medium transition ${
                showChangedOnly
                  ? "border-emerald-300 bg-emerald-100 text-emerald-900"
                  : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50"
              }`}
            >
              {showChangedOnly ? "Showing Changed Only" : "Show All Rows"}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
            <span>Total rows: {players.length}</span>
            <span>Visible rows: {filteredPlayers.length}</span>
            <span>Unsaved changes: {changedPlayerIds.size}</span>
          </div>

          {message ? (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              {message}
            </div>
          ) : null}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          {isLoading ? (
            <div className="px-2 py-6 text-sm text-slate-600">Loading players...</div>
          ) : filteredPlayers.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No players match your current filters.
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-slate-200">
              <div className="overflow-x-auto">
                <table className="min-w-full border-collapse text-sm">
                  <thead className="bg-slate-100 text-slate-700">
                    <tr className="text-left">
                      <th className="px-3 py-3 font-semibold">Name</th>
                      <th className="px-3 py-3 font-semibold">NBA Name</th>
                      <th className="px-3 py-3 font-semibold">Team</th>
                      <th className="px-3 py-3 font-semibold">Position</th>
                      <th className="px-3 py-3 font-semibold">Active</th>
                      <th className="px-3 py-3 font-semibold">Changed</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white text-slate-800">
                    {filteredPlayers.map((player) => {
                      const isChanged = changedPlayerIds.has(player.id);

                      return (
                        <tr
                          key={player.id}
                          className={`border-t border-slate-100 ${
                            isChanged ? "bg-emerald-50/50" : ""
                          }`}
                        >
                          <td className="px-3 py-3 font-medium">{player.name}</td>
                          <td className="px-3 py-3 text-slate-600">
                            {player.nba_display_name ?? "—"}
                          </td>
                          <td className="px-3 py-3 text-slate-600">
                            {player.team_abbreviation ?? "—"}
                          </td>
                          <td className="px-3 py-3">
                            <select
                              value={player.position_group}
                              onChange={(e) =>
                                updatePlayer(
                                  player.id,
                                  "position_group",
                                  e.target.value as "G" | "F/C"
                                )
                              }
                              className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm text-slate-900 outline-none transition focus:border-sky-300"
                            >
                              <option value="G">G</option>
                              <option value="F/C">F/C</option>
                            </select>
                          </td>
                          <td className="px-3 py-3">
                            <label className="inline-flex items-center gap-2 text-sm">
                              <input
                                type="checkbox"
                                checked={player.is_active}
                                onChange={(e) =>
                                  updatePlayer(player.id, "is_active", e.target.checked)
                                }
                                className="h-4 w-4 rounded border-slate-300"
                              />
                              <span>{player.is_active ? "Active" : "Inactive"}</span>
                            </label>
                          </td>
                          <td className="px-3 py-3">
                            {isChanged ? (
                              <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs text-emerald-800">
                                Unsaved
                              </span>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
