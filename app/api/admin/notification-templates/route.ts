import {
  NextRequest,
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getActiveLeagueForSport,
} from "@/lib/groups/context";

import {
  getLeagueNotificationTemplate,
} from "@/lib/leagueNotificationSettings";

import {
  getNotificationTemplate,
  isNotificationSport,
  isNotificationTemplateType,
  normalizeNotificationSport,
  NOTIFICATION_TEMPLATE_DEFAULTS,
  type NotificationSport,
  type NotificationTemplateType,
} from "@/lib/notificationTemplates";

import {
  requireAdminApi,
} from "@/lib/requireAdminApi";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";


type SaveTemplateBody = {
  notificationType?: unknown;
  sport?: unknown;

  enabled?: unknown;

  titleTemplate?: unknown;
  bodyTemplate?: unknown;

  resetToDefault?: unknown;
};


const COMMISSIONER_TOGGLE_TYPES =
  new Set<NotificationTemplateType>([
    "draft_turn",
    "player_finished",
    "slate_complete",
  ]);


function findUnsupportedPlaceholders(
  value: string,
  allowedPlaceholders: string[],
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
      !allowedPlaceholders.includes(
        placeholder,
      ),
  );
}


function leagueLabel(
  sport: NotificationSport,
) {
  if (
    sport ===
    "golf"
  ) {
    return "Golf";
  }

  if (
    sport ===
    "nfl"
  ) {
    return "NFL";
  }

  return "NBA";
}


