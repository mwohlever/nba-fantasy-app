import { getCurrentUser } from "@/lib/auth";
import { getGroupContextForUser } from "@/lib/groups/context";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });
    const context = await getGroupContextForUser(user);
    if (!context) return NextResponse.json({ error: "Group access required." }, { status: 403 });

    const { data, error } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .eq("group_id", context.group.id)
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      groupId: context.group.id,
      teams: data ?? [],
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: "Failed to load teams" },
      { status: 500 }
    );
  }
}
