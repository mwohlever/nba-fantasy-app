import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AppUser } from "@/lib/auth";
import type { BracketPicks } from "@/lib/bracket/types";
import { applyBracketPick } from "@/lib/bracket/dependencies";
import { bracketTopologyFromRows } from "@/lib/bracket/persistence";

type EntrantRow = {
  id: string;
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

export async function getOrCreateMasterBracket(
  user: AppUser,
  competitionId: number,
  bracketNumber = 1,
): Promise<{
  id: string;
  bracketNumber: number;
  name: string | null;
  status: string;
  tiebreakerValue: number | null;
  picks: BracketPicks;
}> {
  const entrant =
    await getOrCreateAccountEntrant(user);

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

export async function saveMasterBracketPick(
  user: AppUser,
  input: {
    competitionId: number;
    bracketNumber: number;
    gameKey: string;
    teamId: string;
  },
) {
  const master =
    await getOrCreateMasterBracket(
      user,
      input.competitionId,
      input.bracketNumber,
    );

  if (master.status !== "draft") {
    throw new Error(
      "This bracket can no longer be edited.",
    );
  }

  const gamesResult = await supabaseAdmin
    .from("bracket_games")
    .select(
      "id, game_key, round_key, round_order, game_order, source_a_team_id, source_a_game_id, source_b_team_id, source_b_game_id",
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
