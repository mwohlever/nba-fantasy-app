import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AppUser } from "@/lib/auth";
import type { BracketPicks } from "@/lib/bracket/types";
import { applyBracketPick } from "@/lib/bracket/dependencies";
import { bracketTopologyFromRows } from "@/lib/bracket/persistence";
import { canEditBracketGame, shouldFreezeBracketEntry } from "@/lib/bracket/lifecycle";
import { validateBracketPicks } from "@/lib/bracket/topology";
import { normalizeBracketName } from "@/lib/bracket/names";

type EntrantRow = {
  id: string;
  entrant_kind: "account" | "managed";
  display_name: string;
};

type MasterBracketRow = {
  id: string;
  competition_id: number;
  entrant_id: string;
  bracket_number: number;
  name: string | null;
  status: string;
  tiebreaker_value: number | null;
};

type GameRow = {
  id: number;
  game_key: string;
  round_key: string;
  round_order: number;
  game_order: number;
  source_a_team_id: string | null;
  source_a_game_id: number | null;
  source_b_team_id: string | null;
  source_b_game_id: number | null;
  lock_at?: string | null;
  status?: string;
};

type PickRow = {
  game_id: number;
  picked_team_id: string;
};

async function getOrCreateAccountEntrant(
  user: AppUser,
): Promise<EntrantRow> {
  const existing = await supabaseAdmin
    .from("bracket_entrants")
    .select("id")
    .eq("account_user_id", user.id)
    .maybeSingle();

  if (existing.error) {
    throw new Error(
      `Failed to load bracket entrant: ${existing.error.message}`,
    );
  }

  if (existing.data) {
    return existing.data as EntrantRow;
  }

  const inserted = await supabaseAdmin
    .from("bracket_entrants")
    .insert({
      entrant_kind: "account",
      display_name: user.displayName,
      account_user_id: user.id,
      managing_user_id: null,
      claimed_at: null,
      is_active: true,
    })
    .select("id")
    .single();

  if (inserted.error) {
    /*
     * Another request may have created the unique account entrant
     * between our read and insert. Re-read before treating it as
     * a real failure.
     */
    const raced = await supabaseAdmin
      .from("bracket_entrants")
      .select("id")
      .eq("account_user_id", user.id)
      .maybeSingle();

    if (!raced.error && raced.data) {
      return raced.data as EntrantRow;
    }

    throw new Error(
      `Failed to create bracket entrant: ${inserted.error.message}`,
    );
  }

  return inserted.data as EntrantRow;
}

export async function listAccountEntrants(user: AppUser) {
  const primary = await getOrCreateAccountEntrant(user);
  const result = await supabaseAdmin
    .from("bracket_entrants")
    .select("id, entrant_kind, display_name")
    .or(`account_user_id.eq.${user.id},managing_user_id.eq.${user.id}`)
    .eq("is_active", true)
    .order("created_at");
  if (result.error) throw new Error(`Failed to load bracket entrants: ${result.error.message}`);
  const entrants = (result.data ?? []) as EntrantRow[];
  if (!entrants.some((entrant) => entrant.id === primary.id)) {
    entrants.unshift({ ...primary, entrant_kind: "account", display_name: user.displayName });
  }
  return entrants.map((entrant) => ({ id: entrant.id, kind: entrant.entrant_kind, displayName: entrant.display_name }));
}

export async function createManagedEntrant(user: AppUser, displayName: string) {
  const name = displayName.trim();
  if (!name || name.length > 80) throw new Error("Entrant name must be from 1 to 80 characters.");
  const result = await supabaseAdmin.from("bracket_entrants").insert({
    entrant_kind: "managed", display_name: name, managing_user_id: user.id,
    account_user_id: null, claimed_at: null, is_active: true,
  }).select("id, entrant_kind, display_name").single();
  if (result.error) throw new Error(`Failed to create managed entrant: ${result.error.message}`);
  const entrant = result.data as EntrantRow;
  return { id: entrant.id, kind: entrant.entrant_kind, displayName: entrant.display_name };
}

async function requireOwnedEntrant(user: AppUser, entrantId: string) {
  const result = await supabaseAdmin.from("bracket_entrants").select("id, entrant_kind, display_name")
    .eq("id", entrantId).or(`account_user_id.eq.${user.id},managing_user_id.eq.${user.id}`).eq("is_active", true).maybeSingle();
  if (result.error || !result.data) throw new Error("You cannot manage this entrant.");
  return result.data as EntrantRow;
}

