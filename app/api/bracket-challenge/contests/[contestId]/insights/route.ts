import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBracketInsights } from "@/lib/bracket/insights.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ contestId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { contestId } = await context.params;
    const params = new URL(request.url).searchParams;
    const entryId = params.has("entryId") ? Number(params.get("entryId")) : undefined;
    const bracketNumber = params.has("bracketNumber") ? Number(params.get("bracketNumber")) : 1;
    if ((entryId !== undefined && (!Number.isInteger(entryId) || entryId < 1)) ||
      !Number.isInteger(bracketNumber) || bracketNumber < 1)
      return NextResponse.json({ success: false, error: "Invalid bracket identity." }, { status: 400 });
    const result = await getBracketInsights(user, contestId, {
      entryId, entrantId: params.get("entrantId") ?? undefined, bracketNumber,
    });
    if (!result) return NextResponse.json({ success: false, error: "Contest not found in active Group." }, { status: 404 });
    if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: 404 });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load Bracket Insights", error);
    return NextResponse.json({ success: false, error: "Unable to load Bracket Insights." }, { status: 500 });
  }
}
