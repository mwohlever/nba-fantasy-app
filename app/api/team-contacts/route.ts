import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const teamId = Number(body.teamId);
    const name = body.name ?? "";
    const phone = body.phone ?? null;
    const smsEnabled = Boolean(body.smsEnabled);

    if (!teamId) {
      return NextResponse.json({ error: "teamId required" }, { status: 400 });
    }

    // Check if record exists
    const { data: existing } = await supabaseAdmin
      .from("team_contacts")
      .select("id")
      .eq("team_id", teamId)
      .maybeSingle();

    let result;

    if (existing) {
      // UPDATE
      result = await supabaseAdmin
        .from("team_contacts")
        .update({
          name,
          phone,
          sms_enabled: smsEnabled,
        })
        .eq("team_id", teamId);
    } else {
      // INSERT
      result = await supabaseAdmin
        .from("team_contacts")
        .insert({
          team_id: teamId,
          name,
          phone,
          sms_enabled: smsEnabled,
        });
    }

    if (result.error) {
      return NextResponse.json({ error: result.error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
