import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getGroupContextForUser } from "@/lib/groups/context";

export async function GET() {
  try {
    const user = await getCurrentUser();

    const groupContext =
      user
        ? await getGroupContextForUser(
            user,
          )
        : null;

    return NextResponse.json({
      success: true,
      authenticated: Boolean(user),
      user,
      groupContext,
    });
  } catch (error) {
    console.error("Failed to load current user", error);

    return NextResponse.json(
      { error: "Failed to load current user." },
      { status: 500 }
    );
  }
}
