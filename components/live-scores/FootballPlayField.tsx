"use client";

import { useEffect, useRef, useState } from "react";
import type { FootballVisualizationPlay } from "@/lib/live-scores/footballPlayVisualization";

const x = (yard: number) => 18 + yard * 2.84;
function resultLabel(play: FootballVisualizationPlay) {
  if (play.renderMode === "semantic") return play.semanticLabel ?? "GAME EVENT";
  if (play.family === "punt") return play.punt?.outcome ? play.punt.outcome.replace(/-/g, " ").toUpperCase() : "PUNT";
  if (play.scoring === "touchdown") return "TOUCHDOWN";
  if (play.scoring === "field-goal-good") return "FIELD GOAL · GOOD";
  if (play.scoring === "field-goal-missed") return "FIELD GOAL · NO GOOD";
  if (play.animation === "incomplete") return "INCOMPLETE";
  if (play.possessionChanged) return "POSSESSION RESULT";
  return play.end !== null && play.start !== null ? `${play.end - play.start >= 0 ? "+" : ""}${play.end - play.start} YDS` : "PLAY RESULT";
}
function secondaryLabel(play: FootballVisualizationPlay) {
  if (play.renderMode === "semantic") return play.semanticLabel ?? "GAME EVENT";
  if (play.family === "punt") {
    const outcome = play.punt?.outcome ? play.punt.outcome.replace(/-/g, " ").toUpperCase() : null;
    return ["PUNT", play.punt?.puntYards !== null && play.punt?.puntYards !== undefined ? `${play.punt.puntYards} YDS` : null, play.punt?.returnYards !== null && play.punt?.returnYards !== undefined ? `RETURN · ${play.punt.returnYards} YDS` : outcome].filter(Boolean).join(" · ");
  }
  const parts = [play.family === "field-goal" ? "FIELD GOAL" : play.family === "pass" ? "PASS" : play.family.toUpperCase(), play.qualifier];
  if (play.scoring === "touchdown") parts.push("TD");
  else if (play.scoring === "field-goal-good") parts.push("GOOD");
  else if (play.scoring === "field-goal-missed") parts.push("NO GOOD");
  else if (play.start !== null && play.end !== null && !play.possessionChanged) parts.push(`${play.end - play.start >= 0 ? "+" : ""}${play.end - play.start} YDS`);
  else if (play.resultOnly) parts.push("RESULT ONLY");
  return parts.filter(Boolean).join(" · ");
}
function Replay({ play, compact, enabled, reducedMotion }: { play: FootballVisualizationPlay; compact: boolean; enabled: boolean; reducedMotion: boolean }) {
  const [progress, setProgress] = useState(0); const frame = useRef<number | null>(null);
  useEffect(() => { if (frame.current) cancelAnimationFrame(frame.current); if (!enabled || reducedMotion || !play.animate) { setProgress(1); return; } setProgress(0); const start = performance.now(); const tick = (now: number) => { const next = Math.min((now - start) / (compact ? 600 : 850), 1); setProgress(next); if (next < 1) frame.current = requestAnimationFrame(tick); }; frame.current = requestAnimationFrame(tick); return () => { if (frame.current) cancelAnimationFrame(frame.current); }; }, [play.id, enabled, reducedMotion, play.animate, compact]);
  if (play.renderMode === "semantic") {
    const detailed = !compact && Boolean(play.semanticSecondaryLabel || play.semanticContextLabel);
    return <g><text x="160" y={detailed ? "28" : "37"} textAnchor="middle" fill="#f8fafc" fontSize={compact ? "9" : "11"} fontWeight="700">{play.semanticLabel ?? "GAME EVENT"}</text>{!compact && play.semanticSecondaryLabel ? <text x="160" y="40" textAnchor="middle" fill="#fde68a" fontSize="7" fontWeight="700">{play.semanticSecondaryLabel}</text> : null}{!compact && play.semanticContextLabel ? <text x="160" y={play.semanticSecondaryLabel ? "50" : "42"} textAnchor="middle" fill="#d1fae5" fontSize="6" fontWeight="700">{play.semanticContextLabel}</text> : null}</g>;
  }
  if (play.start === null) return null;
  const start = play.animation === "sack" ? Math.max(0, play.start - 4) : play.start;
  const final = play.end ?? play.start;
  const marker = play.animation === "incomplete" ? start + 2 : start + (final - start) * progress;
  const lane = play.animation === "pass" ? 25 : play.animation === "sack" ? 37 : 33;
  const ballY = play.animation === "pass" ? lane - Math.sin(progress * Math.PI) * 12 : lane;
  const touchdownOpacity = reducedMotion || progress >= 1 ? 1 : 0;
  const touchdownOverlay = play.scoring === "touchdown" && play.animate ? <text x="160" y={compact ? "37" : "37"} textAnchor="middle" fill="#fef3c7" stroke="#14532d" strokeWidth="2" paintOrder="stroke" opacity={touchdownOpacity} fontSize={compact ? "10" : "13"} fontWeight="800">TOUCHDOWN</text> : null;
  if (play.animation === "field-goal") { const kickStart = x(Math.max(0, start - 7)), kickEnd = 307, t = progress, ballX = (1-t)*(1-t)*kickStart + 2*(1-t)*t*((kickStart+kickEnd)/2) + t*t*kickEnd, ballY = (1-t)*(1-t)*35 + 2*(1-t)*t*7 + t*t*20; return <g><path d={`M ${kickStart} 35 Q ${(kickStart + kickEnd) / 2} 7 ${kickEnd} 20`} fill="none" stroke="#fbbf24" strokeWidth="1.35" strokeDasharray="3 2" opacity=".7" /><ellipse cx={ballX} cy={ballY} rx="3.7" ry="2.1" fill={play.scoring === "field-goal-missed" ? "#fb7185" : "#fbbf24"} stroke="#78350f" strokeWidth=".5" transform={`rotate(-18 ${ballX} ${ballY})`} />{progress >= 1 ? <text x="282" y="53" fill={play.scoring === "field-goal-missed" ? "#fda4af" : "#bbf7d0"} fontSize="7" fontWeight="700">{play.scoring === "field-goal-missed" ? "NO GOOD" : "GOOD"}</text> : null}</g>; }
  if (play.animation === "punt") {
    const destination = play.punt?.destination;
    const hasReturn = destination !== null && destination !== undefined && play.punt?.returnYards !== null && play.punt?.returnYards !== undefined && Math.abs(destination - final) >= 1;
    const kickEnd = hasReturn ? destination! : final;
    const split = .66;
    const kickProgress = hasReturn ? Math.min(progress / split, 1) : progress;
    const returnProgress = hasReturn ? Math.max(0, (progress - split) / (1 - split)) : 0;
    const kickX = (1-kickProgress)*(1-kickProgress)*x(start) + 2*(1-kickProgress)*kickProgress*x((start+kickEnd)/2) + kickProgress*kickProgress*x(kickEnd);
    const ballX = hasReturn && progress > split ? x(kickEnd + (final - kickEnd) * returnProgress) : kickX;
    const ballY = hasReturn && progress > split ? 40 : 33 - Math.sin(kickProgress*Math.PI)*20;
    return <g><path d={`M ${x(start)} 33 Q ${x((start + kickEnd) / 2)} 10 ${x(kickEnd)} 33`} fill="none" stroke="#c4b5fd" strokeWidth="1.2" strokeDasharray="3 2" opacity=".75" />{hasReturn ? <path d={`M ${x(kickEnd)} 40 L ${x(final)} 40`} fill="none" stroke="#7dd3fc" strokeWidth="1.25" strokeDasharray="2 2" opacity=".85" /> : null}<ellipse cx={ballX} cy={ballY} rx="3.7" ry="2.1" fill={hasReturn && progress > split ? "#bae6fd" : "#e9d5ff"} stroke={hasReturn && progress > split ? "#0c4a6e" : "#4c1d95"} strokeWidth=".55" transform={`rotate(-18 ${ballX} ${ballY})`} /></g>;
  }
  if (!play.animate) return play.end === null || !play.staticLabel ? null : <g><ellipse cx={x(play.end)} cy="33" rx="4" ry="2.35" fill="#f8fafc" stroke="#0f172a" strokeWidth=".75" transform={`rotate(-18 ${x(play.end)} 33)`} /><text x={x(play.end)} y="47" textAnchor="middle" fill="#d1fae5" fontSize="6">{play.staticLabel}</text></g>;
  return <g>{play.animation === "pass" ? <path d={`M ${x(start)} ${lane} Q ${x((start + final) / 2)} ${lane - 15} ${x(final)} ${lane}`} fill="none" stroke="#93c5fd" strokeWidth="1" strokeDasharray="3 2" opacity=".75" /> : null}<line x1={x(start)} y1={lane} x2={x(final)} y2={lane} stroke={play.animation === "incomplete" ? "#fb7185" : "#fbbf24"} strokeWidth="1" strokeOpacity=".55" strokeDasharray={play.animation === "incomplete" ? "2 2" : undefined} /><ellipse cx={x(marker)} cy={ballY} rx="4" ry="2.35" fill="#f8fafc" stroke="#0f172a" strokeWidth=".75" transform={`rotate(-18 ${x(marker)} ${ballY})`} />{play.animation === "incomplete" && progress > .7 ? <path d={`M ${x(start + 1)} ${lane - 4} l6 6 m0-6 l-6 6`} stroke="#fb7185" strokeWidth="1.2" /> : null}{touchdownOverlay}</g>;
}
export default function FootballPlayField({ play, offense, compact = false, replayEnabled = true }: { play: FootballVisualizationPlay | null; offense?: string | null; compact?: boolean; replayEnabled?: boolean }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => { const media = window.matchMedia("(prefers-reduced-motion: reduce)"), update = () => setReducedMotion(media.matches); update(); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  const height = compact ? "h-[92px]" : "h-[184px]";
  return <section className={compact ? "rounded-xl border border-slate-700 bg-slate-950/90 px-2 py-1.5 shadow-sm backdrop-blur" : "rounded-xl border border-slate-200 bg-slate-50 p-3"} aria-label="Selected football play replay"><div className={`mb-1 flex items-center justify-between gap-2 text-[10px] font-bold ${compact ? "text-slate-200" : "text-slate-500"}`}><span className="truncate">{compact ? `${play?.period ? `Q${play.period}` : ""}${play?.clock ? ` · ${play.clock}` : ""} · ${play?.text ?? "Selected play"}` : "SELECTED PLAY"}</span>{!compact ? <span className="shrink-0">{offense ? `${offense} →` : "OFFENSE →"}{play?.period ? ` · Q${play.period}` : ""}{play?.clock ? ` · ${play.clock}` : ""}</span> : null}</div><svg viewBox="0 0 320 66" className={`block w-full ${height} rounded bg-emerald-950`} role="img" aria-label="Football field normalized with offense attacking right"><rect x="0" y="6" width="18" height="54" fill="#14532d" /><rect x="302" y="6" width="18" height="54" fill="#14532d" /><rect x="18" y="6" width="284" height="54" fill="none" stroke="#bbf7d0" strokeOpacity=".65" />{[10,20,30,40,50,60,70,80,90].map(yard => <g key={yard}><line x1={x(yard)} x2={x(yard)} y1="6" y2="60" stroke="#bbf7d0" strokeOpacity=".22" /><text x={x(yard)} y="16" textAnchor="middle" fill="#d1fae5" fontSize="6">{yard <= 50 ? yard : 100-yard}</text></g>)}<text x="9" y="36" textAnchor="middle" fill="#d1fae5" fontSize="6" transform="rotate(-90 9 36)">{offense ?? "OFF"}</text><text x="311" y="36" textAnchor="middle" fill="#d1fae5" fontSize="6" transform="rotate(90 311 36)">END</text>{play?.start !== null && play?.start !== undefined ? <line x1={x(play.start)} x2={x(play.start)} y1="7" y2="59" stroke="#38bdf8" strokeWidth="2" /> : null}{play?.firstDown !== null && play?.firstDown !== undefined ? <line x1={x(play.firstDown)} x2={x(play.firstDown)} y1="7" y2="59" stroke="#fbbf24" strokeWidth="1.8" strokeDasharray="4 2" /> : null}{play ? <Replay play={play} compact={compact} enabled={replayEnabled} reducedMotion={reducedMotion} /> : null}</svg>{!compact ? <div className="mt-2"><p className="text-sm font-semibold leading-snug text-slate-800">{play?.text ?? "Select a play to inspect it."}</p>{play ? <div className="mt-1 flex items-center justify-between gap-2 text-[10px] font-bold text-slate-500"><span>{secondaryLabel(play)}</span><span>{resultLabel(play)}</span></div> : null}{play?.renderMode !== "semantic" ? <p className="mt-1 text-[10px] text-slate-500">Solid: LOS · Dashed: 1st down</p> : null}</div> : null}</section>;
}
