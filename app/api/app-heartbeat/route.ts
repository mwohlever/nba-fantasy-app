import {
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  GET as refreshNcaa,
} from "@/app/api/cron/refresh-ncaa/route";

import {
  GET as checkNcaaReminders,
} from "@/app/api/cron/ncaa-pickem-reminders/route";

import {
  GET as refreshNbaSkins,
} from "@/app/api/cron/refresh-nba-skins/route";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const maxDuration =
  60;

export async function POST() {
  const user =
    await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        skipped: true,
        reason:
          "Login required.",
      },
      {
        status: 401,
      },
    );
  }

  const secret =
    process.env
      .GOLF_CRON_SECRET
      ?.trim();

  if (!secret) {
    console.error(
      "App heartbeat cannot run because GOLF_CRON_SECRET is not configured.",
    );

    return NextResponse.json(
      {
        success: false,
        error:
          "App heartbeat is not configured.",
      },
      {
        status: 500,
      },
    );
  }

  const headers = {
    authorization:
      `Bearer ${secret}`,
  };

  const results: {
    ncaaRefresh: unknown;
    ncaaReminders: unknown;
    nbaSkinsRefresh: unknown;
  } = {
    ncaaRefresh: null,
    ncaaReminders: null,
    nbaSkinsRefresh: null,
  };

  /*
   * Keep maintenance failures isolated.
   *
   * ESPN refresh trouble should not prevent reminder checks,
   * and notification trouble should not prevent score refresh.
   */
  try {
    const refreshResponse =
      await refreshNcaa(
        new Request(
          "http://internal/api/cron/refresh-ncaa",
          {
            method: "GET",
            headers,
          },
        ),
      );

    try {
      results.ncaaRefresh =
        await refreshResponse.json();
    } catch {
      results.ncaaRefresh = {
        success: false,
        status:
          refreshResponse.status,
        error:
          "Unreadable NCAA refresh response.",
      };
    }
  } catch (error) {
    console.error(
      "App heartbeat NCAA refresh failed",
      error,
    );

    results.ncaaRefresh = {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unexpected NCAA refresh failure.",
    };
  }

  try {
    const reminderResponse =
      await checkNcaaReminders(
        new Request(
          "http://internal/api/cron/ncaa-pickem-reminders",
          {
            method: "GET",
            headers,
          },
        ),
      );

    try {
      results.ncaaReminders =
        await reminderResponse.json();
    } catch {
      results.ncaaReminders = {
        success: false,
        status:
          reminderResponse.status,
        error:
          "Unreadable NCAA reminder response.",
      };
    }
  } catch (error) {
    console.error(
      "App heartbeat NCAA reminder check failed",
      error,
    );

    results.ncaaReminders = {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Unexpected NCAA reminder failure.",
    };
  }

  /*
   * NBA Skins is season-long rather than slate-based.
   *
   * The refresh route itself skips automatically until a
   * complete annual draft exists, so it is safe to include
   * in the same global heartbeat.
   */
  try {
    const skinsResponse =
      await refreshNbaSkins(
        new Request(
          "http://internal/api/cron/refresh-nba-skins",
          {
            method: "GET",
            headers,
          },
        ),
      );

    try {
      results.nbaSkinsRefresh =
        await skinsResponse.json();
    } catch {
      results.nbaSkinsRefresh = {
        success: false,
        status:
          skinsResponse.status,
        error:
          "Unreadable NBA Skins refresh response.",
      };
    }
  } catch (error) {
    console.error(
      "App heartbeat NBA Skins refresh failed",
      error,
    );

    results.nbaSkinsRefresh = {
      success: false,

      error:
        error instanceof Error
          ? error.message
          : "Unexpected NBA Skins refresh failure.",
    };
  }


  return NextResponse.json(
    {
      success: true,
      checkedAt:
        new Date()
          .toISOString(),
      ...results,
    },
    {
      headers: {
        "Cache-Control":
          "no-store, max-age=0",
      },
    },
  );
}
