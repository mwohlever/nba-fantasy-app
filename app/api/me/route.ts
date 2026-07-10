import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function GET() {
  try {
    const user = await getCurrentUser();

    return NextResponse.json({
      success: true,
      authenticated: Boolean(user),
      user,
    });
  } catch (error) {
    console.error("Failed to load current user", error);

    return NextResponse.json(
      { error: "Failed to load current user." },
      { status: 500 }
    );
  }
}
