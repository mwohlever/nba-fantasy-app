"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const leftLinks = [
  { href: "/", label: "Home" },
  { href: "/lineups", label: "Lineups" },
  { href: "/standings", label: "Standings" },
  { href: "/player-history", label: "Player History" },
];

const rightLinks = [
  { href: "/admin/players", label: "Admin" },
  { href: "/slates/new", label: "Create Slate" },
];

export default function AppNav() {
  const pathname = usePathname();

  function getLinkClass(href: string) {
    const isActive =
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(`${href}/`);

    return `shrink-0 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
      isActive
        ? "border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
        : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-900"
    }`;
  }

  return (
    <nav className="mb-6 rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur">
      {/* MOBILE */}
      <div className="flex flex-col gap-2 sm:hidden">
        {/* Top row → Admin */}
        <div className="flex justify-end gap-2 overflow-x-auto pb-1">
          {rightLinks.map((link) => (
            <Link key={link.href} href={link.href} className={getLinkClass(link.href)}>
              {link.label}
            </Link>
          ))}
        </div>

        {/* Bottom row → Main nav (centered) */}
        <div className="flex justify-center gap-2 overflow-x-auto pb-1">
          {leftLinks.map((link) => (
            <Link key={link.href} href={link.href} className={getLinkClass(link.href)}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>

      {/* DESKTOP */}
      <div className="hidden sm:flex sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {leftLinks.map((link) => (
            <Link key={link.href} href={link.href} className={getLinkClass(link.href)}>
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex gap-2">
          {rightLinks.map((link) => (
            <Link key={link.href} href={link.href} className={getLinkClass(link.href)}>
              {link.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
