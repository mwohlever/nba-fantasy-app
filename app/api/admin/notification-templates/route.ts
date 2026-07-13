import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import {
  getDefaultNotificationTemplate,
  getNotificationTemplate,
  NOTIFICATION_TEMPLATE_DEFAULTS,
  type NotificationTemplateType,
} from "@/lib/notificationTemplates";
import { requireAdminApi } from "@/lib/requireAdminApi";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SaveTemplateBody = {
  notificationType?: string;
  titleTemplate?: string;
  bodyTemplate?: string;
  resetToDefault?: boolean;
};

function isSupportedNotificationType(
  value: string
): value is NotificationTemplateType {
  return value in NOTIFICATION_TEMPLATE_DEFAULTS;
}

function findUnsupportedPlaceholders(
  value: string,
  allowedPlaceholders: string[]
) {
  const found = value.match(/\{[^{}]+\}/g) ?? [];

  return [...new Set(found)].filter(
    (placeholder) => !allowedPlaceholders.includes(placeholder)
  );
}

export async function GET() {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const notificationTypes = Object.keys(
      NOTIFICATION_TEMPLATE_DEFAULTS
    ) as NotificationTemplateType[];

    const templates = await Promise.all(
      notificationTypes.map((type) => getNotificationTemplate(type))
    );

    const defaults = notificationTypes.map((type) =>
      getDefaultNotificationTemplate(type)
    );

    return NextResponse.json({
      success: true,
      templates,
      defaults,
    });
  } catch (error) {
    console.error("Failed to load notification templates", error);

    return NextResponse.json(
      { error: "Unable to load notification templates." },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const authError = await requireAdminApi();
  if (authError) return authError;

  try {
    const currentUser = await getCurrentUser();

    if (!currentUser || currentUser.role !== "admin") {
      return NextResponse.json(
        { error: "Administrator access required." },
        { status: 403 }
      );
    }

    const body = (await request.json()) as SaveTemplateBody;
    const notificationType = String(body.notificationType ?? "").trim();

    if (!isSupportedNotificationType(notificationType)) {
      return NextResponse.json(
        { error: "Unsupported notification type." },
        { status: 400 }
      );
    }

    const defaults = getDefaultNotificationTemplate(notificationType);

    const titleTemplate = body.resetToDefault
      ? defaults.titleTemplate
      : String(body.titleTemplate ?? "").trim();

    const bodyTemplate = body.resetToDefault
      ? defaults.bodyTemplate
      : String(body.bodyTemplate ?? "").trim();

    if (!titleTemplate || !bodyTemplate) {
      return NextResponse.json(
        { error: "A title and message are required." },
        { status: 400 }
      );
    }

    if (titleTemplate.length > 100) {
      return NextResponse.json(
        { error: "The notification title must be 100 characters or fewer." },
        { status: 400 }
      );
    }

    if (bodyTemplate.length > 240) {
      return NextResponse.json(
        { error: "The notification message must be 240 characters or fewer." },
        { status: 400 }
      );
    }

    const unsupportedPlaceholders = findUnsupportedPlaceholders(
      `${titleTemplate} ${bodyTemplate}`,
      defaults.availablePlaceholders
    );

    if (unsupportedPlaceholders.length > 0) {
      return NextResponse.json(
        {
          error: `Unsupported placeholder${
            unsupportedPlaceholders.length === 1 ? "" : "s"
          }: ${unsupportedPlaceholders.join(", ")}`,
        },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("notification_templates")
      .upsert(
        {
          notification_type: notificationType,
          title_template: titleTemplate,
          body_template: bodyTemplate,
          description: defaults.description,
          available_placeholders: defaults.availablePlaceholders,
          updated_at: new Date().toISOString(),
          updated_by: currentUser.id,
        },
        {
          onConflict: "notification_type",
        }
      );

    if (error) {
      return NextResponse.json(
        { error: `Failed to save template: ${error.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      template: {
        ...defaults,
        titleTemplate,
        bodyTemplate,
      },
    });
  } catch (error) {
    console.error("Failed to save notification template", error);

    return NextResponse.json(
      { error: "Unable to save notification template." },
      { status: 500 }
    );
  }
}
