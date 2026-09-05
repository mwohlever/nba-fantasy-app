"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import AppNav from "@/components/AppNav";
import { useSelectedSport } from "@/components/providers/SportProvider";
import {
  calculateCorrectionFantasyPoints,
  parseCorrectionSport,
  type CorrectionSport,
  type CorrectionStatValues,
} from "@/lib/corrections/correctionPolicy";
import type { NbaScoringRules, NflScoringRules } from "@/lib/rules/leagueRules";
import type { StatColumn } from "@/lib/statColumns";

type Slate = {
  id: number;
  label: string;
  is_locked: boolean;
};

type Team = { id: number; name: string };
type Player = {
  id: number;
  name: string;
  positionGroup: string | null;
  teamAbbreviation: string | null;
};
type RosterRow = CorrectionStatValues & {
  playerId: number;
  name: string;
  positionGroup: string | null;
  fantasyPoints: number;
};
type ScoringRules = NbaScoringRules | NflScoringRules;

function emptyStats(columns: StatColumn[]): CorrectionStatValues {
  return Object.fromEntries(columns.map(({ key }) => [key, 0]));
}

export default function AdminCorrectionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { selectedSport, isHydrated } = useSelectedSport();
  const routeSport = parseCorrectionSport(searchParams.get("sport"));
  const sport: CorrectionSport = routeSport ?? (selectedSport === "nfl" ? "nfl" : "nba");

  const [slates, setSlates] = useState<Slate[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [statColumns, setStatColumns] = useState<StatColumn[]>([]);
  const [scoring, setScoring] = useState<ScoringRules | null>(null);
  const [selectedSlateId, setSelectedSlateId] = useState<number | null>(null);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [statDrafts, setStatDrafts] = useState<Record<number, CorrectionStatValues>>({});
  const [replacementPlayerId, setReplacementPlayerId] = useState<number | null>(null);
  const [isLoadingSetup, setIsLoadingSetup] = useState(true);
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [message, setMessage] = useState("");

  const selectedSlate = slates.find((slate) => slate.id === selectedSlateId) ?? null;
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const playerOptions = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  );

  async function loadSetup(targetSlateId?: number) {
    setIsLoadingSetup(true);
    setMessage("");
    setRoster([]);
    setStatDrafts({});
    setSelectedTeamId(null);

    try {
      const query = new URLSearchParams({ sport });
      if (targetSlateId) query.set("slateId", String(targetSlateId));
      const response = await fetch(`/api/admin/correction-data?${query}`, { cache: "no-store" });
      const result = await response.json();

      if (!response.ok) {
        setSlates([]);
        setTeams([]);
        setPlayers([]);
        setSelectedSlateId(null);
        setMessage(result.error || "Failed to load correction data.");
        return;
      }

      const nextSlates = (result.slates ?? []) as Slate[];
      const nextTeams = (result.teams ?? []) as Team[];
      setSlates(nextSlates);
      setTeams(nextTeams);
      setPlayers(result.players ?? []);
      setScoring(result.scoring ?? null);
      setSelectedSlateId(result.selectedSlateId ?? null);
      setSelectedTeamId(nextTeams[0]?.id ?? null);
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong loading correction data.");
    } finally {
      setIsLoadingSetup(false);
    }
  }

  async function loadRoster() {
    if (!selectedSlateId || !selectedTeamId) {
      setRoster([]);
      setStatDrafts({});
      return;
    }

    setIsLoadingRoster(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/team-slate-roster?slateId=${selectedSlateId}&teamId=${selectedTeamId}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (!response.ok) {
        setRoster([]);
        setMessage(result.error || "Failed to load roster.");
        return;
      }

      const nextColumns = (result.statColumns ?? []) as StatColumn[];
      const nextRoster = (result.roster ?? []) as RosterRow[];
      setStatColumns(nextColumns);
      setRoster(nextRoster);
      setStatDrafts(
        Object.fromEntries(
          nextRoster.map((row) => [
            row.playerId,
            Object.fromEntries(nextColumns.map(({ key }) => [key, Number(row[key] ?? 0)])),
          ]),
        ),
      );
    } catch (error) {
      console.error(error);
      setMessage("Something went wrong loading the roster.");
    } finally {
      setIsLoadingRoster(false);
    }
  }

  useEffect(() => {
    if (!isHydrated) return;
    if (!routeSport) router.replace(`/admin/corrections?sport=${sport}`);
    // The request response replaces Group/sport-specific setup atomically.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSetup();
    // The active Group remounts this subtree; sport is URL-authoritative here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated, sport]);

  useEffect(() => {
    // The request response replaces the selected slate/team roster atomically.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadRoster();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSlateId, selectedTeamId]);

  function updateDraft(playerId: number, key: string, value: string) {
    setStatDrafts((current) => ({
      ...current,
      [playerId]: { ...(current[playerId] ?? emptyStats(statColumns)), [key]: Number(value) },
    }));
  }

  async function runMutation(url: string, body: Record<string, unknown>, success: string) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(result.error || "Correction failed.");
      return false;
    }
    setMessage(success);
    await loadRoster();
    return true;
  }

  async function saveStats(playerId: number) {
    if (!selectedSlateId) return;
    await runMutation(
      "/api/admin/manual-stat-correction",
      { slateId: selectedSlateId, playerId, stats: statDrafts[playerId] ?? emptyStats(statColumns) },
      "Stat correction saved and slate totals recalculated.",
    );
  }

  async function correctLineup(action: "add" | "replace" | "remove", oldPlayerId?: number) {
    if (!selectedSlateId || !selectedTeamId) return;
    if ((action === "add" || action === "replace") && !replacementPlayerId) return;
    const saved = await runMutation(
      "/api/admin/lineup-correction",
      {
        slateId: selectedSlateId,
        teamId: selectedTeamId,
        action,
        oldPlayerId,
        newPlayerId: replacementPlayerId,
      },
      `Player ${action === "add" ? "added" : action === "replace" ? "replaced" : "removed"} and slate totals recalculated.`,
    );
    if (saved) setReplacementPlayerId(null);
  }

  async function recomputeSlate() {
    if (!selectedSlateId) return;
    await runMutation(
      "/api/admin/recompute-slate-results",
      { slateId: selectedSlateId },
      "Slate totals and finish positions recalculated.",
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900">
      <div className="mx-auto max-w-7xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-200 bg-white px-5 py-6 shadow-sm">
          <Link href={`/admin?sport=${sport}`} className="text-sm font-semibold text-sky-700 hover:text-sky-900">
            ← Commissioner Center
          </Link>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-wide text-sky-700">Admin</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">
                {sport === "nfl" ? "NFL" : "NBA"} Corrections
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
          ) : slates.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">
              No {sport.toUpperCase()} slates are available in the active Group.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-3">
              <label className="block">
                <span className="mb-2 block text-sm font-medium text-slate-700">Slate</span>
                <select
                  value={selectedSlateId ?? ""}
                  onChange={(event) => void loadSetup(Number(event.target.value))}
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
                <span className="mb-2 block text-sm font-medium text-slate-700">Team</span>
                <select
                  value={selectedTeamId ?? ""}
                  onChange={(event) => setSelectedTeamId(Number(event.target.value))}
                  disabled={teams.length === 0}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm disabled:opacity-60"
                >
                  {teams.length === 0 ? <option value="">No participating teams</option> : null}
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
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
              <h2 className="text-2xl font-semibold text-slate-900">Roster + Stat Corrections</h2>
              <p className="mt-1 text-sm text-slate-600">
                Edit stats directly, or replace/add a player for the selected team.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <select
                value={replacementPlayerId ?? ""}
                onChange={(event) => setReplacementPlayerId(event.target.value ? Number(event.target.value) : null)}
                disabled={!selectedTeamId}
                className="w-full rounded-xl border border-slate-200 bg-white px-3 py-3 text-sm sm:w-72"
              >
                <option value="">Choose {sport.toUpperCase()} player...</option>
                {playerOptions.map((player) => (
                  <option key={player.id} value={player.id}>
                    {player.name} {player.teamAbbreviation ? `(${player.teamAbbreviation})` : ""}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void correctLineup("add")}
                disabled={!selectedTeamId || !replacementPlayerId}
                className="rounded-xl border border-emerald-300 bg-emerald-100 px-4 py-3 text-sm font-medium text-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Add Player
              </button>
            </div>
          </div>

          {isLoadingRoster ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">Loading roster...</div>
          ) : roster.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-500">No roster found.</div>
          ) : (
            <div className="space-y-3">
              {roster.map((row) => {
                const draft = statDrafts[row.playerId] ?? emptyStats(statColumns);
                const supportsManualStats = sport !== "nfl" || row.positionGroup !== "D/ST";
                const draftFantasy = scoring
                  ? calculateCorrectionFantasyPoints({ sport, stats: draft, scoring })
                  : Number(row.fantasyPoints ?? 0);

                return (
                  <div key={row.playerId} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{row.positionGroup ?? "—"}</div>
                        <div className="text-lg font-semibold text-slate-900">{row.name}</div>
                        <div className="mt-1 text-sm text-slate-500">
                          Current FP: {Number(row.fantasyPoints ?? 0).toFixed(1)} • Draft FP: {draftFantasy.toFixed(1)}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => void correctLineup("replace", row.playerId)}
                          disabled={!replacementPlayerId}
                          className="rounded-xl border border-sky-300 bg-sky-100 px-3 py-2 text-sm font-medium text-sky-900 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Replace
                        </button>
                        <button
                          type="button"
                          onClick={() => void correctLineup("remove", row.playerId)}
                          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    {!supportsManualStats ? (
                      <p className="mt-4 text-sm text-slate-500">
                        D/ST component stats are not stored for manual correction.
                      </p>
                    ) : (
                    <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5 lg:grid-cols-10">
                      {statColumns.map(({ key, label }) => (
                        <label key={key} className="block">
                          <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
                          <input
                            type="number"
                            value={draft[key] ?? 0}
                            onChange={(event) => updateDraft(row.playerId, key, event.target.value)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                          />
                        </label>
                      ))}
                      <button
                        type="button"
                        onClick={() => void saveStats(row.playerId)}
                        className="col-span-2 rounded-xl border border-sky-300 bg-sky-100 px-4 py-3 text-sm font-medium text-sky-900 sm:col-span-5 lg:col-span-1 lg:self-end"
                      >
                        Save Stats
                      </button>
                    </div>
                    )}
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
