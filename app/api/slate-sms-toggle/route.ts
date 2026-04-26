import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slateId = Number(body?.slateId);
    const smsEnabled = Boolean(body?.smsEnabled);

    if (!slateId) {
      return NextResponse.json(
        { error: "slateId is required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("slates")
      .update({ sms_enabled: smsEnabled })
      .eq("id", slateId)
      .select("id, sms_enabled")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      slate: data,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while updating SMS setting." },
      { status: 500 }
    );
  }
}
