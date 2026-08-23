import {
  getCurrentUser,
} from "@/lib/auth";

import {
  getGroupContextForUser,
} from "@/lib/groups/context";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";


export type NotificationHistoryGroupOption = {
  id: string;
  name: string;
  slug: string;
};


export type NotificationHistoryScope = {
  isSuperAdmin: boolean;

  activeGroupId: string;
  activeGroupName: string;

  availableGroups:
    NotificationHistoryGroupOption[];

  selectedGroupIds:
    string[];

  selectedLeagueIds:
    string[];

  groupNameByLeagueId:
    Record<string, string>;
};


export async function resolveNotificationHistoryScope(
  requestedGroupIds:
    string[] = [],
): Promise<
  NotificationHistoryScope |
  null
> {
  const user =
    await getCurrentUser();


  if (
    !user
  ) {
    return null;
  }


  const context =
    await getGroupContextForUser(
      user,
    );


  if (
    !context?.canAdministerGroup
  ) {
    return null;
  }


  const isSuperAdmin =
    user.systemRole ===
    "super_admin";


  let availableGroups:
    NotificationHistoryGroupOption[];


  if (
    isSuperAdmin
  ) {
    const {
      data,
      error,
    } =
      await supabaseAdmin
        .from(
          "groups",
        )
        .select(
          "id, name, slug",
        )
        .eq(
          "is_active",
          true,
        )
        .order(
          "name",
          {
            ascending:
              true,
          },
        );


    if (
      error
    ) {
      throw new Error(
        `Failed to load Groups for Notification History: ${error.message}`,
      );
    }


    availableGroups =
      (
        data ?? []
      ).map(
        (
          row,
        ) => ({
          id:
            String(
              row.id,
            ),

          name:
            String(
              row.name,
            ),

          slug:
            String(
              row.slug,
            ),
        }),
      );
  } else {
    availableGroups = [
      {
        id:
          context.group.id,

        name:
          context.group.name,

        slug:
          context.group.slug,
      },
    ];
  }


  const availableGroupIds =
    new Set(
      availableGroups.map(
        (
          group,
        ) =>
          group.id,
      ),
    );


  let selectedGroupIds:
    string[];


  if (
    isSuperAdmin &&
    requestedGroupIds.length >
      0
  ) {
    selectedGroupIds =
      Array.from(
        new Set(
          requestedGroupIds.filter(
            (
              groupId,
            ) =>
              availableGroupIds.has(
                groupId,
              ),
          ),
        ),
      );
  } else {
    selectedGroupIds = [
      context.group.id,
    ];
  }


  /*
   * Never allow an empty History scope.
   *
   * If malformed or stale Super Admin filters arrive,
   * fall back to the currently active Group.
   */
  if (
    selectedGroupIds.length ===
    0
  ) {
    selectedGroupIds = [
      context.group.id,
    ];
  }


  const {
    data: leagues,
    error:
      leaguesError,
  } =
    await supabaseAdmin
      .from(
        "leagues",
      )
      .select(
        "id, group_id",
      )
      .in(
        "group_id",
        selectedGroupIds,
      )
      .eq(
        "is_enabled",
        true,
      );


  if (
    leaguesError
  ) {
    throw new Error(
      `Failed to resolve Notification History leagues: ${leaguesError.message}`,
    );
  }


  const selectedLeagueIds =
    (
      leagues ?? []
    ).map(
      (
        row,
      ) =>
        String(
          row.id,
        ),
    );


  const groupNameById =
    new Map(
      availableGroups.map(
        (
          group,
        ) => [
          group.id,
          group.name,
        ],
      ),
    );


  const groupNameByLeagueId:
    Record<
      string,
      string
    > = {};


  for (
    const league
    of leagues ?? []
  ) {
    groupNameByLeagueId[
      String(
        league.id,
      )
    ] =
      groupNameById.get(
        String(
          league.group_id,
        ),
      ) ??
      "Unknown Group";
  }


  return {
    isSuperAdmin,

    activeGroupId:
      context.group.id,

    activeGroupName:
      context.group.name,

    availableGroups,

    selectedGroupIds,

    selectedLeagueIds,

    groupNameByLeagueId,
  };
}


export async function canOperateNotificationLeague(
  leagueId:
    string |
    null |
    undefined,
) {
  if (
    !leagueId
  ) {
    return false;
  }


  const user =
    await getCurrentUser();


  if (
    !user
  ) {
    return false;
  }


  if (
    user.systemRole ===
    "super_admin"
  ) {
    const {
      data,
      error,
    } =
      await supabaseAdmin
        .from(
          "leagues",
        )
        .select(
          `
            id,
            groups!inner (
              id,
              is_active
            )
          `,
        )
        .eq(
          "id",
          leagueId,
        )
        .eq(
          "groups.is_active",
          true,
        )
        .maybeSingle();


    return Boolean(
      !error &&
      data,
    );
  }


  const context =
    await getGroupContextForUser(
      user,
    );


  if (
    !context?.isGroupAdmin
  ) {
    return false;
  }


  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "leagues",
      )
      .select(
        "id",
      )
      .eq(
        "id",
        leagueId,
      )
      .eq(
        "group_id",
        context.group.id,
      )
      .maybeSingle();


  return Boolean(
    !error &&
    data,
  );
}
