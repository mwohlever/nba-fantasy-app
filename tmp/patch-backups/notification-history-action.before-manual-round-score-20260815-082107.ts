import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  notifyNewlyFinishedPlayers,
} from "@/lib/playerFinishedNotifications";
import {
  sendPushToUser,
  type PushResult,
} from "@/lib/push";
import { requireAdminApi } from "@/lib/requireAdminApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type RecoveryBody = {
  action?: unknown;
  historyId?: unknown;
  eventKey?: unknown;
};

function deliveryStatus(
  result: PushResult
) {
  if (result.skipped) {
    return "skipped";
  }

  if (
    result.sent > 0 &&
    result.failed > 0
  ) {
    return "partial";
  }

  if (result.sent > 0) {
    return "sent";
  }

  return "failed";
}

function notificationUrl(
  notificationType: string,
  slateId: number | null
) {
  if (
    notificationType === "draft_turn" ||
    notificationType ===
      "draft_final_pick"
  ) {
    return slateId
      ? `/lineups/draft?slateId=${slateId}`
      : "/lineups/draft";
  }

  if (slateId) {
    return `/lineups/scores?slateId=${slateId}`;
  }

  return "/";
}

function notificationTag(
  eventKey: string | null,
  historyId: string
) {
  if (eventKey) {
    return eventKey
      .replaceAll(":", "-")
      .replaceAll("_", "-");
  }

  return `notification-retry-${historyId}`;
}

async function retryHistoryRow(
  historyId: string
) {
  const {
    data: history,
    error: historyError,
  } = await supabaseAdmin
    .from("notification_history")
    .select(
      `
        id,
        event_key,
        notification_type,
        user_id,
        slate_id,
        title,
        body,
        status,
        sent_count,
        failed_count,
        metadata
      `
    )
    .eq("id", historyId)
    .maybeSingle();

  if (historyError) {
    throw new Error(
      `Failed to load notification: ${historyError.message}`
    );
  }

  if (!history) {
    return NextResponse.json(
      {
        error:
          "Notification history record was not found.",
      },
      { status: 404 }
    );
  }

  if (
    history.status !== "failed" &&
    history.status !== "partial"
  ) {
    return NextResponse.json(
      {
        error:
          "Only failed or partial notifications can be retried.",
      },
      { status: 409 }
    );
  }

  if (!history.user_id) {
    return NextResponse.json(
      {
        error:
          "This notification has no recipient account.",
      },
      { status: 409 }
    );
  }

  /*
   * Retry the existing event rather than inserting a second
   * notification_history row. This preserves the event-key
   * dedupe record while allowing manual recovery.
   */
  await supabaseAdmin
    .from("notification_history")
    .update({
      status: "pending",
      reason:
        "Manual retry in progress.",
      completed_at: null,
    })
    .eq("id", history.id);

  try {
    const result =
      await sendPushToUser(
        String(history.user_id),
        {
          title: String(history.title),
          body: String(history.body),
          url: notificationUrl(
            String(
              history.notification_type
            ),
            history.slate_id === null
              ? null
              : Number(
                  history.slate_id
                )
          ),
          tag: notificationTag(
            history.event_key
              ? String(
                  history.event_key
                )
              : null,
            String(history.id)
          ),
        }
      );

    const previousMetadata =
      history.metadata &&
      typeof history.metadata ===
        "object"
        ? history.metadata
        : {};

    await supabaseAdmin
      .from("notification_history")
      .update({
        status:
          deliveryStatus(result),
        sent_count:
          Number(
            history.sent_count ?? 0
          ) + result.sent,
        failed_count:
          result.failed,
        skipped:
          result.skipped,
        reason:
          result.reason ?? null,
        metadata: {
          ...previousMetadata,
          devices:
            result.devices,
          manuallyRetriedAt:
            new Date().toISOString(),
        },
        completed_at:
          new Date().toISOString(),
      })
      .eq("id", history.id);

    return NextResponse.json({
      success: true,
      action: "retry",
      result,
    });
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "Unexpected retry error.";

    await supabaseAdmin
      .from("notification_history")
      .update({
        status: "failed",
        reason,
        completed_at:
          new Date().toISOString(),
      })
      .eq("id", history.id);

    throw error;
  }
}

