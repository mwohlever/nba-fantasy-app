import type { FantasyOwner } from "@/lib/live-scores/nflOwnership";
export default function FantasyOwnerLabel({ owner }: { owner?: FantasyOwner }) {
  if (!owner) return null;
  return <span className={`mt-0.5 block max-w-40 truncate text-[10px] leading-tight ${owner.isYou ? "font-bold text-sky-700 dark:text-sky-300" : "font-medium text-slate-500 dark:text-slate-400"}`} title={`${owner.name}${owner.isYou ? " · Your player" : ""}`}>
    {owner.name}{owner.isYou ? " · You" : ""}
  </span>;
}
