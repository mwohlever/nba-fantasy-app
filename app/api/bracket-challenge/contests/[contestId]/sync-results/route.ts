import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { syncBracketOfficialResults } from "@/lib/bracket/resultSync.server";

export const dynamic = "force-dynamic";

/** Authenticated, Group-scoped refresh boundary. GET and arbitrary event IDs cannot write. */
export async function POST(_request: Request, context: { params: Promise<{ contestId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    const { contestId } = await context.params;
    const result = await syncBracketOfficialResults(user, contestId);
    if (!result) return NextResponse.json({ success: false, error: "Contest not found in active Group." }, { status: 404 });
    return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Bracket official result sync failed", error);
    return NextResponse.json({ success: false, error: "Unable to sync official results." }, { status: 500 });
  }
}
