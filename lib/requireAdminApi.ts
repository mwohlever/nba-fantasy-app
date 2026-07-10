import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";

export async function requireAdminApi() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { error: "Login required." },
      { status: 401 }
    );
  }

  if (user.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required." },
      { status: 403 }
    );
  }

  return null;
}
