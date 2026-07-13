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
};

export type PushResult = {
  sent: number;
  failed: number;
  skipped: boolean;
  reason?: string;
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

export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<PushResult> {
  configureWebPush();

  const { data, error } = await supabaseAdmin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh_key, auth_key")
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
    };
  }

  let sent = 0;
  let failed = 0;
  const encodedPayload = JSON.stringify(payload);

  for (const subscription of subscriptions) {
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
        statusCode,
        error,
      });
    }
  }

  return {
    sent,
    failed,
    skipped: sent === 0,
    reason: sent === 0 ? "No notifications were delivered." : undefined,
  };
}
