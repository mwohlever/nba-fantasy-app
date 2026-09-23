"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";

type TextEntryDialogProps = {
  title: string;
  label: string;
  description?: string;
  initialValue?: string;
  submitLabel: string;
  emptyError?: string;
  maxLength?: number;
  onSubmit: (value: string) => Promise<void>;
  onClose: () => void;
};

/** Small native modal shell shared by simple 111 Sports text-entry flows. */
export default function TextEntryDialog({
  title, label, description, initialValue = "", submitLabel, emptyError,
  maxLength = 80, onSubmit, onClose,
}: TextEntryDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.showModal();
    if (window.matchMedia("(pointer: fine)").matches) {
      const frame = window.requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
      });
      return () => { window.cancelAnimationFrame(frame); dialog.close(); };
    }
    return () => dialog.close();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const next = value.trim();
    if (!next && emptyError) { setError(emptyError); return; }
    if (next.length > maxLength) { setError(`${label} must be at most ${maxLength} characters.`); return; }
    try {
      setSaving(true);
      setError("");
      await onSubmit(next);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return <dialog
    ref={dialogRef}
    aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}
    onClick={(event) => { if (event.target === dialogRef.current && !saving) onClose(); }}
    className="m-auto w-[calc(100%-2rem)] max-w-sm max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-0 text-slate-100 shadow-2xl shadow-black/60 backdrop:bg-slate-950/75"
  >
    <form onSubmit={(event) => void submit(event)} className="p-5 sm:p-6">
      <h2 id={titleId} className="text-xl font-black text-white">{title}</h2>
      {description ? <p id={descriptionId} className="mt-1 text-sm text-slate-400">{description}</p> : null}
      <label className="mt-5 block text-sm font-bold text-slate-200">
        {label}
        <input
          ref={inputRef}
          type="text"
          value={value}
          maxLength={maxLength}
          autoComplete="off"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => { setValue(event.target.value); if (error) setError(""); }}
          disabled={saving}
          className="mt-2 w-full min-w-0 rounded-xl border border-slate-600 bg-slate-950 px-3 py-3 text-base font-medium text-white outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 disabled:opacity-60"
        />
      </label>
      {error ? <p id={errorId} role="alert" className="mt-2 text-sm text-red-300">{error}</p> : null}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} disabled={saving} className="rounded-lg border border-slate-600 px-4 py-2.5 text-sm font-bold text-slate-200 disabled:opacity-50">Cancel</button>
        <button type="submit" disabled={saving} className="rounded-lg bg-blue-500 px-4 py-2.5 text-sm font-black text-white transition hover:bg-blue-400 disabled:opacity-50">{saving ? "Saving…" : submitLabel}</button>
      </div>
    </form>
  </dialog>;
}
