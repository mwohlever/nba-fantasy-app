import { NextRequest, NextResponse } from "next/server";

import { requireAdminApi } from "@/lib/requireAdminApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PushSubscriptionRow = {
  id: string;
  user_id: string;
  device_name: string | null;
  created_at: string;
  last_used_at: string | null;
};

type UserRow = {
  id: string;
  display_name: string | null;
};

export async function GET() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const { data: subscriptionData, error: subscriptionError } =
      await supabaseAdmin
        .from("push_subscriptions")
        .select(
          "id, user_id, device_name, created_at, last_used_at",
        )
        .eq("is_active", true)
        .order("created_at", { ascending: false });

    if (subscriptionError) {
      return NextResponse.json(
        {
          error:
            "Failed to load registered devices: " +
            subscriptionError.message,
        },
        { status: 500 },
      );
    }

    const subscriptions =
      (subscriptionData ?? []) as PushSubscriptionRow[];

    const userIds = Array.from(
      new Set(
        subscriptions
          .map((row) => String(row.user_id))
          .filter(Boolean),
      ),
    );

    let users: UserRow[] = [];

    if (userIds.length > 0) {
      const { data: userData, error: userError } =
        await supabaseAdmin
          .from("app_users")
          .select("id, display_name")
          .in("id", userIds);

      if (userError) {
        return NextResponse.json(
          {
            error:
              "Failed to load device owners: " +
              userError.message,
          },
          { status: 500 },
        );
      }

      users = (userData ?? []) as UserRow[];
    }

    const userNameById = new Map(
      users.map((user) => [
        String(user.id),
        user.display_name?.trim() ||
          "Unknown user",
      ]),
    );

    const grouped = new Map<
      string,
      {
        userId: string;
        userName: string;
        devices: Array<{
          id: string;
          deviceName: string;
          createdAt: string;
          lastUsedAt: string | null;
        }>;
      }
    >();

    subscriptions.forEach((subscription) => {
      const userId = String(subscription.user_id);

      const existing =
        grouped.get(userId) ?? {
          userId,
          userName:
            userNameById.get(userId) ??
            "Unknown user",
          devices: [],
        };

      existing.devices.push({
        id: String(subscription.id),
        deviceName:
          subscription.device_name?.trim() ||
          "Web browser",
        createdAt: subscription.created_at,
        lastUsedAt:
          subscription.last_used_at ?? null,
      });

      grouped.set(userId, existing);
    });

    const deviceGroups = Array.from(
      grouped.values(),
    ).sort((a, b) =>
      a.userName.localeCompare(b.userName),
    );

    return NextResponse.json({
      success: true,
      activeDeviceCount: subscriptions.length,
      activeUserCount: deviceGroups.length,
      users: deviceGroups,
    });
  } catch (error) {
    console.error(
      "Failed to load admin push devices",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to load registered devices.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const body = (await request.json()) as {
      subscriptionId?: unknown;
    };

    const subscriptionId = String(
      body.subscriptionId ?? "",
    ).trim();

    if (!subscriptionId) {
      return NextResponse.json(
        {
          error:
            "Missing push subscription ID.",
        },
        { status: 400 },
      );
    }

    const { data, error } =
      await supabaseAdmin
        .from("push_subscriptions")
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subscriptionId)
        .eq("is_active", true)
        .select("id")
        .maybeSingle();

    if (error) {
      return NextResponse.json(
        {
          error:
            "Failed to disable device: " +
            error.message,
        },
        { status: 500 },
      );
    }

    if (!data) {
      return NextResponse.json(
        {
          error:
            "That device is no longer active.",
        },
        { status: 404 },
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error(
      "Failed to disable admin push device",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to disable this device.",
      },
      { status: 500 },
    );
  }
}
