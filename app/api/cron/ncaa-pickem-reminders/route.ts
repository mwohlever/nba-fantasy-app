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
    const now =
      Date.now();

    /*
     * League reminder timing can vary by Group.
     *
     * Load every open week inside the largest supported reminder
     * horizon, then apply that week's own league setting below.
     */
    const windowStart =
      new Date(
        now,
      ).toISOString();

    const windowEnd =
      new Date(
        now +
          168 *
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
          "id, season, week_number, label, lock_at, status, league_id",
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
          "No Pick 'Em week is currently within the 168-hour maximum reminder window.",
      });
    }

    const candidateLeagueIds =
      [
        ...new Set(
          weeks
            .map(
              (week) =>
                week.league_id
                  ? String(
                      week.league_id,
                    )
                  : null,
            )
            .filter(
              (
                leagueId,
              ): leagueId is string =>
                Boolean(
                  leagueId,
                ),
            ),
        ),
      ];

    const {
      data: leagueRows,
      error: leaguesError,
    } =
      candidateLeagueIds.length >
      0
        ? await supabaseAdmin
            .from(
              "leagues",
            )
            .select(
              "id, group_id",
            )
            .in(
              "id",
              candidateLeagueIds,
            )
        : {
            data: [],
            error: null,
          };

    if (
      leaguesError
    ) {
      throw new Error(
        `Failed to resolve Pick 'Em leagues: ${leaguesError.message}`,
      );
    }

    const groupIdByLeagueId =
      new Map(
        (
          leagueRows ??
          []
        ).map(
          (row) => [
            String(
              row.id,
            ),
            String(
              row.group_id,
            ),
          ],
        ),
      );

    const groupIds =
      [
        ...new Set(
          [
            ...groupIdByLeagueId
              .values(),
          ],
        ),
      ];

    const {
      data: teamRows,
      error: teamsError,
    } =
      groupIds.length >
      0
        ? await supabaseAdmin
            .from(
              "teams",
            )
            .select(
              "id, user_id, group_id",
            )
            .in(
              "group_id",
              groupIds,
            )
            .not(
              "user_id",
              "is",
              null,
            )
        : {
            data: [],
            error: null,
          };

    if (
      teamsError
    ) {
      throw new Error(
        `Failed to load Pick 'Em Group teams: ${teamsError.message}`,
      );
    }

    const candidateUserIds =
      [
        ...new Set(
          (
            teamRows ??
            []
          )
            .map(
              (team) =>
                team.user_id
                  ? String(
                      team.user_id,
                    )
                  : null,
            )
            .filter(
              (
                userId,
              ): userId is string =>
                Boolean(
                  userId,
                ),
            ),
        ),
      ];

    const {
      data: membershipRows,
      error: membershipsError,
    } =
      candidateUserIds.length >
        0 &&
      groupIds.length >
        0
        ? await supabaseAdmin
            .from(
              "group_memberships",
            )
            .select(
              "group_id, user_id",
            )
            .in(
              "group_id",
              groupIds,
            )
            .in(
              "user_id",
              candidateUserIds,
            )
            .eq(
              "is_active",
              true,
            )
        : {
            data: [],
            error: null,
          };

    if (
      membershipsError
    ) {
      throw new Error(
        `Failed to load active Group memberships: ${membershipsError.message}`,
      );
    }

    const activeMembershipKeys =
      new Set(
        (
          membershipRows ??
          []
        ).map(
          (row) =>
            `${String(
              row.group_id,
            )}:${String(
              row.user_id,
            )}`,
        ),
      );

    const activeTeamRows =
      (
        teamRows ??
        []
      ).filter(
        (team) =>
          Boolean(
            team.user_id,
          ) &&
          activeMembershipKeys.has(
            `${String(
              team.group_id,
            )}:${String(
              team.user_id,
            )}`,
          ),
      );

    const userIds =
      [
        ...new Set(
          activeTeamRows.map(
            (team) =>
              String(
                team.user_id,
              ),
          ),
        ),
      ];

    const {
      data: users,
      error: usersError,
    } =
      userIds.length >
      0
        ? await supabaseAdmin
            .from(
              "app_users",
            )
            .select(
              "id, display_name",
            )
            .in(
              "id",
              userIds,
            )
            .eq(
              "is_active",
              true,
            )
        : {
            data: [],
            error: null,
          };

    if (
      usersError
    ) {
      throw new Error(
        `Failed to load active users: ${usersError.message}`,
      );
    }

    const userById =
      new Map(
        (
          users ??
          []
        ).map(
          (user) => [
            String(
              user.id,
            ),
            user,
          ],
        ),
      );

    const teamsByGroupId =
      new Map<
        string,
        typeof activeTeamRows
      >();

    for (
      const team
      of activeTeamRows
    ) {
      const groupId =
        String(
          team.group_id,
        );

      const existing =
        teamsByGroupId.get(
          groupId,
        ) ??
        [];

      existing.push(
        team,
      );

      teamsByGroupId.set(
        groupId,
        existing,
      );
    }

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

      const leagueId =
        week.league_id
          ? String(
              week.league_id,
            )
          : null;

      if (
        !leagueId
      ) {
        continue;
      }

      const groupId =
        groupIdByLeagueId.get(
          leagueId,
        ) ??
        null;

      if (
        !groupId
      ) {
        continue;
      }

      const reminderSettings =
        await getNcaaPickEmNotificationSettings(
          leagueId,
        );

      if (
        !reminderSettings.enabled
      ) {
        continue;
      }

      const lockAtMs =
        week.lock_at
          ? new Date(
              week.lock_at,
            ).getTime()
          : NaN;

      const leagueWindowEnd =
        now +
        reminderSettings
          .reminderHours *
          60 *
          60 *
          1000;

      if (
        !Number.isFinite(
          lockAtMs,
        ) ||
        lockAtMs <
          now ||
        lockAtMs >
          leagueWindowEnd
      ) {
        continue;
      }

      const weekTeams =
        teamsByGroupId.get(
          groupId,
        ) ??
        [];

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
        const team
        of weekTeams
      ) {
        const userId =
          String(
            team.user_id,
          );

        const teamId =
          Number(
            team.id,
          );

        const user =
          userById.get(
            userId,
          );

        if (
          !user
        ) {
          continue;
        }

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
            leagueId,

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
