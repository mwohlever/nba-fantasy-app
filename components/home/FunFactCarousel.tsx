"use client";

import { useEffect, useState } from "react";

type FunFact = {
  label: string;
  value: string;
  detail?: string;
};

type Props = {
  facts: FunFact[];
};

export default function FunFactCarousel({ facts }: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (facts.length <= 1) return;

    const interval = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % facts.length);
    }, 5000);

    return () => window.clearInterval(interval);
  }, [facts.length]);

  useEffect(() => {
    if (index > facts.length - 1) {
      setIndex(0);
    }
  }, [facts.length, index]);

  if (facts.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4">
        <div className="text-sm text-slate-500">No fun facts yet.</div>
      </div>
    );
  }

  const fact = facts[index];

  return (
    <div className="rounded-2xl border border-orange-200 bg-orange-50 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-orange-700">
            {fact.label}
          </div>
          <div className="mt-1 text-lg font-semibold text-slate-900">
            {fact.value}
          </div>
          {fact.detail ? (
            <div className="mt-1 text-sm text-slate-600">{fact.detail}</div>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() =>
              setIndex((prev) => (prev - 1 + facts.length) % facts.length)
            }
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-sky-200 hover:bg-sky-50"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => setIndex((prev) => (prev + 1) % facts.length)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-sky-200 hover:bg-sky-50"
          >
            →
          </button>
        </div>
      </div>

      <div className="text-xs text-slate-500">
        {index + 1} of {facts.length}
      </div>
    </div>
  );
}
