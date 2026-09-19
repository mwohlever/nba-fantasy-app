import { NextRequest, NextResponse } from "next/server";

import {
  getBracketCompetitionField,
  assertCfpCompetition,
  saveCfpCompetitionField,
  type BracketFieldTeamInput,
} from "@/lib/bracket/field.server";
import { requireSuperAdminApi } from "@/lib/requireAdminApi";

export const dynamic = "force-dynamic";

function parseCompetitionId(raw: string) {
  const value = Number(raw);

  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Invalid competition ID.");
  }

  return value;
}

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ competitionId: string }> },
) {
  try {
    const authError = await requireSuperAdminApi();
    if (authError) return authError;

    const { competitionId: rawCompetitionId } = await context.params;
    const competitionId = parseCompetitionId(rawCompetitionId);
    await assertCfpCompetition(competitionId);

    return NextResponse.json(
      {
        competitionId,
        field: await getBracketCompetitionField(competitionId),
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to load CFP field.";

    return NextResponse.json(
      { error: message },
      { status: message === "Invalid competition ID." ? 400 : 403 },
    );
  }
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ competitionId: string }> },
) {
  try {
    const authError = await requireSuperAdminApi();
    if (authError) return authError;

    const { competitionId: rawCompetitionId } = await context.params;
    const competitionId = parseCompetitionId(rawCompetitionId);

    const body = (await request.json()) as {
      teams?: BracketFieldTeamInput[];
    };

    if (!Array.isArray(body.teams)) {
      return NextResponse.json(
        { error: "teams must be an array." },
        { status: 400 },
      );
    }

    const result = await saveCfpCompetitionField(
      competitionId,
      body.teams,
    );

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to save CFP field.";

    return NextResponse.json(
      { error: message },
      { status: 400 },
    );
  }
}
