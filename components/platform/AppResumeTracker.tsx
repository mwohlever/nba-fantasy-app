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
import {
  appendAppLaunchTrace,
  getCurrentLaunchDiagnosticState,
} from "@/lib/groups/launchTrace";
import { sportKeyFromLeagueSportKey } from "@/lib/sports";

function AppResumeTrackerContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { groupContext, isLoading } = useGroupContext();
  const search = searchParams.toString();
  const restoreState = useRef<"pending" | "complete">("pending");
  const restoreCheckTraced = useRef(false);
  const restoreWaitingTraced = useRef(false);

  useEffect(() => {
    appendAppLaunchTrace("app_boot");
  }, []);

  useEffect(() => {
    if (restoreState.current === "complete") return;

    const bootState = getCurrentLaunchDiagnosticState();
    if (!bootState) {
      restoreState.current = "complete";
      appendAppLaunchTrace("restore_skipped", {
        reason: "diagnostic_state_unavailable",
      });
      return;
    }

    if (!restoreCheckTraced.current) {
      restoreCheckTraced.current = true;
      appendAppLaunchTrace("restore_check", {
        lastLocation: bootState.lastLocation,
      });
    }

    if (!shouldRestoreStandaloneBoot(bootState)) {
      restoreState.current = "complete";
      appendAppLaunchTrace("restore_skipped", {
        reason: "not_standalone_root_navigation",
      });
      return;
    }

    if (isLoading) {
      if (!restoreWaitingTraced.current) {
        restoreWaitingTraced.current = true;
        appendAppLaunchTrace("restore_waiting_for_group", {
          groupLoading: true,
          groupReady: false,
          lastLocation: bootState.lastLocation,
        });
      }
      return;
    }

    if (!groupContext) {
      restoreState.current = "complete";
      appendAppLaunchTrace("restore_skipped", {
        groupLoading: false,
        groupReady: false,
        reason: "no_authenticated_group_context",
      });
      return;
    }

    const storedRecord = parseAppResumeRecord(bootState.lastLocation);
    appendAppLaunchTrace("restore_candidate", {
      lastLocation: bootState.lastLocation,
      groupLoading: false,
      groupReady: true,
    });

    const destination = resolveAppResumeDestination(storedRecord, {
      groupSlug: groupContext.group.slug,
      enabledSports: groupContext.leagues.map((league) =>
        sportKeyFromLeagueSportKey(league.sportKey),
      ),
      canAdministerGroup: groupContext.canAdministerGroup,
      isSuperAdmin: groupContext.isSuperAdmin,
    });
    const accepted = Boolean(
      storedRecord &&
        storedRecord.groupSlug === groupContext.group.slug &&
        storedRecord.destination === destination,
    );

    appendAppLaunchTrace("restore_validation_result", {
      lastLocation: bootState.lastLocation,
      groupLoading: false,
      groupReady: true,
      resolvedDestination: destination,
      accepted,
    });

    restoreState.current = "complete";
    appendAppLaunchTrace("restore_replace", {
      resolvedDestination: destination,
      accepted,
    });
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
