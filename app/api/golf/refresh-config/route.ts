import {
  NextRequest,
  NextResponse,
} from "next/server";

import { getCurrentUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SlateRow = {
  id: number;
  sport: string;
  external_event_id: string | null;
  start_date: string;
  is_locked: boolean;
};

function parseSlateId(
  value: string | null,
): number | null {
  const parsed = Number(value);

  return Number.isInteger(parsed) &&
    parsed > 0
    ? parsed
    : null;
}

export async function GET(
  request: NextRequest,
) {
  const user =
    await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        error: "Login required.",
      },
      {
        status: 401,
      },
    );
  }

  const slateId =
    parseSlateId(
      request.nextUrl.searchParams.get(
        "slateId",
      ),
    );

  if (!slateId) {
    return NextResponse.json(
      {
        error:
          "A valid slateId is required.",
      },
      {
        status: 400,
      },
    );
  }

  const {
    data,
    error,
  } = await supabaseAdmin
    .from("slates")
    .select(
      [
        "id",
        "sport",
        "external_event_id",
        "start_date",
        "is_locked",
      ].join(","),
    )
    .eq("id", slateId)
    .single();

  if (error || !data) {
    return NextResponse.json(
      {
        error: "Slate not found.",
      },
      {
        status: 404,
      },
    );
  }

  const slate =
    data as unknown as SlateRow;

  if (slate.sport !== "golf") {
    return NextResponse.json(
      {
        error:
          "This slate is not a Golf slate.",
      },
      {
        status: 400,
      },
    );
  }

  const eventId =
    slate.external_event_id?.trim();

  const year =
    slate.start_date
      ?.slice(0, 4)
      .trim();

  if (
    !eventId ||
    !/^\d+$/.test(eventId)
  ) {
    return NextResponse.json(
      {
        error:
          "This Golf slate does not have a valid ESPN event ID.",
      },
      {
        status: 400,
      },
    );
  }

  if (
    !year ||
    !/^\d{4}$/.test(year)
  ) {
    return NextResponse.json(
      {
        error:
          "This Golf slate does not have a valid tournament year.",
      },
      {
        status: 400,
      },
    );
  }

  return NextResponse.json({
    success: true,
    slateId,
    eventId,
    year,
    isLocked:
      Boolean(slate.is_locked),
  });
}
