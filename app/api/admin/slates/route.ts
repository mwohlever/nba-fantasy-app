import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminApi } from "@/lib/requireAdminApi";

export async function GET() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const { data, error } = await supabaseAdmin
      .from("slates")
      .select("id, date, start_date, end_date, is_locked")
      .order("start_date", { ascending: false })
      .order("end_date", { ascending: false });

    if (error) {
      return NextResponse.json(
        { error: `Failed to load slates: ${error.message}` },
        { status: 500 }
      );
    }

    const slates = (data ?? []).map((slate) => ({
      ...slate,
      label:
        slate.start_date && slate.end_date && slate.start_date !== slate.end_date
          ? `${slate.start_date} - ${slate.end_date}`
          : slate.start_date ?? slate.date,
    }));

    return NextResponse.json({
      success: true,
      slates,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while loading slates." },
      { status: 500 }
    );
  }
}