export async function renameMasterBracket(user: AppUser, input: {
  competitionId: number; entrantId: string; bracketNumber: number; name: unknown;
}) {
  await requireOwnedEntrant(user, input.entrantId);
  const name = normalizeBracketName(input.name);
  const result = await supabaseAdmin.from("bracket_master_brackets")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("competition_id", input.competitionId).eq("entrant_id", input.entrantId)
    .eq("bracket_number", input.bracketNumber)
    .select("id, name").maybeSingle();
  if (result.error) throw new Error(`Failed to rename bracket: ${result.error.message}`);
  if (!result.data) throw new Error("Bracket not found.");
  return { id: result.data.id, name: result.data.name as string | null };
}

export async function getOrCreateMasterBracket(
  user: AppUser,
  competitionId: number,
  bracketNumber = 1,
  entrantId?: string,
): Promise<{
  id: string;
  bracketNumber: number;
  name: string | null;
  status: string;
  tiebreakerValue: number | null;
  picks: BracketPicks;
}> {
  const entrant = entrantId
    ? await requireOwnedEntrant(user, entrantId)
    : await getOrCreateAccountEntrant(user);

  let masterResult = await supabaseAdmin
    .from("bracket_master_brackets")
    .select(
      "id, competition_id, entrant_id, bracket_number, name, status, tiebreaker_value",
    )
    .eq("competition_id", competitionId)
    .eq("entrant_id", entrant.id)
    .eq("bracket_number", bracketNumber)
    .maybeSingle();

  if (masterResult.error) {
    throw new Error(
      `Failed to load master bracket: ${masterResult.error.message}`,
    );
  }

  if (!masterResult.data) {
    const inserted = await supabaseAdmin
      .from("bracket_master_brackets")
      .insert({
        competition_id: competitionId,
        entrant_id: entrant.id,
        bracket_number: bracketNumber,
        status: "draft",
      })
      .select(
        "id, competition_id, entrant_id, bracket_number, name, status, tiebreaker_value",
      )
      .single();

    if (inserted.error) {
      /*
       * Same race protection as entrant creation: the unique
       * competition/entrant/bracket-number key is authoritative.
       */
      masterResult = await supabaseAdmin
        .from("bracket_master_brackets")
        .select(
          "id, competition_id, entrant_id, bracket_number, name, status, tiebreaker_value",
        )
        .eq("competition_id", competitionId)
        .eq("entrant_id", entrant.id)
        .eq("bracket_number", bracketNumber)
        .maybeSingle();

      if (
        masterResult.error ||
        !masterResult.data
      ) {
        throw new Error(
          `Failed to create master bracket: ${inserted.error.message}`,
        );
      }
    } else {
      masterResult = {
        data: inserted.data,
        error: null,
      } as typeof masterResult;
    }
  }

  const master =
    masterResult.data as MasterBracketRow;

  const picksResult = await supabaseAdmin
    .from("bracket_master_picks")
    .select("game_id, picked_team_id")
    .eq("master_bracket_id", master.id)
    .eq("competition_id", competitionId);

  if (picksResult.error) {
    throw new Error(
      `Failed to load master bracket picks: ${picksResult.error.message}`,
    );
  }

  const gamesResult = await supabaseAdmin
    .from("bracket_games")
    .select(
      "id, game_key, round_key, round_order, game_order, source_a_team_id, source_a_game_id, source_b_team_id, source_b_game_id",
    )
    .eq("competition_id", competitionId);

  if (gamesResult.error) {
    throw new Error(
      `Failed to load bracket games: ${gamesResult.error.message}`,
    );
  }

  const games =
    (gamesResult.data ?? []) as GameRow[];

  const gameKeyById = new Map(
    games.map((game) => [
      Number(game.id),
      game.game_key,
    ]),
  );

  const picks: BracketPicks = {};

  for (
    const row of
      (picksResult.data ?? []) as PickRow[]
  ) {
    const gameKey =
      gameKeyById.get(Number(row.game_id));

    if (gameKey) {
      picks[gameKey] =
        row.picked_team_id;
    }
  }

  return {
    id: master.id,
    bracketNumber:
      master.bracket_number,
    name: master.name,
    status: master.status,
    tiebreakerValue:
      master.tiebreaker_value,
    picks,
  };
}

