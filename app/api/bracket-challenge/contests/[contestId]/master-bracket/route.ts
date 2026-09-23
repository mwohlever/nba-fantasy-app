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
  renameMasterBracket,
  saveMasterBracketPick,
  saveMasterBracketTiebreaker,
} from "@/lib/bracket/masterBracket.server";
import { shouldFreezeBracketEntry } from "@/lib/bracket/lifecycle";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
    const entryId = Number(url.searchParams.get("entryId") ?? "");
    const entrantId = url.searchParams.get("entrantId");
    const bracketNumber = Number(url.searchParams.get("bracketNumber") ?? "1");

    if (!Number.isInteger(bracketNumber) || bracketNumber < 1) {
      throw new Error("Invalid bracket number.");
    }

    if (Number.isInteger(entryId) && entryId > 0) {
      const entryResult = await supabaseAdmin.from("bracket_entries")
        .select("id, entrant_id, master_bracket_id, status, locked_at, picks_snapshot, tiebreaker_value, bracket_master_brackets(bracket_number, name), bracket_entrants(account_user_id, managing_user_id, display_name)")
        .eq("id", entryId).eq("contest_id", contestId).eq("competition_id", resolved.challenge.competition.id).maybeSingle();
      if (entryResult.error) throw new Error(`Failed to load frozen bracket: ${entryResult.error.message}`);
      const entry = entryResult.data as any;
      if (!entry?.locked_at) return NextResponse.json({ success: false, error: "Frozen bracket not found." }, { status: 404 });
      const entrant = Array.isArray(entry.bracket_entrants) ? entry.bracket_entrants[0] : entry.bracket_entrants;
      const owner = entrant?.account_user_id === resolved.user.id || entrant?.managing_user_id === resolved.user.id;
      if (!shouldFreezeBracketEntry({ contestStatus: resolved.challenge.contest.status, contestLockAt: resolved.challenge.contest.lockAt }) && !owner) {
        return NextResponse.json({ success: false, error: "This bracket is private until the contest locks." }, { status: 403 });
      }
      return NextResponse.json({ success: true, entrants: [], selectedEntrantId: entry.entrant_id, contestEntry: { id: entry.id, status: entry.status, lockedAt: entry.locked_at },
        masterBracket: { id: entry.master_bracket_id, bracketNumber: Number((Array.isArray(entry.bracket_master_brackets) ? entry.bracket_master_brackets[0] : entry.bracket_master_brackets)?.bracket_number ?? 1), name: (Array.isArray(entry.bracket_master_brackets) ? entry.bracket_master_brackets[0] : entry.bracket_master_brackets)?.name ?? null, entrantName: entrant?.display_name ?? null, status: entry.status, tiebreakerValue: entry.tiebreaker_value, picks: entry.picks_snapshot ?? {}, readOnly: !owner } }, { headers: { "Cache-Control": "no-store" } });
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
    const namesResult = await supabaseAdmin.from("bracket_master_brackets")
      .select("bracket_number, name")
      .eq("competition_id", resolved.challenge.competition.id)
      .eq("entrant_id", selectedEntrantId);
    if (namesResult.error) throw new Error(`Failed to load bracket names: ${namesResult.error.message}`);
    const entry = await getContestEntryForMaster(contestId, masterBracket.id);
    if (entry) await maybeFreezeContestEntry({ entryId: entry.id, contestStatus: resolved.challenge.contest.status, contestLockAt: resolved.challenge.contest.lockAt });
    const frozen = entry ? await getFrozenEntrySnapshot(entry.id) : null;

    return NextResponse.json(
      {
        success: true,
        entrants,
        selectedEntrantId,
        bracketNames: Object.fromEntries((namesResult.data ?? []).map((row) => [row.bracket_number, row.name])),
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

    if (body?.action === "rename") {
      if (!entrantId) throw new Error("Entrant is required to rename a bracket.");
      const renamed = await renameMasterBracket(resolved.user, {
        competitionId: resolved.challenge.competition.id, entrantId, bracketNumber, name: body.name,
      });
      return NextResponse.json({ success: true, ...renamed }, { headers: { "Cache-Control": "no-store" } });
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
