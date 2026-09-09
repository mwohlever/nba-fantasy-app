import type { NflFieldState } from "@/lib/live-scores/nflField";

export default function NflLiveField({ field }: { field: NflFieldState | null | undefined }) {
  if (!field) return null;
  const x = (yard: number) => 24 + yard * 2.72;
  return <section className="mb-3 text-xs text-slate-700 dark:text-slate-200" aria-label="Live football field after latest play">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-x-2 font-semibold">
      <span><span className="mr-1 inline-block h-2 w-2 rounded-full border border-slate-400" style={{ backgroundColor: field.color ?? undefined }} aria-hidden="true" />{field.offense} possession → · {field.downDistance}</span>
      <span>{field.position} · {field.clock}</span>
    </div>
    <svg viewBox="0 0 320 66" className="block h-20 w-full rounded bg-emerald-950" role="img"
      aria-label={`${field.offense} moving right, ball at ${field.position}, ${field.downDistance}. ${field.firstDown === null ? "Goal to go" : `${field.firstDown - field.ball} yards to first down`}`}>
      <rect x="24" y="6" width="272" height="54" fill="none" stroke="#a7f3d0" strokeOpacity=".5" />
      {[10,20,30,40,50,60,70,80,90].map(yard => <g key={yard}>
        <line x1={x(yard)} x2={x(yard)} y1="6" y2="60" stroke="#a7f3d0" strokeOpacity=".25" />
        <text x={x(yard)} y="18" textAnchor="middle" fill="#d1fae5" fontSize="7">{yard <= 50 ? yard : 100-yard}</text>
      </g>)}
      <text x="12" y="35" textAnchor="middle" fill="white" fontSize="8" transform="rotate(-90 12 35)">{field.offense}</text>
      <text x="308" y="35" textAnchor="middle" fill="white" fontSize="8" transform="rotate(90 308 35)">{field.defense}</text>
      <line x1={x(field.ball)} x2={x(field.ball)} y1="7" y2="59" stroke="#7dd3fc" strokeWidth="2" />
      {field.firstDown !== null ? <line x1={x(field.firstDown)} x2={x(field.firstDown)} y1="7" y2="59" stroke="#fcd34d" strokeWidth="2" strokeDasharray="4 2" /> : null}
      <ellipse cx={x(field.ball)} cy="37" rx="5" ry="3" fill="#fff" stroke="#0f172a" />
    </svg>
    <div className="mt-1 flex justify-between text-[10px] text-slate-500 dark:text-slate-400"><span>Solid: scrimmage · Dashed: first down</span><span>After latest play · →</span></div>
    {field.latestPlay ? <p className="mt-1 leading-snug"><span className="font-semibold">Latest: </span>{field.latestPlay}</p> : null}
  </section>;
}
