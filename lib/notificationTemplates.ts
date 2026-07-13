import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const NOTIFICATION_TEMPLATE_DEFAULTS = {
  draft_turn: {
    notificationType: "draft_turn",
    titleTemplate: "🏀 Your turn to draft!",
    bodyTemplate: "{teamName}, you're on the clock for {slateLabel}.",
    description:
      "Sent to the next participant after a draft pick is submitted.",
    availablePlaceholders: ["{teamName}", "{slateLabel}"],
  },
} as const;

export type NotificationTemplateType =
  keyof typeof NOTIFICATION_TEMPLATE_DEFAULTS;

export type NotificationTemplate = {
  notificationType: NotificationTemplateType;
  titleTemplate: string;
  bodyTemplate: string;
  description: string;
  availablePlaceholders: string[];
};

type NotificationTemplateRow = {
  notification_type: string;
  title_template: string;
  body_template: string;
  description: string | null;
  available_placeholders: string[] | null;
};

export function renderNotificationTemplate(
  template: string,
  values: Record<string, string | number | null | undefined>
) {
  return Object.entries(values).reduce((result, [key, value]) => {
    const replacement = value == null ? "" : String(value);

    return result.replaceAll(`{${key}}`, replacement);
  }, template);
}

export function getDefaultNotificationTemplate(
  notificationType: NotificationTemplateType
): NotificationTemplate {
  const template = NOTIFICATION_TEMPLATE_DEFAULTS[notificationType];

  return {
    notificationType: template.notificationType,
    titleTemplate: template.titleTemplate,
    bodyTemplate: template.bodyTemplate,
    description: template.description,
    availablePlaceholders: [...template.availablePlaceholders],
  };
}

export async function getNotificationTemplate(
  notificationType: NotificationTemplateType
): Promise<NotificationTemplate> {
  const fallback = getDefaultNotificationTemplate(notificationType);

  const { data, error } = await supabaseAdmin
    .from("notification_templates")
    .select(
      `
        notification_type,
        title_template,
        body_template,
        description,
        available_placeholders
      `
    )
    .eq("notification_type", notificationType)
    .maybeSingle();

  if (error) {
    console.error("Failed to load notification template", {
      notificationType,
      error,
    });

    return fallback;
  }

  const row = data as NotificationTemplateRow | null;

  if (!row) {
    return fallback;
  }

  return {
    notificationType,
    titleTemplate: row.title_template?.trim() || fallback.titleTemplate,
    bodyTemplate: row.body_template?.trim() || fallback.bodyTemplate,
    description: row.description?.trim() || fallback.description,
    availablePlaceholders:
      row.available_placeholders?.length
        ? row.available_placeholders
        : fallback.availablePlaceholders,
  };
}
