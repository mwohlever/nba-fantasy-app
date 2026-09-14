"use client";

import type { GolfDraftType, GolfGameType, GolfRosterPeriodType } from "@/lib/rules/leagueRules";

function Choice<T extends string>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <fieldset className="grid gap-1 sm:grid-cols-[7.5rem_1fr] sm:items-center sm:gap-3">
      <legend className="float-left w-full text-[11px] font-bold uppercase tracking-wide text-slate-500 sm:w-auto">
        {label}
      </legend>
      <div className="flex rounded-lg bg-slate-100 p-1">
        {options.map(([option, text]) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`min-h-10 flex-1 rounded-md px-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-emerald-600 ${
              value === option ? "bg-emerald-700 text-white shadow-sm" : "text-slate-600 hover:bg-white"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function GolfGameSetup({ gameType, draftType, rosterPeriodType, rosterSize, onGameType, onDraftType, onRosterPeriodType }: {
  gameType: GolfGameType;
  draftType: GolfDraftType;
  rosterPeriodType: GolfRosterPeriodType;
  rosterSize: number;
  onGameType: (value: GolfGameType) => void;
  onDraftType: (value: GolfDraftType) => void;
  onRosterPeriodType: (value: GolfRosterPeriodType) => void;
}) {
  return (
    <section className="space-y-2 border-t border-slate-200 pt-3">
      <h2 className="text-sm font-semibold text-slate-900">Game Setup</h2>
      <Choice label="Game Type" value={gameType} onChange={onGameType}
        options={[["standard", "Standard"], ["best_ball", "Best Ball"]]} />
      <Choice label="Draft Type" value={draftType} onChange={onDraftType}
        options={[["snake", "Snake"], ["salary_cap", "Salary Cap"]]} />
      <Choice label="Roster Periods" value={rosterPeriodType} onChange={onRosterPeriodType}
        options={[["full_tournament", "Full Tournament"], ["split_after_round_2", "Split After R2"]]} />
      {draftType === "salary_cap" ? (
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
          <span className="font-semibold text-slate-700">Salary Cap <strong className="ml-2 text-emerald-700">${rosterSize * 25}</strong></span>
          <span className="text-slate-500">$25 average budget per roster spot</span>
        </div>
      ) : null}
      <p className="text-[11px] text-slate-500">These choices are frozen for this slate.</p>
    </section>
  );
}
