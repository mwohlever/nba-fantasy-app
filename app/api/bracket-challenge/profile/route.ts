import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getBracketProfile } from "@/lib/bracket/profile.server";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Login required." }, { status: 401 });
  try { const params = new URL(request.url).searchParams; const profile = await getBracketProfile(user, params.get("entrantId"), params.get("contestId")); if (!profile?.entrant) return NextResponse.json({ error: "Bracket entrant not found in the active Group." }, { status: 404 }); return NextResponse.json(profile, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { console.error("Failed to load bracket profile", error); return NextResponse.json({ error: "Unable to load Bracket Challenge profile." }, { status: 500 }); }
}