export async function admitMasterBracketToContest(user: AppUser, input: { contestId: string; competitionId: number; entrantId: string; bracketNumber: number }) {
  const master = await getOrCreateMasterBracket(user, input.competitionId, input.bracketNumber, input.entrantId);
  const admission = await supabaseAdmin.rpc("admit_bracket_master_to_contest", { p_contest_id: input.contestId, p_master_bracket_id: master.id });
  if (admission.error) throw new Error(admission.error.message);
  return { ...master, entryId: Number(admission.data) };
}

export async function maybeFreezeContestEntry(input: { entryId: number; contestStatus: string; contestLockAt: string | null }) {
  if (!shouldFreezeBracketEntry({ contestStatus: input.contestStatus, contestLockAt: input.contestLockAt })) return;
  const entryResult = await supabaseAdmin.from("bracket_entries").select("competition_id, master_bracket_id").eq("id", input.entryId).single();
  if (entryResult.error || !entryResult.data) throw new Error("Failed to load bracket entry before freezing.");
  const [gamesResult, picksResult] = await Promise.all([
    supabaseAdmin.from("bracket_games").select("id, game_key, round_key, round_order, game_order, source_a_team_id, source_a_game_id, source_b_team_id, source_b_game_id").eq("competition_id", entryResult.data.competition_id),
    supabaseAdmin.from("bracket_master_picks").select("game_id, picked_team_id").eq("master_bracket_id", entryResult.data.master_bracket_id).eq("competition_id", entryResult.data.competition_id),
  ]);
  if (gamesResult.error || picksResult.error) throw new Error("Failed to validate bracket picks before freezing.");
  const rows = (gamesResult.data ?? []) as GameRow[];
  const byId = new Map(rows.map((game) => [game.id, game.game_key]));
  const picks: BracketPicks = {};
  for (const pick of (picksResult.data ?? []) as PickRow[]) {
    const gameKey = byId.get(pick.game_id);
    if (gameKey) picks[gameKey] = pick.picked_team_id;
  }
  validateBracketPicks(bracketTopologyFromRows(rows), picks);
  const result = await supabaseAdmin.rpc("freeze_bracket_entry", { p_entry_id: input.entryId });
  if (result.error) throw new Error(`Failed to freeze bracket entry: ${result.error.message}`);
}

export async function getFrozenEntrySnapshot(entryId: number) {
  const result = await supabaseAdmin.from("bracket_entries")
    .select("status, locked_at, picks_snapshot, tiebreaker_value")
    .eq("id", entryId).maybeSingle();
  if (result.error) throw new Error(`Failed to load bracket entry: ${result.error.message}`);
  const entry = result.data as { status: string; locked_at: string | null; picks_snapshot: BracketPicks | null; tiebreaker_value: number | null } | null;
  return entry?.locked_at ? entry : null;
}

export async function getContestEntryForMaster(contestId: string, masterBracketId: string) {
  const result = await supabaseAdmin.from("bracket_entries")
    .select("id, status, locked_at, picks_snapshot, tiebreaker_value")
    .eq("contest_id", contestId).eq("master_bracket_id", masterBracketId).maybeSingle();
  if (result.error) throw new Error(`Failed to load bracket entry: ${result.error.message}`);
  return result.data as { id: number; status: string; locked_at: string | null; picks_snapshot: BracketPicks | null; tiebreaker_value: number | null } | null;
}

export async function saveMasterBracketTiebreaker(
  user: AppUser,
  input: {
    competitionId: number;
    bracketNumber: number;
    entrantId?: string;
    contestStatus?: string;
    contestLockAt?: string | null;
    tiebreakerValue: number;
  },
) {
  const master =
    await getOrCreateMasterBracket(
      user,
      input.competitionId,
      input.bracketNumber,
      input.entrantId,
    );

  if (shouldFreezeBracketEntry({ contestStatus: input.contestStatus ?? "open", contestLockAt: input.contestLockAt ?? null })) {
    throw new Error(
      "This contest is locked and can no longer be edited.",
    );
  }

  if (
    !Number.isInteger(input.tiebreakerValue) ||
    input.tiebreakerValue < 0 ||
    input.tiebreakerValue > 999
  ) {
    throw new Error(
      "Championship total must be a whole number from 0 to 999.",
    );
  }

  const updateResult = await supabaseAdmin
    .from("bracket_master_brackets")
    .update({
      tiebreaker_value:
        input.tiebreakerValue,
      updated_at:
        new Date().toISOString(),
    })
    .eq("id", master.id)
    .eq(
      "competition_id",
      input.competitionId,
    );

  if (updateResult.error) {
    throw new Error(
      `Failed to save championship total: ${updateResult.error.message}`,
    );
  }

  return {
    masterBracketId: master.id,
    bracketNumber:
      master.bracketNumber,
    tiebreakerValue:
      input.tiebreakerValue,
  };
}

