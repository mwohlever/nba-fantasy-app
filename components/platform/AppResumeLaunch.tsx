"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useGroupContext } from "@/components/providers/GroupProvider";
import {
  APP_RESUME_STORAGE_KEY,
  parseAppResumeRecord,
  resolveAppResumeDestination,
} from "@/lib/groups/resume";
import { sportKeyFromLeagueSportKey } from "@/lib/sports";

export default function AppResumeLaunch() {
  const router = useRouter();
  const { groupContext, isLoading } = useGroupContext();

  useEffect(() => {
    if (isLoading) return;

    if (!groupContext) {
      router.replace("/");
      return;
    }

    let storedValue: string | null = null;
    try {
      storedValue = window.localStorage.getItem(APP_RESUME_STORAGE_KEY);
    } catch (error) {
      console.error("Failed to read the last 111 Sports location", error);
    }

    const destination = resolveAppResumeDestination(
      parseAppResumeRecord(storedValue),
      {
        groupSlug: groupContext.group.slug,
        enabledSports: groupContext.leagues.map((league) =>
          sportKeyFromLeagueSportKey(league.sportKey),
        ),
        canAdministerGroup: groupContext.canAdministerGroup,
        isSuperAdmin: groupContext.isSuperAdmin,
      },
    );

    router.replace(destination);
  }, [groupContext, isLoading, router]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm font-semibold text-teal-200">
      Opening 111 Sports…
    </main>
  );
}
