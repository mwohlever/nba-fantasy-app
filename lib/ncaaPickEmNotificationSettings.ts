import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

export type NcaaPickEmNotificationSettings = {
  enabled: boolean;
  reminderHours: number;
  titleTemplate: string;
  bodyTemplate: string;
};

export const NCAA_PICKEM_NOTIFICATION_DEFAULTS:
  NcaaPickEmNotificationSettings = {
    enabled: true,
    reminderHours: 24,
    titleTemplate:
      "🏈 Pick 'Em locks soon",
    bodyTemplate:
      "{teamName}, you still have {missingPicks} picks to save for {weekLabel}. Picks lock {lockTime}.",
  };

export const NCAA_PICKEM_NOTIFICATION_PLACEHOLDERS = [
  "{teamName}",
  "{missingPicks}",
  "{weekLabel}",
  "{lockTime}",
  "{season}",
  "{weekNumber}",
] as const;

export async function getNcaaPickEmNotificationSettings():
  Promise<NcaaPickEmNotificationSettings> {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "ncaa_pickem_notification_settings",
      )
      .select(
        "enabled, reminder_hours, title_template, body_template",
      )
      .eq(
        "id",
        1,
      )
      .maybeSingle();

  if (error) {
    console.error(
      "Failed to load NCAA Pick 'Em notification settings",
      error,
    );

    return NCAA_PICKEM_NOTIFICATION_DEFAULTS;
  }

  if (!data) {
    return NCAA_PICKEM_NOTIFICATION_DEFAULTS;
  }

  return {
    enabled:
      data.enabled !== false,

    reminderHours:
      Number(
        data.reminder_hours,
      ) ||
      NCAA_PICKEM_NOTIFICATION_DEFAULTS.reminderHours,

    titleTemplate:
      String(
        data.title_template ??
          "",
      ).trim() ||
      NCAA_PICKEM_NOTIFICATION_DEFAULTS.titleTemplate,

    bodyTemplate:
      String(
        data.body_template ??
          "",
      ).trim() ||
      NCAA_PICKEM_NOTIFICATION_DEFAULTS.bodyTemplate,
  };
}

export function renderNcaaPickEmNotificationTemplate(
  template: string,
  values: Record<
    string,
    string | number | null | undefined
  >,
) {
  return Object.entries(
    values,
  ).reduce(
    (
      result,
      [key, value],
    ) =>
      result.replaceAll(
        `{${key}}`,
        value == null
          ? ""
          : String(value),
      ),
    template,
  );
}
