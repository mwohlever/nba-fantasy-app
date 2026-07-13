import { NextResponse } from "next/server";
import webpush from "web-push";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

type SubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
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

export async function POST() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    configureWebPush();

    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh_key, auth_key")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (error) {
      return NextResponse.json(
        { error: `Failed to load devices: ${error.message}` },
        { status: 500 }
      );
    }

    const subscriptions = (data ?? []) as SubscriptionRow[];

    if (subscriptions.length === 0) {
      return NextResponse.json(
        { error: "No active push-enabled devices found." },
        { status: 400 }
      );
    }

    let sent = 0;
    let failed = 0;

    const payload = JSON.stringify({
      title: "🏀 Push Notifications Work!",
      body: `Hey ${user.displayName}, this device is connected to 111 Fantasy.`,
      url: "/profile",
      tag: "push-test",
    });

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
          payload
        );

        sent += 1;

        await supabaseAdmin
          .from("push_subscriptions")
          .update({
            last_used_at: new Date().toISOString(),
          })
          .eq("id", subscription.id);
      } catch (error) {
        failed += 1;

        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error
            ? Number(error.statusCode)
            : null;

        if (statusCode === 404 || statusCode === 410) {
          await supabaseAdmin
            .from("push_subscriptions")
            .update({
              is_active: false,
              updated_at: new Date().toISOString(),
            })
            .eq("id", subscription.id);
        }

        console.error("Push test failed", error);
      }
    }

    return NextResponse.json({
      success: sent > 0,
      sent,
      failed,
    });
  } catch (error) {
    console.error("Unable to send push test", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to send test notification.",
      },
      { status: 500 }
    );
  }
}
