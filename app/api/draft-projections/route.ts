import { NextRequest, NextResponse } from "next/server";
import { getDraftProjectionsForSlate } from "@/lib/lineups/draftProjections.server";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const slateId = Number(request.nextUrl.searchParams.get("slateId"));
  if (!Number.isSafeInteger(slateId) || slateId <= 0) {
    return NextResponse.json({ error: "slateId must be a positive safe integer." }, { status: 400 });
  }
  const authorization = await authorizeSlateResource(request, slateId);
  if (!authorization.ok) return authorization.response;

  const result = await supabaseAdmin
    .from("slates")
    .select("sport,date,start_date,display_name,rules_snapshot")
    .eq("id", slateId)
    .maybeSingle();
  if (result.error) return NextResponse.json({ error: `Failed to load slate: ${result.error.message}` }, { status: 500 });
  if (!result.data || (result.data.sport !== "nba" && result.data.sport !== "nfl")) {
    return NextResponse.json({ error: "Draft V2 projections are available only for NBA and NFL slates." }, { status: 404 });
  }

  try {
    const slate = {
      ...result.data,
      sport: result.data.sport,
      rules_snapshot: result.data.rules_snapshot && typeof result.data.rules_snapshot === "object" && !Array.isArray(result.data.rules_snapshot)
        ? result.data.rules_snapshot as Record<string, unknown>
        : null,
    } as const;
    const projections = await getDraftProjectionsForSlate(slate);
    return NextResponse.json({ slateId, ...projections }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load Draft projections." },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  }
}
