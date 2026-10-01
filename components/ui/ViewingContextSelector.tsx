"use client";

import type { ViewingOption } from "@/lib/viewing-context/context";

export default function ViewingContextSelector({ label, value, options, onChange, disabled = false }: {
  label: string;
  value: number | null;
  options: readonly ViewingOption[];
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return <label className="flex w-full min-w-0 items-center gap-2 text-xs text-[var(--app-text-muted)] sm:max-w-md">
    <span className="shrink-0">{label}</span>
    <select aria-label={label} value={value ?? ""} disabled={disabled || !options.length}
      onChange={event => onChange(Number(event.target.value))}
      className="min-h-11 w-full min-w-0 flex-1 truncate rounded-lg border border-[var(--app-border)] bg-[var(--app-surface)] px-2 text-sm font-semibold text-[var(--app-text)] focus-visible:outline-2 focus-visible:outline-[var(--app-blue)] disabled:opacity-60">
      {!options.length && <option value="">None available</option>}
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>;
}
