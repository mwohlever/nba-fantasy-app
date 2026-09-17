import type { FootballEventEmphasis, NflFieldState } from "@/lib/live-scores/nflField";

const emphasisLabel = (kind: FootballEventEmphasis["kind"]) => ({
  touchdown: "TOUCHDOWN!", "field-goal": "FIELD GOAL!", interception: "INTERCEPTION!", turnover: "TURNOVER!",
}[kind] ?? "");

// Shared NFL/college field; keep the module path stable for existing consumers.
export default function FootballLiveField({ field }: { field: NflFieldState | null | undefined }) {
  const state = field;
  const display: NflFieldState = field ?? { offense: "", defense: "", color: null, ball: null, firstDown: null, downDistance: "", position: "", clock: "", latestPlay: "", latestEvent: null, lastFootballPlay: null, fieldStatePlay: null, eventEmphasis: null };
  const x = (yard: number) => 24 + yard * 2.72;
  const latestDiffers = Boolean(display.latestEvent && display.lastFootballPlay && (
    display.latestEvent.id !== display.lastFootballPlay.id ||
    display.latestEvent.id === null && (display.latestEvent.text !== display.lastFootballPlay.text || display.latestEvent.type !== display.lastFootballPlay.type)
  ));
  const emphasis = display.eventEmphasis;
  return <section className="mb-3 text-xs text-slate-700 dark:text-slate-200" aria-label="Live football field">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 font-semibold">
      <span><span className="mr-1 inline-block h-2 w-2 rounded-full border border-slate-400" style={{ backgroundColor: display.color ?? undefined }} aria-hidden="true" />{display.offense ? `${display.offense} possession →` : "Field state unavailable"}{display.downDistance ? ` · ${display.downDistance}` : ""}</span>
      <span>{[display.position, display.clock].filter(Boolean).join(" · ")}</span>
    </div>
    <div className="relative">
      <svg viewBox="0 0 320 66" className="block h-20 w-full rounded bg-emerald-950" role="img"
        aria-label={display.ball === null ? "Football field; current ball position unavailable" : `${display.offense} moving right, ball at ${display.position}, ${display.downDistance}`}>
        <rect x="24" y="6" width="272" height="54" fill="none" stroke="#a7f3d0" strokeOpacity=".5" />
        {[10,20,30,40,50,60,70,80,90].map(yard => <g key={yard}>
          <line x1={x(yard)} x2={x(yard)} y1="6" y2="60" stroke="#a7f3d0" strokeOpacity=".25" />
          <text x={x(yard)} y="18" textAnchor="middle" fill="#d1fae5" fontSize="7">{yard <= 50 ? yard : 100-yard}</text>
        </g>)}
        <text x="12" y="35" textAnchor="middle" fill="white" fontSize="8" transform="rotate(-90 12 35)">{display.offense}</text>
        <text x="308" y="35" textAnchor="middle" fill="white" fontSize="8" transform="rotate(90 308 35)">{display.defense}</text>
        {display.ball !== null && <line x1={x(display.ball)} x2={x(display.ball)} y1="7" y2="59" stroke="#7dd3fc" strokeWidth="2" />}
        {display.firstDown !== null ? <line x1={x(display.firstDown)} x2={x(display.firstDown)} y1="7" y2="59" stroke="#fcd34d" strokeWidth="2" strokeDasharray="4 2" /> : null}
        {display.ball !== null && <ellipse cx={x(display.ball)} cy="37" rx="5" ry="3" fill="#fff" stroke="#0f172a" />}
      </svg>
      {emphasis ? <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-live="polite">
        <div className="rounded bg-slate-950/80 px-3 py-1 text-center text-white shadow">
          <div className="text-sm font-black tracking-wide">{emphasisLabel(emphasis.kind)}</div>
          {emphasis.team ? <div className="text-[10px] font-bold">{emphasis.team}{emphasis.kind === "interception" || emphasis.kind === "turnover" ? " BALL" : ""}</div> : null}
        </div>
      </div> : null}
    </div>
    <div className="mt-1 flex justify-between text-[10px] text-slate-500 dark:text-slate-400"><span>Solid: scrimmage · Dashed: first down</span><span>{state ? `${display.stateLabel ?? "After latest play"} · →` : "Awaiting structured state"}</span></div>
    {latestDiffers && display.latestEvent?.text ? <p className="mt-1 leading-snug"><span className="font-semibold">Current event: </span>{display.latestEvent.text}</p> : null}
    {display.lastFootballPlay?.text ? <p className="mt-1 leading-snug"><span className="font-semibold">{latestDiffers ? "Last play: " : "Latest play: "}</span>{display.lastFootballPlay.text}</p> : null}
  </section>;
}
