"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const shotCastImage = "https://pga-tour-res.cloudinary.com/c_fill,b_rgb:ffffff,w_500,f_auto,q_auto/tourcastPickle/holes_2026_r_028_679_overhead_full_8_port.png";

const draftPlayers = [
  { name: "Anthony Edwards", position: "G", nbaId: 1630162 },
  { name: "Jalen Brunson", position: "G", nbaId: 1628973 },
  { name: "Jayson Tatum", position: "F/C", nbaId: 1628369 },
  { name: "LeBron James", position: "F/C", nbaId: 2544 },
  { name: "Nikola Jokic", position: "F/C", nbaId: 203999 },
];

function ShotCastPreview() {
  return (
    <article className="relative h-[300px] w-full min-w-0 overflow-hidden rounded-[1.4rem] border border-emerald-900/60 bg-slate-900 shadow-lg shadow-black/20 md:h-[350px] md:w-[310px]">
      <header className="flex items-center justify-between border-b border-slate-800 bg-slate-900/95 px-3 py-2.5">
          <div><p className="text-[8px] font-black uppercase tracking-[0.18em] text-emerald-400">ShotCast replay</p><p className="mt-0.5 text-xs font-bold text-slate-100">Scottie Scheffler · BMW Championship · Hole 8</p></div>
        <span className="rounded-md bg-emerald-950 px-2 py-1 text-[8px] font-black uppercase tracking-wide text-emerald-300">Course</span>
      </header>
      <div className="relative h-[207px] bg-cover bg-center md:h-[257px]" style={{ backgroundImage: `url(${shotCastImage})` }}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-label="Scottie Scheffler drive on BMW Championship hole 8">
          <path d="M44.1 80.6 C45.5 67, 52.5 50, 56.1 36.3" fill="none" stroke="#facc15" strokeWidth="2.3" strokeLinecap="round" style={{ filter: "drop-shadow(0 1px 1px rgb(0 0 0 / 65%))" }} />
          <circle cx="44.1" cy="80.6" r="2.2" fill="#0f172a" stroke="#ffffff" strokeWidth="0.9" style={{ filter: "drop-shadow(0 1px 1px rgb(0 0 0 / 65%))" }} />
          <circle cx="56.1" cy="36.3" r="3.4" fill="#facc15" stroke="#ffffff" strokeWidth="1" style={{ filter: "drop-shadow(0 1px 1px rgb(0 0 0 / 65%))" }} />
          <text x="56.1" y="37.5" textAnchor="middle" fontSize="3.5" fontWeight="900" fill="#111827">1</text>
        </svg>
        <div className="absolute bottom-2 left-2 right-2 rounded-xl border border-slate-700/70 bg-slate-950/90 px-3 py-2 shadow-lg"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-bold text-white">Shot 1 · 362 yds · Right fairway</p><span className="text-[9px] font-semibold text-emerald-300">248 yds to hole</span></div></div>
      </div>
      <div className="flex gap-1 border-t border-slate-800 px-3 py-2 text-[8px] font-bold uppercase tracking-wide text-slate-500"><span className="rounded-md bg-slate-700 px-2 py-1 text-white">Course</span><span className="px-2 py-1">Green View</span><span className="px-2 py-1">3D Green</span></div>
    </article>
  );
}

