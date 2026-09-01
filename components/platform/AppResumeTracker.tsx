"use client";

import { Suspense, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useGroupContext } from "@/components/providers/GroupProvider";
import {
  APP_RESUME_STORAGE_KEY,
  createAppResumeRecord,
} from "@/lib/groups/resume";
import { appendAppLaunchTrace } from "@/lib/groups/launchTrace";
import { sportKeyFromLeagueSportKey } from "@/lib/sports";

function AppResumeTrackerContent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { groupContext } = useGroupContext();
  const search = searchParams.toString();

  useEffect(() => {
    appendAppLaunchTrace("app_boot");
  }, []);

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

    appendAppLaunchTrace("tracker_observe", {
      accepted: Boolean(record),
    });

    if (!record) return;

    try {
      window.localStorage.setItem(
        APP_RESUME_STORAGE_KEY,
        JSON.stringify(record),
      );
      appendAppLaunchTrace("tracker_write", {
        lastLocation: JSON.stringify(record),
        accepted: true,
      });
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
