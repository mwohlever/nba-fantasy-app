import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
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
