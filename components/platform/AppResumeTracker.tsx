"use client";

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useGroupContext } from "@/components/providers/GroupProvider";
import {
  APP_RESUME_STORAGE_KEY,
  createAppResumeRecord,
  parseAppResumeRecord,
  resolveAppResumeDestination,
  shouldRestoreStandaloneBoot,
} from "@/lib/groups/resume";
import { sportKeyFromLeagueSportKey } from "@/lib/sports";

function getStandaloneBootState() {
  try {
    const navigationEntry = performance
      .getEntriesByType("navigation")
      .at(0) as PerformanceNavigationTiming | undefined;

    return {
      location: `${window.location.pathname}${window.location.search}`,
      standalone:
        window.matchMedia("(display-mode: standalone)").matches ||
        ("standalone" in window.navigator &&
          (window.navigator as Navigator & { standalone?: boolean }).standalone === true),
      navigationType: navigationEntry?.type ?? null,
      lastLocation: window.localStorage.getItem(APP_RESUME_STORAGE_KEY),
    };
  } catch {
    return null;
  }
}

function AppResumeTrackerContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { groupContext, isLoading } = useGroupContext();
  const search = searchParams.toString();
  const restoreState = useRef<"pending" | "complete">("pending");
  const bootStateRef = useRef<ReturnType<typeof getStandaloneBootState> | undefined>(
    undefined,
  );

  useEffect(() => {
    if (restoreState.current === "complete") return;

    if (bootStateRef.current === undefined) {
      bootStateRef.current = getStandaloneBootState();
    }

    const bootState = bootStateRef.current;
    if (!bootState) {
      restoreState.current = "complete";
      return;
    }

    if (!shouldRestoreStandaloneBoot(bootState)) {
      restoreState.current = "complete";
      return;
    }

    if (isLoading) return;

    if (!groupContext) {
      restoreState.current = "complete";
      return;
    }

    const storedRecord = parseAppResumeRecord(bootState.lastLocation);
    const destination = resolveAppResumeDestination(storedRecord, {
      groupSlug: groupContext.group.slug,
      enabledSports: groupContext.leagues.map((league) =>
        sportKeyFromLeagueSportKey(league.sportKey),
      ),
      canAdministerGroup: groupContext.canAdministerGroup,
      isSuperAdmin: groupContext.isSuperAdmin,
    });

    restoreState.current = "complete";
    router.replace(destination);
  }, [groupContext, isLoading, router]);

  useEffect(() => {
    if (!groupContext) return;

    const destination = `${pathname}${search ? `?${search}` : ""}`;
    const record = createAppResumeRecord(
      destination,
      {
        groupSlug: groupContext.group.slug,
        enabledSports: groupContext.leagues.map((league) =>
          sportKeyFromLeagueSportKey(league.sportKey),
        ),
        canAdministerGroup: groupContext.canAdministerGroup,
        isSuperAdmin: groupContext.isSuperAdmin,
      },
    );

    if (!record) return;

    try {
      window.localStorage.setItem(
        APP_RESUME_STORAGE_KEY,
        JSON.stringify(record),
      );
    } catch (error) {
      console.error("Failed to remember the last 111 Sports location", error);
    }
  }, [groupContext, pathname, search]);

  return null;
}

export default function AppResumeTracker() {
  return (
    <Suspense fallback={null}>
      <AppResumeTrackerContent />
    </Suspense>
  );
}
