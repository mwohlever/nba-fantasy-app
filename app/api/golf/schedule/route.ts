import { NextRequest, NextResponse } from "next/server";
import { fetchGolfSchedule } from "@/lib/providers/golf";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const year =
      searchParams.get("year") ??
      String(new Date().getUTCFullYear());

    if (!/^\d{4}$/.test(year)) {
      return NextResponse.json(
        { error: "Invalid year." },
        { status: 400 }
      );
    }

    const schedule = await fetchGolfSchedule(year);

    return NextResponse.json({
      success: true,
      year,
      tournaments: schedule.map((event) => ({
        eventId: event.espnEventId,
        name: event.name,
        startDate: event.startDate,
        endDate: event.endDate,
      })),
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unknown golf schedule error.",
      },
      {
        status: 500,
      }
    );
  }
}
