// Browser push operations shared by settings and the one-time reminder.
export type PushDevice = { endpoint: string; is_active: boolean };

export function supportsPush() {
  return typeof window !== "undefined" && typeof navigator !== "undefined" &&
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isCurrentDeviceActive(endpoint: string | null, devices: PushDevice[], permission: NotificationPermission) {
  return permission === "granted" && Boolean(endpoint) &&
    devices.some(device => device.endpoint === endpoint && device.is_active);
}

export async function inspectPushDevice() {
  const response = await fetch("/api/push-subscriptions", { cache: "no-store" });
  if (response.status === 401) return null;
  const result = await response.json();
  if (!response.ok || !Array.isArray(result.subscriptions)) {
    throw new Error(result.error || "Unable to load registered devices.");
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  const permission = Notification.permission;
  return { permission, active: isCurrentDeviceActive(subscription?.endpoint ?? null, result.subscriptions, permission) };
}

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

export function getDeviceName() {
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

export async function enableCurrentDevicePush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!publicKey) throw new Error("The public notification key is not configured.");
  // Called directly from a click: preserve browser user activation.
  const permission = Notification.permission === "default"
    ? await Notification.requestPermission() : Notification.permission;
  if (permission !== "granted") {
    throw new Error(permission === "denied"
      ? "Notifications are blocked in this browser's settings."
      : "Notification permission was not granted.");
  }
  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const subscriptionJson = subscription.toJSON();
  const response = await fetch("/api/push-subscriptions", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscriptionJson.endpoint, keys: subscriptionJson.keys, deviceName: getDeviceName() }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Unable to register this device.");
  window.dispatchEvent(new Event("111-push-device-enabled"));
  return subscription.endpoint;
}
