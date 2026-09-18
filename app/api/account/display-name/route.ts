import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type DisplayNameBody = {
  displayName?: string;
};

const MIN_DISPLAY_NAME_LENGTH = 1;
const MAX_DISPLAY_NAME_LENGTH = 40;

export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      );
    }

    const body = (await request.json()) as DisplayNameBody;
    const displayName = String(body.displayName ?? "")
      .trim()
      .replace(/\s+/g, " ");

    if (
      displayName.length < MIN_DISPLAY_NAME_LENGTH ||
      displayName.length > MAX_DISPLAY_NAME_LENGTH
    ) {
      return NextResponse.json(
        {
          error: `Display name must be between ${MIN_DISPLAY_NAME_LENGTH} and ${MAX_DISPLAY_NAME_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }

    if (displayName === currentUser.displayName) {
      return NextResponse.json({
        success: true,
        displayName,
      });
    }

    /*
     * Group-scoped fantasy surfaces still intentionally use teams.name.
     * Keep every Group team owned by this account aligned with the
     * account-level display name.
     *
     * Never use app_users.team_id here. That field is legacy identity.
     */
    const { error: teamUpdateError } = await supabaseAdmin
      .from("teams")
      .update({
        name: displayName,
      })
      .eq("user_id", currentUser.id);

    if (teamUpdateError) {
      console.error(
        "Failed to update Group team display names",
        teamUpdateError,
      );

      return NextResponse.json(
        { error: "Unable to update your display name right now." },
        { status: 500 },
      );
    }

    const { error: userUpdateError } = await supabaseAdmin
      .from("app_users")
      .update({
        display_name: displayName,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentUser.id);

    if (userUpdateError) {
      console.error(
        "Failed to update account display name",
        userUpdateError,
      );

      /*
       * Best-effort rollback keeps Group team labels aligned with the
       * still-authoritative account name if the account update fails.
       */
      const { error: rollbackError } = await supabaseAdmin
        .from("teams")
        .update({
          name: currentUser.displayName,
        })
        .eq("user_id", currentUser.id);

      if (rollbackError) {
        console.error(
          "Failed to roll back Group team display names",
          rollbackError,
        );
      }

      return NextResponse.json(
        { error: "Unable to update your display name right now." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      displayName,
    });
  } catch (error) {
    console.error("Display name update failed", error);

    return NextResponse.json(
      { error: "Unable to update your display name right now." },
      { status: 500 },
    );
  }
}
