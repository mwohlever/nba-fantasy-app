"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGroupContext } from "@/components/providers/GroupProvider";
import TeamAvatar from "@/components/ui/TeamAvatar";

type PlatformAccountGroup = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
};

type PlatformAccountMenuProps = {
  displayName: string;
  avatarUrl: string | null;
  groups: PlatformAccountGroup[];
};

export default function PlatformAccountMenu({
  displayName,
  avatarUrl,
  groups,
}: PlatformAccountMenuProps) {
  const router = useRouter();
  const {
    groupContext,
    availableGroups,
    isSwitchingGroup,
    setActiveGroup,
  } = useGroupContext();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const displayedGroups =
    availableGroups.length > 0 ? availableGroups : groups;
  const activeGroupSlug =
    groupContext?.group.slug ?? groups.find((group) => group.isActive)?.slug;

  useEffect(() => {
    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node;

      if (menuRef.current && !menuRef.current.contains(target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, []);

  async function handleLogout() {
    try {
      setIsLoggingOut(true);

      const response = await fetch("/api/auth/logout", {
        method: "POST",
      });

      if (!response.ok) {
        throw new Error("Logout failed.");
      }

      setIsOpen(false);
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error(error);
      window.alert("Unable to log out right now.");
    } finally {
      setIsLoggingOut(false);
    }
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label={`Open ${displayName} account menu`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/70 py-1.5 pl-1.5 pr-3 text-sm font-semibold text-slate-200 transition hover:border-teal-400"
      >
        <TeamAvatar teamName={displayName} avatarUrl={avatarUrl} size="sm" />
        <span className="max-w-28 truncate">{displayName}</span>
        <span aria-hidden="true" className="text-xs text-slate-400">
          ▾
        </span>
      </button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-50 mt-2 w-64 rounded-2xl border border-slate-700 bg-slate-950 p-2 shadow-xl"
        >
          <div className="px-3 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.16em] text-teal-300">
            Groups
          </div>

          {displayedGroups.map((group) => {
            const isActive = group.slug === activeGroupSlug;

            return (
              <button
                key={group.id}
                type="button"
                role="menuitem"
                disabled={isSwitchingGroup}
                onClick={() => {
                  setIsOpen(false);

                  if (isActive) {
                    router.push(`/groups/${encodeURIComponent(group.slug)}`);
                  } else {
                    void setActiveGroup(group.slug);
                  }
                }}
                className={`block w-full rounded-xl px-3 py-2.5 text-left text-sm transition disabled:opacity-50 ${
                  isActive
                    ? "bg-teal-400/15 font-semibold text-teal-200"
                    : "text-slate-200 hover:bg-slate-800"
                }`}
              >
                {group.name}
                {isActive ? (
                  <span className="ml-2 text-[9px] font-black uppercase tracking-wide text-teal-400">
                    Active
                  </span>
                ) : null}
              </button>
            );
          })}

          <div className="my-2 border-t border-slate-800" />

          <div className="px-3 pb-1 pt-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
            Account
          </div>

          <button
            type="button"
            role="menuitem"
            disabled={isLoggingOut}
            onClick={() => void handleLogout()}
            className="block w-full rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-300 transition hover:bg-red-950/40 disabled:opacity-50"
          >
            {isLoggingOut ? "Logging out..." : "Log out"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