async function sendMissedGolfEvent(
  eventKey: string
) {
  const match =
    /^player_finished:(\d+):(\d+):round-(\d+)$/.exec(
      eventKey
    );

  if (!match) {
    return NextResponse.json(
      {
        error:
          "Manual Send currently supports missed Golf round-finished events only.",
      },
      { status: 400 }
    );
  }

  const slateId =
    Number(match[1]);

  const playerId =
    Number(match[2]);

  const roundNumber =
    Number(match[3]);

  if (
    !Number.isInteger(slateId) ||
    !Number.isInteger(playerId) ||
    !Number.isInteger(roundNumber) ||
    roundNumber < 1 ||
    roundNumber > 4
  ) {
    return NextResponse.json(
      {
        error:
          "Invalid Golf notification event key.",
      },
      { status: 400 }
    );
  }

  /*
   * Race protection:
   * if the normal refresh path fired after the monitor loaded,
   * do not create a second event.
   */
  const {
    data: existingHistory,
    error: existingHistoryError,
  } = await supabaseAdmin
    .from("notification_history")
    .select("id, status")
    .eq("event_key", eventKey)
    .maybeSingle();

  if (existingHistoryError) {
    throw new Error(
      `Failed to check notification history: ${existingHistoryError.message}`
    );
  }

  if (existingHistory) {
    return NextResponse.json(
      {
        error:
          "This notification event has already reached the delivery pipeline. Refresh the monitor.",
      },
      { status: 409 }
    );
  }

  const [
    {
      data: slate,
      error: slateError,
    },
    {
      data: player,
      error: playerError,
    },
    {
      data: eventPlayer,
      error: eventPlayerError,
    },
    {
      data: lineups,
      error: lineupsError,
    },
  ] = await Promise.all([
    supabaseAdmin
      .from("slates")
      .select(
        "id, date, start_date, end_date, sport, display_name"
      )
      .eq("id", slateId)
      .eq("sport", "golf")
      .maybeSingle(),

    supabaseAdmin
      .from("golf_players")
      .select(
        "id, display_name"
      )
      .eq("id", playerId)
      .maybeSingle(),

    supabaseAdmin
      .from("golf_event_players")
      .select(
        "id, rounds_completed, official_score_to_par"
      )
      .eq("slate_id", slateId)
      .eq("player_id", playerId)
      .maybeSingle(),

    supabaseAdmin
      .from("lineups")
      .select(
        `
          team_id,
          lineup_players (
            player_id
          )
        `
      )
      .eq("slate_id", slateId),
  ]);

  if (
    slateError ||
    playerError ||
    eventPlayerError ||
    lineupsError
  ) {
    const reason =
      slateError?.message ??
      playerError?.message ??
      eventPlayerError?.message ??
      lineupsError?.message ??
      "Unknown lookup error.";

    throw new Error(
      `Failed to validate missed Golf notification: ${reason}`
    );
  }

  if (
    !slate ||
    !player ||
    !eventPlayer
  ) {
    return NextResponse.json(
      {
        error:
          "The Golf event could not be reconstructed.",
      },
      { status: 404 }
    );
  }

  const {
    data: persistedRound,
    error: roundError,
  } = await supabaseAdmin
    .from("golf_rounds")
    .select(
      "round_number, holes_completed"
    )
    .eq(
      "event_player_id",
      Number(eventPlayer.id)
    )
    .eq(
      "round_number",
      roundNumber
    )
    .maybeSingle();

  if (roundError) {
    throw new Error(
      `Failed to verify completed Golf round: ${roundError.message}`
    );
  }

  const roundComplete =
    Number(
      eventPlayer.rounds_completed ??
        0
    ) >= roundNumber ||
    Number(
      persistedRound
        ?.holes_completed ?? 0
    ) >= 18;

  /*
   * Never permit the admin screen to manually send a WAITING
   * notification. The database must independently confirm that
   * the real completion condition is satisfied.
   */
  if (!roundComplete) {
    return NextResponse.json(
      {
        error:
          `Round ${roundNumber} is not complete. This notification cannot be sent manually yet.`,
      },
      { status: 409 }
    );
  }

  const result =
    await notifyNewlyFinishedPlayers({
      slate: {
        id: Number(slate.id),
        date:
          slate.date ??
          slate.start_date,
        start_date:
          slate.start_date ??
          slate.date,
        end_date:
          slate.end_date ??
          slate.date,
        sport: "golf",
        display_name:
          slate.display_name,
      },
      players: [
        {
          id: playerId,
          name:
            String(
              player.display_name
            ),
        },
      ],
      lineups:
        (lineups ?? []).map(
          (lineup: any) => ({
            team_id:
              Number(lineup.team_id),
            lineup_players:
              lineup.lineup_players ??
              [],
          })
        ),
      /*
       * Force the existing notification helper through the same
       * transition used by the automatic Golf refresh path.
       * sendLoggedNotification's event_key still protects against
       * a duplicate race.
       */
      previousStatuses: [
        {
          playerId,
          gameStatus: 2,
        },
      ],
      currentStats: [
        {
          player_id:
            playerId,
          fantasy_points:
            eventPlayer
              .official_score_to_par ===
            null
              ? null
              : Number(
                  eventPlayer
                    .official_score_to_par
                ),
          game_status: 3,
          round_number:
            roundNumber,
          round_score: null,
          event_key_suffix:
            `round-${roundNumber}`,
        },
      ],
    });

  return NextResponse.json({
    success: true,
    action: "send",
    result,
  });
}

export async function POST(
  request: NextRequest
) {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  try {
    const body =
      (await request.json()) as
        RecoveryBody;

    const action =
      typeof body.action ===
      "string"
        ? body.action
        : "";

    if (action === "retry") {
      const historyId =
        typeof body.historyId ===
        "string"
          ? body.historyId
          : "";

      if (!historyId) {
        return NextResponse.json(
          {
            error:
              "A notification history ID is required for Retry.",
          },
          { status: 400 }
        );
      }

      return await retryHistoryRow(
        historyId
      );
    }

    if (action === "send") {
      const eventKey =
        typeof body.eventKey ===
        "string"
          ? body.eventKey
          : "";

      if (!eventKey) {
        return NextResponse.json(
          {
            error:
              "An expected notification event key is required for Send.",
          },
          { status: 400 }
        );
      }

      return await sendMissedGolfEvent(
        eventKey
      );
    }

    return NextResponse.json(
      {
        error:
          "Unsupported notification recovery action.",
      },
      { status: 400 }
    );
  } catch (error) {
    console.error(
      "Notification recovery failed",
      error
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to recover notification.",
      },
      { status: 500 }
    );
  }
}
