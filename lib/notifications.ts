import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendPushToUser, type PushResult } from "@/lib/push";

type LoggedNotificationInput = {
  eventKey?: string | null;
  notificationType: string;

  userId?: string | null;
  teamId?: number | null;
  slateId?: number | null;
  leagueId?: string | null;
  playerId?: number | null;

  title: string;
  body: string;
  url: string;
  tag: string;

  metadata?: Record<string, unknown>;
  skipReason?: string | null;
};

export type LoggedNotificationResult = PushResult & {
  duplicate?: boolean;
  historyId?: string | null;
};

function getStatus(result: PushResult) {
  if (result.skipped) return "skipped";
  if (result.sent > 0 && result.failed > 0) return "partial";
  if (result.sent > 0) return "sent";
  return "failed";
}

export async function sendLoggedNotification(
  input: LoggedNotificationInput
): Promise<LoggedNotificationResult> {
  const initialMetadata = input.metadata ?? {};

  const { data: historyRow, error: historyError } = await supabaseAdmin
    .from("notification_history")
    .insert({
      event_key: input.eventKey ?? null,
      notification_type: input.notificationType,
      league_id: input.leagueId ?? null,
      user_id: input.userId ?? null,
      team_id: input.teamId ?? null,
      slate_id: input.slateId ?? null,
      player_id: input.playerId ?? null,
      title: input.title,
      body: input.body,
      status: "pending",
      metadata: initialMetadata,
    })
    .select("id")
    .single();

  if (historyError) {
    if (historyError.code === "23505" && input.eventKey) {
      return {
        sent: 0,
        failed: 0,
        skipped: true,
        duplicate: true,
        reason: "This notification event was already processed.",
        historyId: null,
        devices: [],
      };
    }

    console.error("Failed to create notification history record", historyError);
  }

  const historyId = historyRow?.id ?? null;

  if (input.skipReason) {
    if (historyId) {
      await supabaseAdmin
        .from("notification_history")
        .update({
          status: "skipped",
          skipped: true,
          reason: input.skipReason,
          metadata: {
            ...initialMetadata,
            devices: [],
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", historyId);
    }

    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: input.skipReason,
      historyId,
      devices: [],
    };
  }

  if (!input.userId) {
    const reason = "No recipient account was available.";

    if (historyId) {
      await supabaseAdmin
        .from("notification_history")
        .update({
          status: "skipped",
          skipped: true,
          reason,
          metadata: {
            ...initialMetadata,
            devices: [],
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", historyId);
    }

    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason,
      historyId,
      devices: [],
    };
  }

  try {
    const result = await sendPushToUser(input.userId, {
      title: input.title,
      body: input.body,
      url: input.url,
      tag: input.tag,
    });

    if (historyId) {
      await supabaseAdmin
        .from("notification_history")
        .update({
          status: getStatus(result),
          sent_count: result.sent,
          failed_count: result.failed,
          skipped: result.skipped,
          reason: result.reason ?? null,
          metadata: {
            ...initialMetadata,
            devices: result.devices,
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", historyId);
    }

    return {
      ...result,
      historyId,
    };
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "Unexpected push notification error.";

    if (historyId) {
      await supabaseAdmin
        .from("notification_history")
        .update({
          status: "failed",
          sent_count: 0,
          failed_count: 1,
          skipped: false,
          reason,
          metadata: {
            ...initialMetadata,
            devices: [],
          },
          completed_at: new Date().toISOString(),
        })
        .eq("id", historyId);
    }

    console.error("Logged notification failed", error);

    return {
      sent: 0,
      failed: 1,
      skipped: false,
      reason,
      historyId,
      devices: [],
    };
  }
}
