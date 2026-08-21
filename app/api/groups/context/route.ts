import {
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getAvailableGroupsForUser,
  getGroupContextForUser,
} from "@/lib/groups/context";


export const dynamic =
  "force-dynamic";


export async function GET() {
  try {
    const user =
      await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        {
          error:
            "Login required.",
        },
        {
          status:
            401,
        },
      );
    }

    const [
      context,
      groups,
    ] =
      await Promise.all([
        getGroupContextForUser(
          user,
        ),

        getAvailableGroupsForUser(
          user,
        ),
      ]);

    return NextResponse.json({
      success:
        true,

      context,

      groups,
    });
  } catch (
    error
  ) {
    console.error(
      "Failed to load Group context",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to load Group context.",
      },
      {
        status:
          500,
      },
    );
  }
}
