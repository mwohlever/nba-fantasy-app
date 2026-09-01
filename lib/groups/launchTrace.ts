import { APP_RESUME_STORAGE_KEY } from "./resume";

export const APP_LAUNCH_TRACE_STORAGE_KEY = "111-launch-trace";
export const APP_LAUNCH_TRACE_LIMIT = 30;

export type AppLaunchTraceEvent =
  | "app_boot"
  | "launch_mount"
  | "launch_resolve"
  | "launch_replace"
  | "restore_check"
  | "restore_waiting_for_group"
  | "restore_candidate"
  | "restore_validation_result"
  | "restore_replace"
  | "restore_skipped"
  | "tracker_observe"
  | "tracker_write";

export type AppLaunchTraceRecord = {
  timestamp: string;
  event: AppLaunchTraceEvent;
  location: string;
  standalone: boolean;
  visibility: DocumentVisibilityState;
  navigationType: string | null;
  lastLocation?: string | null;
  groupLoading?: boolean;
  groupReady?: boolean;
  resolvedDestination?: string;
  accepted?: boolean;
  reason?: string;
};

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

export function getCurrentLaunchDiagnosticState() {
  if (!isBrowser()) return null;

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
      visibility: document.visibilityState,
      navigationType: navigationEntry?.type ?? null,
      lastLocation: window.localStorage.getItem(APP_RESUME_STORAGE_KEY),
    };
  } catch {
    return null;
  }
}

export function readAppLaunchTrace(): AppLaunchTraceRecord[] {
  if (!isBrowser()) return [];

  try {
    const value = window.localStorage.getItem(APP_LAUNCH_TRACE_STORAGE_KEY);
    if (!value) return [];
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? (parsed.slice(-APP_LAUNCH_TRACE_LIMIT) as AppLaunchTraceRecord[])
      : [];
  } catch {
    return [];
  }
}

export function appendAppLaunchTrace(
  event: AppLaunchTraceEvent,
  details: Partial<
    Pick<
      AppLaunchTraceRecord,
      | "lastLocation"
      | "groupLoading"
      | "groupReady"
      | "resolvedDestination"
      | "accepted"
      | "reason"
    >
  > = {},
) {
  if (!isBrowser()) return;

  try {
    const state = getCurrentLaunchDiagnosticState();
    if (!state) return;

    const records = readAppLaunchTrace();
    records.push({
      timestamp: new Date().toISOString(),
      event,
      ...state,
      ...details,
    });

    window.localStorage.setItem(
      APP_LAUNCH_TRACE_STORAGE_KEY,
      JSON.stringify(records.slice(-APP_LAUNCH_TRACE_LIMIT)),
    );
  } catch {
    // Temporary diagnostics must never affect application behavior.
  }
}

export function clearAppLaunchTrace() {
  if (!isBrowser()) return;

  try {
    window.localStorage.removeItem(APP_LAUNCH_TRACE_STORAGE_KEY);
  } catch {
    // Temporary diagnostics must never affect application behavior.
  }
}
