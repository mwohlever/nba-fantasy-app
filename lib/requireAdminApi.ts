import {
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getGroupContextForUser,
} from "@/lib/groups/context";


export async function requireAdminApi() {
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


  /*
   * A Super Admin can administer any Group.
   */
  if (
    user.systemRole ===
    "super_admin"
  ) {
    return null;
  }


  const context =
    await getGroupContextForUser(
      user,
    );


  /*
   * Normal admins are scoped to their active Group.
   */
  if (
    !context?.isGroupAdmin
  ) {
    return NextResponse.json(
      {
        error:
          "Group admin access required.",
      },
      {
        status:
          403,
      },
    );
  }


  return null;
}
