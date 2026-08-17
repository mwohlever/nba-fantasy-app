import {
  NextResponse,
} from "next/server";

import {
  sendLoggedNotification,
} from "@/lib/notifications";

import {
  getNcaaPickEmNotificationSettings,
  renderNcaaPickEmNotificationTemplate,
} from "@/lib/ncaaPickEmNotificationSettings";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";

export const runtime =
  "nodejs";

export const dynamic =
  "force-dynamic";

export const maxDuration =
  60;

/*
 * We deliberately use the existing Golf cron secret rather
 * than introduce another production secret just for this
 * tiny scheduled check.
 *
 * The route itself is completely independent from Golf.
 */
function isAuthorized(
  request: Request,
) {
  const secret =
    process.env
      .GOLF_CRON_SECRET
      ?.trim();

  if (!secret) {
    console.error(
      "GOLF_CRON_SECRET is not configured.",
    );

    return false;
  }

  return (
    request.headers.get(
      "authorization",
    ) ===
    `Bearer ${secret}`
  );
}

function formatLockTime(
  value: string,
) {
  const date =
    new Date(value);

  return new Intl.DateTimeFormat(
    "en-US",
    {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone:
        "America/New_York",
      timeZoneName:
        "short",
    },
  ).format(date);
}

export async function GET(
  request: Request,
) {
  if (!isAuthorized(request)) {
    return NextResponse.json(
      {
        error:
          "Unauthorized.",
      },
      {
        status: 401,
      },
    );
  }

  try {
    const reminderSettings =
      await getNcaaPickEmNotificationSettings();

    if (
      !reminderSettings.enabled
    ) {
      return NextResponse.json({
        success: true,
        checkedWeeks: 0,
        remindersSent: 0,
        remindersSkipped: 0,
        disabled: true,
        message:
          "NCAA Pick 'Em reminders are disabled by the commissioner.",
      });
    }

    const now =
      Date.now();

    const reminderHours =
      reminderSettings.reminderHours;

    /*
     * There is no guaranteed production scheduler.
     *
     * Normal logged-in app activity can call this check.
     * Once a card enters its configured reminder window,
     * the first available app heartbeat can send the reminder.
     *
     * sendLoggedNotification() + the per-user/week event key
     * makes repeated checks safe and prevents duplicate pushes.
     */
    const windowStart =
      new Date(
        now,
      ).toISOString();

    const windowEnd =
      new Date(
        now +
          reminderHours *
            60 *
            60 *
            1000,
      ).toISOString();

    const {
      data: weeks,
      error: weeksError,
    } =
      await supabaseAdmin
        .from(
          "ncaa_pickem_weeks",
        )
        .select(
          "id, season, week_number, label, lock_at, status",
        )
        .eq(
          "status",
          "open",
        )
        .not(
          "lock_at",
          "is",
          null,
        )
        .gte(
          "lock_at",
          windowStart,
        )
        .lte(
          "lock_at",
          windowEnd,
        );

    if (weeksError) {
      throw new Error(
        `Failed to load Pick 'Em weeks: ${weeksError.message}`,
      );
    }

    if (
      !weeks ||
      weeks.length === 0
    ) {
      return NextResponse.json({
        success: true,
        checkedWeeks: 0,
        remindersSent: 0,
        remindersSkipped: 0,
        message:
          `No Pick 'Em week is currently within the ${reminderHours}-hour reminder window.`,
        reminderHours,
      });
    }

    const {
      data: users,
      error: usersError,
    } =
      await supabaseAdmin
        .from(
          "app_users",
        )
        .select(
          "id, team_id, display_name",
        )
        .eq(
          "is_active",
          true,
        );

    if (usersError) {
      throw new Error(
        `Failed to load active users: ${usersError.message}`,
      );
    }

    const activeUsers =
      (
        users ??
        []
      ).filter(
        (user) =>
          user.team_id !==
            null &&
          user.team_id !==
            undefined,
      );

    const userIds =
      activeUsers.map(
        (user) =>
          String(
            user.id,
          ),
      );

    const {
      data: preferences,
      error:
        preferencesError,
    } =
      userIds.length >
      0
        ? await supabaseAdmin
            .from(
              "notification_preferences",
            )
            .select(
              "user_id, notifications_enabled, pickem_reminder_enabled",
            )
            .in(
              "user_id",
              userIds,
            )
        : {
            data: [],
            error: null,
          };

    if (
      preferencesError
    ) {
      throw new Error(
        `Failed to load notification preferences: ${preferencesError.message}`,
      );
    }

    const preferenceByUser =
      new Map(
        (
          preferences ??
          []
        ).map(
          (row) => [
            String(
              row.user_id,
            ),
            row,
          ],
        ),
      );

    let remindersSent =
      0;

    let remindersSkipped =
      0;

    let duplicateEvents =
      0;

    const details:
      Array<{
        weekId: number;
        teamId: number;
        user: string;
        activeGames: number;
        savedPicks: number;
        missingPicks: number;
        result:
          | "sent"
          | "skipped"
          | "duplicate"
          | "failed";
        reason?: string;
      }> = [];

    for (
      const week
      of weeks
    ) {
      const weekId =
        Number(
          week.id,
        );

      const {
        data: games,
        error: gamesError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_games",
          )
          .select(
            "id",
          )
          .eq(
            "week_id",
            weekId,
          )
          .eq(
            "included",
            true,
          );

      if (gamesError) {
        throw new Error(
          `Failed to load Pick 'Em games for week ${weekId}: ${gamesError.message}`,
        );
      }

      const gameIds =
        (
          games ??
          []
        ).map(
          (game) =>
            Number(
              game.id,
            ),
        );

      const activeGameCount =
        gameIds.length;

      if (
        activeGameCount ===
        0
      ) {
        continue;
      }

      const {
        data: picks,
        error: picksError,
      } =
        await supabaseAdmin
          .from(
            "ncaa_pickem_picks",
          )
          .select(
            "game_id, team_id",
          )
          .eq(
            "week_id",
            weekId,
          )
          .in(
            "game_id",
            gameIds,
          );

      if (picksError) {
        throw new Error(
          `Failed to load Pick 'Em picks for week ${weekId}: ${picksError.message}`,
        );
      }

      const pickedGamesByTeam =
        new Map<
          number,
          Set<number>
        >();

      for (
        const pick
        of picks ?? []
      ) {
        const teamId =
          Number(
            pick.team_id,
          );

        const gameId =
          Number(
            pick.game_id,
          );

        const existing =
          pickedGamesByTeam.get(
            teamId,
          ) ??
          new Set<number>();

        existing.add(
          gameId,
        );

        pickedGamesByTeam.set(
          teamId,
          existing,
        );
      }

      for (
        const user
        of activeUsers
      ) {
        const userId =
          String(
            user.id,
          );

        const teamId =
          Number(
            user.team_id,
          );

        const displayName =
          String(
            user.display_name ??
              "Player",
          );

        const preference =
          preferenceByUser.get(
            userId,
          );

        /*
         * Existing accounts with no notification_preferences
         * row use the app's normal defaults: notifications on.
         */
        const notificationsEnabled =
          preference
            ?.notifications_enabled ??
          true;

        const reminderEnabled =
          preference
            ?.pickem_reminder_enabled ??
          true;

        const pickedGames =
          pickedGamesByTeam.get(
            teamId,
          ) ??
          new Set<number>();

        const savedPicks =
          pickedGames.size;

        const missingPicks =
          Math.max(
            activeGameCount -
              savedPicks,
            0,
          );

        if (
          missingPicks ===
          0
        ) {
          remindersSkipped +=
            1;

          details.push({
            weekId,
            teamId,
            user:
              displayName,
            activeGames:
              activeGameCount,
            savedPicks,
            missingPicks,
            result:
              "skipped",
            reason:
              "Weekly card is already complete.",
          });

          continue;
        }

        if (
          !notificationsEnabled ||
          !reminderEnabled
        ) {
          remindersSkipped +=
            1;

          details.push({
            weekId,
            teamId,
            user:
              displayName,
            activeGames:
              activeGameCount,
            savedPicks,
            missingPicks,
            result:
              "skipped",
            reason:
              !notificationsEnabled
                ? "Notifications are disabled."
                : "Pick 'Em reminders are disabled.",
          });

          continue;
        }

        const lockDisplay =
          week.lock_at
            ? formatLockTime(
                week.lock_at,
              )
            : "";

        const templateValues = {
          teamName:
            displayName,

          missingPicks,

          weekLabel:
            week.label,

          lockTime:
            lockDisplay,

          season:
            Number(
              week.season,
            ),

          weekNumber:
            Number(
              week.week_number,
            ),
        };

        const title =
          renderNcaaPickEmNotificationTemplate(
            reminderSettings.titleTemplate,
            templateValues,
          );

        const body =
          renderNcaaPickEmNotificationTemplate(
            reminderSettings.bodyTemplate,
            templateValues,
          );

        const result =
          await sendLoggedNotification({
            eventKey:
              `ncaa_pickem_lock_reminder:${weekId}:${userId}`,

            notificationType:
              "ncaa_pickem_lock_reminder",

            userId,
            teamId,

            title,
            body,

            url:
              `/ncaa-pickem?season=${week.season}&week=${week.week_number}`,

            tag:
              `ncaa-pickem-lock-${weekId}`,

            metadata: {
              sport:
                "ncaa",
              season:
                Number(
                  week.season,
                ),
              weekNumber:
                Number(
                  week.week_number,
                ),
              weekLabel:
                week.label,
              weekId,
              lockAt:
                week.lock_at,
              lockDisplay:
                week.lock_at
                  ? formatLockTime(
                      week.lock_at,
                    )
                  : null,
              activeGames:
                activeGameCount,
              savedPicks,
              missingPicks,
            },
          });

        if (
          result.duplicate
        ) {
          duplicateEvents +=
            1;

          details.push({
            weekId,
            teamId,
            user:
              displayName,
            activeGames:
              activeGameCount,
            savedPicks,
            missingPicks,
            result:
              "duplicate",
            reason:
              result.reason,
          });

          continue;
        }

        if (
          result.sent >
          0
        ) {
          remindersSent +=
            1;

          details.push({
            weekId,
            teamId,
            user:
              displayName,
            activeGames:
              activeGameCount,
            savedPicks,
            missingPicks,
            result:
              "sent",
          });
        } else {
          remindersSkipped +=
            1;

          details.push({
            weekId,
            teamId,
            user:
              displayName,
            activeGames:
              activeGameCount,
            savedPicks,
            missingPicks,
            result:
              result.skipped
                ? "skipped"
                : "failed",
            reason:
              result.reason,
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      checkedWeeks:
        weeks.length,
      remindersSent,
      remindersSkipped,
      duplicateEvents,
      details,
    });
  } catch (error) {
    console.error(
      "NCAA Pick 'Em reminder cron failed",
      error,
    );

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to process NCAA Pick 'Em reminders.",
      },
      {
        status: 500,
      },
    );
  }
}