export async function saveMasterBracketPick(
  user: AppUser,
  input: {
    competitionId: number;
    bracketNumber: number;
    entrantId?: string;
    contestStatus?: string;
    contestLockAt?: string | null;
    gameKey: string;
    teamId: string;
  },
) {
  const master =
    await getOrCreateMasterBracket(
      user,
      input.competitionId,
      input.bracketNumber,
      input.entrantId,
    );


  const gamesResult = await supabaseAdmin
    .from("bracket_games")
    .select(
      "id, game_key, round_key, round_order, game_order, source_a_team_id, source_a_game_id, source_b_team_id, source_b_game_id, lock_at, status",
    )
    .eq("competition_id", input.competitionId)
    .order("round_order", {
      ascending: true,
    })
    .order("game_order", {
      ascending: true,
    });

  if (gamesResult.error) {
    throw new Error(
      `Failed to load bracket topology: ${gamesResult.error.message}`,
    );
  }

  const rows =
    (gamesResult.data ?? []) as GameRow[];

  const topology =
    bracketTopologyFromRows(rows);

  const gameByKey = new Map(
    rows.map((game) => [
      game.game_key,
      game,
    ]),
  );

  const targetGame =
    gameByKey.get(input.gameKey);

  if (!targetGame) {
    throw new Error(
      "Bracket game not found.",
    );
  }

  if (!canEditBracketGame({
    contest: { contestStatus: input.contestStatus ?? "open", contestLockAt: input.contestLockAt ?? null },
    gameLockAt: targetGame.lock_at ?? null,
    gameStatus: targetGame.status ?? "scheduled",
  })) throw new Error("This game is locked and can no longer be edited.");

  /*
   * The pure engine remains authoritative for eligibility and
   * downstream invalidation.
   */
  const change = applyBracketPick(
    topology,
    master.picks,
    input.gameKey,
    input.teamId,
  );

  const selectedTeam =
    change.picks[input.gameKey];

  if (!selectedTeam) {
    throw new Error(
      "Bracket pick could not be resolved.",
    );
  }

  const upsertResult = await supabaseAdmin
    .from("bracket_master_picks")
    .upsert(
      {
        master_bracket_id:
          master.id,
        competition_id:
          input.competitionId,
        game_id:
          targetGame.id,
        picked_team_id:
          selectedTeam,
        updated_at:
          new Date().toISOString(),
      },
      {
        onConflict:
          "master_bracket_id,game_id",
      },
    );

  if (upsertResult.error) {
    throw new Error(
      `Failed to save bracket pick: ${upsertResult.error.message}`,
    );
  }

  if (
    change.clearedGameIds.length >
    0
  ) {
    const clearedDbIds =
      change.clearedGameIds
        .map(
          (gameKey) =>
            gameByKey.get(gameKey)?.id,
        )
        .filter(
          (
            id,
          ): id is number =>
            typeof id === "number",
        );

    if (clearedDbIds.length > 0) {
      const clearResult =
        await supabaseAdmin
          .from(
            "bracket_master_picks",
          )
          .delete()
          .eq(
            "master_bracket_id",
            master.id,
          )
          .eq(
            "competition_id",
            input.competitionId,
          )
          .in(
            "game_id",
            clearedDbIds,
          );

      if (clearResult.error) {
        throw new Error(
          `Failed to clear invalid bracket picks: ${clearResult.error.message}`,
        );
      }
    }
  }

  return {
    masterBracketId: master.id,
    bracketNumber:
      master.bracketNumber,
    picks: change.picks,
    clearedGameIds:
      change.clearedGameIds,
  };
}
