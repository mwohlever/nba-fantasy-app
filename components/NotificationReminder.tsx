"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { enableCurrentDevicePush, inspectPushDevice, supportsPush } from "@/lib/pushDevice";
import { dismissReminder, isReminderDismissed, NOTIFICATION_DEVICE_URL, shouldShowReminder } from "@/lib/notificationReminder";

export default function NotificationReminder() {
  const pathname = usePathname();
  const assessed = useRef(false);
  const [visible, setVisible] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");

  function dismiss() {
    dismissReminder();
    setVisible(false);
  }

  useEffect(() => {
    let cancelled = false;
    async function inspect() {
      if (pathname === "/login" || pathname.startsWith("/auth")) {
        assessed.current = false;
        setVisible(false);
        return;
      }
      if (assessed.current) return;
      if (!supportsPush() || isReminderDismissed() || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return;
      // Web Push on iOS requires a Home Screen app, including iPad desktop UA.
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
      if (ios && !window.matchMedia("(display-mode: standalone)").matches &&
        !(navigator as Navigator & { standalone?: boolean }).standalone) return;
      try {
        const device = await inspectPushDevice();
        if (cancelled) return;
        if (!device) { setVisible(false); return; }
        const response = await fetch("/api/notification-preferences", { cache: "no-store" });
        if (!response.ok) { if (!cancelled) setVisible(false); return; }
        const result = await response.json();
        if (cancelled) return;
        assessed.current = true;
        setPermission(device.permission);
        setVisible(shouldShowReminder({
          supported: true, authenticated: true, loading: false,
          active: device.active, dismissed: isReminderDismissed(),
          masterEnabled: result.preferences?.notificationsEnabled === true,
        }));
      } catch {
        // Unknown/offline state is not evidence that this device needs enabling.
        if (!cancelled) setVisible(false);
      }
    }
    void inspect();
    function enabled() { dismiss(); }
    function storageChanged() { if (isReminderDismissed()) setVisible(false); }
    window.addEventListener("111-push-device-enabled", enabled);
    window.addEventListener("storage", storageChanged);
    return () => {
      cancelled = true;
      window.removeEventListener("111-push-device-enabled", enabled);
      window.removeEventListener("storage", storageChanged);
    };
  }, [pathname]);

  async function enable() {
    setWorking(true);
    setMessage("");
    try {
      await enableCurrentDevicePush();
      dismiss();
    } catch (error) {
      setPermission(Notification.permission);
      setMessage(error instanceof Error ? error.message : "Unable to enable push notifications.");
    } finally { setWorking(false); }
  }

  // Authentication pages must never retain a prompt from an earlier session.
  if (!visible || pathname === "/login" || pathname.startsWith("/auth")) return null;
  const denied = permission === "denied";
  return (
    <aside aria-labelledby="notification-reminder-title" className="notification-reminder fixed inset-x-3 z-50 flex flex-col mx-auto max-w-sm rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <div className="min-h-0 overflow-y-auto overscroll-contain break-words">
        <h2 id="notification-reminder-title" className="text-sm font-semibold">
          {denied ? "Notifications are blocked on this device" : "Turn on notifications?"}
        </h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
          {denied
            ? "Allow notifications in your browser or device settings, then enable this device in Notification Settings."
            : "Get draft alerts, game updates, and other 111 Sports notifications on this device."}
        </p>
        {message && <p role="status" className="mt-2 text-sm">{message}</p>}
      </div>
      <div className="mt-3 flex shrink-0 flex-wrap gap-2">
        {denied ? (
          <Link href={NOTIFICATION_DEVICE_URL} onClick={dismiss} className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white">Notification Settings</Link>
        ) : (
          <button type="button" onClick={() => void enable()} disabled={working} className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
            {working ? "Enabling..." : "Turn On Notifications"}
          </button>
        )}
        <button type="button" onClick={dismiss} className="rounded-lg px-3 py-2 text-sm font-semibold">Not Now</button>
      </div>
    </aside>
  );
}
