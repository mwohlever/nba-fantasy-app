"use client";

import { useEffect, useState } from "react";
import {
  clearAppLaunchTrace,
  getCurrentLaunchDiagnosticState,
  readAppLaunchTrace,
  type AppLaunchTraceRecord,
} from "@/lib/groups/launchTrace";

export default function LaunchDebugPage() {
  const [trace, setTrace] = useState<AppLaunchTraceRecord[]>([]);
  const [currentState, setCurrentState] = useState<ReturnType<
    typeof getCurrentLaunchDiagnosticState
  >>(null);
  const [copyStatus, setCopyStatus] = useState("");

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCurrentState(getCurrentLaunchDiagnosticState());
      setTrace(readAppLaunchTrace());
    }, 0);

    return () => window.clearTimeout(timeout);
  }, []);

  async function copyTrace() {
    const payload = JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        currentState: getCurrentLaunchDiagnosticState(),
        trace: readAppLaunchTrace(),
      },
      null,
      2,
    );

    try {
      await navigator.clipboard.writeText(payload);
      setCopyStatus("Copied");
    } catch {
      setCopyStatus("Copy failed");
    }
  }

  function clearTrace() {
    clearAppLaunchTrace();
    setTrace([]);
    setCopyStatus("Trace cleared");
  }

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-6 text-slate-100">
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-teal-300">
            Temporary diagnostics
          </p>
          <h1 className="mt-2 text-2xl font-black">PWA Launch Trace</h1>
        </header>

        <section className="rounded-2xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-slate-300">
            Current state
          </h2>
          <dl className="mt-3 grid gap-3 text-sm">
            <div>
              <dt className="text-slate-500">URL</dt>
              <dd className="break-all font-mono">{currentState?.location ?? "Loading…"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Standalone mode</dt>
              <dd>{currentState ? (currentState.standalone ? "Yes" : "No") : "Loading…"}</dd>
            </div>
            <div>
              <dt className="text-slate-500">111-last-location</dt>
              <dd className="break-all font-mono text-xs">
                {currentState?.lastLocation ?? "None"}
              </dd>
            </div>
          </dl>
        </section>

        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-black uppercase tracking-wide text-slate-300">
              Launch trace ({trace.length})
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void copyTrace()}
                className="rounded-xl bg-teal-300 px-3 py-2 text-sm font-bold text-slate-950"
              >
                Copy trace
              </button>
              <button
                type="button"
                onClick={clearTrace}
                className="rounded-xl border border-slate-700 px-3 py-2 text-sm font-bold"
              >
                Clear trace
              </button>
            </div>
          </div>
          {copyStatus ? <p className="mt-2 text-xs text-teal-300">{copyStatus}</p> : null}

          <ol className="mt-4 space-y-3">
            {trace.length ? (
              trace.map((record, index) => (
                <li
                  key={`${record.timestamp}:${record.event}:${index}`}
                  className="rounded-xl border border-slate-800 bg-slate-900 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="font-mono text-sm text-teal-300">{record.event}</strong>
                    <time className="text-[11px] text-slate-500">{record.timestamp}</time>
                  </div>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-300">
                    {JSON.stringify(record, null, 2)}
                  </pre>
                </li>
              ))
            ) : (
              <li className="rounded-xl border border-dashed border-slate-700 p-4 text-sm text-slate-500">
                No launch trace records yet.
              </li>
            )}
          </ol>
        </section>
      </div>
    </main>
  );
}
