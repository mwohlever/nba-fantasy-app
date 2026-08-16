"use client";

import {
  useCallback,
  useEffect,
  useState,
} from "react";

type Device = {
  id: string;
  deviceName: string;
  createdAt: string;
  lastUsedAt: string | null;
};

type DeviceUser = {
  userId: string;
  userName: string;
  devices: Device[];
};

type DeviceResponse = {
  success?: boolean;
  activeDeviceCount?: number;
  activeUserCount?: number;
  users?: DeviceUser[];
  error?: string;
};

function formatDeviceDate(
  value: string | null,
) {
  if (!value) return "Never";

  const date = new Date(value);

  if (
    !Number.isFinite(date.getTime())
  ) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat(
    "en-US",
    {
      month: "short",
      day: "numeric",
      year: "numeric",
    },
  ).format(date);
}

export default function AdminPushDevices() {
  const [users, setUsers] = useState<
    DeviceUser[]
  >([]);

  const [
    activeDeviceCount,
    setActiveDeviceCount,
  ] = useState(0);

  const [
    activeUserCount,
    setActiveUserCount,
  ] = useState(0);

  const [isLoading, setIsLoading] =
    useState(true);

  const [
    removingDeviceId,
    setRemovingDeviceId,
  ] = useState<string | null>(null);

  const [message, setMessage] =
    useState("");

  const loadDevices = useCallback(
    async () => {
      try {
        setIsLoading(true);

        const response = await fetch(
          "/api/admin/push-devices",
          {
            cache: "no-store",
          },
        );

        const result =
          (await response.json()) as DeviceResponse;

        if (!response.ok) {
          setMessage(
            result.error ||
              "Failed to load registered devices.",
          );
          return;
        }

        setUsers(
          Array.isArray(result.users)
            ? result.users
            : [],
        );

        setActiveDeviceCount(
          Number(
            result.activeDeviceCount ?? 0,
          ),
        );

        setActiveUserCount(
          Number(
            result.activeUserCount ?? 0,
          ),
        );
      } catch (error) {
        console.error(
          "Failed to load admin push devices",
          error,
        );

        setMessage(
          "Something went wrong while loading registered devices.",
        );
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  async function removeDevice(
    device: Device,
    userName: string,
  ) {
    if (removingDeviceId) return;

    const confirmed = window.confirm(
      `Remove ${device.deviceName} from ${userName}'s push notifications?`,
    );

    if (!confirmed) return;

    try {
      setRemovingDeviceId(device.id);
      setMessage("");

      const response = await fetch(
        "/api/admin/push-devices",
        {
          method: "DELETE",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            subscriptionId: device.id,
          }),
        },
      );

      const result =
        (await response.json()) as DeviceResponse;

      if (!response.ok) {
        setMessage(
          result.error ||
            "Failed to remove device.",
        );
        return;
      }

      setMessage(
        `${device.deviceName} removed from ${userName}'s push notifications.`,
      );

      await loadDevices();
    } catch (error) {
      console.error(
        "Failed to remove admin push device",
        error,
      );

      setMessage(
        "Something went wrong while removing the device.",
      );
    } finally {
      setRemovingDeviceId(null);
    }
  }

  return (
    <details className="group overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 [&::-webkit-details-marker]:hidden">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-sm font-bold text-slate-100">
              Registered Devices
            </span>

            <span className="text-xs text-slate-400">
              {isLoading
                ? "Loading…"
                : `${activeUserCount} user${
                    activeUserCount === 1
                      ? ""
                      : "s"
                  } · ${activeDeviceCount} active`}
            </span>
          </div>

          <div className="mt-0.5 text-xs text-slate-500">
            Manage active push devices by user.
          </div>
        </div>

        <span
          aria-hidden="true"
          className="shrink-0 text-xs text-slate-400 transition-transform group-open:rotate-180"
        >
          ▼
        </span>
      </summary>

      <div className="border-t border-slate-800 px-4 py-3">
        {message ? (
          <div className="mb-3 rounded-xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
            {message}
          </div>
        ) : null}

        {isLoading ? (
          <div className="py-3 text-sm text-slate-400">
            Loading registered devices…
          </div>
        ) : users.length === 0 ? (
          <div className="py-3 text-sm text-slate-400">
            No active push devices.
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {users.map((user) => (
              <div
                key={user.userId}
                className="py-3 first:pt-0 last:pb-0"
              >
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="font-semibold text-slate-100">
                    {user.userName}
                  </div>

                  <div className="text-xs text-slate-500">
                    {user.devices.length} active
                  </div>
                </div>

                <div className="space-y-1.5">
                  {user.devices.map(
                    (device) => (
                      <div
                        key={device.id}
                        className="flex flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-slate-200">
                            {device.deviceName}
                          </div>

                          <div className="mt-0.5 text-[11px] leading-4 text-slate-500">
                            Registered{" "}
                            {formatDeviceDate(
                              device.createdAt,
                            )}
                            {" · "}
                            Last used{" "}
                            {formatDeviceDate(
                              device.lastUsedAt,
                            )}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            void removeDevice(
                              device,
                              user.userName,
                            )
                          }
                          disabled={
                            removingDeviceId !== null
                          }
                          className="shrink-0 rounded-lg border border-red-900/80 bg-red-950/30 px-3 py-1.5 text-xs font-semibold text-red-300 transition hover:border-red-700 hover:bg-red-950/60 disabled:opacity-50"
                        >
                          {removingDeviceId ===
                          device.id
                            ? "Removing…"
                            : "Remove"}
                        </button>
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="mt-3 flex justify-end">
          <button
            type="button"
            onClick={() =>
              void loadDevices()
            }
            disabled={isLoading}
            className="text-xs font-semibold text-sky-400 transition hover:text-sky-300 disabled:opacity-50"
          >
            Refresh devices
          </button>
        </div>
      </div>
    </details>
  );
}
