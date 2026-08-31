import Link from "next/link";
import Image from "next/image";
import type { MouseEvent } from "react";
import { getSportConfig } from "@/lib/sports";

type Props = {
  sportKey: string;
  name: string;
  href: string;
  statusLabel?: string;
  detail?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export default function GameCard({ sportKey, name, href, statusLabel, detail, onClick }: Props) {
  const sport = getSportConfig(sportKey);
  return (
    <Link
      href={href}
      onClick={onClick}
      className="group flex min-w-0 items-center gap-3 rounded-2xl border border-slate-700/70 bg-slate-900/70 p-3 transition hover:border-teal-400/60 hover:bg-slate-800"
    >
      <Image src={sport.logo} alt="" width={44} height={44} className="h-11 w-11 shrink-0 rounded-full object-cover" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-semibold text-white">{name}</span>
        {detail ? <span className="block truncate text-xs text-slate-400">{detail}</span> : null}
      </span>
      {statusLabel ? <span className="rounded-full bg-teal-300/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-teal-200">{statusLabel}</span> : null}
      <span aria-hidden="true" className="text-slate-500 transition group-hover:translate-x-0.5 group-hover:text-teal-200">→</span>
    </Link>
  );
}
