import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SubscriptionBody = {
  endpoint?: string;
  keys?: {
    p256dh?: string;
    auth?: string;
  };
  deviceName?: string;
};

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .select("id, endpoint, device_name, is_active, created_at, last_used_at")
      .eq("user_id", user.id)
      .eq("is_active", true)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load devices: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      subscriptions: data ?? [],
    });
  } catch (error) {
    console.error("Failed to load push subscriptions", error);

    return NextResponse.json(
      { error: "Unable to load registered devices." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as SubscriptionBody;

    const endpoint = String(body.endpoint ?? "").trim();
    const p256dhKey = String(body.keys?.p256dh ?? "").trim();
    const authKey = String(body.keys?.auth ?? "").trim();

    if (!endpoint || !p256dhKey || !authKey) {
      return NextResponse.json(
        { error: "Invalid push subscription." },
        { status: 400 }
      );
    }

    const userAgent = request.headers.get("user-agent");

    const { data, error } = await supabaseAdmin
      .from("push_subscriptions")
      .upsert(
        {
          user_id: user.id,
          endpoint,
          p256dh_key: p256dhKey,
          auth_key: authKey,
          user_agent: userAgent,
          device_name: body.deviceName?.trim() || "Web browser",
          is_active: true,
          updated_at: new Date().toISOString(),
          last_used_at: new Date().toISOString(),
        },
        {
          onConflict: "endpoint",
        }
      )
      .select("id, device_name, is_active")
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error:
            error?.message ??
            "Failed to register this device.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      subscription: data,
    });
  } catch (error) {
    console.error("Failed to register push subscription", error);

    return NextResponse.json(
      { error: "Unable to register this device." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as {
      endpoint?: string;
    };

    const endpoint = String(body.endpoint ?? "").trim();

    if (!endpoint) {
      return NextResponse.json(
        { error: "Missing subscription endpoint." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("push_subscriptions")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("user_id", user.id)
      .eq("endpoint", endpoint);

    if (error) {
      return NextResponse.json(
        { error: `Failed to disable device: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Failed to disable push subscription", error);

    return NextResponse.json(
      { error: "Unable to disable this device." },
      { status: 500 }
    );
  }
}
