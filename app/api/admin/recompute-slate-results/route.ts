import { NextRequest, NextResponse } from "next/server";

import { recomputeCorrectedSlateResults } from "@/lib/corrections/recomputeSlateResults";
import { authorizeSlateResource } from "@/lib/security/resourceAuthorization";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const slateId = Number(body.slateId);

    if (!Number.isInteger(slateId)) {
      return NextResponse.json({ error: "Valid slateId is required." }, { status: 400 });
    }

    const authorization = await authorizeSlateResource(request, slateId, {
      requireCommissioner: true,
    });
    if (!authorization.ok) return authorization.response;

    const sport = authorization.target.sportKey;
    if (sport !== "nba" && sport !== "nfl") {
      return NextResponse.json(
        { error: "Corrections are supported for NBA and NFL slates." },
        { status: 400 },
      );
    }

    const results = await recomputeCorrectedSlateResults(slateId, sport);

    return NextResponse.json({ success: true, slateId, results });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Unexpected server error while recomputing slate results." },
      { status: 500 },
    );
  }
}