async function resolveLeague(
  sport: NotificationSport,
) {
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
      sport,
    );

  if (
    !access
  ) {
    return {
      error:
        NextResponse.json(
          {
            error:
              `No enabled ${leagueLabel(
                sport,
              )} league exists in the active Group.`,
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


export async function GET(
  request: NextRequest,
) {
  const authError =
    await requireAdminApi();

  if (
    authError
  ) {
    return authError;
  }

  try {
    const sport =
      normalizeNotificationSport(
        request.nextUrl
          .searchParams
          .get(
            "sport",
          ),
      );

    const resolved =
      await resolveLeague(
        sport,
      );

    if (
      resolved.error ||
      !resolved.access
    ) {
      return resolved.error;
    }

    const league =
      resolved.access.league;

    const notificationTypes =
      Object.keys(
        NOTIFICATION_TEMPLATE_DEFAULTS[
          sport
        ],
      ) as NotificationTemplateType[];

    /*
     * Platform templates are the inherited defaults for every
     * league. A league override only exists when a commissioner
     * explicitly customizes that event.
     */
    const [
      platformTemplates,
      leagueTemplates,
    ] =
      await Promise.all([
        Promise.all(
          notificationTypes.map(
            (
              notificationType,
            ) =>
              getNotificationTemplate(
                notificationType,
                sport,
              ),
          ),
        ),

        Promise.all(
          notificationTypes.map(
            (
              notificationType,
            ) =>
              getLeagueNotificationTemplate(
                notificationType,
                sport,
                league.id,
              ),
          ),
        ),
      ]);

    const templates =
      leagueTemplates.map(
        (
          resolvedTemplate,
          index,
        ) => ({
          ...resolvedTemplate
            .template,

          enabled:
            resolvedTemplate
              .enabled,

          inherited:
            resolvedTemplate
              .template
              .titleTemplate ===
              platformTemplates[
                index
              ].titleTemplate &&
            resolvedTemplate
              .template
              .bodyTemplate ===
              platformTemplates[
                index
              ].bodyTemplate,
        }),
      );

    return NextResponse.json({
      success:
        true,

      sport,

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
          league.id,

        name:
          league.name,

        sportKey:
          league.sportKey,

        gameMode:
          league.gameMode,
      },

      templates,

      /*
       * "defaults" now means the inherited platform wording,
       * not a second league-specific copy.
       */
      defaults:
        platformTemplates,
    });
  } catch (
    error
  ) {
    console.error(
      "Failed to load league notification templates",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to load notification settings.",
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
    const body =
      await request
        .json() as
        SaveTemplateBody;

    if (
      !isNotificationTemplateType(
        body.notificationType,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Unsupported notification type.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      !isNotificationSport(
        body.sport,
      )
    ) {
      return NextResponse.json(
        {
          error:
            "Unsupported sport.",
        },
        {
          status:
            400,
        },
      );
    }

    const notificationType:
      NotificationTemplateType =
        body.notificationType;

    const sport:
      NotificationSport =
        body.sport;

    const resolved =
      await resolveLeague(
        sport,
      );

    if (
      resolved.error ||
      !resolved.user ||
      !resolved.access
    ) {
      return resolved.error;
    }

    const league =
      resolved.access.league;

    const platformTemplate =
      await getNotificationTemplate(
        notificationType,
        sport,
      );

    const resetToDefault =
      body.resetToDefault ===
      true;

    /*
     * Restoring default removes the league override entirely.
     * The resolver then naturally falls back to the platform
     * template and the default enabled state.
     */
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
            notificationType,
          );

      if (
        deleteError
      ) {
        return NextResponse.json(
          {
            error:
              `Failed to restore inherited settings: ${deleteError.message}`,
          },
          {
            status:
              500,
          },
        );
      }

      const restored =
        await getLeagueNotificationTemplate(
          notificationType,
          sport,
          league.id,
        );

      return NextResponse.json({
        success:
          true,

        template: {
          ...restored.template,

          enabled:
            restored.enabled,

          inherited:
            true,
        },
      });
    }

    const titleTemplate =
      String(
        body.titleTemplate ??
          "",
      ).trim();

    const bodyTemplate =
      String(
        body.bodyTemplate ??
          "",
      ).trim();

    if (
      !titleTemplate ||
      !bodyTemplate
    ) {
      return NextResponse.json(
        {
          error:
            "A title and message are required.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      titleTemplate.length >
      100
    ) {
      return NextResponse.json(
        {
          error:
            "The notification title must be 100 characters or fewer.",
        },
        {
          status:
            400,
        },
      );
    }

    if (
      bodyTemplate.length >
      240
    ) {
      return NextResponse.json(
        {
          error:
            "The notification message must be 240 characters or fewer.",
        },
        {
          status:
            400,
        },
      );
    }

    const unsupportedPlaceholders =
      findUnsupportedPlaceholders(
        `${titleTemplate} ${bodyTemplate}`,
        platformTemplate
          .availablePlaceholders,
      );

    if (
      unsupportedPlaceholders.length >
      0
    ) {
      return NextResponse.json(
        {
          error:
            `Unsupported placeholder${
              unsupportedPlaceholders.length ===
              1
                ? ""
                : "s"
            }: ${unsupportedPlaceholders.join(
              ", ",
            )}`,
        },
        {
          status:
            400,
        },
      );
    }

    /*
     * Only the three commissioner-facing primary event types
     * own enable/disable switches.
     *
     * draft_final_pick inherits draft_turn.
     * slate_complete_winner inherits slate_complete.
     */
    const isEnabled =
      COMMISSIONER_TOGGLE_TYPES.has(
        notificationType,
      )
        ? body.enabled !==
          false
        : true;

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
              notificationType,

            is_enabled:
              isEnabled,

            title_template:
              titleTemplate,

            body_template:
              bodyTemplate,

            reminder_hours:
              null,

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
      console.error(
        "League notification settings upsert failed",
        {
          leagueId:
            league.id,

          notificationType,
          sport,
          error,
        },
      );

      return NextResponse.json(
        {
          error:
            `Failed to save notification settings: ${error.message}`,
        },
        {
          status:
            500,
        },
      );
    }

    const saved =
      await getLeagueNotificationTemplate(
        notificationType,
        sport,
        league.id,
      );

    return NextResponse.json({
      success:
        true,

      template: {
        ...saved.template,

        enabled:
          saved.enabled,

        inherited:
          false,
      },
    });
  } catch (
    error
  ) {
    console.error(
      "Failed to save league notification settings",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to save notification settings.",
      },
      {
        status:
          500,
      },
    );
  }
}
