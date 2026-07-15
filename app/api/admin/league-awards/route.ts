import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/requireAdminApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type AwardRarity = "common" | "rare" | "epic" | "legendary";

type AwardBody = {
  id?: number;
  season?: number;
  teamId?: number;
  title?: string;
  emoji?: string;
  description?: string | null;
  rarity?: string;
  displayOrder?: number;
  featured?: boolean;
};

const VALID_RARITIES = new Set<AwardRarity>([
  "common",
  "rare",
  "epic",
  "legendary",
]);

function validateAward(body: AwardBody) {
  const season = Number(body.season);
  const teamId = Number(body.teamId);
  const title = String(body.title ?? "").trim();
  const emoji = String(body.emoji ?? "🏆").trim();
  const description = String(body.description ?? "").trim();
  const rarity = String(body.rarity ?? "common").trim() as AwardRarity;
  const displayOrder = Number(body.displayOrder ?? 0);
  const featured = Boolean(body.featured);

  if (!Number.isInteger(season) || season < 2023 || season > 2100) {
    return {
      error: "Enter a valid season between 2023 and 2100.",
    };
  }

  if (!Number.isInteger(teamId) || teamId <= 0) {
    return {
      error: "Choose an award winner.",
    };
  }

  if (!title || title.length > 80) {
    return {
      error: "Award title must contain 1–80 characters.",
    };
  }

  if (!emoji || emoji.length > 20) {
    return {
      error: "Choose an emoji of 20 characters or fewer.",
    };
  }

  if (description.length > 300) {
    return {
      error: "Description must be 300 characters or fewer.",
    };
  }

  if (!VALID_RARITIES.has(rarity)) {
    return {
      error: "Choose a valid rarity.",
    };
  }

  if (!Number.isInteger(displayOrder)) {
    return {
      error: "Display order must be a whole number.",
    };
  }

  return {
    values: {
      season,
      team_id: teamId,
      title,
      emoji,
      description: description || null,
      rarity,
      display_order: displayOrder,
      featured,
      updated_at: new Date().toISOString(),
    },
  };
}

export async function GET(request: Request) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const seasonParam = searchParams.get("season");
    const season = seasonParam ? Number(seasonParam) : null;

    let query = supabaseAdmin
      .from("league_awards")
      .select(
        `
          id,
          season,
          team_id,
          title,
          emoji,
          description,
          rarity,
          display_order,
          featured,
          created_at,
          updated_at,
          teams (
            id,
            name
          )
        `
      )
      .order("season", { ascending: false })
      .order("featured", { ascending: false })
      .order("display_order", { ascending: true })
      .order("id", { ascending: true });

    if (season && Number.isInteger(season)) {
      query = query.eq("season", season);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: `Unable to load league awards: ${error.message}` },
        { status: 500 }
      );
    }

    const { data: teams, error: teamsError } = await supabaseAdmin
      .from("teams")
      .select("id, name")
      .order("name", { ascending: true });

    if (teamsError) {
      return NextResponse.json(
        { error: `Unable to load teams: ${teamsError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      awards: data ?? [],
      teams: teams ?? [],
    });
  } catch (error) {
    console.error("Failed to load league awards", error);

    return NextResponse.json(
      { error: "Unable to load league awards." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const body = (await request.json()) as AwardBody;
    const validation = validateAward(body);

    if ("error" in validation) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("league_awards")
      .insert(validation.values)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Unable to create award: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      award: data,
    });
  } catch (error) {
    console.error("Failed to create league award", error);

    return NextResponse.json(
      { error: "Unable to create league award." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const body = (await request.json()) as AwardBody;
    const id = Number(body.id);

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { error: "A valid award ID is required." },
        { status: 400 }
      );
    }

    const validation = validateAward(body);

    if ("error" in validation) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("league_awards")
      .update(validation.values)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json(
        { error: `Unable to update award: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      award: data,
    });
  } catch (error) {
    console.error("Failed to update league award", error);

    return NextResponse.json(
      { error: "Unable to update league award." },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    const id = Number(searchParams.get("id"));

    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json(
        { error: "A valid award ID is required." },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("league_awards")
      .delete()
      .eq("id", id);

    if (error) {
      return NextResponse.json(
        { error: `Unable to delete award: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
    });
  } catch (error) {
    console.error("Failed to delete league award", error);

    return NextResponse.json(
      { error: "Unable to delete league award." },
      { status: 500 }
    );
  }
}
