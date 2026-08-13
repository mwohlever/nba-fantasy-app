import {
  NextRequest,
  NextResponse,
} from "next/server";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireAdminApi } from "@/lib/requireAdminApi";
import {
  fetchPgaTourField,
  type PgaTourFieldPlayer,
} from "@/lib/providers/pgaTourField";

import {
  fetchPgaTourCourseMetadata,
} from "@/lib/shotcast/importShotCastManifest";

import {
  upsertGolfCourseHoles,
} from "@/lib/golf/upsertGolfCourseHoles";

type RequestBody = {
  slateId?: number | string;
};

type SlateRow = {
  id: number;
  sport: string;
  display_name: string | null;
  start_date: string;
  external_event_id: string | null;
  is_locked: boolean;
};

type ExistingGolfPlayer = {
  id: number;
  display_name: string;
  espn_player_id: string;
};

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function parseSlateId(
  value: unknown,
) {
  const parsed = Number(value);

  return Number.isInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
}

function countryFlagUrl(
  countryCode: string | null,
) {
  const normalized =
    countryCode
      ?.trim()
      .toLowerCase();

  if (
    !normalized ||
    normalized.length !== 3
  ) {
    return null;
  }

  /*
   * Existing PGA/ESPN refreshes will replace this later
   * with their authoritative flag URL.
   */
  return null;
}

async function authorize(
  request: NextRequest,
) {
  const configuredSecret =
    process.env.GOLF_CRON_SECRET?.trim();

  const supplied =
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim();

  if (
    configuredSecret &&
    supplied === configuredSecret
  ) {
    return null;
  }

  return requireAdminApi();
}

