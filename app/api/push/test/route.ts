import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { sendLoggedNotification } from "@/lib/notifications";

export const runtime = "nodejs";

export async function POST() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    const result = await sendLoggedNotification({
      notificationType: "push_test",
      userId: user.id,
      teamId: user.teamId,
      title: "🏀 Push Notifications Work!",
      body: `Hey ${user.displayName}, this device is connected to 111 Sports.`,
      url: "/profile",
      tag: "push-test",
      metadata: {
        displayName: user.displayName,
      },
    });

    if (result.sent === 0) {
      return NextResponse.json(
        {
          error: result.reason ?? "No notifications were delivered.",
          ...result,
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      ...result,
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
