"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { isFantasySport } from "@/lib/lineups/draftContext";
import { useGroupContext } from "@/components/providers/GroupProvider";
import {
  parseViewingValue, readViewingMemory, resolveViewingValue, viewingStorageKey,
  viewingUrl, writeViewingMemory, type ViewingGame, type ViewingOption,
} from "./context";

/** Small page-owned adapter; no global resource state or browser authorization. */
export function useViewingContext({ game, options, fallback, serverGroupId, serverValue }: {
  game: ViewingGame;
  options: readonly ViewingOption[] | undefined;
  fallback: number | null;
  serverGroupId?: string;
  serverValue?: number | null;
}) {
  const { groupContext, isLoading, isSwitchingGroup } = useGroupContext();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const groupId = groupContext?.group.id;
  const key = groupId ? viewingStorageKey(groupId, game, game === "nba-skins" ? "season" : "slate") : null;
  const [memory, setMemory] = useState<{ key: string; value: string | null } | null>(null);
  const search = searchParams.toString();
  const explicit = searchParams.get(game === "nba-skins" ? "season" : "slateId");
  const routeSport = searchParams.get("sport");
  const routeMatches = game === "nba-skins" || !isFantasySport(routeSport) || routeSport === game;
  const scopeReady = Boolean(routeMatches && key && !isLoading && !isSwitchingGroup &&
    (!serverGroupId || serverGroupId === groupId));
  const hydrated = scopeReady && memory?.key === key;
  const remembered = hydrated ? memory?.value ?? null : null;
  const value = options === undefined
    ? parseViewingValue(explicit) ?? parseViewingValue(remembered)
    : resolveViewingValue({ explicit, remembered, available: options.map(option => option.value), fallback });
  const ready = Boolean(hydrated && options !== undefined);

  useEffect(() => {
    if (!key || !scopeReady) return;
    let value: string | null = null;
    try { value = readViewingMemory(window.localStorage, key); } catch { /* Storage may be disabled. */ }
    // Hydrate a browser-only hint after the active Group is acknowledged.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMemory({ key, value });
  }, [key, scopeReady, explicit]);

  useEffect(() => {
    if (!ready || !key) return;
    try { writeViewingMemory(window.localStorage, key, value); } catch { /* Storage may be disabled. */ }
    const href = viewingUrl(pathname, search, game, value);
    if (href === `${pathname}${search ? `?${search}` : ""}`) return;
    // Resource-backed server pages must reload their authorized payload. Client
    // pages already fetch by value; native history also updates useSearchParams.
    if (serverValue !== undefined) router.replace(href, { scroll: false });
    else window.history.replaceState(null, "", href);
  }, [ready, key, value, pathname, search, game, router, serverValue]);

  function select(next: number) {
    if (!ready || !key || !options?.some(option => option.value === next)) return;
    try { writeViewingMemory(window.localStorage, key, next); } catch { /* Storage may be disabled. */ }
    const href = viewingUrl(pathname, search, game, next);
    if (serverValue !== undefined) router.push(href, { scroll: false });
    else window.history.pushState(null, "", href);
  }

  return { value, select, ready, hydrated, missingGroup: !isLoading && !isSwitchingGroup && !groupId,
    // Never render a server payload through controls for a different slate.
    matchesServer: serverValue === undefined || (ready && value === serverValue) };
}
