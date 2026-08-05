import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

export const dynamic =
  "force-dynamic";

export async function GET(
  request: NextRequest,
) {
  const tournamentId =
    request.nextUrl.searchParams
      .get("tournamentId")
      ?.trim()
      .toUpperCase() ?? "";

  if (
    !/^R\d{7}$/.test(
      tournamentId,
    )
  ) {
    return NextResponse.json(
      {
        error:
          "A valid tournamentId is required.",
      },
      { status: 400 },
    );
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("shotcast_manifests")
    .select("manifest")
    .eq(
      "tournament_id",
      tournamentId,
    )
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 },
    );
  }

  if (!data?.manifest) {
    return NextResponse.json(
      {
        error:
          "ShotCast manifest not found.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    data.manifest,
    {
      headers: {
        "Cache-Control":
          "no-store, max-age=0",
      },
    },
  );
}
