"use client";

import AppNav from "@/components/AppNav";

export default function NbaSkinsDraftPage() {
  return (
    <main className="min-h-screen bg-slate-950 px-3 py-5 pb-24 text-slate-100 sm:px-4 sm:py-6 sm:pb-6">
      <div className="mx-auto max-w-6xl space-y-6">
        <AppNav />

        <section className="rounded-3xl border border-slate-700 bg-slate-900 p-6 shadow-sm">
          <div className="text-xs font-bold uppercase tracking-[0.18em] text-blue-300">
            NBA Skins
          </div>

          <h1 className="mt-2 text-3xl font-black tracking-tight text-white">
            Draft
          </h1>

          <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-400">
            The live Skins draft will use this dedicated page.
            Each league member drafts seven NBA teams and chooses
            Wins or Losses for every selection. Once the commissioner
            locks the draft, normal editing stops for the season.
          </p>

          <div className="mt-6 rounded-2xl border border-dashed border-slate-600 px-5 py-8 text-center">
            <div className="text-lg font-bold text-white">
              Draft board foundation ready
            </div>

            <div className="mt-2 text-sm text-slate-400">
              Live pick entry and draft locking come in the next phase.
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
