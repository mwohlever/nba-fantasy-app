import Link from "next/link";
import Image from "next/image";
import type { MouseEvent } from "react";
import {
  getPlatformGameConfig,
  getSportConfig,
} from "@/lib/sports";

type Props = {
  sportKey: string;
  name: string;
  href: string;
  description?: string;
  compact?: boolean;
  statusLabel?: string;
  detail?: string;
  onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
};

export default function GameCard({ sportKey, name, href, description, compact = false, statusLabel, detail, onClick }: Props) {
  const sport = getSportConfig(sportKey);
  const platformGame = getPlatformGameConfig(sportKey);

  if (compact) {
    return (
      <Link
        href={href}
        onClick={onClick}
        className="group flex min-w-0 items-center gap-3 rounded-xl border border-slate-700/70 bg-slate-900/65 px-3 py-2.5 transition hover:border-teal-400/60 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
      >
        <Image
          src={sport.logo}
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-full object-cover ring-1 ring-white/10"
        />
        <span className="min-w-0 flex-1 truncate text-sm font-bold text-white">
          {name || platformGame?.label}
        </span>
        <span className="shrink-0 text-xs font-bold text-teal-300">
          {detail === "Opening…" ? "Opening…" : "Enter →"}
        </span>
      </Link>
    );
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      className="group relative flex min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-700/70 bg-[linear-gradient(145deg,rgba(15,23,42,0.96),rgba(15,23,42,0.72))] p-4 transition hover:-translate-y-0.5 hover:border-teal-400/60 hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
    >
      <span className="flex w-full items-start gap-3">
        <Image src={sport.logo} alt="" width={48} height={48} className="h-12 w-12 shrink-0 rounded-full object-cover ring-1 ring-white/10" />
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="block truncate text-base font-bold text-white">{name || platformGame?.label}</span>
          <span className="mt-1 block text-xs leading-5 text-slate-400">
            {description ?? platformGame?.description}
          </span>
        </span>
        {statusLabel ? <span className="shrink-0 rounded-full bg-teal-300/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-teal-200">{statusLabel}</span> : null}
      </span>

      <span className="mt-4 flex w-full items-center justify-between gap-3 border-t border-slate-700/70 pt-3">
        <span className="min-w-0 truncate text-xs font-medium text-slate-300">{detail ?? "Open game"}</span>
        <span className="shrink-0 text-xs font-bold text-teal-300">
          Enter <span aria-hidden="true" className="inline-block transition group-hover:translate-x-0.5">→</span>
        </span>
      </span>
    </Link>
  );
}
