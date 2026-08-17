import {
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  NCAA_PICKEM_NOTIFICATION_DEFAULTS,
  NCAA_PICKEM_NOTIFICATION_PLACEHOLDERS,
  getNcaaPickEmNotificationSettings,
} from "@/lib/ncaaPickEmNotificationSettings";

import {
  requireAdminApi,
} from "@/lib/requireAdminApi";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

type SaveBody = {
  enabled?: unknown;
  reminderHours?: unknown;
  titleTemplate?: unknown;
  bodyTemplate?: unknown;
  resetToDefault?: unknown;
};

function unsupportedPlaceholders(
  value: string,
) {
  const found =
    value.match(
      /\{[^{}]+\}/g,
    ) ??
    [];

  return [
    ...new Set(
      found,
    ),
  ].filter(
    (placeholder) =>
      !NCAA_PICKEM_NOTIFICATION_PLACEHOLDERS.includes(
        placeholder as
          (typeof NCAA_PICKEM_NOTIFICATION_PLACEHOLDERS)[number],
      ),
  );
}

export async function GET() {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  const settings =
    await getNcaaPickEmNotificationSettings();

  return NextResponse.json({
    success: true,
    settings,
    defaults:
      NCAA_PICKEM_NOTIFICATION_DEFAULTS,
    availablePlaceholders:
      NCAA_PICKEM_NOTIFICATION_PLACEHOLDERS,
  });
}

export async function PUT(
  request: Request,
) {
  const authError =
    await requireAdminApi();

  if (authError) {
    return authError;
  }

  try {
    const user =
      await getCurrentUser();

    if (
      !user ||
      user.role !== "admin"
    ) {
      return NextResponse.json(
        {
          error:
            "Administrator access required.",
        },
        {
          status: 403,
        },
      );
    }

    const body =
      await request.json() as SaveBody;

    const resetToDefault =
      body.resetToDefault ===
      true;

    const source =
      resetToDefault
        ? NCAA_PICKEM_NOTIFICATION_DEFAULTS
        : {
            enabled:
              body.enabled !==
              false,

            reminderHours:
              Number(
                body.reminderHours,
              ),

            titleTemplate:
              String(
                body.titleTemplate ??
                  "",
              ).trim(),

            bodyTemplate:
              String(
                body.bodyTemplate ??
                  "",
              ).trim(),
          };

    const reminderHours =
      Number(
        source.reminderHours,
      );

    if (
      !Number.isInteger(
        reminderHours,
      ) ||
      reminderHours < 1 ||
      reminderHours > 168
    ) {
      return NextResponse.json(
        {
          error:
            "Reminder timing must be between 1 and 168 hours before lock.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      !source.titleTemplate ||
      !source.bodyTemplate
    ) {
      return NextResponse.json(
        {
          error:
            "A notification title and message are required.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      source.titleTemplate.length >
      100
    ) {
      return NextResponse.json(
        {
          error:
            "Notification title must be 100 characters or fewer.",
        },
        {
          status: 400,
        },
      );
    }

    if (
      source.bodyTemplate.length >
      240
    ) {
      return NextResponse.json(
        {
          error:
            "Notification message must be 240 characters or fewer.",
        },
        {
          status: 400,
        },
      );
    }

    const unsupported =
      unsupportedPlaceholders(
        `${source.titleTemplate} ${source.bodyTemplate}`,
      );

    if (
      unsupported.length >
      0
    ) {
      return NextResponse.json(
        {
          error:
            `Unsupported placeholder${
              unsupported.length === 1
                ? ""
                : "s"
            }: ${unsupported.join(
              ", ",
            )}`,
        },
        {
          status: 400,
        },
      );
    }

    const {
      error,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_notification_settings",
        )
        .upsert(
          {
            id: 1,

            enabled:
              source.enabled,

            reminder_hours:
              reminderHours,

            title_template:
              source.titleTemplate,

            body_template:
              source.bodyTemplate,

            updated_at:
              new Date()
                .toISOString(),

            updated_by:
              String(
                user.id,
              ),
          },
          {
            onConflict:
              "id",
          },
        );

    if (error) {
      return NextResponse.json(
        {
          error:
            `Failed to save NCAA Pick 'Em notification settings: ${error.message}`,
        },
        {
          status: 500,
        },
      );
    }

    return NextResponse.json({
      success: true,

      settings: {
        enabled:
          source.enabled,

        reminderHours,

        titleTemplate:
          source.titleTemplate,

        bodyTemplate:
          source.bodyTemplate,
      },
    });
  } catch (error) {
    console.error(
      "Failed to save NCAA Pick 'Em notification settings",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to save NCAA Pick 'Em notification settings.",
      },
      {
        status: 500,
      },
    );
  }
}
