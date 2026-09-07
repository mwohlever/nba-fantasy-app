import { resolvePinAccountId } from "@/lib/security/pinIdentity";
import { NextResponse } from "next/server";
import { createUserSession, verifyPin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type LoginBody = {
  teamId?: number;
  groupSlug?: string;
  teamName?: string;
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
    const pin = String(body.pin ?? "").trim();

    if (!/^\d{4,8}$/.test(pin)) {
      return NextResponse.json(
        { error: "Enter your Group, team name, and a valid PIN." },
        { status: 400 }
      );
    }

    const accountId = await resolvePinAccountId({
      groupSlug: body.groupSlug, teamName: body.teamName, legacyTeamId: body.teamId,
    });
    if (!accountId) return NextResponse.json({ error: "Invalid account or PIN." }, { status: 401 });

    const { data, error } = await supabaseAdmin
      .from("app_users")
      .select(
        "id, team_id, display_name, role, pin_salt, pin_hash, is_active"
      )
      .eq("id", accountId)
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
