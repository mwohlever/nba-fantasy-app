"use client";

export function SegmentedSelector<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void;
}) {
  return <div role="group" aria-label={label} className="flex rounded-xl bg-slate-100 p-1">
    {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value}
      onClick={() => onChange(option.value)} className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-bold ${value === option.value ? "bg-white text-sky-600 shadow-sm" : "text-slate-500"}`}>
      {option.label}
    </button>)}
  </div>;
}

export default function LiveViewSelector({ value, onChange }: { value: "games" | "standings"; onChange: (value: "games" | "standings") => void }) {
  return <SegmentedSelector label="Live view" value={value} onChange={onChange} options={[{ value: "games", label: "Games" }, { value: "standings", label: "Standings" }]} />;
}
