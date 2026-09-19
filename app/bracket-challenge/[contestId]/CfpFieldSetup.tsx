"use client";

import { useEffect, useMemo, useState } from "react";

type TeamOption = {
  providerTeamId: string;
  displayName: string;
  abbreviation: string | null;
  logoUrl: string | null;
};

type FieldTeam = TeamOption & { seed: number };

const emptyField = (): FieldTeam[] =>
  Array.from({ length: 12 }, (_, index) => ({
    seed: index + 1,
    providerTeamId: "",
    displayName: "",
    abbreviation: null,
    logoUrl: null,
  }));

export default function CfpFieldSetup({ competitionId }: { competitionId: number }) {
  const [field, setField] = useState<FieldTeam[]>(emptyField);
  const [savedField, setSavedField] = useState<FieldTeam[]>(emptyField);
  const [options, setOptions] = useState<TeamOption[]>([]);
  const [searchBySeed, setSearchBySeed] = useState<Record<number, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [fieldResponse, optionsResponse] = await Promise.all([
          fetch(`/api/admin/bracket-challenge/competitions/${competitionId}/field`, { cache: "no-store" }),
          fetch(`/api/admin/bracket-challenge/competitions/${competitionId}/field/options`, { cache: "no-store" }),
        ]);
        const [fieldResult, optionsResult] = await Promise.all([
          fieldResponse.json(),
          optionsResponse.json(),
        ]);
        if (!fieldResponse.ok) throw new Error(fieldResult?.error ?? "Unable to load the CFP field.");
        if (!optionsResponse.ok) throw new Error(optionsResult?.error ?? "Unable to load ESPN teams.");
        if (cancelled) return;

        const fieldBySeed = new Map<number, FieldTeam>(
          (fieldResult.field ?? []).map((team: FieldTeam) => [Number(team.seed), team]),
        );
        const nextField = emptyField().map((team) => fieldBySeed.get(team.seed) ?? team);
        setField(nextField);
        setSavedField(nextField);
        setOptions(optionsResult.teams ?? []);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Unable to load field setup.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [competitionId]);

  const selectedIds = useMemo(
    () => new Set(field.map((team) => team.providerTeamId).filter(Boolean)),
    [field],
  );
  const complete = field.every((team) => team.providerTeamId && team.displayName)
    && selectedIds.size === 12;
  const dirty = JSON.stringify(field) !== JSON.stringify(savedField);

  function chooseTeam(seed: number, providerTeamId: string) {
    const option = options.find((team) => team.providerTeamId === providerTeamId);
    if (!option && providerTeamId) return;
    setNotice("");
    setSearchBySeed((current) => ({ ...current, [seed]: "" }));
    setField((current) => current.map((team) =>
      team.seed === seed ? { seed, ...(option ?? { providerTeamId: "", displayName: "", abbreviation: null, logoUrl: null }) } : team,
    ));
  }

  async function save() {
    if (!complete || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/bracket-challenge/competitions/${competitionId}/field`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teams: field }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result?.error ?? "Unable to save CFP field.");

      const nextField = (result.field ?? []) as FieldTeam[];
      setField(nextField);
      setSavedField(nextField);
      setNotice(result.picksClearedCount > 0
        ? `CFP field saved. ${result.picksClearedCount} existing editable bracket pick${result.picksClearedCount === 1 ? " was" : "s were"} cleared because team identities changed.`
        : "CFP field saved.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save CFP field.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-5 border-t border-slate-700/70 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-300">Super Admin only · global competition field</p>
          <h2 className="mt-1 text-base font-black text-white">CFP test field</h2>
          <p className="mt-1 max-w-2xl text-xs text-slate-400">This sets the shared 2026 CFP field for every Group contest using this competition. It is a testing/correction tool, not a Group setting.</p>
        </div>
        {dirty ? <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-200">Unsaved changes</span> : null}
      </div>

      {error ? <p className="mt-3 rounded-xl border border-red-500/30 bg-red-950/30 px-3 py-2 text-xs text-red-200">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-100">{notice}</p> : null}
      {loading ? <p className="mt-4 text-sm text-slate-400">Loading ESPN FBS teams…</p> : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {field.map((team) => (
            <label key={team.seed} className="flex min-w-0 items-center gap-2 rounded-xl border border-slate-700/70 bg-slate-900/50 px-2.5 py-2">
              <span className="w-12 shrink-0 text-xs font-black text-slate-300">Seed {team.seed}</span>
              {team.logoUrl ? <img src={team.logoUrl} alt="" className="h-7 w-7 shrink-0 object-contain" /> : <span className="h-7 w-7 shrink-0 rounded bg-slate-800" />}
              <input type="search" value={searchBySeed[team.seed] ?? ""} onChange={(event) => setSearchBySeed((current) => ({ ...current, [team.seed]: event.target.value }))} placeholder="Search" className="w-20 shrink-0 border-0 bg-transparent text-xs text-slate-200 outline-none placeholder:text-slate-500" aria-label={`Search ESPN teams for CFP seed ${team.seed}`} />
              <select value={team.providerTeamId} onChange={(event) => chooseTeam(team.seed, event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none" aria-label={`CFP seed ${team.seed} ESPN team`}>
                <option value="">Select ESPN team…</option>
                {options.filter((option) => {
                  const query = (searchBySeed[team.seed] ?? "").trim().toLowerCase();
                  return !query || `${option.displayName} ${option.abbreviation ?? ""}`.toLowerCase().includes(query);
                }).map((option) => (
                  <option key={option.providerTeamId} value={option.providerTeamId} disabled={selectedIds.has(option.providerTeamId) && option.providerTeamId !== team.providerTeamId}>
                    {option.displayName}{option.abbreviation ? ` (${option.abbreviation})` : ""}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={() => void save()} disabled={!complete || saving || loading} className="rounded-xl bg-blue-500 px-4 py-2 text-sm font-black text-white transition hover:bg-blue-400 disabled:cursor-not-allowed disabled:opacity-45">
          {saving ? "Saving field…" : "Save complete CFP field"}
        </button>
        {!complete && !loading ? <span className="text-xs text-slate-500">Assign 12 unique ESPN teams to enable save.</span> : null}
      </div>
    </section>
  );
}