export async function POST(
  request: NextRequest,
) {
  const authError =
    await authorize(request);

  if (authError) {
    return authError;
  }

  try {
    let body: RequestBody;

    try {
      body =
        (await request.json()) as RequestBody;
    } catch {
      return NextResponse.json(
        {
          error:
            "A valid JSON request body is required.",
        },
        { status: 400 },
      );
    }

    const slateId =
      parseSlateId(body.slateId);

    if (!slateId) {
      return NextResponse.json(
        {
          error:
            "A valid slateId is required.",
        },
        { status: 400 },
      );
    }

    const {
      data: slateData,
      error: slateError,
    } = await supabaseAdmin
      .from("slates")
      .select(
        [
          "id",
          "sport",
          "display_name",
          "start_date",
          "external_event_id",
          "is_locked",
        ].join(","),
      )
      .eq("id", slateId)
      .single();

    if (
      slateError ||
      !slateData
    ) {
      return NextResponse.json(
        {
          error:
            slateError?.message ||
            "Slate not found.",
        },
        { status: 404 },
      );
    }

    const slate =
      slateData as unknown as SlateRow;

    if (slate.sport !== "golf") {
      return NextResponse.json(
        {
          error:
            "This endpoint only imports Golf fields.",
        },
        { status: 400 },
      );
    }

    if (slate.is_locked) {
      return NextResponse.json(
        {
          error:
            "This slate is locked.",
        },
        { status: 400 },
      );
    }

    const tournamentName =
      slate.display_name?.trim();

    const year =
      slate.start_date?.slice(0, 4);

    if (
      !tournamentName ||
      !/^\d{4}$/.test(year)
    ) {
      return NextResponse.json(
        {
          error:
            "The slate needs a tournament name and valid start date.",
        },
        { status: 400 },
      );
    }

    const field =
      await fetchPgaTourField({
        year,
        tournamentName,
      });

    /*
     * Course scorecard metadata belongs to tournament setup,
     * not live scoring.
     *
     * The PGA field lookup above already resolved the official
     * PGA tournament ID, so use that same ID to load and persist
     * all 18 pars/yardages before play begins.
     */
    const courseMetadata =
      await fetchPgaTourCourseMetadata({
        tournamentId:
          field.tournamentId,
        round: 1,
      });

    const courseSync =
      await upsertGolfCourseHoles({
        slateId,
        metadata: {
          courseId:
            courseMetadata.courseId,
          courseName:
            courseMetadata.courseName,
          isHost:
            courseMetadata.isHost,
          holes:
            courseMetadata.holes,
        },
      });

    const {
      data: existingData,
      error: existingError,
    } = await supabaseAdmin
      .from("golf_players")
      .select(
        "id, display_name, espn_player_id",
      );

    if (existingError) {
      return NextResponse.json(
        {
          error:
            "The PGA field was downloaded, but existing golfers could not be loaded: " +
            existingError.message,
        },
        { status: 500 },
      );
    }

    const existingPlayers =
      (existingData ?? []) as unknown as ExistingGolfPlayer[];

    const existingByName =
      new Map<
        string,
        ExistingGolfPlayer[]
      >();

    for (
      const player of existingPlayers
    ) {
      const key =
        normalizeName(
          player.display_name,
        );

      const matches =
        existingByName.get(key) ?? [];

      matches.push(player);
      existingByName.set(
        key,
        matches,
      );
    }

    const refreshedAt =
      new Date().toISOString();

    const resolvedPlayerIds =
      new Map<string, number>();

    const ambiguousPlayers: Array<{
      pgaPlayerId: string;
      displayName: string;
      databaseMatches: number[];
    }> = [];

    const missingPlayers: PgaTourFieldPlayer[] =
      [];

    for (
      const fieldPlayer of field.players
    ) {
      const possibleMatches =
        existingByName.get(
          normalizeName(
            fieldPlayer.displayName,
          ),
        ) ?? [];

      if (
        possibleMatches.length === 1
      ) {
        resolvedPlayerIds.set(
          fieldPlayer.pgaPlayerId,
          Number(
            possibleMatches[0].id,
          ),
        );
      } else if (
        possibleMatches.length > 1
      ) {
        ambiguousPlayers.push({
          pgaPlayerId:
            fieldPlayer.pgaPlayerId,
          displayName:
            fieldPlayer.displayName,
          databaseMatches:
            possibleMatches.map(
              (player) =>
                Number(player.id),
            ),
        });
      } else {
        missingPlayers.push(
          fieldPlayer,
        );
      }
    }

    if (
      ambiguousPlayers.length > 0
    ) {
      return NextResponse.json(
        {
          error:
            "The field contains golfer names that match multiple database records.",
          ambiguousPlayers,
        },
        { status: 409 },
      );
    }

    let createdGolfers = 0;

    if (
      missingPlayers.length > 0
    ) {
      const newRows =
        missingPlayers.map(
          (player) => ({
            /*
             * ESPN IDs are mandatory in the existing schema.
             * This stable placeholder is reconciled to the real
             * ESPN ID by refresh-stats-golf once ESPN publishes
             * the tournament competitor feed.
             */
            espn_player_id:
              `pga:${player.pgaPlayerId}`,
            display_name:
              player.displayName,
            short_name:
              player.shortName,
            country:
              player.country,
            country_flag_url:
              countryFlagUrl(
                player.countryCode,
              ),
            player_url:
              `https://www.pgatour.com/player/` +
              `${player.pgaPlayerId}`,
            headshot_url:
              player.headshotUrl,
            owgr_player_id:
              player.pgaPlayerId,
            owgr_rank:
              player.owgrRank,
            owgr_points:
              player.rankingPoints,
            owgr_updated_at:
              refreshedAt,
            is_active: true,
            updated_at:
              refreshedAt,
          }),
        );

      const {
        data: insertedData,
        error: insertedError,
      } = await supabaseAdmin
        .from("golf_players")
        .upsert(newRows, {
          onConflict:
            "espn_player_id",
        })
        .select(
          "id, espn_player_id",
        );

      if (insertedError) {
        return NextResponse.json(
          {
            error:
              "Missing PGA field golfers could not be created: " +
              insertedError.message,
          },
          { status: 500 },
        );
      }

      const inserted =
        (insertedData ??
          []) as unknown as Array<{
          id: number;
          espn_player_id: string;
        }>;

      createdGolfers =
        inserted.length;

      for (
        const player of inserted
      ) {
        const pgaPlayerId =
          player.espn_player_id.replace(
            /^pga:/,
            "",
          );

        resolvedPlayerIds.set(
          pgaPlayerId,
          Number(player.id),
        );
      }
    }

    const unresolved =
      field.players.filter(
        (player) =>
          !resolvedPlayerIds.has(
            player.pgaPlayerId,
          ),
      );

    if (unresolved.length > 0) {
      return NextResponse.json(
        {
          error:
            "Some PGA field golfers could not be resolved to database IDs.",
          unresolvedPlayers:
            unresolved.map(
              (player) => ({
                pgaPlayerId:
                  player.pgaPlayerId,
                displayName:
                  player.displayName,
              }),
            ),
        },
        { status: 500 },
      );
    }

    const eventRows =
      field.players.map(
        (player, index) => ({
          slate_id: slateId,
          player_id:
            resolvedPlayerIds.get(
              player.pgaPlayerId,
            )!,
          leaderboard_order:
            index + 1,
          official_score_to_par:
            null,
          official_score_display:
            null,
          penalty_strokes: 0,
          fantasy_score: null,
          rounds_completed: 0,
          holes_completed: 0,
          current_round: null,
          last_hole: null,
          status: "scheduled",
          tee_time: null,
          tee_time_raw: null,
          updated_at:
            refreshedAt,
        }),
      );

    const {
      data: eventData,
      error: eventError,
    } = await supabaseAdmin
      .from("golf_event_players")
      .upsert(eventRows, {
        onConflict:
          "slate_id,player_id",
      })
      .select("id");

    if (eventError) {
      return NextResponse.json(
        {
          error:
            "The golfers were saved, but the slate field could not be populated: " +
            eventError.message,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      slateId,
      tournament: {
        pgaTournamentId:
          field.tournamentId,
        name:
          field.tournamentName,
        fieldUrl:
          field.fieldUrl,
      },
      fieldPlayersFound:
        field.players.length,
      existingGolfersMatched:
        field.players.length -
        missingPlayers.length,
      createdGolfers,
      eventPlayersUpserted:
        eventData?.length ??
        eventRows.length,
      course: {
        id:
          courseSync.courseId,
        name:
          courseSync.courseName,
        holesUpserted:
          courseSync.holesUpserted,
      },
      importedAt:
        refreshedAt,
      preview:
        field.players
          .slice(0, 10)
          .map((player) => ({
            pgaPlayerId:
              player.pgaPlayerId,
            displayName:
              player.displayName,
            owgrRank:
              player.owgrRank,
            qualifier:
              player.qualifier,
          })),
    });
  } catch (error) {
    console.error(
      "PGA TOUR field import failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected PGA TOUR field import error.",
      },
      { status: 500 },
    );
  }
}
