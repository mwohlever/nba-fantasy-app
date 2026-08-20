import {
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  setActiveGroupCookie,
  userCanAccessGroup,
} from "@/lib/groups/context";


type ActiveGroupBody = {
  groupSlug?: string;
};


export async function POST(
  request: Request,
) {
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


    const body =
      (
        await request.json()
      ) as ActiveGroupBody;


    const groupSlug =
      String(
        body.groupSlug ??
        "",
      )
        .trim()
        .toLowerCase();


    if (!groupSlug) {
      return NextResponse.json(
        {
          error:
            "Group is required.",
        },
        {
          status:
            400,
        },
      );
    }


    const allowed =
      await userCanAccessGroup(
        user,
        groupSlug,
      );


    if (!allowed) {
      return NextResponse.json(
        {
          error:
            "You do not have access to that Group.",
        },
        {
          status:
            403,
        },
      );
    }


    await setActiveGroupCookie(
      groupSlug,
    );


    return NextResponse.json({
      success:
        true,

      groupSlug,
    });
  } catch (
    error
  ) {
    console.error(
      "Failed to switch active Group",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Failed to switch active Group.",
      },
      {
        status:
          500,
      },
    );
  }
}
