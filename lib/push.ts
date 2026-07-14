import webpush from "web-push";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
  device_name: string | null;
  user_agent: string | null;
};

export type PushDeviceResult = {
  subscriptionId: string;
  deviceName: string;
  status: "sent" | "failed";
  reason?: string;
  statusCode?: number | null;
};

export type PushResult = {
  sent: number;
  failed: number;
  skipped: boolean;
  reason?: string;
  devices: PushDeviceResult[];
};

function configureWebPush() {
  const subject = process.env.VAPID_SUBJECT;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;

  if (!subject || !publicKey || !privateKey) {
    throw new Error("VAPID configuration is incomplete.");
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

function getPushStatusCode(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "statusCode" in error
  ) {
    return Number(error.statusCode);
  }

  return null;
}

function getPushErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "body" in error &&
    typeof error.body === "string" &&
    error.body.trim()
  ) {
    return error.body;
  }

  return "Push delivery failed.";
}

function describeDevice(
  deviceName: string | null,
  userAgent: string | null
) {
  const savedName = String(deviceName ?? "").trim();
  const ua = String(userAgent ?? "");

  if (savedName && savedName.toLowerCase() !== "web browser") {
    return savedName;
  }

  const isIPhone = /iPhone/i.test(ua);
  const isIPad = /iPad/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isChromeOS = /CrOS/i.test(ua);
  const isWindows = /Windows/i.test(ua);
  const isMac = /Macintosh|Mac OS X/i.test(ua);

  const isEdge = /Edg\//i.test(ua);
  const isFirefox = /Firefox\//i.test(ua);
  const isChrome =
    /Chrome\//i.test(ua) &&
    !isEdge &&
    !/OPR\//i.test(ua);
  const isSafari =
    /Safari\//i.test(ua) &&
    !isChrome &&
    !isEdge &&
    !/CriOS\//i.test(ua) &&
    !/FxiOS\//i.test(ua);

  let browser = "Browser";

  if (isEdge) browser = "Edge";
  else if (isFirefox || /FxiOS\//i.test(ua)) browser = "Firefox";
  else if (isChrome || /CriOS\//i.test(ua)) browser = "Chrome";
  else if (isSafari) browser = "Safari";

  let platform = "device";

  if (isIPhone) platform = "iPhone";
  else if (isIPad) platform = "iPad";
  else if (isAndroid) platform = "Android";
  else if (isChromeOS) platform = "Chromebook";
  else if (isWindows) platform = "Windows";
  else if (isMac) platform = "Mac";

  if (isIPhone || isIPad) {
    return `${browser} / Home Screen App on ${platform}`;
  }

  return `${browser} on ${platform}`;
}

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<PushResult> {
  configureWebPush();

  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select(
      `
        id,
        endpoint,
        p256dh_key,
        auth_key,
        device_name,
        user_agent
      `
    )
    .eq("user_id", userId)
    .eq("is_active", true);

  if (error) {
    throw new Error(`Failed to load push subscriptions: ${error.message}`);
  }

  const subscriptions = (data ?? []) as SubscriptionRow[];

  if (subscriptions.length === 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "No active push-enabled devices found.",
      devices: [],
    };
  }

  let sent = 0;
  let failed = 0;
  const devices: PushDeviceResult[] = [];
  const encodedPayload = JSON.stringify(payload);

  for (const subscription of subscriptions) {
    const deviceName = describeDevice(
      subscription.device_name,
      subscription.user_agent
    );

    try {
      await webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: {
            p256dh: subscription.p256dh_key,
            auth: subscription.auth_key,
          },
        },
        encodedPayload
      );

      sent += 1;

      devices.push({
        subscriptionId: subscription.id,
        deviceName,
        status: "sent",
      });

      await supabaseAdmin
        .from("push_subscriptions")
        .update({
          last_used_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscription.id);
    } catch (error) {
      failed += 1;

      const statusCode = getPushStatusCode(error);
      const reason = getPushErrorMessage(error);

      devices.push({
        subscriptionId: subscription.id,
        deviceName,
        status: "failed",
        reason,
        statusCode,
      });

      if (statusCode === 404 || statusCode === 410) {
        await supabaseAdmin
          .from("push_subscriptions")
          .update({
            is_active: false,
            updated_at: new Date().toISOString(),
          })
          .eq("id", subscription.id);
      }

      console.error("Push notification failed", {
        subscriptionId: subscription.id,
        deviceName,
        statusCode,
        error,
      });
    }
  }

  return {
    sent,
    failed,
    skipped: sent === 0,
    reason:
      sent === 0
        ? failed > 0
          ? "No notifications were delivered."
          : "No active push-enabled devices found."
        : undefined,
    devices,
  };
}
