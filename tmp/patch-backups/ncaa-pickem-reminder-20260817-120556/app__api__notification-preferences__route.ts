import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type PreferencesBody = {
  notificationsEnabled?: boolean;
  draftTurnEnabled?: boolean;
  playerFinishedEnabled?: boolean;
  slateFinalEnabled?: boolean;
};

const defaultPreferences = {
  notifications_enabled: true,
  draft_turn_enabled: true,
  player_finished_enabled: true,
  slate_final_enabled: false,
};

function formatPreferences(row: {
  notifications_enabled: boolean;
  draft_turn_enabled: boolean;
  player_finished_enabled: boolean;
  slate_final_enabled: boolean;
}) {
  return {
    notificationsEnabled: row.notifications_enabled,
    draftTurnEnabled: row.draft_turn_enabled,
    playerFinishedEnabled: row.player_finished_enabled,
    slateFinalEnabled: row.slate_final_enabled,
  };
}

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
      .from("notification_preferences")
      .select(
        "notifications_enabled, draft_turn_enabled, player_finished_enabled, slate_final_enabled"
      )
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) {
      return NextResponse.json(
        { error: `Failed to load preferences: ${error.message}` },
        { status: 500 }
      );
    }

    if (data) {
      return NextResponse.json({
        success: true,
        preferences: formatPreferences(data),
      });
    }

    const { data: created, error: createError } = await supabaseAdmin
      .from("notification_preferences")
      .insert({
        user_id: user.id,
        ...defaultPreferences,
      })
      .select(
        "notifications_enabled, draft_turn_enabled, player_finished_enabled, slate_final_enabled"
      )
      .single();

    if (createError || !created) {
      return NextResponse.json(
        {
          error:
            createError?.message ??
            "Failed to create notification preferences.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      preferences: formatPreferences(created),
    });
  } catch (error) {
    console.error("Failed to load notification preferences", error);

    return NextResponse.json(
      { error: "Unable to load notification preferences." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as PreferencesBody;

    const update = {
      notifications_enabled:
        typeof body.notificationsEnabled === "boolean"
          ? body.notificationsEnabled
          : defaultPreferences.notifications_enabled,
      draft_turn_enabled:
        typeof body.draftTurnEnabled === "boolean"
          ? body.draftTurnEnabled
          : defaultPreferences.draft_turn_enabled,
      player_finished_enabled:
        typeof body.playerFinishedEnabled === "boolean"
          ? body.playerFinishedEnabled
          : defaultPreferences.player_finished_enabled,
      slate_final_enabled:
        typeof body.slateFinalEnabled === "boolean"
          ? body.slateFinalEnabled
          : defaultPreferences.slate_final_enabled,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabaseAdmin
      .from("notification_preferences")
      .upsert(
        {
          user_id: user.id,
          ...update,
        },
        {
          onConflict: "user_id",
        }
      )
      .select(
        "notifications_enabled, draft_turn_enabled, player_finished_enabled, slate_final_enabled"
      )
      .single();

    if (error || !data) {
      return NextResponse.json(
        {
          error:
            error?.message ??
            "Failed to update notification preferences.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      preferences: formatPreferences(data),
    });
  } catch (error) {
    console.error("Failed to update notification preferences", error);

    return NextResponse.json(
      { error: "Unable to update notification preferences." },
      { status: 500 }
    );
  }
}
