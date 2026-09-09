"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

/** Page-owned secondary controls, with ordinary Tab navigation (not a menu). */
export default function SecondaryControlsPanel({ open, onOpenChange, label, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const onChange = useRef(onOpenChange);
  onChange.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const close = () => { onChange.current(false); trigger.current?.focus(); };
    const pointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) close();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", key);
      trigger.current?.focus();
    };
  }, [open]);
  return <div ref={root} className="secondary-controls" data-pull-refresh-exclude>
    <button ref={trigger} type="button" className="scores-icon-button" aria-label={label}
      title={label} aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}>
      <span aria-hidden="true">⚙</span>
    </button>
    {open && <section id={id} className="secondary-controls-panel" aria-label={label} data-pull-refresh-overlay>
      <header><strong>{label}</strong><button ref={closeButton} type="button" aria-label={`Close ${label}`}
        className="scores-icon-button" onClick={() => onOpenChange(false)}>×</button></header>
      {children}
    </section>}
  </div>;
}
