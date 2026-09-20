import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { getBracketChallengeDetail } from "@/lib/bracket/challenge.server";
import {
  admitMasterBracketToContest,
  createManagedEntrant,
  getContestEntryForMaster,
  getFrozenEntrySnapshot,
  getOrCreateMasterBracket,
  listAccountEntrants,
  maybeFreezeContestEntry,
  saveMasterBracketPick,
  saveMasterBracketTiebreaker,
} from "@/lib/bracket/masterBracket.server";

export const dynamic = "force-dynamic";

async function resolveContext(
  contestId: string,
) {
  const user = await getCurrentUser();

  if (!user) {
    return {
      error: NextResponse.json(
        {
          success: false,
          error: "Unauthorized",
        },
        { status: 401 },
      ),
    };
  }

  const challenge =
    await getBracketChallengeDetail(
      user,
      contestId,
    );

  if (!challenge) {
    return {
      error: NextResponse.json(
        {
          success: false,
          error:
            "Bracket Challenge not found for the active Group.",
        },
        { status: 404 },
      ),
    };
  }

  return {
    user,
    challenge,
  };
}

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      contestId: string;
    }>;
  },
) {
  try {
    const { contestId } =
      await context.params;

    const resolved =
      await resolveContext(contestId);

    if ("error" in resolved) {
      return resolved.error;
    }

    const url = new URL(_request.url);
    const entrantId = url.searchParams.get("entrantId");
    const bracketNumber = Number(url.searchParams.get("bracketNumber") ?? "1");

    if (!Number.isInteger(bracketNumber) || bracketNumber < 1) {
      throw new Error("Invalid bracket number.");
    }

    if (
      bracketNumber >
      resolved.challenge.contest.maxBracketsPerEntrant
    ) {
      throw new Error(
        "This entrant has reached the contest bracket limit.",
      );
    }

    const entrants = await listAccountEntrants(resolved.user);
    const selectedEntrantId = entrantId || entrants.find((entrant) => entrant.kind === "account")?.id;
    if (!selectedEntrantId) throw new Error("Unable to find your primary entrant.");
    const masterBracket = await getOrCreateMasterBracket(resolved.user, resolved.challenge.competition.id, bracketNumber, selectedEntrantId);
    const entry = await getContestEntryForMaster(contestId, masterBracket.id);
    if (entry) await maybeFreezeContestEntry({ entryId: entry.id, contestStatus: resolved.challenge.contest.status, contestLockAt: resolved.challenge.contest.lockAt });
    const frozen = entry ? await getFrozenEntrySnapshot(entry.id) : null;

    return NextResponse.json(
      {
        success: true,
        entrants,
        selectedEntrantId,
        contestEntry: entry ? { id: entry.id, status: entry.status, lockedAt: entry.locked_at } : null,
        masterBracket: frozen ? { ...masterBracket, status: frozen.status, picks: frozen.picks_snapshot ?? {}, tiebreakerValue: frozen.tiebreaker_value } : masterBracket,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Failed to load master bracket",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "Unable to load your bracket.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      contestId: string;
    }>;
  },
) {
  try {
    const { contestId } =
      await context.params;

    const resolved =
      await resolveContext(contestId);

    if ("error" in resolved) {
      return resolved.error;
    }

    const body = await request.json();

    const entrantId = typeof body?.entrantId === "string" ? body.entrantId : undefined;
    const bracketNumber = Number(body?.bracketNumber ?? 1);

    if (!Number.isInteger(bracketNumber) || bracketNumber < 1) {
      throw new Error("Invalid bracket number.");
    }

    if (
      bracketNumber >
      resolved.challenge.contest.maxBracketsPerEntrant
    ) {
      throw new Error(
        "This entrant has reached the contest bracket limit.",
      );
    }

    const hasTiebreaker =
      body?.tiebreakerValue !== undefined;

    const result = hasTiebreaker
      ? await saveMasterBracketTiebreaker(
          resolved.user,
          {
            competitionId:
              resolved.challenge
                .competition.id,
            bracketNumber, entrantId,
            contestStatus: resolved.challenge.contest.status, contestLockAt: resolved.challenge.contest.lockAt,
            tiebreakerValue:
              Number(
                body.tiebreakerValue,
              ),
          },
        )
      : await saveMasterBracketPick(
          resolved.user,
          {
            competitionId:
              resolved.challenge
                .competition.id,
            bracketNumber, entrantId,
            contestStatus: resolved.challenge.contest.status, contestLockAt: resolved.challenge.contest.lockAt,
            gameKey:
              typeof body?.gameKey ===
              "string"
                ? body.gameKey.trim()
                : "",
            teamId:
              typeof body?.teamId ===
              "string"
                ? body.teamId.trim()
                : "",
          },
        );

    const admitted = await admitMasterBracketToContest(resolved.user, {
      contestId, competitionId: resolved.challenge.competition.id,
      entrantId: entrantId ?? (await listAccountEntrants(resolved.user)).find((entrant) => entrant.kind === "account")!.id,
      bracketNumber,
    });

    return NextResponse.json(
      {
        success: true,
        ...result,
        entryId: admitted.entryId,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error(
      "Failed to save bracket pick",
      error,
    );

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to save bracket pick.",
      },
      { status: 400 },
    );
  }
}

export async function POST(request: Request, context: { params: Promise<{ contestId: string }> }) {
  try {
    const { contestId } = await context.params;
    const resolved = await resolveContext(contestId);
    if ("error" in resolved) return resolved.error;
    const body = await request.json();
    if (body?.action !== "createManagedEntrant") return NextResponse.json({ success: false, error: "Unsupported action." }, { status: 400 });
    if (!resolved.challenge.contest.managedEntrantsAllowed) return NextResponse.json({ success: false, error: "Managed entrants are not allowed in this contest." }, { status: 400 });
    if (resolved.challenge.contest.status !== "open" && resolved.challenge.contest.status !== "setup") return NextResponse.json({ success: false, error: "This contest is not accepting entrants." }, { status: 400 });
    const entrant = await createManagedEntrant(resolved.user, typeof body?.displayName === "string" ? body.displayName : "");
    return NextResponse.json({ success: true, entrant }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Unable to create entrant." }, { status: 400 });
  }
}
