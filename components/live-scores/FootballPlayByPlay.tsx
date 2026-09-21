"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import FootballPlayField from "./FootballPlayField";
import { footballPlaysByQuarter } from "@/lib/live-scores/football-plays";
import { isMeaningfulFootballPlay, normalizeFootballVisualizationPlay, footballPlayId, type FootballRawPlay } from "@/lib/live-scores/footballPlayVisualization";

type Drive = { plays?: FootballRawPlay[] };

export default function FootballPlayByPlay({ drives, isLive, offenseNames, initialPeriod }: { drives: Drive[]; isLive: boolean; offenseNames: Record<string, string>; initialPeriod?: number | null }) {
  const grouped = useMemo(() => footballPlaysByQuarter(drives), [drives]);
  const all = useMemo(() => grouped.flatMap(group => group.plays), [grouped]);
  const periods = useMemo(() => grouped.map(group => group.period).sort((a, b) => a - b), [grouped]);
  const [period, setPeriod] = useState<number | null>(initialPeriod ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const [normalVisible, setNormalVisible] = useState(true);
  const [narrow, setNarrow] = useState(false);
  const [stickyReplayEnabled, setStickyReplayEnabled] = useState(false);
  const replayRegion = useRef<HTMLDivElement | null>(null);
  const priorSelection = useRef<string | null>(null);
  useEffect(() => { const media = window.matchMedia("(max-width: 639px)"), update = () => setNarrow(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => { const region = replayRegion.current, root = region?.closest("[data-game-center-scroll]"); if (!region || !root || !narrow || !window.IntersectionObserver) { setNormalVisible(true); return; } const observer = new IntersectionObserver(([entry]) => setNormalVisible(entry.isIntersecting), { root, threshold: .01 }); observer.observe(region); return () => observer.disconnect(); }, [narrow]);
  useEffect(() => { if (!periods.length) { setPeriod(null); return; } setPeriod(current => current && periods.includes(current) ? current : (isLive ? periods.at(-1)! : periods.at(-1)!)); }, [periods, isLive]);
  const activePeriod = initialPeriod ?? period;
  const periodPlays = useMemo(() => all.filter(play => play.period?.number === activePeriod), [all, activePeriod]);
  useEffect(() => { const selectable = periodPlays.filter(isMeaningfulFootballPlay); const latest = selectable[0] ?? periodPlays[0]; if (!latest) { setSelectedId(null); return; } const existing = periodPlays.find(play => footballPlayId(play) === selectedId); if (manual && existing) return; setSelectedId(footballPlayId(latest)); }, [periodPlays, selectedId, manual]);
  const selectedRaw = periodPlays.find(play => footballPlayId(play) === selectedId) ?? null;
  const selected = selectedRaw ? normalizeFootballVisualizationPlay(selectedRaw, 0, { offenseAbbreviation: selectedRaw.start?.team?.id ? offenseNames[String(selectedRaw.start.team.id)] : null }) : null;
  const compactVisible = narrow && !normalVisible;
  useEffect(() => { if (priorSelection.current !== null && priorSelection.current !== selectedId) setStickyReplayEnabled(true); priorSelection.current = selectedId; }, [selectedId]);
  const select = (play: FootballRawPlay) => { setManual(true); setSelectedId(footballPlayId(play)); };
  const latest = periodPlays.filter(isMeaningfulFootballPlay)[0] ?? periodPlays[0] ?? null;
  const periodNavigation = (sticky = false) => <div className={`flex items-center gap-2 overflow-x-auto ${sticky ? "bg-white px-1 pb-1 pt-1" : "pb-1"}`}>{periods.map(value => <button key={value} type="button" onClick={() => { setManual(false); setPeriod(value); }} className={`shrink-0 rounded-lg border px-3 py-1.5 text-xs font-black ${activePeriod === value ? "border-sky-500 bg-sky-50 text-sky-700" : "border-slate-200 bg-white text-slate-500"}`}>{value <= 4 ? `Q${value}` : `OT${value - 4}`}</button>)}{manual && latest ? <button type="button" onClick={() => { setManual(false); setSelectedId(footballPlayId(latest)); }} className="ml-auto shrink-0 text-xs font-bold text-sky-600">Latest ↗</button> : null}</div>;
  if (!grouped.length) return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Play-by-play is not available for this game.</div>;
  return <div className="space-y-3"><div ref={replayRegion}><FootballPlayField play={selected} offense={selected?.offenseTeamId ? offenseNames[selected.offenseTeamId] : null} /></div>{compactVisible ? <div className="sticky top-0 z-20 -mx-1 !-mt-4 bg-white"><FootballPlayField compact play={selected} offense={selected?.offenseTeamId ? offenseNames[selected.offenseTeamId] : null} replayEnabled={stickyReplayEnabled} />{periodNavigation(true)}</div> : periodNavigation()}<div className="overflow-hidden rounded-xl border border-slate-200">{periodPlays.map((play, index) => { const id = footballPlayId(play); const selectedRow = id === selectedId; return <button key={`${id}-${index}`} type="button" onClick={() => select(play)} className={`block w-full border-b border-slate-100 px-3 py-2.5 text-left last:border-b-0 ${selectedRow ? "bg-sky-50 ring-1 ring-inset ring-sky-200" : play.scoringPlay ? "bg-amber-50 hover:bg-amber-100" : "bg-white hover:bg-slate-50"}`}><span className="flex gap-3"><span className="w-14 shrink-0"><span className="block text-xs font-black text-slate-500">{play.clock?.displayValue || ""}</span>{play.start?.shortDownDistanceText ? <span className="mt-0.5 block whitespace-nowrap text-[10px] font-bold text-slate-400">{play.start.shortDownDistanceText}</span> : null}</span><span className={`min-w-0 flex-1 text-sm leading-snug ${play.scoringPlay ? "font-bold text-slate-900" : "text-slate-700"}`}>{play.text || "Play"}{play.scoringPlay && play.awayScore != null && play.homeScore != null ? <span className="mt-1 block text-xs font-black text-amber-700">{play.awayScore} - {play.homeScore}</span> : null}</span></span></button>; })}</div></div>;
}
