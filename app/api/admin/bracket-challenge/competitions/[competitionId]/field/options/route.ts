import { NextRequest, NextResponse } from "next/server";

import { fetchNcaaEspnTeamDirectory } from "@/lib/providers/ncaa";
import { requireSuperAdminApi } from "@/lib/requireAdminApi";
import { assertCfpCompetition } from "@/lib/bracket/field.server";

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
    // Keep this endpoint scoped to a real CFP competition, even though the
    // provider directory itself is not competition-specific.
    await assertCfpCompetition(competitionId);

    const teams = await fetchNcaaEspnTeamDirectory();
    return NextResponse.json(
      {
        teams: teams.map((team) => ({
          providerTeamId: team.id,
          displayName: team.displayName,
          abbreviation: team.abbreviation,
          logoUrl: team.logo,
        })),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load ESPN teams.";
    return NextResponse.json(
      { error: message },
      { status: message === "Invalid competition ID." ? 400 : 500 },
    );
  }
}
