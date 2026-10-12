"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LiveScoreGame } from "@/components/live-scores/LiveScoreCard";
import type { ImplicationSelection, ImplicationSubject, ImplicationsResponse } from "@/lib/bracket/gameImplications.server";
import { implicationSelectionQuery, matchesImplicationContext, implicationLockConsistent, implicationReadStamp } from "@/lib/bracket/implicationsContext";
import { parseBracketLiveState, resolveImplicationSubject, selectionForSubject } from "@/lib/bracket/liveState";
import { gameImplicationsNarrative } from "@/lib/bracket/implicationsNarrative";

export type ImplicationsDataSource = {
  version: string;
  list: (signal: AbortSignal) => Promise<ImplicationsResponse>;
  analyze: (selection: ImplicationSelection, gameId: string, signal: AbortSignal) => Promise<ImplicationsResponse>;
};

export default function BracketGameImplications({ contestId, gameId, selection, selectionRequested = Boolean(selection), onSelectionChange, game, refreshKey = 0, source }: {
  contestId: string; gameId?: string; selection: ImplicationSelection | null; selectionRequested?: boolean;
  onSelectionChange: (subject: ImplicationSubject | null, replace?: boolean) => void; game: LiveScoreGame | null;
  refreshKey?: number;
  source?: ImplicationsDataSource;
}) {
  const [cohort, setCohort] = useState<{ contestId: string; subjects: ImplicationSubject[]; stamp: string;
    poolState: ImplicationsResponse["poolState"] | null; locked: boolean | null } | null>(null);
  const [listFailure, setListFailure] = useState<{ contestId: string; message: string } | null>(null);
  const [result, setResult] = useState<{ key: string; data: ImplicationsResponse } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const subjects = useMemo(() => cohort?.contestId === contestId ? cohort.subjects : [], [cohort, contestId]);
  const selected = resolveImplicationSubject(subjects, selection, selectionRequested);
  const query = selected ? implicationSelectionQuery(selectionForSubject(selected)).toString() : "";
  const effectiveSelection = useMemo(() => parseBracketLiveState(query).selection, [query]);
  const visibilityKey = cohort?.contestId === contestId ? `${cohort.locked}:${cohort.poolState}` : "loading";
  const key = `${contestId}:${gameId}:${query}:${source?.version ?? "official"}:${visibilityKey}`;
  const providerStatus = game?.status;

  const acceptSubjects = useCallback((data: ImplicationsResponse) => {
    const stamp = implicationReadStamp(data);
    setCohort((current) => {
      if (current?.contestId === contestId && current.stamp > stamp) return current;
      const poolState = data.poolState ?? (current?.contestId === contestId ? current.poolState : null);
      const locked = data.contestLock?.locked ?? (current?.contestId === contestId ? current.locked : null);
      return current?.contestId === contestId && current.stamp === stamp && current.poolState === poolState && current.locked === locked && JSON.stringify(current.subjects) === JSON.stringify(data.subjects)
        ? current : { contestId, subjects: data.subjects, stamp, poolState, locked };
    });
  }, [contestId]);

  useEffect(() => {
    if (!gameId) return;
    const controller = new AbortController();
    let inFlight = false;
    async function loadList() {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = source ? await source.list(controller.signal) : await fetch(`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}/implications`, { cache: "no-store", signal: controller.signal })
          .then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error || "Unable to load brackets."); return body as ImplicationsResponse; });
        if (data.contestId !== contestId || !implicationLockConsistent(data)) throw new Error("Contest context changed. Refresh the bracket list.");
        if (!controller.signal.aborted) { setListFailure(null); acceptSubjects(data); }
      } catch (error) {
        if (!controller.signal.aborted) { setCohort(null); setListFailure({ contestId, message: error instanceof Error ? error.message : "Unable to load brackets." }); }
      } finally { inFlight = false; }
    }
    void loadList();
    // Access/readiness can change at the deadline even with no viewed bracket or provider status change.
    const timer = window.setInterval(() => { void loadList(); }, providerStatus === "in" || providerStatus === "post" ? 20_000 : 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [contestId, gameId, retry, refreshKey, source, providerStatus, acceptSubjects]);

  useEffect(() => {
    if (!selectionRequested && selected) onSelectionChange(selected, true);
  }, [selectionRequested, selected, onSelectionChange]);

  useEffect(() => {
    if (!query || !gameId) return;
    const controller = new AbortController();
    let inFlight = false;
    async function load() {
      if (inFlight) return;
      inFlight = true;
      try {
        let data: ImplicationsResponse;
        if (source) data = await source.analyze(effectiveSelection!, gameId!, controller.signal);
        else {
          const response = await fetch(`/api/bracket-challenge/contests/${encodeURIComponent(contestId)}/implications?${query}&gameId=${encodeURIComponent(gameId!)}`, { cache: "no-store", signal: controller.signal });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error || "Unable to load implications.");
          data = body;
        }
        if (!matchesImplicationContext(data, contestId, gameId!, effectiveSelection!)) throw new Error("Bracket context changed. Select the bracket again.");
        if (!controller.signal.aborted) {
          setFailure(null); setResult({ key, data });
          acceptSubjects(data);
        }
      } catch (error) {
        if (!controller.signal.aborted) { setResult(null); setFailure({ key, message: error instanceof Error ? error.message : "Unable to load implications." }); }
      } finally { inFlight = false; }
    }
    void load();
    const timer = window.setInterval(() => { void load(); }, providerStatus === "in" || providerStatus === "post" ? 20_000 : 60_000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [contestId, gameId, query, key, effectiveSelection, retry, providerStatus, refreshKey, source, acceptSubjects]);

  // Render gating hides a previous game/entry immediately, even if its request ignores abort.
  const matching = query && result?.key === key ? result.data : null;
  const data = matching && !(cohort?.contestId === contestId && cohort.stamp > implicationReadStamp(matching) &&
    (cohort.poolState !== null && cohort.poolState !== matching.poolState || matching.contestLock && cohort.locked !== matching.contestLock.locked)) ? matching : null;
  const error = failure?.key === key ? failure.message : "";
  const listError = listFailure?.contestId === contestId ? listFailure.message : "";
  const narrative = data ? gameImplicationsNarrative(data, game) : null;
  const refresh = () => { setFailure(null); setResult(null); setListFailure(null); setRetry((value) => value + 1); };
  if (!gameId) return <p className="p-4 text-sm text-slate-600">This development event isn’t part of the CFP bracket. Game implications are available on tournament games.</p>;
  return <div className="space-y-4 p-4 text-sm leading-relaxed text-slate-700" data-bracket-implications>
    <div>
      <label htmlFor="implications-bracket" className="mb-1 block text-xs font-bold text-slate-500">Viewing bracket</label>
      <select id="implications-bracket" value={selected?.masterBracketId ?? ""} onChange={(event) => onSelectionChange(subjects.find((row) => row.masterBracketId === event.target.value) ?? null)} className="w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 sm:max-w-md">
        <option value="">Select a bracket…</option>
        {subjects.map((subject) => <option key={subject.masterBracketId} value={subject.masterBracketId}>{subject.label}{subject.snapshotStatus === "pending" ? " · Pending" : ""}</option>)}
      </select>
    </div>
    {listError || error ? <p role="alert" className="text-rose-700">{listError || error} <button className="font-bold underline" onClick={refresh}>Retry</button></p>
      : cohort?.contestId !== contestId ? <p role="status" className="text-slate-500">Loading brackets…</p>
        : !selected ? <p className="text-slate-600">{selectionRequested ? "That bracket is unavailable or private. Choose an available bracket above." : subjects.length ? "Choose whose bracket to explore. There isn’t a single personal bracket to select automatically." : "No viewable brackets are available yet."}</p>
          : !data ? <p role="status" className="text-slate-500">Loading implications…</p>
            : !narrative ? <p className="text-slate-600">{selected.entrantName}’s locked picks are still being finalized. <button className="font-bold underline" onClick={refresh}>Refresh</button></p>
              : <>
                <header data-story-kind={narrative.story?.significance.primary.kind}>
                  <p className="mb-1 text-[10px] font-black uppercase tracking-widest text-sky-700">{narrative.story?.phase === "official" ? "The aftermath" : narrative.story?.phase === "live" ? "As it stands" : narrative.story?.phase === "provider_final" ? "Awaiting official result" : "Why this game matters"}</p>
                  <h2 className="text-xl font-black leading-snug text-slate-950">{narrative.story?.main.headline}</h2>
                  {narrative.story?.main.body ? <p className="mt-2">{narrative.story.main.body}</p> : null}
                  {narrative.story?.status ? <p className="mt-2 text-xs text-slate-500">{narrative.story.status}</p> : null}
                  {selected.snapshotStatus === "draft" ? <p className="mt-1 text-xs text-slate-500">Private draft · current contest rules</p> : null}
                </header>
                {narrative.story?.championship ? <section aria-label="Championship recap" className="rounded-xl border border-sky-200 bg-sky-50 p-4">
                  <p className="text-xs font-black uppercase tracking-widest text-sky-700">National champions</p>
                  <p className="mt-1 text-2xl font-black text-slate-950">{narrative.story.championship.champion}</p>
                  {narrative.story.championship.runnerUp ? <p className="mt-1 text-sm">Runner-up: {narrative.story.championship.runnerUp}</p> : null}
                  {narrative.story.championship.score ? <p className="mt-1 font-bold">Final scoreboard: {narrative.story.championship.score}</p> : null}
                </section> : null}
                {narrative.story?.supports.length ? <div className="space-y-3 border-l-2 border-sky-200 pl-3">{narrative.story.supports.map((line) => <div key={line.id}><p className="font-bold text-slate-950">{line.headline}</p>{line.body ? <p className="mt-1 text-xs">{line.body}</p> : null}</div>)}</div> : null}
                {narrative.story?.showOutcomes && narrative.cards.length ? <div className="grid gap-3 sm:grid-cols-2" aria-label="Possible outcomes">
                  {narrative.cards.map((card) => <article key={card.teamId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <h3 className="font-bold text-slate-950">{card.title}</h3><p className="mt-1 font-black text-sky-700">{card.award}</p>
                    {card.consequences.slice(0, 1).map((line) => <p className="mt-2 text-xs" key={line}>{line}</p>)}
                  </article>)}
                </div> : null}
                {narrative.story?.recap.length ? <section aria-label="Confirmed contest recap" className="space-y-2 border-t border-slate-200 pt-3">{narrative.story.recap.map((line) => <p key={line}>{line}</p>)}</section> : null}
                {narrative.privacy ? <p className="text-xs text-slate-500">{narrative.privacy}</p> : null}
                <p className="text-[10px] text-slate-400">Official results checked {new Date(data.freshness.readAt).toLocaleTimeString()}.</p>
              </>}
  </div>;
}
