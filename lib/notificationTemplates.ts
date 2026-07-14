import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const NOTIFICATION_TEMPLATE_DEFAULTS = {
  draft_turn: {
    notificationType: "draft_turn",
    titleTemplate: "🏀 Your turn to draft!",
    bodyTemplate:
      "{teamName}, you're on the clock for your {roundOrdinal} round pick.",
    description:
      "Sent to the next participant after a draft pick is submitted.",
    availablePlaceholders: [
      "{teamName}",
      "{slateLabel}",
      "{roundNumber}",
      "{roundOrdinal}",
      "{overallPickNumber}",
      "{remainingNeeds}",
    ],
  },
  draft_final_pick: {
    notificationType: "draft_final_pick",
    titleTemplate: "🏀 Last pick!",
    bodyTemplate:
      "{teamName}, you're on the clock for your last pick — you need a {positionNeed}!",
    description:
      "Sent when the next participant is making their fifth and final draft pick.",
    availablePlaceholders: [
      "{teamName}",
      "{slateLabel}",
      "{roundNumber}",
      "{roundOrdinal}",
      "{overallPickNumber}",
      "{positionNeed}",
      "{remainingNeeds}",
    ],
  },
  player_finished: {
    notificationType: "player_finished",
    titleTemplate: "🏀 {playerName} finished!",
    bodyTemplate:
      "{playerName} finished with {fantasyPoints} fantasy points for {teamName}.",
    description:
      "Sent when one of a participant's drafted players finishes a game.",
    availablePlaceholders: [
      "{playerName}",
      "{fantasyPoints}",
      "{teamName}",
      "{slateLabel}",
    ],
  },
  slate_complete: {
    notificationType: "slate_complete",
    titleTemplate: "🏆 Slate Complete!",
    bodyTemplate:
      "{winnerName} wins with {winningScore} fantasy points. You finished {finishOrdinal} with {teamScore}.",
    description:
      "Sent to participants after a slate finishes and final standings are calculated.",
    availablePlaceholders: [
      "{winnerName}",
      "{winningScore}",
      "{teamName}",
      "{teamScore}",
      "{finishNumber}",
      "{finishOrdinal}",
      "{slateLabel}",
    ],
  },
  slate_complete_winner: {
    notificationType: "slate_complete_winner",
    titleTemplate: "🏆 You won!",
    bodyTemplate:
      "You won the {slateLabel} slate with {teamScore} fantasy points!",
    description:
      "Sent to the participant who wins a completed slate.",
    availablePlaceholders: [
      "{winnerName}",
      "{winningScore}",
      "{teamName}",
      "{teamScore}",
      "{finishNumber}",
      "{finishOrdinal}",
      "{slateLabel}",
    ],
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

  if (!row) return fallback;

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
