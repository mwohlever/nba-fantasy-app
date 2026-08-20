import { NextResponse } from "next/server";
import {
  deleteOtherUserSessions,
  generatePinSalt,
  getCurrentUser,
  hashPin,
  verifyPin,
} from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ChangePinBody = {
  currentPin?: string;
  newPin?: string;
  confirmPin?: string;
};

type AppUserSecurityRow = {
  id: string;
  pin_salt: string | null;
  pin_hash: string | null;
  is_active: boolean;
};

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();

    if (!currentUser) {
      return NextResponse.json(
        { error: "Login required." },
        { status: 401 }
      );
    }

    const body = (await request.json()) as ChangePinBody;

    const currentPin = String(body.currentPin ?? "").trim();
    const newPin = String(body.newPin ?? "").trim();
    const confirmPin = String(body.confirmPin ?? "").trim();

    if (!/^\d{4,8}$/.test(currentPin)) {
      return NextResponse.json(
        { error: "Enter your current 4–8 digit PIN." },
        { status: 400 }
      );
    }

    if (!/^\d{4,8}$/.test(newPin)) {
      return NextResponse.json(
        { error: "Your new PIN must contain 4–8 digits." },
        { status: 400 }
      );
    }

    if (newPin !== confirmPin) {
      return NextResponse.json(
        { error: "The new PIN and confirmation do not match." },
        { status: 400 }
      );
    }

    if (newPin === currentPin) {
      return NextResponse.json(
        { error: "Choose a new PIN that differs from your current PIN." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("app_users")
      .select("id, pin_salt, pin_hash, is_active")
      .eq("id", currentUser.id)
      .maybeSingle();

    if (error) {
      console.error("Failed to load user security record", error);

      return NextResponse.json(
        { error: "Unable to update your PIN right now." },
        { status: 500 }
      );
    }

    const user = data as AppUserSecurityRow | null;

    if (!user?.is_active) {
      return NextResponse.json(
        { error: "This account is unavailable." },
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
            "This account does not currently use a league PIN.",
        },
        {
          status: 409,
        },
      );
    }

    const currentPinIsValid =
      await verifyPin(
        currentPin,
        user.pin_salt,
        user.pin_hash
      );

    if (!currentPinIsValid) {
      return NextResponse.json(
        { error: "Your current PIN is incorrect." },
        { status: 401 }
      );
    }

    const newSalt = generatePinSalt();
    const newHash = await hashPin(newPin, newSalt);

    const { error: updateError } = await supabaseAdmin
      .from("app_users")
      .update({
        pin_salt: newSalt,
        pin_hash: newHash,
        updated_at: new Date().toISOString(),
      })
      .eq("id", currentUser.id);

    if (updateError) {
      console.error("Failed to update PIN", updateError);

      return NextResponse.json(
        { error: "Unable to update your PIN right now." },
        { status: 500 }
      );
    }

    try {
      await deleteOtherUserSessions(currentUser.id);
    } catch (sessionError) {
      console.error(
        "PIN changed, but other sessions could not be removed",
        sessionError
      );

      return NextResponse.json({
        success: true,
        warning:
          "Your PIN was changed, but some other signed-in devices may remain active.",
      });
    }

    return NextResponse.json({
      success: true,
      message:
        "PIN updated successfully. Other signed-in devices have been logged out.",
    });
  } catch (error) {
    console.error("Change PIN failed", error);

    return NextResponse.json(
      { error: "Unable to update your PIN right now." },
      { status: 500 }
    );
  }
}
