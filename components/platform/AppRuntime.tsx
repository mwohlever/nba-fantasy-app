"use client";

import { usePathname } from "next/navigation";
import ThemeProvider from "@/components/theme/ThemeProvider";
import SportProvider from "@/components/providers/SportProvider";
import GroupProvider from "@/components/providers/GroupProvider";
import NotificationReminder from "@/components/NotificationReminder";
import AppHeartbeat from "@/components/AppHeartbeat";
import AppResumeTracker from "@/components/platform/AppResumeTracker";

/** The isolated simulator must never mount real account, Group or background services. */
export default function AppRuntime({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Also isolate denied production requests to this path. The server page itself returns 404.
  if (pathname === "/dev/cfp-simulation") return <>{children}</>;
  return <><AppHeartbeat /><ThemeProvider><NotificationReminder /><GroupProvider><SportProvider><AppResumeTracker />{children}</SportProvider></GroupProvider></ThemeProvider></>;
}
