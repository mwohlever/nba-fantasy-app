"use client";

import { useEffect, useMemo, useState } from "react";
import AppNav from "@/components/AppNav";

type SlateListRow = {
  id: number;
  date: string;
  start_date: string | null;
  end_date: string | null;
  is_locked: boolean;
  label: string;
};

type SlateTeamRow = {
  team_id: number;
  team_name: string;
  draft_order: number;
  is_participating: boolean;
};

type SlateDetailResponse = {
  success: boolean;
  slate: SlateListRow;
  teams: SlateTeamRow[];
};

export default function AdminSlatesPage() {
  const [slates, setSlates] = useState<SlateListRow[]>([]);
  const [selectedSlateId, setSelectedSlateId] = useState<number | "">("");
  const [selectedSlate, setSelectedSlate] = useState<SlateListRow | null>(null);
  const [teams, setTeams] = useState<SlateTeamRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadSlates();
  }, []);

  useEffect(() => {
    if (!selectedSlateId) return;
    void loadSlateDetail(selectedSlateId);
  }, [selectedSlateId]);

  async function loadSlates() {
    try {
      setIsLoading(true);
      setMessage("");

      const response = await fetch("/api/admin/slates");
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to load slates.");
        return;
      }

      const nextSlates = result.slates ?? [];
      setSlates(nextSlates);

      if (nextSlates.length > 0 && !selectedSlateId) {
        setSelectedSlateId(nextSlates[0].id);
      }
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while loading slates.");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSlateDetail(slateId: number) {
    try {
      setMessage("");

      const response = await fetch(`/api/admin/slates/${slateId}`);
      const result = (await response.json()) as SlateDetailResponse | { error?: string };

      if (!response.ok) {
        setMessage("error" in result ? result.error || "Failed to load slate." : "Failed to load slate.");
        return;
      }

      const safeResult = result as SlateDetailResponse;
      setSelectedSlate(safeResult.slate);
      setTeams(safeResult.teams);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while loading slate details.");
    }
  }

  function updateTeam(teamId: number, patch: Partial<SlateTeamRow>) {
    setTeams((prev) =>
      prev.map((team) =>
        team.team_id === teamId ? { ...team, ...patch } : team
      )
    );
  }

  async function handleSave() {
    if (!selectedSlateId || !selectedSlate) return;

    try {
      setIsSaving(true);
      setMessage("");

      const response = await fetch(`/api/admin/slates/${selectedSlateId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          is_locked: selectedSlate.is_locked,
          teams: teams.map((team) => ({
            team_id: team.team_id,
            draft_order: Number(team.draft_order),
            is_participating: team.is_participating,
          })),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to save slate.");
        return;
      }

      setMessage("Slate updated successfully.");
      await loadSlateDetail(selectedSlateId);
      await loadSlates();
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while saving.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReseed() {
    if (!selectedSlateId) return;

    try {
      setIsSaving(true);
      setMessage("");

      const response = await fetch(`/api/admin/slates/${selectedSlateId}/reseed`, {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to reseed slate.");
        return;
      }

      setMessage("Slate reseeded successfully.");
      await loadSlateDetail(selectedSlateId);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while reseeding.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedSlateId) return;

    const confirmed = window.confirm(
      "Delete this slate? This will remove lineups, stats, team results, and slate settings."
    );

    if (!confirmed) return;

    try {
      setIsSaving(true);
      setMessage("");

      const response = await fetch(`/api/admin/slates/${selectedSlateId}`, {
        method: "DELETE",
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to delete slate.");
        return;
      }

      setMessage("Slate deleted successfully.");
      setSelectedSlate(null);
      setTeams([]);
      setSelectedSlateId("");
      await loadSlates();
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong while deleting.");
    } finally {
      setIsSaving(false);
    }
  }

  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.draft_order - b.draft_order),
    [teams]
  );

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Slate Manager</h1>
              <p className="mt-2 text-sm text-slate-600">
                Edit participation, draft order, lock status, reseed, or delete a slate.
              </p>
            </div>

            <div className="min-w-[240px]">
              <label
                htmlFor="slate-select"
                className="mb-1 block text-xs font-medium text-slate-600"
              >
                Select Slate
              </label>
              <select
                id="slate-select"
                value={selectedSlateId}
                onChange={(e) => setSelectedSlateId(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-300"
              >
                {slates.map((slate) => (
                  <option key={slate.id} value={slate.id}>
                    {slate.label}
                    {slate.is_locked ? " (Locked)" : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {message ? (
          <div className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900 shadow-sm">
            {message}
          </div>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {isLoading ? (
            <div className="text-sm text-slate-600">Loading slates...</div>
          ) : !selectedSlate ? (
            <div className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Select a slate to manage it.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">
                    Current Slate
                  </div>
                  <div className="mt-1 text-xl font-semibold text-slate-900">
                    {selectedSlate.label}
                  </div>
                </div>

                <label className="flex items-center gap-3 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedSlate.is_locked}
                    onChange={(e) =>
                      setSelectedSlate((prev) =>
                        prev ? { ...prev, is_locked: e.target.checked } : prev
                      )
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Locked
                </label>
              </div>

              <div className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="overflow-x-auto">
                  <table className="min-w-full border-collapse text-sm">
                    <thead className="bg-slate-100 text-slate-700">
                      <tr className="text-left">
                        <th className="px-3 py-3">Team</th>
                        <th className="px-3 py-3">Participating</th>
                        <th className="px-3 py-3">Draft Order</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white text-slate-800">
                      {sortedTeams.map((team) => (
                        <tr key={team.team_id} className="border-t border-slate-100">
                          <td className="px-3 py-3 font-medium">{team.team_name}</td>
                          <td className="px-3 py-3">
                            <input
                              type="checkbox"
                              checked={team.is_participating}
                              onChange={(e) =>
                                updateTeam(team.team_id, {
                                  is_participating: e.target.checked,
                                })
                              }
                              className="h-4 w-4 rounded border-slate-300"
                            />
                          </td>
                          <td className="px-3 py-3">
                            <input
                              type="number"
                              min={1}
                              value={team.draft_order}
                              onChange={(e) =>
                                updateTeam(team.team_id, {
                                  draft_order: Number(e.target.value),
                                })
                              }
                              className="w-24 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-sky-300"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void handleSave()}
                  disabled={isSaving}
                  className="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-2.5 text-sm font-medium text-emerald-900 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving ? "Saving..." : "Save Slate"}
                </button>

                <button
                  type="button"
                  onClick={() => void handleReseed()}
                  disabled={isSaving}
                  className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-2.5 text-sm font-medium text-sky-900 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Reseed From Previous Slate
                </button>

                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={isSaving}
                  className="rounded-xl border border-red-300 bg-red-100 px-4 py-2.5 text-sm font-medium text-red-900 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Delete Slate
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