function DraftPreview() {
  return (
    <article className="w-full min-w-0 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 shadow-lg shadow-black/20 md:w-[295px]">
      <header className="px-3 py-3"><div className="flex items-start justify-between"><div><p className="text-[8px] font-black uppercase tracking-[0.16em] text-orange-300">Daily snake draft</p><p className="mt-1 text-sm font-black text-white">Your lineup</p></div><div className="text-right"><p className="text-sm font-black text-white">5/5</p><p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">Complete</p></div></div><div className="mt-2 h-1 overflow-hidden rounded-full bg-slate-800"><div className="h-full w-full rounded-full bg-gradient-to-r from-sky-500 via-sky-300 to-amber-400" /></div></header>
      <div className="px-3 pb-4 pt-1">
        {[draftPlayers.slice(0, 2), draftPlayers.slice(2)].map((row, rowIndex) => <div key={rowIndex} className={`flex justify-center ${rowIndex ? "mt-3 gap-3" : "gap-8"}`}>{row.map((player) => <div key={player.nbaId} className="w-[68px] min-w-0 text-center"><div role="img" aria-label={`${player.name} headshot`} className="mx-auto h-12 w-12 rounded-full border-2 border-sky-400/80 bg-slate-800 bg-cover bg-center shadow-md" style={{ backgroundImage: `url(https://cdn.nba.com/headshots/nba/latest/1040x760/${player.nbaId}.png)` }} /><p className="mt-1 truncate text-[9px] font-bold text-slate-100">{player.name}</p><p className="text-[8px] font-bold uppercase tracking-wide text-slate-500">{player.position}</p></div>)}</div>)}
      </div>
    </article>
  );
}

function HistoryAccent() {
  return <div className="hidden w-48 rounded-2xl border border-slate-800 bg-slate-900/85 p-3 opacity-60 md:block"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-amber-300">History</p><div className="mt-2 flex items-center gap-2"><span className="text-xl">🏆</span><div><p className="text-xs font-bold text-white">Trophy Case</p><p className="text-[9px] text-slate-500">Every season saved</p></div></div></div>;
}

function StandingsPreview() {
  const rows = [
    ["1", "9", "4", "1.8", "284.6", "341.2", "221.8"],
    ["2", "7", "5", "2.1", "276.3", "329.7", "214.5"],
    ["3", "6", "3", "2.5", "268.9", "318.4", "205.1"],
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 px-3 py-2.5"><p className="text-[8px] font-black uppercase tracking-[0.16em] text-emerald-400">All-time records</p><p className="mt-1 text-sm font-black text-white">Team Standings</p></div>
      <table className="w-full table-fixed border-collapse text-center text-[8px] text-slate-300">
        <thead className="bg-slate-800/80 text-[7px] font-bold uppercase leading-3 text-slate-400">
          <tr><th className="w-7 py-2">#</th><th className="py-2">Wins</th><th className="py-2">Runner-<br />ups</th><th className="py-2">Avg<br />finish</th><th className="py-2">Avg<br />score</th><th className="py-2">High<br />score</th><th className="py-2">Low<br />score</th></tr>
        </thead>
        <tbody>{rows.map((row, rowIndex) => <tr key={row[0]} className={`border-t border-slate-800 ${rowIndex === 0 ? "bg-amber-400/5" : ""}`}>{row.map((value, cellIndex) => <td key={`${row[0]}-${cellIndex}`} className={`px-0.5 py-3 font-bold ${cellIndex === 0 ? "text-emerald-300" : "text-slate-200"}`}>{value}</td>)}</tr>)}</tbody>
      </table>
      <div className="grid grid-cols-3 border-t border-slate-800 bg-slate-950 text-center text-[8px] font-bold uppercase tracking-wide text-slate-500"><span className="py-2 text-emerald-300">Stats</span><span className="py-2">History</span><span className="py-2">Trophies</span></div>
    </div>
  );
}

function NotificationsPreview() {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900 p-3">
      <div className="rounded-xl border border-teal-900/70 bg-slate-950 p-3 shadow-lg shadow-black/20">
        <div className="flex items-center gap-2"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-teal-300 text-[10px] font-black text-slate-950">111</span><div><p className="text-[9px] font-black uppercase tracking-[0.14em] text-teal-300">111 Sports · NBA</p><p className="mt-0.5 text-sm font-black text-white">🏀 Your turn to draft!</p></div></div>
        <p className="mt-3 text-[11px] leading-4 text-slate-300">You&apos;re on the clock for your second-round pick.</p>
        <p className="mt-2 text-[8px] font-bold uppercase tracking-wide text-slate-600">now</p>
      </div>
      <div className="mx-2 mt-3 rounded-xl border border-slate-800 bg-slate-950/75 px-3 py-2.5">
        <p className="text-[9px] font-black uppercase tracking-wide text-amber-300">111 Sports</p><p className="mt-1 text-xs font-black text-white">🏆 Slate Complete!</p><p className="mt-1 text-[9px] text-slate-400">Final standings are ready.</p>
      </div>
    </div>
  );
}

