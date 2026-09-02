import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { requireSuperAdminApi } from "@/lib/requireAdminApi";
import {
  fetchEspnGolfWorldRankings,
  type GolfWorldRanking,
} from "@/lib/providers/golfRankings";

type GolfPlayerRow = {
  id: number;
  display_name: string;
  espn_player_id: string | null;
};

function normalizeName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\b(jr|sr|ii|iii|iv)\b/gi, "")
    .replace(/[^a-z0-9]+/gi, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function buildRankingMaps(
  rankings: GolfWorldRanking[],
) {
  const byEspnId = new Map<string, GolfWorldRanking>();
  const byNormalizedName = new Map<
    string,
    GolfWorldRanking[]
  >();

  for (const ranking of rankings) {
    if (ranking.espnPlayerId) {
      byEspnId.set(
        String(ranking.espnPlayerId),
        ranking,
      );
    }

    const normalizedName = normalizeName(
      ranking.playerName,
    );

    const existing =
      byNormalizedName.get(normalizedName) ?? [];

    existing.push(ranking);
    byNormalizedName.set(normalizedName, existing);
  }

  return {
    byEspnId,
    byNormalizedName,
  };
}

export async function POST() {
  const authError = await requireSuperAdminApi();
  if (authError) return authError;

  try {
    const rankingResult =
      await fetchEspnGolfWorldRankings(200);

    const rankings = rankingResult.rankings;
    const now = new Date().toISOString();

    /*
     * Read existing ESPN IDs before the upsert so the response can report
     * how many ranked golfers were newly created.
     */
    const { data: existingPlayerData, error: existingPlayerError } =
      await supabaseAdmin
        .from("golf_players")
        .select("id, espn_player_id");

    if (existingPlayerError) {
      return NextResponse.json(
        {
          error:
            "Rankings were downloaded, but existing golfers could not be loaded: " +
            existingPlayerError.message,
        },
        { status: 500 },
      );
    }

    const existingEspnIds = new Set(
      (existingPlayerData ?? [])
        .map((player) =>
          String(player.espn_player_id ?? "").trim(),
        )
        .filter(Boolean),
    );

    /*
     * ESPN IDs are required by golf_players, so every ranking that includes
     * an ESPN identity can safely be created or updated here.
     *
     * Rankings without an ESPN ID can still be matched to an existing golfer
     * by normalized name later, but are not inserted as speculative records.
     */
    const rankedPlayerRows = rankings
      .filter(
        (ranking) =>
          Boolean(
            String(ranking.espnPlayerId ?? "").trim(),
          ),
      )
      .map((ranking) => {
        const espnPlayerId = String(
          ranking.espnPlayerId,
        );

        return {
          espn_player_id: espnPlayerId,
          display_name: ranking.playerName,
          short_name: ranking.playerName,
          player_url:
            `https://www.espn.com/golf/player/_/id/` +
            `${espnPlayerId}`,
          headshot_url:
            `https://a.espncdn.com/i/headshots/golf/players/full/` +
            `${espnPlayerId}.png`,
          owgr_player_id: espnPlayerId,
          owgr_rank: ranking.rank,
          owgr_points: ranking.points,
          owgr_updated_at: now,
          is_active: true,
          updated_at: now,
        };
      });

    let rankedRowsUpserted = 0;

    if (rankedPlayerRows.length > 0) {
      const { data: rankedUpsertData, error: rankedUpsertError } =
        await supabaseAdmin
          .from("golf_players")
          .upsert(rankedPlayerRows, {
            onConflict: "espn_player_id",
          })
          .select("id");

      if (rankedUpsertError) {
        return NextResponse.json(
          {
            error:
              "Rankings were downloaded, but ranked golfers could not be saved: " +
              rankedUpsertError.message,
          },
          { status: 500 },
        );
      }

      rankedRowsUpserted =
        rankedUpsertData?.length ?? 0;
    }

    const createdGolfers = rankedPlayerRows.filter(
      (row) =>
        !existingEspnIds.has(row.espn_player_id),
    ).length;

    /*
     * Reload after the upsert. This list now includes tournament entrants
     * plus ranked golfers who were not in the current tournament.
     */
    const { data: golferData, error: golferError } =
      await supabaseAdmin
        .from("golf_players")
        .select(
          "id, display_name, espn_player_id",
        )
        .eq("is_active", true);

    if (golferError) {
      return NextResponse.json(
        {
          error:
            "Ranked golfers were saved, but the full player list could not be loaded: " +
            golferError.message,
        },
        { status: 500 },
      );
    }

    const golfers =
      (golferData ?? []) as GolfPlayerRow[];

    const {
      byEspnId,
      byNormalizedName,
    } = buildRankingMaps(rankings);

    const matchedRankingKeys = new Set<string>();

    const ambiguousGolfers: Array<{
      golferId: number;
      golferName: string;
      possibleMatches: string[];
    }> = [];

    const unmatchedGolfers: Array<{
      golferId: number;
      golferName: string;
    }> = [];

    const updates: Array<{
      id: number;
      owgr_player_id: string | null;
      owgr_rank: number;
      owgr_points: number | null;
      owgr_updated_at: string;
    }> = [];

    for (const golfer of golfers) {
      let ranking: GolfWorldRanking | null = null;

      if (golfer.espn_player_id) {
        ranking =
          byEspnId.get(
            String(golfer.espn_player_id),
          ) ?? null;
      }

      if (!ranking) {
        const possibleMatches =
          byNormalizedName.get(
            normalizeName(golfer.display_name),
          ) ?? [];

        if (possibleMatches.length === 1) {
          ranking = possibleMatches[0];
        } else if (possibleMatches.length > 1) {
          ambiguousGolfers.push({
            golferId: golfer.id,
            golferName: golfer.display_name,
            possibleMatches:
              possibleMatches.map(
                (match) =>
                  `#${match.rank} ${match.playerName}`,
              ),
          });

          continue;
        }
      }

      if (!ranking) {
        unmatchedGolfers.push({
          golferId: golfer.id,
          golferName: golfer.display_name,
        });

        continue;
      }

      const rankingKey =
        ranking.espnPlayerId ??
        `${ranking.rank}:${normalizeName(
          ranking.playerName,
        )}`;

      matchedRankingKeys.add(rankingKey);

      updates.push({
        id: golfer.id,
        owgr_player_id:
          ranking.espnPlayerId ?? null,
        owgr_rank: ranking.rank,
        owgr_points: ranking.points,
        owgr_updated_at: now,
      });
    }

    const updateErrors: Array<{
      golferId: number;
      error: string;
    }> = [];

    let updatedCount = 0;

    for (const update of updates) {
      const { error } = await supabaseAdmin
        .from("golf_players")
        .update({
          owgr_player_id:
            update.owgr_player_id,
          owgr_rank: update.owgr_rank,
          owgr_points: update.owgr_points,
          owgr_updated_at:
            update.owgr_updated_at,
        })
        .eq("id", update.id);

      if (error) {
        updateErrors.push({
          golferId: update.id,
          error: error.message,
        });
      } else {
        updatedCount += 1;
      }
    }

    const unmatchedRankings =
      rankings.filter((ranking) => {
        const rankingKey =
          ranking.espnPlayerId ??
          `${ranking.rank}:${normalizeName(
            ranking.playerName,
          )}`;

        return !matchedRankingKeys.has(rankingKey);
      });

    return NextResponse.json({
      success: updateErrors.length === 0,
      provider: "ESPN",
      rankingLimit: 200,
      rankingsFound: rankings.length,
      rankingRowsWithEspnIds:
        rankedPlayerRows.length,
      rankedRowsUpserted,
      createdGolfers,
      activeGolfersChecked: golfers.length,
      matchedGolfers: updates.length,
      updatedGolfers: updatedCount,
      unmatchedGolfers:
        unmatchedGolfers.length,
      ambiguousGolfers:
        ambiguousGolfers.length,
      unmatchedRankings:
        unmatchedRankings.length,
      updatedAt: now,
      pagesAttempted:
        rankingResult.pagesAttempted,
      pageErrors:
        rankingResult.pageErrors,
      details: {
        unmatchedGolfers:
          unmatchedGolfers.slice(0, 30),
        ambiguousGolfers:
          ambiguousGolfers.slice(0, 30),
        unmatchedRankings:
          unmatchedRankings
            .slice(0, 30)
            .map((ranking) => ({
              rank: ranking.rank,
              name: ranking.playerName,
              espnPlayerId:
                ranking.espnPlayerId,
            })),
        updateErrors:
          updateErrors.slice(0, 30),
      },
    });
  } catch (error) {
    console.error(
      "Golf rankings sync failed:",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unexpected Golf rankings sync error.",
      },
      { status: 500 },
    );
  }
}
