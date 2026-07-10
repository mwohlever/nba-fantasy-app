import { NextResponse } from "next/server";
import { deleteCurrentSession } from "@/lib/auth";

export async function POST() {
  try {
    await deleteCurrentSession();

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Logout failed", error);

    return NextResponse.json(
      { error: "Unable to log out right now." },
      { status: 500 }
    );
  }
}
