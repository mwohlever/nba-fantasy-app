"use client";

import { useEffect, useState } from "react";

type RegisteredDevice = {
  id: string;
  endpoint: string;
  device_name: string | null;
  is_active: boolean;
  created_at: string | null;
  last_used_at: string | null;
};

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat(
    (4 - (base64String.length % 4)) % 4,
  );

  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);

  return Uint8Array.from(
    [...rawData].map((character) =>
      character.charCodeAt(0),
    ),
  );
}

function getDeviceName() {
  const userAgent = navigator.userAgent;

  if (/iPhone/i.test(userAgent)) {
    return "iPhone";
  }

  if (/iPad/i.test(userAgent)) {
    return "iPad";
  }

  if (/Android/i.test(userAgent)) {
    return "Android device";
  }

  if (/CrOS/i.test(userAgent)) {
    return "Chromebook";
  }

  if (/Macintosh/i.test(userAgent)) {
    return "Mac";
  }

  if (/Windows/i.test(userAgent)) {
    return "Windows computer";
  }

  return "Web browser";
}

function formatDeviceDate(value: string | null) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export default function PushDeviceControls() {
  const [isSupported, setIsSupported] =
    useState<boolean | null>(null);

  /*
   * This now means:
   *
   * 1. the browser has a real PushSubscription, AND
   * 2. that exact endpoint is active in our database.
   *
   * Previously we checked only #1, which allowed the browser
   * and Supabase device state to drift apart.
   */
  const [isSubscribed, setIsSubscribed] =
    useState(false);

  const [permission, setPermission] =
    useState<NotificationPermission>("default");

  const [currentEndpoint, setCurrentEndpoint] =
    useState<string | null>(null);

  const [registeredDevices, setRegisteredDevices] =
    useState<RegisteredDevice[]>([]);

  const [isLoadingDevices, setIsLoadingDevices] =
    useState(true);

  const [isWorking, setIsWorking] =
    useState(false);

  const [removingEndpoint, setRemovingEndpoint] =
    useState<string | null>(null);

  const [message, setMessage] =
    useState("");

  async function loadRegisteredDevices() {
    const response = await fetch(
      "/api/push-subscriptions",
      {
        method: "GET",
        cache: "no-store",
      },
    );

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error ||
          "Unable to load registered devices.",
      );
    }

    const devices = Array.isArray(
      result.subscriptions,
    )
      ? (result.subscriptions as RegisteredDevice[])
      : [];

    setRegisteredDevices(devices);

    return devices;
  }

  async function inspectCurrentBrowser(
    devices?: RegisteredDevice[],
  ) {
    const supported =
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setIsSupported(supported);

    if (!supported) {
      setCurrentEndpoint(null);
      setIsSubscribed(false);
      return;
    }

    setPermission(Notification.permission);

    const registration =
      await navigator.serviceWorker.register(
        "/sw.js",
      );

    const subscription =
      await registration.pushManager.getSubscription();

    const endpoint =
      subscription?.endpoint ?? null;

    setCurrentEndpoint(endpoint);

    let activeDevices = devices;

    if (!activeDevices) {
      activeDevices =
        await loadRegisteredDevices();
    }

    const activeInDatabase =
      Boolean(endpoint) &&
      activeDevices.some(
        (device) =>
          device.endpoint === endpoint,
      );

    setIsSubscribed(
      Boolean(
        subscription &&
          activeInDatabase,
      ),
    );
  }

  async function refreshDeviceState() {
    setIsLoadingDevices(true);

    try {
      const devices =
        await loadRegisteredDevices();

      await inspectCurrentBrowser(devices);
    } finally {
      setIsLoadingDevices(false);
    }
  }

  useEffect(() => {
    let active = true;

    async function checkPushStatus() {
      const supported =
        "serviceWorker" in navigator &&
        "PushManager" in window &&
        "Notification" in window;

      if (!active) {
        return;
      }

      setIsSupported(supported);

      if (!supported) {
        setIsLoadingDevices(false);
        return;
      }

      setPermission(Notification.permission);

      try {
        const registration =
          await navigator.serviceWorker.register(
            "/sw.js",
          );

        const subscription =
          await registration.pushManager.getSubscription();

        const response = await fetch(
          "/api/push-subscriptions",
          {
            method: "GET",
            cache: "no-store",
          },
        );

        const result =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ||
              "Unable to load registered devices.",
          );
        }

        const devices =
          Array.isArray(
            result.subscriptions,
          )
            ? (result.subscriptions as RegisteredDevice[])
            : [];

        if (!active) {
          return;
        }

        const endpoint =
          subscription?.endpoint ?? null;

        setCurrentEndpoint(endpoint);
        setRegisteredDevices(devices);

        /*
         * A local browser subscription alone does not mean the
         * device is enabled in 111 Sports.
         *
         * The exact endpoint must also be active server-side.
         */
        setIsSubscribed(
          Boolean(
            subscription &&
              endpoint &&
              devices.some(
                (device) =>
                  device.endpoint ===
                  endpoint,
              ),
          ),
        );
      } catch (error) {
        console.error(
          "Failed to inspect push status",
          error,
        );

        if (active) {
          setMessage(
            "Unable to check push notification status.",
          );
        }
      } finally {
        if (active) {
          setIsLoadingDevices(false);
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
        process.env
          .NEXT_PUBLIC_VAPID_PUBLIC_KEY;

      if (!publicKey) {
        setMessage(
          "The public notification key is not configured.",
        );
        return;
      }

      const nextPermission =
        await Notification.requestPermission();

      setPermission(nextPermission);

      if (nextPermission !== "granted") {
        setMessage(
          nextPermission === "denied"
            ? "Notifications are blocked in this browser's settings."
            : "Notification permission was not granted.",
        );

        return;
      }

      const registration =
        await navigator.serviceWorker.register(
          "/sw.js",
        );

      await navigator.serviceWorker.ready;

      let subscription =
        await registration.pushManager.getSubscription();

      if (!subscription) {
        subscription =
          await registration.pushManager.subscribe(
            {
              userVisibleOnly: true,
              applicationServerKey:
                urlBase64ToUint8Array(
                  publicKey,
                ),
            },
          );
      }

      const subscriptionJson =
        subscription.toJSON();

      const response = await fetch(
        "/api/push-subscriptions",
        {
          method: "POST",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            endpoint:
              subscriptionJson.endpoint,
            keys:
              subscriptionJson.keys,
            deviceName:
              getDeviceName(),
          }),
        },
      );

      const result =
        await response.json();

      if (!response.ok) {
        setMessage(
          result.error ||
            "Unable to register this device.",
        );

        return;
      }

      setCurrentEndpoint(
        subscription.endpoint,
      );

      await refreshDeviceState();

      setMessage(
        "Push notifications are enabled on this device.",
      );
    } catch (error) {
      console.error(
        "Failed to enable push",
        error,
      );

      setMessage(
        "Unable to enable push notifications.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function disableEndpoint(
    endpoint: string,
  ) {
    const response = await fetch(
      "/api/push-subscriptions",
      {
        method: "DELETE",
        headers: {
          "Content-Type":
            "application/json",
        },
        body: JSON.stringify({
          endpoint,
        }),
      },
    );

    const result =
      await response.json();

    if (!response.ok) {
      throw new Error(
        result.error ||
          "Unable to disable this device.",
      );
    }
  }

  async function disablePush() {
    try {
      setIsWorking(true);
      setMessage("");

      const registration =
        await navigator.serviceWorker.getRegistration(
          "/",
        );

      const subscription =
        await registration?.pushManager.getSubscription();

      /*
       * If this browser still has a subscription, disable the
       * exact endpoint server-side BEFORE removing the browser
       * subscription.
       *
       * We no longer silently ignore a failed DELETE.
       */
      if (subscription) {
        await disableEndpoint(
          subscription.endpoint,
        );

        try {
          await subscription.unsubscribe();
        } catch (error) {
          /*
           * Server-side delivery is already disabled, so this
           * browser will no longer receive 111 Sports pushes.
           * Local cleanup can safely fail without reactivating it.
           */
          console.warn(
            "Push endpoint disabled server-side, but browser unsubscribe failed",
            error,
          );
        }
      } else if (currentEndpoint) {
        await disableEndpoint(
          currentEndpoint,
        );
      }

      await refreshDeviceState();

      setMessage(
        "Push notifications are disabled on this device.",
      );
    } catch (error) {
      console.error(
        "Failed to disable push",
        error,
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to disable push notifications.",
      );
    } finally {
      setIsWorking(false);
    }
  }

  async function removeRegisteredDevice(
    device: RegisteredDevice,
  ) {
    try {
      setRemovingEndpoint(
        device.endpoint,
      );

      setMessage("");

      await disableEndpoint(
        device.endpoint,
      );

      /*
       * If the user removes the endpoint that belongs to this
       * browser, also clean up its local PushSubscription.
       */
      if (
        currentEndpoint &&
        device.endpoint ===
          currentEndpoint
      ) {
        const registration =
          await navigator.serviceWorker.getRegistration(
            "/",
          );

        const subscription =
          await registration?.pushManager.getSubscription();

        if (
          subscription?.endpoint ===
          device.endpoint
        ) {
          try {
            await subscription.unsubscribe();
          } catch (error) {
            console.warn(
              "Registered device removed server-side, but browser unsubscribe failed",
              error,
            );
          }
        }
      }

      await refreshDeviceState();

      setMessage(
        `${device.device_name || "Device"} removed from push notifications.`,
      );
    } catch (error) {
      console.error(
        "Failed to remove registered device",
        error,
      );

      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to remove this device.",
      );
    } finally {
      setRemovingEndpoint(null);
    }
  }

  async function sendTestPush() {
    try {
      setIsWorking(true);
      setMessage("");

      const response = await fetch(
        "/api/push/test",
        {
          method: "POST",
        },
      );

      const result =
        await response.json();

      if (
        !response.ok ||
        !result.success
      ) {
        setMessage(
          result.error ||
            "The test notification could not be sent.",
        );

        return;
      }

      setMessage(
        `Test sent to ${result.sent} device${
          result.sent === 1
            ? ""
            : "s"
        }.`,
      );
    } catch (error) {
      console.error(
        "Failed to send push test",
        error,
      );

      setMessage(
        "Unable to send the test notification.",
      );
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
        This browser does not support Web Push
        notifications.
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
              ? `${getDeviceName()} is enabled for push notifications.`
              : permission === "denied"
                ? "Notifications are blocked by your browser."
                : `${getDeviceName()} is not enabled for push notifications.`}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {isSubscribed ? (
            <>
              <button
                type="button"
                onClick={() =>
                  void sendTestPush()
                }
                disabled={isWorking}
                className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
              >
                Send Test
              </button>

              <button
                type="button"
                onClick={() =>
                  void disablePush()
                }
                disabled={isWorking}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                {isWorking
                  ? "Disabling..."
                  : "Disable"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() =>
                void enablePush()
              }
              disabled={
                isWorking ||
                permission === "denied"
              }
              className="rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:opacity-50"
            >
              {isWorking
                ? "Enabling..."
                : "Enable on This Device"}
            </button>
          )}
        </div>
      </div>

      {message ? (
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {message}
        </div>
      ) : null}

      <div className="mt-5 border-t border-slate-200 pt-5">
        <div>
          <div className="font-semibold text-slate-900">
            Registered Devices
          </div>

          <div className="mt-1 text-sm text-slate-500">
            Active devices that can currently
            receive notifications for your
            account.
          </div>
        </div>

        {isLoadingDevices ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
            Loading registered devices...
          </div>
        ) : registeredDevices.length ===
          0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-300 px-4 py-4 text-sm text-slate-500">
            No devices are currently registered.
          </div>
        ) : (
          <div className="mt-4 space-y-2">
            {registeredDevices.map(
              (device) => {
                const isCurrentDevice =
                  Boolean(
                    currentEndpoint &&
                      device.endpoint ===
                        currentEndpoint,
                  );

                const registeredDate =
                  formatDeviceDate(
                    device.created_at,
                  );

                const lastUsedDate =
                  formatDeviceDate(
                    device.last_used_at,
                  );

                return (
                  <div
                    key={device.id}
                    className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">
                          {device.device_name ||
                            "Web browser"}
                        </span>

                        {isCurrentDevice ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-sky-700">
                            This device
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-1 text-xs text-slate-500">
                        {registeredDate
                          ? `Registered ${registeredDate}`
                          : "Registered device"}

                        {lastUsedDate
                          ? ` · Last used ${lastUsedDate}`
                          : ""}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        void removeRegisteredDevice(
                          device,
                        )
                      }
                      disabled={
                        removingEndpoint ===
                          device.endpoint ||
                        isWorking
                      }
                      className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                    >
                      {removingEndpoint ===
                      device.endpoint
                        ? "Removing..."
                        : isCurrentDevice
                          ? "Disable"
                          : "Remove"}
                    </button>
                  </div>
                );
              },
            )}
          </div>
        )}
      </div>
    </div>
  );
}
