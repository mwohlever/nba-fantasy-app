"use client";

import { useEffect, useState } from "react";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);

  return Uint8Array.from(
    [...rawData].map((character) => character.charCodeAt(0))
  );
}

function getDeviceName() {
  const userAgent = navigator.userAgent;

  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Android device";
  if (/CrOS/i.test(userAgent)) return "Chromebook";
  if (/Macintosh/i.test(userAgent)) return "Mac";
  if (/Windows/i.test(userAgent)) return "Windows computer";

  return "Web browser";
}

export default function PushDeviceControls() {
  const [isSupported, setIsSupported] = useState<boolean | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [permission, setPermission] =
    useState<NotificationPermission>("default");
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;

    async function checkPushStatus() {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!active) return;

      setIsSupported(supported);

      if (!supported) return;

      setPermission(Notification.permission);

      try {
        const registration =
          await navigator.serviceWorker.register("/sw.js");

        const subscription =
          await registration.pushManager.getSubscription();

        if (active) {
          setIsSubscribed(Boolean(subscription));
        }
      } catch (error) {
        console.error("Failed to inspect push status", error);

        if (active) {
          setMessage("Unable to check push notification status.");
        }
      }
    }

    void checkPushStatus();

    return () => {
      active = false;
    };
  }, []);

  async function enablePush() {
    try {
      setIsWorking(true);
      setMessage("");

      const publicKey =
        process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

      if (!publicKey) {
        setMessage("The public notification key is not configured.");
        return;
      }

      const nextPermission =
        await Notification.requestPermission();

      setPermission(nextPermission);

      if (nextPermission !== "granted") {
        setMessage(
          nextPermission === "denied"
            ? "Notifications are blocked in this browser's settings."
            : "Notification permission was not granted."
        );
        return;
      }

      const registration =
        await navigator.serviceWorker.register("/sw.js");

      await navigator.serviceWorker.ready;

      let subscription =
        await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription =
          await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey:
              urlBase64ToUint8Array(publicKey),
          });
      }

      const subscriptionJson = subscription.toJSON();

      const response = await fetch("/api/push-subscriptions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          endpoint: subscriptionJson.endpoint,
          keys: subscriptionJson.keys,
          deviceName: getDeviceName(),
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        setMessage(
          result.error || "Unable to register this device."
        );
        return;
      }

      setIsSubscribed(true);
      setMessage("Push notifications are enabled on this device.");
    } catch (error) {
      console.error("Failed to enable push", error);
      setMessage("Unable to enable push notifications.");
    } finally {
      setIsWorking(false);
    }
  }

  async function disablePush() {
    try {
      setIsWorking(true);
      setMessage("");

      const registration =
        await navigator.serviceWorker.getRegistration("/");

      const subscription =
        await registration?.pushManager.getSubscription();

      if (subscription) {
        await fetch("/api/push-subscriptions", {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            endpoint: subscription.endpoint,
          }),
        });

        await subscription.unsubscribe();
      }

      setIsSubscribed(false);
      setMessage("Push notifications are disabled on this device.");
    } catch (error) {
      console.error("Failed to disable push", error);
      setMessage("Unable to disable push notifications.");
    } finally {
      setIsWorking(false);
    }
  }

  async function sendTestPush() {
    try {
      setIsWorking(true);
      setMessage("");

      const response = await fetch("/api/push/test", {
        method: "POST",
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        setMessage(
          result.error ||
            "The test notification could not be sent."
        );
        return;
      }

      setMessage(
        `Test sent to ${result.sent} device${
          result.sent === 1 ? "" : "s"
        }.`
      );
    } catch (error) {
      console.error("Failed to send push test", error);
      setMessage("Unable to send the test notification.");
    } finally {
      setIsWorking(false);
    }
  }

  if (isSupported === null) {
    return (
      <div className="rounded-2xl border border-dashed border-sky-300 bg-white/70 px-4 py-6 text-center text-sm text-slate-500">
        Checking this device...
      </div>
    );
  }

  if (!isSupported) {
    return (
      <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-4 text-sm text-orange-800">
        This browser does not support Web Push notifications.
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-sky-200 bg-white p-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="font-semibold text-slate-900">
            This Device
          </div>

          <div className="mt-1 text-sm text-slate-500">
            {isSubscribed
              ? "Push notifications are enabled."
              : permission === "denied"
                ? "Notifications are blocked by your browser."
                : "Enable this browser to receive league alerts."}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isSubscribed ? (
            <>
              <button
                type="button"
                onClick={() => void sendTestPush()}
                disabled={isWorking}
                className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
              >
                Send Test
              </button>

              <button
                type="button"
                onClick={() => void disablePush()}
                disabled={isWorking}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Disable
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => void enablePush()}
              disabled={isWorking || permission === "denied"}
              className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
            >
              {isWorking ? "Enabling..." : "Enable on This Device"}
            </button>
          )}
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {message}
        </div>
      ) : null}
    </div>
  );
}
