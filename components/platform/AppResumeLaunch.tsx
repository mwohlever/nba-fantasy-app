"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGroupContext } from "@/components/providers/GroupProvider";
import {
  APP_RESUME_STORAGE_KEY,
  parseAppResumeRecord,
  resolveAppResumeDestination,
} from "@/lib/groups/resume";
import { appendAppLaunchTrace } from "@/lib/groups/launchTrace";
import { sportKeyFromLeagueSportKey } from "@/lib/sports";

export default function AppResumeLaunch() {
  const router = useRouter();
  const { groupContext, isLoading } = useGroupContext();

  useEffect(() => {
    let storedValue: string | null = null;
    try {
      storedValue = window.localStorage.getItem(APP_RESUME_STORAGE_KEY);
    } catch {
      // The trace helper must not affect launch behavior.
    }

    appendAppLaunchTrace("launch_mount", {
      groupLoading: isLoading,
      groupReady: Boolean(groupContext),
      lastLocation: storedValue,
    });
    // This records the initial mount only; resolution readiness is traced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isLoading) return;

    if (!groupContext) {
      appendAppLaunchTrace("launch_resolve", {
        groupLoading: false,
        groupReady: false,
        resolvedDestination: "/",
        accepted: false,
      });
      appendAppLaunchTrace("launch_replace", {
        resolvedDestination: "/",
      });
      router.replace("/");
      return;
    }

    let storedValue: string | null = null;
    try {
      storedValue = window.localStorage.getItem(APP_RESUME_STORAGE_KEY);
    } catch (error) {
      console.error("Failed to read the last 111 Sports location", error);
    }

    const storedRecord = parseAppResumeRecord(storedValue);
    const destination = resolveAppResumeDestination(
      storedRecord,
      {
        groupSlug: groupContext.group.slug,
        enabledSports: groupContext.leagues.map((league) =>
          sportKeyFromLeagueSportKey(league.sportKey),
        ),
        canAdministerGroup: groupContext.canAdministerGroup,
        isSuperAdmin: groupContext.isSuperAdmin,
      },
    );

    appendAppLaunchTrace("launch_resolve", {
      lastLocation: storedValue,
      groupLoading: false,
      groupReady: true,
      resolvedDestination: destination,
      accepted: Boolean(
        storedRecord &&
          storedRecord.groupSlug === groupContext.group.slug &&
          storedRecord.destination === destination,
      ),
    });

    appendAppLaunchTrace("launch_replace", {
      resolvedDestination: destination,
    });
    router.replace(destination);
  }, [groupContext, isLoading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-semibold text-teal-200">
      Opening 111 Sports…
    </main>
  );
}
