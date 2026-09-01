"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useGroupContext } from "@/components/providers/GroupProvider";
import {
  APP_RESUME_STORAGE_KEY,
  createAppResumeRecord,
} from "@/lib/groups/resume";
import { sportKeyFromLeagueSportKey } from "@/lib/sports";

function AppResumeTrackerContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { groupContext } = useGroupContext();
  const search = searchParams.toString();

  useEffect(() => {
    if (!groupContext) return;

    const record = createAppResumeRecord(
      `${pathname}${search ? `?${search}` : ""}`,
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
