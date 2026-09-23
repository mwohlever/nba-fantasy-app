"use client";

export default function EditNameButton({ label, onClick }: { label: string; onClick: () => void }) {
  return <button
    type="button"
    onClick={onClick}
    aria-label={`Rename ${label}`}
    title={`Rename ${label}`}
    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-blue-300 transition hover:border-blue-400 hover:bg-blue-400/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-300"
  >
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="m4 20 4.3-.9L19 8.4a2 2 0 0 0-2.8-2.8L5.5 16.3 4 20Z" />
      <path d="m14.8 6.9 2.8 2.8" />
    </svg>
  </button>;
}
