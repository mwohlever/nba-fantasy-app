import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBracketContestAdmin, updateBracketContest } from "@/lib/bracket/admin.server";
export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: { params: Promise<{ contestId: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try { const { contestId } = await context.params; const result = await getBracketContestAdmin(user, contestId); if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: result.status }); return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to load contest settings." }, { status: 500 }); }
}
export async function PATCH(request: Request, context: { params: Promise<{ contestId: string }> }) {
  const user = await getCurrentUser(); if (!user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  try { const { contestId } = await context.params; const result = await updateBracketContest(user, contestId, await request.json()); if ("error" in result) return NextResponse.json({ success: false, error: result.error }, { status: result.status }); return NextResponse.json({ success: true, ...result }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to update contest settings." }, { status: 400 }); }
}
