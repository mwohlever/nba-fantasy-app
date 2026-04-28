"use client";

import AppNav from "@/components/AppNav";
import { useEffect, useMemo, useState } from "react";

type Slate = {
  id: number;
  label: string;
  start_date: string;
  end_date: string;
  is_locked: boolean;
};

type Team = {
  id: number;
  name: string;
};

type Player = {
  id: number;
  name: string;
  position_group: "G" | "F/C" | null;
  is_active: boolean;
  team_abbreviation: string | null;
};

type RosterRow = {
  playerId: number;
  name: string;
  positionGroup: string | null;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fantasyPoints: number;
};

type StatDraft = {
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
};

function emptyStats(): StatDraft {
  return {
    points: 0,
    rebounds: 0,
    assists: 0,
    steals: 0,
    blocks: 0,
    turnovers: 0,
  };
}

function calculateFantasy(stats: StatDraft) {
  return Number(
    (
      Number(stats.points || 0) +
      Number(stats.rebounds || 0) * 1.2 +
      Number(stats.assists || 0) * 1.5 +
      Number(stats.steals || 0) * 2 +
      Number(stats.blocks || 0) * 2 -
      Number(stats.turnovers || 0)
    ).toFixed(1)
  );
}

export default function AdminCorrectionsPage() {
  const [slates, setSlates] = useState<Slate[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);

  const [selectedSlateId, setSelectedSlateId] = useState<number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);

  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [statDrafts, setStatDrafts] = useState<Record<number, StatDraft>>({});
  const [replacementPlayerId, setReplacementPlayerId] = useState<number | null>(null);

  const [isLoadingSetup, setIsLoadingSetup] = useState(true);
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [message, setMessage] = useState("");

  const selectedSlate = slates.find((slate) => slate.id === selectedSlateId) ?? null;
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;

  const playerOptions = useMemo(() => {
    return players.filter((player) => player.name).sort((a, b) => a.name.localeCompare(b.name));
  }, [players]);

  async function loadSetup() {
    try {
      setIsLoadingSetup(true);
      setMessage("");

      const response = await fetch("/api/admin/correction-data", {
        cache: "no-store",
      });
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to load correction data.");
        return;
      }

      const nextSlates = result.slates ?? [];
      const nextTeams = result.teams ?? [];

      setSlates(nextSlates);
      setTeams(nextTeams);
      setPlayers(result.players ?? []);

      if (nextSlates.length > 0) setSelectedSlateId(nextSlates[0].id);
      if (nextTeams.length > 0) setSelectedTeamId(nextTeams[0].id);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong loading correction data.");
    } finally {
      setIsLoadingSetup(false);
    }
  }

  async function loadRoster() {
    if (!selectedSlateId || !selectedTeamId) return;

    try {
      setIsLoadingRoster(true);
      setMessage("");

      const response = await fetch(
        `/api/team-slate-roster?slateId=${selectedSlateId}&teamId=${selectedTeamId}`,
        { cache: "no-store" }
      );
      const result = await response.json();

      if (!response.ok) {
        setMessage(result.error || "Failed to load roster.");
        return;
      }

      const nextRoster = result.roster ?? [];
      setRoster(nextRoster);

      const nextDrafts: Record<number, StatDraft> = {};
      nextRoster.forEach((row: RosterRow) => {
        nextDrafts[row.playerId] = {
          points: Number(row.points ?? 0),
          rebounds: Number(row.rebounds ?? 0),
          assists: Number(row.assists ?? 0),
          steals: Number(row.steals ?? 0),
          blocks: Number(row.blocks ?? 0),
          turnovers: Number(row.turnovers ?? 0),
        };
      });

      setStatDrafts(nextDrafts);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong loading the roster.");
    } finally {
      setIsLoadingRoster(false);
    }
  }

  useEffect(() => {
    void loadSetup();
  }, []);

  useEffect(() => {
    if (selectedSlateId && selectedTeamId) {
      void loadRoster();
    }
  }, [selectedSlateId, selectedTeamId]);

  function updateDraft(playerId: number, key: keyof StatDraft, value: string) {
    setStatDrafts((prev) => ({
      ...prev,
      [playerId]: {
        ...(prev[playerId] ?? emptyStats()),
        [key]: Number(value),
      },
    }));
  }

  async function saveStats(playerId: number) {
    if (!selectedSlateId) return;

    const stats = statDrafts[playerId] ?? emptyStats();

    const response = await fetch("/api/admin/manual-stat-correction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slateId: selectedSlateId,
        playerId,
        ...stats,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to save stat correction.");
      return;
    }

    setMessage("Stat correction saved and slate totals recalculated.");
    await loadRoster();
  }

  async function replacePlayer(oldPlayerId: number) {
    if (!selectedSlateId || !selectedTeamId || !replacementPlayerId) return;

    const response = await fetch("/api/admin/lineup-correction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slateId: selectedSlateId,
        teamId: selectedTeamId,
        action: "replace",
        oldPlayerId,
        newPlayerId: replacementPlayerId,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to replace player.");
      return;
    }

    setMessage("Player replaced and slate totals recalculated.");
    setReplacementPlayerId(null);
    await loadRoster();
  }

  async function addPlayer() {
    if (!selectedSlateId || !selectedTeamId || !replacementPlayerId) return;

    const response = await fetch("/api/admin/lineup-correction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slateId: selectedSlateId,
        teamId: selectedTeamId,
        action: "add",
        newPlayerId: replacementPlayerId,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to add player.");
      return;
    }

    setMessage("Player added and slate totals recalculated.");
    setReplacementPlayerId(null);
    await loadRoster();
  }

  async function removePlayer(oldPlayerId: number) {
    if (!selectedSlateId || !selectedTeamId) return;

    const response = await fetch("/api/admin/lineup-correction", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        slateId: selectedSlateId,
        teamId: selectedTeamId,
        action: "remove",
        oldPlayerId,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to remove player.");
      return;
    }

    setMessage("Player removed and slate totals recalculated.");
    await loadRoster();
  }

  async function recomputeSlate() {
    if (!selectedSlateId) return;

    const response = await fetch("/api/admin/recompute-slate-results", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ slateId: selectedSlateId }),
    });

    const result = await response.json();

    if (!response.ok) {
      setMessage(result.error || "Failed to recompute slate.");
      return;
    }

    setMessage("Slate totals and finish positions recalculated.");
    await loadRoster();
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-sky-700">
                Admin
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                Corrections
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                Fix historical rosters, stat lines, slate totals, and finish positions.
              </p>
            </div>

            <button
              type="button"
              onClick={recomputeSlate}
              disabled={!selectedSlateId}
              className="rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm font-medium text-sky-900 transition hover:bg-sky-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Recompute Slate
            </button>
          </div>
        </section>

        {message ? (
          <section className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
            {message}
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {isLoadingSetup ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading correction tools...
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Slate
                </span>
                <select
                  value={selectedSlateId ?? ""}
                  onChange={(event) => setSelectedSlateId(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
                >
                  {slates.map((slate) => (
                    <option key={slate.id} value={slate.id}>
                      {slate.label} {slate.is_locked ? "(Locked)" : "(Open)"}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">
                  Team
                </span>
                <select
                  value={selectedTeamId ?? ""}
                  onChange={(event) => setSelectedTeamId(Number(event.target.value))}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm"
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
              </label>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <div className="font-semibold text-slate-900">Current Selection</div>
                <div className="mt-1">{selectedSlate?.label ?? "—"}</div>
                <div>{selectedTeam?.name ?? "—"}</div>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-2xl font-semibold text-slate-900">
                Roster + Stat Corrections
              </h2>
              <p className="mt-1 text-sm text-slate-600">
                Edit stats directly, or replace/add a player for the selected team.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={replacementPlayerId ?? ""}
                onChange={(event) =>
                  setReplacementPlayerId(
                    event.target.value ? Number(event.target.value) : null
                  )
                }
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm sm:w-72"
              >
                <option value="">Choose player...</option>
                {playerOptions.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} {player.team_abbreviation ? `(${player.team_abbreviation})` : ""}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={addPlayer}
                disabled={!replacementPlayerId}
                className="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add Player
              </button>
            </div>
          </div>

          {isLoadingRoster ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              Loading roster...
            </div>
          ) : roster.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No roster found.
            </div>
          ) : (
            <div className="space-y-3">
              {roster.map((row) => {
                const draft = statDrafts[row.playerId] ?? emptyStats();

                return (
                  <div
                    key={row.playerId}
                    className="rounded-2xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          {row.positionGroup ?? "—"}
                        </div>
                        <div className="text-lg font-semibold text-slate-900">
                          {row.name}
                        </div>
                        <div className="mt-1 text-sm text-slate-500">
                          Current FP: {Number(row.fantasyPoints ?? 0).toFixed(1)} • Draft FP:{" "}
                          {calculateFantasy(draft).toFixed(1)}
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => replacePlayer(row.playerId)}
                          disabled={!replacementPlayerId}
                          className="rounded-xl border border-sky-300 bg-sky-100 px-3 py-2 text-sm font-medium text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Replace
                        </button>

                        <button
                          type="button"
                          onClick={() => removePlayer(row.playerId)}
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-7">
                      {[
                        ["points", "PTS"],
                        ["rebounds", "REB"],
                        ["assists", "AST"],
                        ["steals", "STL"],
                        ["blocks", "BLK"],
                        ["turnovers", "TO"],
                      ].map(([key, label]) => (
                        <label key={key} className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-500">
                            {label}
                          </span>
                          <input
                            type="number"
                            value={draft[key as keyof StatDraft]}
                            onChange={(event) =>
                              updateDraft(
                                row.playerId,
                                key as keyof StatDraft,
                                event.target.value
                              )
                            }
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                      ))}

                      <button
                        type="button"
                        onClick={() => saveStats(row.playerId)}
                        className="col-span-3 rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm font-medium text-sky-900 sm:col-span-1 sm:self-end"
                      >
                        Save Stats
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
