import {
  getLeagueNotificationOverride,
  NCAA_PICKEM_REMINDER_NOTIFICATION_TYPE,
} from "@/lib/leagueNotificationSettings";
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

async function getLegacyNcaaPickEmNotificationSettings():
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
      "Failed to load legacy NCAA Pick 'Em notification settings",
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

export async function getNcaaPickEmNotificationSettings(
  leagueId?: string | null,
): Promise<NcaaPickEmNotificationSettings> {
  const fallback =
    await getLegacyNcaaPickEmNotificationSettings();

  if (!leagueId) {
    return fallback;
  }

  const override =
    await getLeagueNotificationOverride(
      leagueId,
      NCAA_PICKEM_REMINDER_NOTIFICATION_TYPE,
    );

  if (!override) {
    return fallback;
  }

  return {
    enabled:
      override.isEnabled,

    reminderHours:
      override.reminderHours &&
      Number.isFinite(
        override.reminderHours,
      )
        ? override.reminderHours
        : fallback.reminderHours,

    titleTemplate:
      override.titleTemplate ??
      fallback.titleTemplate,

    bodyTemplate:
      override.bodyTemplate ??
      fallback.bodyTemplate,
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
