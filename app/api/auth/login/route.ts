import { NextResponse } from "next/server";
import { createUserSession, verifyPin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type LoginBody = {
  teamId?: number;
  pin?: string;
};

type AppUserRow = {
  id: string;
  team_id: number | null;
  display_name: string;
  role: "player" | "admin";
  pin_salt: string | null;
  pin_hash: string | null;
  is_active: boolean;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as LoginBody;
    const teamId = Number(body.teamId);
    const pin = String(body.pin ?? "").trim();

    if (!Number.isInteger(teamId) || !/^\d{4,8}$/.test(pin)) {
      return NextResponse.json(
        { error: "Select your name and enter a valid PIN." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("app_users")
      .select(
        "id, team_id, display_name, role, pin_salt, pin_hash, is_active"
      )
      .eq("team_id", teamId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load login user", error);

      return NextResponse.json(
        { error: "Unable to log in right now." },
        { status: 500 }
      );
    }

    const user = data as AppUserRow | null;

    if (!user?.is_active) {
      return NextResponse.json(
        { error: "That account is unavailable." },
        { status: 401 }
      );
    }

    if (
      !user.pin_salt ||
      !user.pin_hash
    ) {
      return NextResponse.json(
        {
          error:
            "This account does not use league PIN sign-in.",
        },
        {
          status: 409,
        },
      );
    }

    const pinIsValid =
      await verifyPin(
        pin,
        user.pin_salt,
        user.pin_hash,
      );

    if (!pinIsValid) {
      return NextResponse.json(
        { error: "Incorrect PIN." },
        { status: 401 }
      );
    }

    await createUserSession(user.id);

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        teamId: Number(user.team_id),
        displayName: user.display_name,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Login failed", error);

    return NextResponse.json(
      { error: "Unable to log in right now." },
      { status: 500 }
    );
  }
}
