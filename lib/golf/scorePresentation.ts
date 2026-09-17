export function golfHoleResultClass(relativeToPar: number | null | undefined) {
  if (relativeToPar === null || relativeToPar === undefined) return "border-slate-200 bg-slate-50 text-slate-400";
  if (relativeToPar <= -2) return "border-emerald-700 bg-emerald-700 text-white ring-2 ring-emerald-200";
  if (relativeToPar === -1) return "border-emerald-300 bg-emerald-100 text-emerald-900";
  if (relativeToPar === 0) return "border-slate-200 bg-white text-slate-700";
  if (relativeToPar === 1) return "border-red-300 bg-red-100 text-red-900";
  return "border-red-700 bg-red-700 text-white ring-2 ring-red-200";
}

export function golfHoleResultTextClass(relativeToPar: number | null | undefined) {
  if (relativeToPar === null || relativeToPar === undefined) return "text-slate-400";
  if (relativeToPar < 0) return "text-emerald-300";
  if (relativeToPar > 0) return "text-red-300";
  return "text-slate-300";
}

export function golfHoleResultLabel(relativeToPar: number | null | undefined) {
  if (relativeToPar === null || relativeToPar === undefined) return null;
  if (relativeToPar === 0) return "Even";
  return relativeToPar > 0 ? `${relativeToPar} over par` : `${Math.abs(relativeToPar)} under par`;
}
