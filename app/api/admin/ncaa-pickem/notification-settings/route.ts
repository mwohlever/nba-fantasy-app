import {
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getActiveLeagueForSport,
} from "@/lib/groups/context";

import {
  NCAA_PICKEM_REMINDER_NOTIFICATION_TYPE,
} from "@/lib/leagueNotificationSettings";

import {
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


async function resolvePickEmLeague() {
  const user =
    await getCurrentUser();

  if (
    !user
  ) {
    return {
      error:
        NextResponse.json(
          {
            error:
              "Login required.",
          },
          {
            status:
              401,
          },
        ),

      user:
        null,

      access:
        null,
    };
  }

  const access =
    await getActiveLeagueForSport(
      user,
      "ncaa_pickem",
    );

  if (
    !access
  ) {
    return {
      error:
        NextResponse.json(
          {
            error:
              "No enabled NCAA Pick 'Em league exists in the active Group.",
          },
          {
            status:
              404,
          },
        ),

      user,
      access:
        null,
    };
  }

  if (
    !access.context
      .canAdministerGroup
  ) {
    return {
      error:
        NextResponse.json(
          {
            error:
              "Group admin access required.",
          },
          {
            status:
              403,
          },
        ),

      user,
      access:
        null,
    };
  }

  return {
    error:
      null,

    user,
    access,
  };
}


export async function GET() {
  const authError =
    await requireAdminApi();

  if (
    authError
  ) {
    return authError;
  }

  try {
    const resolved =
      await resolvePickEmLeague();

    if (
      resolved.error ||
      !resolved.access
    ) {
      return resolved.error;
    }

    /*
     * No league ID = inherited legacy/platform Pick'Em default.
     * League ID = active Group's commissioner override.
     */
    const [
      defaults,
      settings,
    ] =
      await Promise.all([
        getNcaaPickEmNotificationSettings(),

        getNcaaPickEmNotificationSettings(
          resolved.access
            .league.id,
        ),
      ]);

    return NextResponse.json({
      success:
        true,

      group: {
        id:
          resolved.access
            .context
            .group.id,

        name:
          resolved.access
            .context
            .group.name,
      },

      league: {
        id:
          resolved.access
            .league.id,

        name:
          resolved.access
            .league.name,
      },

      settings,
      defaults,

      availablePlaceholders:
        NCAA_PICKEM_NOTIFICATION_PLACEHOLDERS,
    });
  } catch (
    error
  ) {
    console.error(
      "Failed to load NCAA Pick 'Em league notification settings",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to load NCAA Pick 'Em notification settings.",
      },
      {
        status:
          500,
      },
    );
  }
}


export async function PUT(
  request: Request,
) {
  const authError =
    await requireAdminApi();

  if (
    authError
  ) {
    return authError;
  }

  try {
    const resolved =
      await resolvePickEmLeague();

    if (
      resolved.error ||
      !resolved.user ||
      !resolved.access
    ) {
      return resolved.error;
    }

    const league =
      resolved.access.league;

    const body =
      await request
        .json() as
        SaveBody;

    const resetToDefault =
      body.resetToDefault ===
      true;

    if (
      resetToDefault
    ) {
      const {
        error:
          deleteError,
      } =
        await supabaseAdmin
          .from(
            "league_notification_settings",
          )
          .delete()
          .eq(
            "league_id",
            league.id,
          )
          .eq(
            "notification_type",
            NCAA_PICKEM_REMINDER_NOTIFICATION_TYPE,
          );

      if (
        deleteError
      ) {
        return NextResponse.json(
          {
            error:
              `Failed to restore Pick 'Em defaults: ${deleteError.message}`,
          },
          {
            status:
              500,
          },
        );
      }

      const settings =
        await getNcaaPickEmNotificationSettings(
          league.id,
        );

      return NextResponse.json({
        success:
          true,

        settings,
      });
    }

    const source = {
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
      reminderHours <
        1 ||
      reminderHours >
        168
    ) {
      return NextResponse.json(
        {
          error:
            "Reminder timing must be between 1 and 168 hours before lock.",
        },
        {
          status:
            400,
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
          status:
            400,
        },
      );
    }

    if (
      source
        .titleTemplate
        .length >
      100
    ) {
      return NextResponse.json(
        {
          error:
            "Notification title must be 100 characters or fewer.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      source
        .bodyTemplate
        .length >
      240
    ) {
      return NextResponse.json(
        {
          error:
            "Notification message must be 240 characters or fewer.",
        },
        {
          status:
            400,
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
              unsupported.length ===
              1
                ? ""
                : "s"
            }: ${unsupported.join(
              ", ",
            )}`,
        },
        {
          status:
            400,
        },
      );
    }

    const {
      error,
    } =
      await supabaseAdmin
        .from(
          "league_notification_settings",
        )
        .upsert(
          {
            league_id:
              league.id,

            notification_type:
              NCAA_PICKEM_REMINDER_NOTIFICATION_TYPE,

            is_enabled:
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
              resolved.user.id,
          },
          {
            onConflict:
              "league_id,notification_type",
          },
        );

    if (
      error
    ) {
      return NextResponse.json(
        {
          error:
            `Failed to save NCAA Pick 'Em notification settings: ${error.message}`,
        },
        {
          status:
            500,
        },
      );
    }

    const settings =
      await getNcaaPickEmNotificationSettings(
        league.id,
      );

    return NextResponse.json({
      success:
        true,
      settings,
    });
  } catch (
    error
  ) {
    console.error(
      "Failed to save NCAA Pick 'Em league notification settings",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to save NCAA Pick 'Em notification settings.",
      },
      {
        status:
          500,
      },
    );
  }
}