const mobileSlides = [
  { title: "ShotCast Replay", description: "Follow every shot with live ShotCast.", preview: <ShotCastPreview /> },
  { title: "Daily Snake Drafts", description: "Build your team at your own pace with your friends.", preview: <DraftPreview /> },
  { title: "Standings & History", description: "Track wins, stats, trophies, records, and every season.", preview: <StandingsPreview /> },
  { title: "Group Notifications", description: "Choose the alerts your Group wants for drafts, scores, and game updates.", preview: <NotificationsPreview /> },
];

function MobileFeatureCarousel() {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [activeSlide, setActiveSlide] = useState(0);
  const [timerResetKey, setTimerResetKey] = useState(0);

  const showSlide = useCallback((index: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ left: scroller.clientWidth * index, behavior: "smooth" });
    setActiveSlide(index);
  }, []);

  const resetAutoAdvance = useCallback(() => {
    setTimerResetKey((value) => value + 1);
  }, []);

  useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const mobileViewport = window.matchMedia("(max-width: 767px)");
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = null;
      if (document.hidden || reducedMotion.matches || !mobileViewport.matches) return;
      timeoutId = setTimeout(() => {
        showSlide((activeSlide + 1) % mobileSlides.length);
      }, 10_000);
    };

    schedule();
    document.addEventListener("visibilitychange", schedule);
    reducedMotion.addEventListener("change", schedule);
    mobileViewport.addEventListener("change", schedule);

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", schedule);
      reducedMotion.removeEventListener("change", schedule);
      mobileViewport.removeEventListener("change", schedule);
    };
  }, [activeSlide, showSlide, timerResetKey]);

  return (
    <div className="min-w-0 md:hidden">
      <p className="mb-3 text-[10px] font-black uppercase tracking-[0.18em] text-teal-300">Explore 111 Sports</p>
      <div ref={scrollerRef} onPointerDown={resetAutoAdvance} onScroll={(event) => { const width = event.currentTarget.clientWidth; if (width) setActiveSlide(Math.round(event.currentTarget.scrollLeft / width)); }} className="flex w-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {mobileSlides.map((slide) => <article key={slide.title} className="h-[410px] w-full min-w-full snap-center overflow-hidden rounded-2xl border border-slate-800 bg-slate-950/65 p-3"><div className="mb-3"><h2 className="text-base font-black text-white">{slide.title}</h2><p className="mt-1 text-xs leading-5 text-slate-400">{slide.description}</p></div><div className="max-h-[330px] overflow-hidden">{slide.preview}</div></article>)}
      </div>
      <div className="mt-3 flex justify-center gap-2" aria-label="Product tour slides">{mobileSlides.map((slide, index) => <button key={slide.title} type="button" onClick={() => { resetAutoAdvance(); showSlide(index); }} aria-label={`Show ${slide.title}`} aria-current={activeSlide === index ? "true" : undefined} className={`h-1.5 rounded-full transition-all ${activeSlide === index ? "w-5 bg-teal-300" : "w-1.5 bg-slate-600"}`} />)}</div>
    </div>
  );
}

export default function ProductShowcase() {
  return (
    <section aria-label="111 Sports product preview" className="relative mt-7 min-w-0 md:mt-0 md:min-h-[410px]">
      <MobileFeatureCarousel />
      <div className="hidden min-w-0 opacity-70 md:block"><div className="absolute left-10 top-4 z-20"><ShotCastPreview /></div><div className="absolute right-0 top-16 z-10"><DraftPreview /></div><div className="absolute bottom-4 right-12 z-0"><HistoryAccent /></div></div>
      <div className="pointer-events-none absolute inset-y-0 left-0 hidden w-24 bg-gradient-to-r from-slate-950 via-slate-950/65 to-transparent md:block" /><div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-28 bg-gradient-to-t from-slate-950 via-slate-950/70 to-transparent md:block" />
    </section>
  );
}
