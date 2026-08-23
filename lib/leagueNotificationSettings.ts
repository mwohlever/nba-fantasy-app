import {
  getNotificationTemplate,
  type NotificationSport,
  type NotificationTemplate,
  type NotificationTemplateType,
} from "@/lib/notificationTemplates";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const NCAA_PICKEM_REMINDER_NOTIFICATION_TYPE =
  "ncaa_pickem_lock_reminder" as const;

export type LeagueNotificationType =
  | NotificationTemplateType
  | typeof NCAA_PICKEM_REMINDER_NOTIFICATION_TYPE;

export type LeagueNotificationOverride = {
  leagueId: string;
  notificationType: string;
  isEnabled: boolean;
  titleTemplate: string | null;
  bodyTemplate: string | null;
  reminderHours: number | null;
};

type LeagueNotificationRow = {
  league_id: string;
  notification_type: string;
  is_enabled: boolean;
  title_template: string | null;
  body_template: string | null;
  reminder_hours: number | null;
};

/*
 * These are separate message templates internally, but they belong to
 * the same commissioner-facing event switch:
 *
 *   draft_final_pick          -> Draft Turn
 *   slate_complete_winner     -> Slate/Tournament Complete
 */
const ENABLE_CONTROL_TYPE: Partial<
  Record<NotificationTemplateType, NotificationTemplateType>
> = {
  draft_final_pick: "draft_turn",
  slate_complete_winner: "slate_complete",
};

export async function getLeagueNotificationOverrides(
  leagueId: string,
  notificationTypes: string[],
): Promise<LeagueNotificationOverride[]> {
  const uniqueTypes = [
    ...new Set(
      notificationTypes
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  ];

  if (!leagueId || uniqueTypes.length === 0) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("league_notification_settings")
    .select(
      `
        league_id,
        notification_type,
        is_enabled,
        title_template,
        body_template,
        reminder_hours
      `,
    )
    .eq("league_id", leagueId)
    .in("notification_type", uniqueTypes);

  if (error) {
    console.error(
      "Failed to load league notification settings",
      {
        leagueId,
        notificationTypes: uniqueTypes,
        error,
      },
    );

    /*
     * Backward-compatible behavior:
     * if the new migration has not been applied yet or a lookup fails,
     * do not break the existing notification pipeline.
     */
    return [];
  }

  return ((data ?? []) as LeagueNotificationRow[]).map(
    (row) => ({
      leagueId: String(row.league_id),
      notificationType: String(row.notification_type),
      isEnabled: row.is_enabled !== false,
      titleTemplate:
        typeof row.title_template === "string" &&
        row.title_template.trim()
          ? row.title_template.trim()
          : null,
      bodyTemplate:
        typeof row.body_template === "string" &&
        row.body_template.trim()
          ? row.body_template.trim()
          : null,
      reminderHours:
        row.reminder_hours === null ||
        row.reminder_hours === undefined
          ? null
          : Number(row.reminder_hours),
    }),
  );
}

export async function getLeagueNotificationOverride(
  leagueId: string | null | undefined,
  notificationType: string,
): Promise<LeagueNotificationOverride | null> {
  if (!leagueId) {
    return null;
  }

  const rows = await getLeagueNotificationOverrides(
    leagueId,
    [notificationType],
  );

  return rows[0] ?? null;
}

export type ResolvedLeagueNotificationTemplate = {
  enabled: boolean;
  template: NotificationTemplate;
};

export async function getLeagueNotificationTemplate(
  notificationType: NotificationTemplateType,
  sport: NotificationSport,
  leagueId: string | null | undefined,
): Promise<ResolvedLeagueNotificationTemplate> {
  const baseTemplate = await getNotificationTemplate(
    notificationType,
    sport,
  );

  if (!leagueId) {
    return {
      enabled: true,
      template: baseTemplate,
    };
  }

  const controlType =
    ENABLE_CONTROL_TYPE[notificationType] ??
    notificationType;

  const rows = await getLeagueNotificationOverrides(
    leagueId,
    controlType === notificationType
      ? [notificationType]
      : [notificationType, controlType],
  );

  const templateOverride =
    rows.find(
      (row) =>
        row.notificationType === notificationType,
    ) ?? null;

  const controlOverride =
    rows.find(
      (row) =>
        row.notificationType === controlType,
    ) ?? null;

  return {
    enabled:
      controlOverride?.isEnabled ??
      true,

    template: {
      ...baseTemplate,

      titleTemplate:
        templateOverride?.titleTemplate ??
        baseTemplate.titleTemplate,

      bodyTemplate:
        templateOverride?.bodyTemplate ??
        baseTemplate.bodyTemplate,
    },
  };
}
