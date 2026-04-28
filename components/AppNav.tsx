"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const mainLinks = [
  { href: "/", label: "Home", icon: "⌂" },
  { href: "/lineups/draft", label: "Draft", icon: "✎" },
  { href: "/lineups/scores", label: "Scores", icon: "▦" },
];

const moreLinks = [
  { href: "/standings", label: "Standings" },
  { href: "/player-history", label: "Player History" },
  { href: "/admin", label: "Admin" },
];

const desktopAdminLinks = [
  { href: "/admin", label: "Admin Home" },
  { href: "/admin/players", label: "Manage Players" },
  { href: "/admin/slates", label: "Manage Slates" },
  { href: "/slates/new", label: "Create Slate" },
];

export default function AppNav() {
  const pathname = usePathname();
  const [desktopAdminOpen, setDesktopAdminOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);

  const desktopAdminRef = useRef<HTMLDivElement | null>(null);
  const mobileMoreRef = useRef<HTMLDivElement | null>(null);

  const moreIsActive =
    pathname.startsWith("/standings") ||
    pathname.startsWith("/player-history") ||
    pathname.startsWith("/admin") ||
    pathname.startsWith("/slates");

  const adminIsActive =
    pathname.startsWith("/admin") || pathname.startsWith("/slates");

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;

      if (
        desktopAdminRef.current &&
        !desktopAdminRef.current.contains(target)
      ) {
        setDesktopAdminOpen(false);
      }

      if (mobileMoreRef.current && !mobileMoreRef.current.contains(target)) {
        setMobileMoreOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function isLinkActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function desktopLinkClass(href: string) {
    const active = isLinkActive(href);

    return `rounded-full border px-4 py-2 text-sm font-medium transition ${
      active
        ? "border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
        : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
    }`;
  }

  function mobileLinkClass(href: string) {
    const active = isLinkActive(href);

    return `flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition ${
      active
        ? "bg-sky-100 text-sky-900"
        : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
    }`;
  }

  return (
    <>
      {/* Desktop nav only */}
      <nav className="mb-6 hidden rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:block">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {mainLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={desktopLinkClass(link.href)}
              >
                {link.label}
              </Link>
            ))}

            <Link href="/standings" className={desktopLinkClass("/standings")}>
              Standings
            </Link>

            <Link
              href="/player-history"
              className={desktopLinkClass("/player-history")}
            >
              Player History
            </Link>
          </div>

          <div className="relative" ref={desktopAdminRef}>
            <button
              type="button"
              onClick={() => setDesktopAdminOpen((open) => !open)}
              className={`rounded-full border px-4 py-2 text-sm font-medium transition ${
                adminIsActive
                  ? "border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
                  : "border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:bg-sky-50"
              }`}
            >
              Admin ▾
            </button>

            {desktopAdminOpen ? (
              <div className="absolute right-0 z-50 mt-2 w-52 rounded-2xl border border-slate-200 bg-white p-2 shadow-lg">
                {desktopAdminLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setDesktopAdminOpen(false)}
                    className={`block rounded-xl px-3 py-2 text-sm transition ${
                      isLinkActive(link.href)
                        ? "bg-sky-100 font-semibold text-sky-900"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </nav>

      {/* White shield behind mobile nav */}
      <div
        className="fixed bottom-[-56px] left-0 right-0 z-[9998] h-28 bg-white sm:hidden"
        aria-hidden="true"
      />

      {/* Mobile bottom nav only */}
      <div
        ref={mobileMoreRef}
        className="fixed bottom-[-48px] left-0 right-0 z-[9999] border-t border-slate-200 bg-white px-3 pb-[58px] pt-2 shadow-[0_-6px_16px_rgba(15,23,42,0.10)] sm:hidden"
      >
        {mobileMoreOpen ? (
          <div className="absolute bottom-full right-3 mb-2 w-56 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
            {moreLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMoreOpen(false)}
                className={`block rounded-xl px-4 py-3 text-sm font-medium transition ${
                  isLinkActive(link.href)
                    ? "bg-sky-100 text-sky-900"
                    : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </div>
        ) : null}

        <div className="mx-auto grid max-w-xl grid-cols-4 gap-1">
          {mainLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={mobileLinkClass(link.href)}
            >
              <span className="text-lg leading-none">{link.icon}</span>
              <span>{link.label}</span>
            </Link>
          ))}

          <button
            type="button"
            onClick={() => setMobileMoreOpen((open) => !open)}
            className={`flex flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-medium transition ${
              moreIsActive
                ? "bg-sky-100 text-sky-900"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <span className="text-lg leading-none">⋯</span>
            <span>More</span>
          </button>
        </div>
      </div>
    </>
  );
}
