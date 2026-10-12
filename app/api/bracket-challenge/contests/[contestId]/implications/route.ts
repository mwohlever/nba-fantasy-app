import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBracketGameImplications } from "@/lib/bracket/gameImplications.server";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ contestId: string }> }) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { contestId } = await context.params;
    const params = new URL(request.url).searchParams;
    const entryId = params.has("entryId") ? Number(params.get("entryId")) : undefined;
    const entrantId = params.get("entrantId") ?? undefined;
    const bracketNumber = params.has("bracketNumber") ? Number(params.get("bracketNumber")) : undefined;
    if ((entryId !== undefined && (!Number.isSafeInteger(entryId) || entryId < 1)) ||
      (entrantId !== undefined && (!entrantId || entryId !== undefined || !Number.isSafeInteger(bracketNumber) || bracketNumber! < 1)) ||
      (bracketNumber !== undefined && !entrantId))
      return NextResponse.json({ error: "Invalid bracket identity." }, { status: 400 });
    const result = await getBracketGameImplications(user, contestId, {
      gameId: params.get("gameId") ?? undefined, entryId, entrantId, bracketNumber,
    });
    if (!result) return NextResponse.json({ error: "Contest not found in active Group." }, { status: 404 });
    if ("error" in result) return NextResponse.json(result, { status: 404 });
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load bracket game implications", error);
    return NextResponse.json({ error: "Unable to load implications." }, { status: 500 });
  }
}
