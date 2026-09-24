import { NextResponse } from "next/server";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";
import { runClaimedNflSlate } from "@/lib/nfl/backgroundScoring.server";
import { NflScoringProvider } from "@/lib/nfl/scoringProvider";

export async function POST(request: Request) {
  let body: { slateId?: number };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON." }, { status: 400 }); }
  const slateId = Number(body.slateId);
  if (!Number.isInteger(slateId) || slateId <= 0) return NextResponse.json({ error: "slateId is required." }, { status: 400 });
  const authorization = await authorizeSlateResource(request, slateId, { allowInternal: true });
  if (!authorization.ok) return authorization.response;
  const result = await runClaimedNflSlate(slateId, new NflScoringProvider(), true);
  if (result.state === "leased") return NextResponse.json({ error: "NFL scoring is already in progress." }, { status: 409 });
  if (result.state === "ineligible") return NextResponse.json({ error: "This slate is locked or unavailable." }, { status: 400 });
  if (result.response) return result.response;
  return NextResponse.json({ error: "NFL scoring failed." }, { status: 500 });
}
