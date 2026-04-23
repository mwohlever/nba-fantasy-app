"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const leftLinks = [
  { href: "/", label: "Home" },
  { href: "/lineups", label: "Lineups" },
  { href: "/standings", label: "Standings" },
  { href: "/player-history", label: "Player History" },
];

const adminLinks = [
  { href: "/admin", label: "Admin Home" },
  { href: "/admin/players", label: "Manage Players" },
  { href: "/admin/slates", label: "Manage Slates" },
  { href: "/slates/new", label: "Create Slate" },
];

export default function AppNav() {
  const pathname = usePathname();
  const [adminOpen, setAdminOpen] = useState(false);
  const adminRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setAdminOpen(false);
  }, [pathname]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!adminRef.current) return;
      if (!adminRef.current.contains(event.target as Node)) {
        setAdminOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setAdminOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function isActivePath(href: string) {
    return href === "/"
      ? pathname === "/"
      : pathname === href || pathname.startsWith(`${href}/`);
  }

  function getLinkClass(href: string) {
    const isActive = isActivePath(href);

    return `shrink-0 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
      isActive
        ? "border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
        : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-900"
    }`;
  }

  const adminIsActive =
    pathname === "/admin" ||
    pathname.startsWith("/admin/") ||
    pathname === "/slates/new";

  const adminButtonClass = `shrink-0 rounded-xl border px-4 py-2.5 text-sm font-medium transition ${
    adminIsActive || adminOpen
      ? "border-sky-300 bg-sky-100 text-sky-900 shadow-sm"
      : "border-slate-200 bg-white text-slate-700 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-900"
  }`;

  return (
    <nav className="mb-6 rounded-2xl border border-slate-200 bg-white/90 p-2 shadow-sm backdrop-blur">
      {/* MOBILE */}
      <div className="flex flex-col gap-2 sm:hidden">
        <div className="flex justify-start gap-2 overflow-x-auto pb-1">
          {leftLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={getLinkClass(link.href)}
            >
              {link.label}
            </Link>
          ))}

          <Link href="/admin" className={getLinkClass("/admin")}>
            Admin
          </Link>
        </div>
      </div>

      {/* DESKTOP */}
      <div className="hidden sm:flex sm:items-center sm:justify-between">
        <div className="flex gap-2">
          {leftLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={getLinkClass(link.href)}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div ref={adminRef} className="relative">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setAdminOpen((prev) => !prev);
            }}
            className={adminButtonClass}
            aria-haspopup="menu"
            aria-expanded={adminOpen}
          >
            Admin ▾
          </button>

          {adminOpen ? (
            <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
              <div className="flex flex-col gap-1">
                {adminLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`rounded-xl px-3 py-2 text-sm transition ${
                      isActivePath(link.href)
                        ? "bg-sky-100 text-sky-900"
                        : "text-slate-700 hover:bg-sky-50 hover:text-sky-900"
                    }`}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
