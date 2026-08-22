import {
  createHash,
  randomBytes,
} from "crypto";

import {
  NextResponse,
} from "next/server";

import {
  getCurrentUser,
  type AppUser,
} from "@/lib/auth";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";


export const dynamic =
  "force-dynamic";


const INVITE_LIFETIME_DAYS =
  7;


const LEAGUE_TEMPLATES = {
  nba: {
    sport_key:
      "nba",
    game_mode:
      "standard",
    name:
      "NBA",
    slug:
      "nba",
  },

  nba_skins: {
    sport_key:
      "nba_skins",
    game_mode:
      "standard",
    name:
      "NBA Skins",
    slug:
      "nba-skins",
  },

  nfl: {
    sport_key:
      "nfl",
    game_mode:
      "standard",
    name:
      "NFL",
    slug:
      "nfl",
  },

  golf: {
    sport_key:
      "golf",
    game_mode:
      "standard",
    name:
      "Golf",
    slug:
      "golf",
  },

  ncaa_pickem: {
    sport_key:
      "ncaa_pickem",
    game_mode:
      "standard",
    name:
      "NCAA Pick 'Em",
    slug:
      "ncaa-pickem",
  },
} as const;


type LeagueKey =
  keyof typeof LEAGUE_TEMPLATES;


type ActionBody = {
  action?: string;

  groupId?: string;

  name?: string;

  slug?: string;

  sports?: string[];

  initialAdminUserId?: string;

  email?: string;

  inviteId?: string;

  membershipId?: string;

  leagueId?: string;

  role?:
    | "member"
    | "admin";

  isActive?: boolean;
};


function normalizeEmail(
  value:
    string,
) {
  return value
    .trim()
    .toLowerCase();
}


function normalizeSlug(
  value:
    string,
) {
  return value
    .trim()
    .toLowerCase()
    .replace(
      /[^a-z0-9]+/g,
      "-",
    )
    .replace(
      /^-+|-+$/g,
      "",
    );
}


function hashInviteToken(
  token:
    string,
) {
  return createHash(
    "sha256",
  )
    .update(
      token,
    )
    .digest(
      "hex",
    );
}


function makeInviteToken() {
  return randomBytes(
    32,
  ).toString(
    "base64url",
  );
}


async function getAdminGroupIds(
  user:
    AppUser,
) {
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
          "groups",
        )
        .select(
          "id",
        );

    if (error) {
      throw new Error(
        `Unable to load Groups: ${error.message}`,
      );
    }

    return (
      data ??
      []
    ).map(
      (row) =>
        String(
          row.id,
        ),
    );
  }


  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "group_memberships",
      )
      .select(
        "group_id",
      )
      .eq(
        "user_id",
        user.id,
      )
      .eq(
        "role",
        "admin",
      )
      .eq(
        "is_active",
        true,
      );

  if (error) {
    throw new Error(
      `Unable to load Group permissions: ${error.message}`,
    );
  }


  return (
    data ??
    []
  ).map(
    (row) =>
      String(
        row.group_id,
      ),
  );
}


async function userCanAdministerGroup(
  user:
    AppUser,
  groupId:
    string,
) {
  if (
    user.systemRole ===
    "super_admin"
  ) {
    return true;
  }


  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "group_memberships",
      )
      .select(
        "id",
      )
      .eq(
        "group_id",
        groupId,
      )
      .eq(
        "user_id",
        user.id,
      )
      .eq(
        "role",
        "admin",
      )
      .eq(
        "is_active",
        true,
      )
      .maybeSingle();


  if (error) {
    throw new Error(
      `Unable to validate Group permission: ${error.message}`,
    );
  }


  return Boolean(
    data,
  );
}


async function requireGroupAdmin(
  user:
    AppUser,
  groupId:
    string,
) {
  if (
    !groupId
  ) {
    return false;
  }


  return userCanAdministerGroup(
    user,
    groupId,
  );
}


async function expireOldInvites(
  groupIds:
    string[],
) {
  if (
    groupIds.length ===
    0
  ) {
    return;
  }


  const now =
    new Date()
      .toISOString();


  const {
    error,
  } =
    await supabaseAdmin
      .from(
        "group_invites",
      )
      .update({
        status:
          "expired",

        updated_at:
          now,
      })
      .in(
        "group_id",
        groupIds,
      )
      .eq(
        "status",
        "pending",
      )
      .lt(
        "expires_at",
        now,
      );


  if (error) {
    throw new Error(
      `Unable to expire old invitations: ${error.message}`,
    );
  }
}


export async function GET() {
  try {
    const user =
      await getCurrentUser();


    if (!user) {
      return NextResponse.json(
        {
          error:
            "Login required.",
        },
        {
          status:
            401,
        },
      );
    }


    const groupIds =
      await getAdminGroupIds(
        user,
      );


    if (
      groupIds.length ===
      0 &&
      user.systemRole !==
        "super_admin"
    ) {
      return NextResponse.json(
        {
          error:
            "Group administrator access required.",
        },
        {
          status:
            403,
        },
      );
    }


    await expireOldInvites(
      groupIds,
    );


    let platformUsers:
      Array<{
        id: string;
        display_name: string;
        email: string | null;
        avatar_url: string | null;
        system_role: string;
      }> =
      [];


    if (
      user.systemRole ===
      "super_admin"
    ) {
      const {
        data:
          platformUserData,
        error:
          platformUserError,
      } =
        await supabaseAdmin
          .from(
            "app_users",
          )
          .select(
            `
              id,
              display_name,
              email,
              avatar_url,
              system_role
            `,
          )
          .order(
            "display_name",
            {
              ascending:
                true,
            },
          );


      if (
        platformUserError
      ) {
        throw new Error(
          `Unable to load platform users: ${platformUserError.message}`,
        );
      }


      platformUsers =
        (
          platformUserData ??
          []
        ) as typeof platformUsers;
    }


    if (
      groupIds.length ===
      0
    ) {
      return NextResponse.json({
        success:
          true,

        permissions: {
          isSuperAdmin:
            user.systemRole ===
            "super_admin",

          canCreateGroups:
            user.systemRole ===
            "super_admin",
        },

        platformUsers,

        groups:
          [],
      });
    }


    const [
      groupsResult,
      membershipsResult,
      leaguesResult,
      invitesResult,
      teamsResult,
    ] =
      await Promise.all([
        supabaseAdmin
          .from(
            "groups",
          )
          .select(
            `
              id,
              name,
              slug,
              created_by_user_id,
              is_active,
              created_at,
              updated_at
            `,
          )
          .in(
            "id",
            groupIds,
          )
          .order(
            "created_at",
            {
              ascending:
                true,
            },
          ),

        supabaseAdmin
          .from(
            "group_memberships",
          )
          .select(
            `
              id,
              group_id,
              user_id,
              role,
              is_active,
              joined_at,
              created_at,
              updated_at
            `,
          )
          .in(
            "group_id",
            groupIds,
          )
          .order(
            "joined_at",
            {
              ascending:
                true,
            },
          ),

        supabaseAdmin
          .from(
            "leagues",
          )
          .select(
            `
              id,
              group_id,
              sport_key,
              game_mode,
              name,
              slug,
              is_enabled
            `,
          )
          .in(
            "group_id",
            groupIds,
          )
          .order(
            "name",
            {
              ascending:
                true,
            },
          ),

        supabaseAdmin
          .from(
            "group_invites",
          )
          .select(
            `
              id,
              group_id,
              email,
              status,
              invited_by_user_id,
              accepted_by_user_id,
              expires_at,
              accepted_at,
              revoked_at,
              created_at,
              updated_at
            `,
          )
          .in(
            "group_id",
            groupIds,
          )
          .order(
            "created_at",
            {
              ascending:
                false,
            },
          ),

        supabaseAdmin
          .from(
            "teams",
          )
          .select(
            `
              id,
              name,
              group_id,
              user_id
            `,
          )
          .in(
            "group_id",
            groupIds,
          ),
      ]);


    const loadError =
      groupsResult.error ??
      membershipsResult.error ??
      leaguesResult.error ??
      invitesResult.error ??
      teamsResult.error;


    if (loadError) {
      throw new Error(
        `Unable to load Group administration data: ${loadError.message}`,
      );
    }


    const memberships =
      membershipsResult.data ??
      [];


    const userIds =
      Array.from(
        new Set(
          memberships.map(
            (membership) =>
              String(
                membership.user_id,
              ),
          ),
        ),
      );


    let appUsers:
      Array<{
        id: string;
        display_name: string;
        email: string | null;
        avatar_url: string | null;
        system_role: string;
      }> =
      [];


    if (
      userIds.length >
      0
    ) {
      const {
        data,
        error,
      } =
        await supabaseAdmin
          .from(
            "app_users",
          )
          .select(
            `
              id,
              display_name,
              email,
              avatar_url,
              system_role
            `,
          )
          .in(
            "id",
            userIds,
          );


      if (error) {
        throw new Error(
          `Unable to load Group members: ${error.message}`,
        );
      }


      appUsers =
        (
          data ??
          []
        ) as typeof appUsers;
    }


    const appUserById =
      new Map(
        appUsers.map(
          (appUser) => [
            appUser.id,
            appUser,
          ],
        ),
      );


    const teams =
      teamsResult.data ??
      [];


    const teamByGroupUser =
      new Map(
        teams
          .filter(
            (team) =>
              team.group_id &&
              team.user_id,
          )
          .map(
            (team) => [
              `${team.group_id}:${team.user_id}`,
              {
                id:
                  Number(
                    team.id,
                  ),

                name:
                  String(
                    team.name,
                  ),
              },
            ],
          ),
      );


    const resultGroups =
      (
        groupsResult.data ??
        []
      ).map(
        (group) => ({
          ...group,

          leagues:
            (
              leaguesResult.data ??
              []
            ).filter(
              (league) =>
                league.group_id ===
                group.id,
            ),

          members:
            memberships
              .filter(
                (membership) =>
                  membership.group_id ===
                  group.id,
              )
              .map(
                (membership) => {
                  const member =
                    appUserById.get(
                      String(
                        membership.user_id,
                      ),
                    ) ??
                    null;


                  const team =
                    teamByGroupUser.get(
                      `${group.id}:${membership.user_id}`,
                    ) ??
                    null;


                  return {
                    ...membership,

                    display_name:
                      member?.display_name ??
                      "Unknown user",

                    email:
                      member?.email ??
                      null,

                    avatar_url:
                      member?.avatar_url ??
                      null,

                    system_role:
                      member?.system_role ??
                      "user",

                    team,
                  };
                },
              ),

          invites:
            (
              invitesResult.data ??
              []
            ).filter(
              (invite) =>
                invite.group_id ===
                group.id,
            ),
        }),
      );


    return NextResponse.json({
      success:
        true,

      permissions: {
        isSuperAdmin:
          user.systemRole ===
          "super_admin",

        canCreateGroups:
          user.systemRole ===
          "super_admin",
      },

      currentUser: {
        id:
          user.id,

        displayName:
          user.displayName,

        email:
          user.email,

        systemRole:
          user.systemRole,
      },

      platformUsers,

      groups:
        resultGroups,
    });
  } catch (
    error
  ) {
    console.error(
      "Failed to load Group administration",
      error,
    );


    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to load Group administration.",
      },
      {
        status:
          500,
      },
    );
  }
}


export async function POST(
  request:
    Request,
) {
  try {
    const user =
      await getCurrentUser();


    if (!user) {
      return NextResponse.json(
        {
          error:
            "Login required.",
        },
        {
          status:
            401,
        },
      );
    }


    const body =
      (
        await request.json()
      ) as ActionBody;


    const action =
      String(
        body.action ??
          "",
      );


    // ==========================================================
    // CREATE GROUP
    // ==========================================================

    if (
      action ===
      "create_group"
    ) {
      if (
        user.systemRole !==
        "super_admin"
      ) {
        return NextResponse.json(
          {
            error:
              "Super Admin access required.",
          },
          {
            status:
              403,
          },
        );
      }


      const name =
        String(
          body.name ??
            "",
        ).trim();


      /*
       * Blank slug means "derive it from the Group name."
       *
       * The admin UI intentionally allows this field to be empty.
       * `??` alone is not enough because an empty string is neither
       * null nor undefined.
       */
      const requestedSlug =
        String(
          body.slug ??
            "",
        ).trim();


      const slug =
        normalizeSlug(
          requestedSlug ||
            name,
        );


      if (
        !name ||
        name.length >
          80
      ) {
        return NextResponse.json(
          {
            error:
              "Group name must be between 1 and 80 characters.",
          },
          {
            status:
              400,
          },
        );
      }


      if (
        !slug ||
        !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(
          slug,
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Group slug is invalid.",
          },
          {
            status:
              400,
          },
        );
      }


      const requestedSports =
        Array.from(
          new Set(
            (
              body.sports ??
              []
            ).filter(
              (
                value,
              ): value is LeagueKey =>
                Object.prototype.hasOwnProperty.call(
                  LEAGUE_TEMPLATES,
                  value,
                ),
            ),
          ),
        );


      if (
        requestedSports.length ===
        0
      ) {
        return NextResponse.json(
          {
            error:
              "Choose at least one game for the Group.",
          },
          {
            status:
              400,
          },
        );
      }


      const initialAdminUserId =
        String(
          body.initialAdminUserId ??
            "",
        ).trim();


      if (
        !initialAdminUserId
      ) {
        return NextResponse.json(
          {
            error:
              "Choose an initial Group Admin.",
          },
          {
            status:
              400,
          },
        );
      }


      const {
        data:
          initialAdminUser,
        error:
          initialAdminUserError,
      } =
        await supabaseAdmin
          .from(
            "app_users",
          )
          .select(
            `
              id,
              display_name,
              email
            `,
          )
          .eq(
            "id",
            initialAdminUserId,
          )
          .maybeSingle();


      if (
        initialAdminUserError
      ) {
        throw new Error(
          `Unable to validate initial Group Admin: ${initialAdminUserError.message}`,
        );
      }


      if (
        !initialAdminUser
      ) {
        return NextResponse.json(
          {
            error:
              "That initial Group Admin account no longer exists.",
          },
          {
            status:
              400,
          },
        );
      }


      const {
        data:
          createdGroup,
        error:
          groupError,
      } =
        await supabaseAdmin
          .from(
            "groups",
          )
          .insert({
            name,
            slug,

            created_by_user_id:
              user.id,

            is_active:
              true,
          })
          .select(
            `
              id,
              name,
              slug,
              is_active
            `,
          )
          .single();


      if (
        groupError ||
        !createdGroup
      ) {
        const duplicate =
          groupError?.code ===
          "23505";


        return NextResponse.json(
          {
            error:
              duplicate
                ? "That Group name/slug is already in use."
                : `Unable to create Group${groupError?.message ? `: ${groupError.message}` : "."}`,
          },
          {
            status:
              duplicate
                ? 409
                : 500,
          },
        );
      }


      const groupId =
        String(
          createdGroup.id,
        );


      const {
        error:
          membershipError,
      } =
        await supabaseAdmin
          .from(
            "group_memberships",
          )
          .insert({
            group_id:
              groupId,

            user_id:
              initialAdminUser.id,

            role:
              "admin",

            is_active:
              true,
          });


      if (
        membershipError
      ) {
        await supabaseAdmin
          .from(
            "groups",
          )
          .delete()
          .eq(
            "id",
            groupId,
          );


        throw new Error(
          `Unable to create Group administrator membership: ${membershipError.message}`,
        );
      }


      /*
       * The selected initial Group Admin becomes the first
       * active member and receives the Group-specific fantasy
       * team identity. The Super Admin who created the Group
       * does not need Group membership.
       */
      const creatorTeamBaseName =
        String(
          initialAdminUser.display_name ??
            "Player",
        )
          .trim()
          .replace(
            /\s+/g,
            " ",
          ) ||
        "Player";


      const {
        data:
          existingCreatorTeam,
        error:
          existingCreatorTeamError,
      } =
        await supabaseAdmin
          .from(
            "teams",
          )
          .select(
            `
              id,
              name
            `,
          )
          .eq(
            "group_id",
            groupId,
          )
          .eq(
            "user_id",
            initialAdminUser.id,
          )
          .maybeSingle();


      if (
        existingCreatorTeamError
      ) {
        await supabaseAdmin
          .from(
            "groups",
          )
          .delete()
          .eq(
            "id",
            groupId,
          );


        throw new Error(
          `Unable to check Group creator team: ${existingCreatorTeamError.message}`,
        );
      }


      if (
        !existingCreatorTeam
      ) {
        let creatorTeamName =
          creatorTeamBaseName;


        const {
          data:
            sameNameTeam,
          error:
            sameNameTeamError,
        } =
          await supabaseAdmin
            .from(
              "teams",
            )
            .select(
              "id",
            )
            .eq(
              "name",
              creatorTeamName,
            )
            .maybeSingle();


        if (
          sameNameTeamError
        ) {
          await supabaseAdmin
            .from(
              "groups",
            )
            .delete()
            .eq(
              "id",
              groupId,
            );


          throw new Error(
            `Unable to validate Group creator team name: ${sameNameTeamError.message}`,
          );
        }


        if (
          sameNameTeam
        ) {
          creatorTeamName =
            `${creatorTeamBaseName} (${createdGroup.name})`;
        }


        const {
          error:
            creatorTeamError,
        } =
          await supabaseAdmin
            .from(
              "teams",
            )
            .insert({
              name:
                creatorTeamName,

              group_id:
                groupId,

              user_id:
                initialAdminUser.id,
            });


        if (
          creatorTeamError
        ) {
          await supabaseAdmin
            .from(
              "groups",
            )
            .delete()
            .eq(
              "id",
              groupId,
            );


          throw new Error(
            `Unable to create Group creator team: ${creatorTeamError.message}`,
          );
        }
      }


      const leagueRows =
        requestedSports.map(
          (sportKey) => {
            const template =
              LEAGUE_TEMPLATES[
                sportKey
              ];


            return {
              group_id:
                groupId,

              sport_key:
                template.sport_key,

              game_mode:
                template.game_mode,

              name:
                template.name,

              slug:
                template.slug,

              is_enabled:
                true,

              settings_version:
                1,

              settings:
                {},
            };
          },
        );


      const {
        error:
          leaguesError,
      } =
        await supabaseAdmin
          .from(
            "leagues",
          )
          .insert(
            leagueRows,
          );


      if (
        leaguesError
      ) {
        await supabaseAdmin
          .from(
            "groups",
          )
          .delete()
          .eq(
            "id",
            groupId,
          );


        throw new Error(
          `Unable to create Group leagues: ${leaguesError.message}`,
        );
      }


      return NextResponse.json({
        success:
          true,

        group:
          createdGroup,
      });
    }


    // ==========================================================
    // CREATE / REISSUE INVITE
    // ==========================================================

    if (
      action ===
      "create_invite"
    ) {
      const groupId =
        String(
          body.groupId ??
            "",
        ).trim();


      if (
        !(
          await requireGroupAdmin(
            user,
            groupId,
          )
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Group administrator access required.",
          },
          {
            status:
              403,
          },
        );
      }


      const email =
        normalizeEmail(
          String(
            body.email ??
              "",
          ),
        );


      if (
        !email ||
        email.length >
          320 ||
        !email.includes(
          "@",
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Enter a valid email address.",
          },
          {
            status:
              400,
          },
        );
      }


      /*
       * Do not invite somebody who is already an active member
       * of the Group.
       */
      const {
        data:
          existingUser,
        error:
          existingUserError,
      } =
        await supabaseAdmin
          .from(
            "app_users",
          )
          .select(
            "id",
          )
          .eq(
            "email",
            email,
          )
          .maybeSingle();


      if (
        existingUserError
      ) {
        throw new Error(
          `Unable to check existing account: ${existingUserError.message}`,
        );
      }


      if (
        existingUser
      ) {
        const {
          data:
            existingMembership,
          error:
            membershipLookupError,
        } =
          await supabaseAdmin
            .from(
              "group_memberships",
            )
            .select(
              "id, is_active",
            )
            .eq(
              "group_id",
              groupId,
            )
            .eq(
              "user_id",
              existingUser.id,
            )
            .maybeSingle();


        if (
          membershipLookupError
        ) {
          throw new Error(
            `Unable to check existing Group membership: ${membershipLookupError.message}`,
          );
        }


        if (
          existingMembership
            ?.is_active
        ) {
          return NextResponse.json(
            {
              error:
                "That email already belongs to an active member of this Group.",
            },
            {
              status:
                409,
            },
          );
        }
      }


      const now =
        new Date()
          .toISOString();


      /*
       * Reissuing is intentionally destructive to the previous
       * pending token. Raw tokens are never stored, so a fresh
       * token is the only safe way to produce another copyable URL.
       */
      const {
        error:
          revokeExistingError,
      } =
        await supabaseAdmin
          .from(
            "group_invites",
          )
          .update({
            status:
              "revoked",

            revoked_at:
              now,

            updated_at:
              now,
          })
          .eq(
            "group_id",
            groupId,
          )
          .eq(
            "email",
            email,
          )
          .eq(
            "status",
            "pending",
          );


      if (
        revokeExistingError
      ) {
        throw new Error(
          `Unable to replace existing invitation: ${revokeExistingError.message}`,
        );
      }


      const rawToken =
        makeInviteToken();


      const tokenHash =
        hashInviteToken(
          rawToken,
        );


      const expiresAt =
        new Date();


      expiresAt.setDate(
        expiresAt.getDate() +
          INVITE_LIFETIME_DAYS,
      );


      const {
        data:
          invite,
        error:
          inviteError,
      } =
        await supabaseAdmin
          .from(
            "group_invites",
          )
          .insert({
            group_id:
              groupId,

            email,

            token_hash:
              tokenHash,

            status:
              "pending",

            invited_by_user_id:
              user.id,

            expires_at:
              expiresAt
                .toISOString(),
          })
          .select(
            `
              id,
              group_id,
              email,
              status,
              expires_at,
              created_at
            `,
          )
          .single();


      if (
        inviteError ||
        !invite
      ) {
        throw new Error(
          `Unable to create invitation${inviteError?.message ? `: ${inviteError.message}` : "."}`,
        );
      }


      const origin =
        new URL(
          request.url,
        ).origin;


      return NextResponse.json({
        success:
          true,

        invite,

        inviteUrl:
          `${origin}/invite/${rawToken}`,
      });
    }


    // ==========================================================
    // REVOKE INVITE
    // ==========================================================

    if (
      action ===
      "revoke_invite"
    ) {
      const groupId =
        String(
          body.groupId ??
            "",
        ).trim();


      const inviteId =
        String(
          body.inviteId ??
            "",
        ).trim();


      if (
        !(
          await requireGroupAdmin(
            user,
            groupId,
          )
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Group administrator access required.",
          },
          {
            status:
              403,
          },
        );
      }


      const now =
        new Date()
          .toISOString();


      const {
        data,
        error,
      } =
        await supabaseAdmin
          .from(
            "group_invites",
          )
          .update({
            status:
              "revoked",

            revoked_at:
              now,

            updated_at:
              now,
          })
          .eq(
            "id",
            inviteId,
          )
          .eq(
            "group_id",
            groupId,
          )
          .eq(
            "status",
            "pending",
          )
          .select(
            "id",
          )
          .maybeSingle();


      if (error) {
        throw new Error(
          `Unable to revoke invitation: ${error.message}`,
        );
      }


      if (!data) {
        return NextResponse.json(
          {
            error:
              "That pending invitation was not found.",
          },
          {
            status:
              404,
          },
        );
      }


      return NextResponse.json({
        success:
          true,
      });
    }


    // ==========================================================
    // UPDATE MEMBER ROLE
    // ==========================================================

    if (
      action ===
      "update_member_role"
    ) {
      const groupId =
        String(
          body.groupId ??
            "",
        ).trim();


      const membershipId =
        String(
          body.membershipId ??
            "",
        ).trim();


      const role =
        body.role;


      if (
        role !==
          "member" &&
        role !==
          "admin"
      ) {
        return NextResponse.json(
          {
            error:
              "Invalid Group role.",
          },
          {
            status:
              400,
          },
        );
      }


      if (
        !(
          await requireGroupAdmin(
            user,
            groupId,
          )
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Group administrator access required.",
          },
          {
            status:
              403,
          },
        );
      }


      const {
        data:
          membership,
        error:
          membershipError,
      } =
        await supabaseAdmin
          .from(
            "group_memberships",
          )
          .select(
            `
              id,
              user_id,
              role,
              is_active
            `,
          )
          .eq(
            "id",
            membershipId,
          )
          .eq(
            "group_id",
            groupId,
          )
          .maybeSingle();


      if (
        membershipError
      ) {
        throw new Error(
          `Unable to load Group member: ${membershipError.message}`,
        );
      }


      if (
        !membership
      ) {
        return NextResponse.json(
          {
            error:
              "Group member not found.",
          },
          {
            status:
              404,
          },
        );
      }


      /*
       * Do not allow the final active Group admin to demote
       * themselves (or be demoted by another Group admin).
       */
      if (
        membership.role ===
          "admin" &&
        role ===
          "member"
      ) {
        const {
          count,
          error:
            adminCountError,
        } =
          await supabaseAdmin
            .from(
              "group_memberships",
            )
            .select(
              "id",
              {
                count:
                  "exact",

                head:
                  true,
              },
            )
            .eq(
              "group_id",
              groupId,
            )
            .eq(
              "role",
              "admin",
            )
            .eq(
              "is_active",
              true,
            );


        if (
          adminCountError
        ) {
          throw new Error(
            `Unable to validate Group administrators: ${adminCountError.message}`,
          );
        }


        if (
          Number(
            count ??
              0,
          ) <=
          1
        ) {
          return NextResponse.json(
            {
              error:
                "A Group must retain at least one active administrator.",
            },
            {
              status:
                409,
            },
          );
        }
      }


      const {
        error:
          updateError,
      } =
        await supabaseAdmin
          .from(
            "group_memberships",
          )
          .update({
            role,

            updated_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "id",
            membershipId,
          )
          .eq(
            "group_id",
            groupId,
          );


      if (
        updateError
      ) {
        throw new Error(
          `Unable to update Group role: ${updateError.message}`,
        );
      }


      return NextResponse.json({
        success:
          true,
      });
    }


    // ==========================================================
    // REMOVE MEMBER FROM GROUP
    // ==========================================================

    if (
      action ===
      "remove_member"
    ) {
      const groupId =
        String(
          body.groupId ??
            "",
        ).trim();


      const membershipId =
        String(
          body.membershipId ??
            "",
        ).trim();


      if (
        !(
          await requireGroupAdmin(
            user,
            groupId,
          )
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Group administrator access required.",
          },
          {
            status:
              403,
          },
        );
      }


      const {
        data:
          membership,
        error:
          membershipError,
      } =
        await supabaseAdmin
          .from(
            "group_memberships",
          )
          .select(
            `
              id,
              user_id,
              role,
              is_active
            `,
          )
          .eq(
            "id",
            membershipId,
          )
          .eq(
            "group_id",
            groupId,
          )
          .maybeSingle();


      if (
        membershipError
      ) {
        throw new Error(
          `Unable to load Group member: ${membershipError.message}`,
        );
      }


      if (
        !membership
      ) {
        return NextResponse.json(
          {
            error:
              "Group member not found.",
          },
          {
            status:
              404,
          },
        );
      }


      /*
       * An administrator should never remove their own current
       * membership from this screen. Another administrator can
       * handle that if necessary.
       */
      if (
        String(
          membership.user_id,
        ) ===
        user.id
      ) {
        return NextResponse.json(
          {
            error:
              "You cannot remove your own Group membership.",
          },
          {
            status:
              409,
          },
        );
      }


      /*
       * Never remove the final active Group administrator.
       */
      if (
        membership.role ===
          "admin" &&
        membership.is_active
      ) {
        const {
          count,
          error:
            adminCountError,
        } =
          await supabaseAdmin
            .from(
              "group_memberships",
            )
            .select(
              "id",
              {
                count:
                  "exact",

                head:
                  true,
              },
            )
            .eq(
              "group_id",
              groupId,
            )
            .eq(
              "role",
              "admin",
            )
            .eq(
              "is_active",
              true,
            );


        if (
          adminCountError
        ) {
          throw new Error(
            `Unable to validate Group administrators: ${adminCountError.message}`,
          );
        }


        if (
          Number(
            count ??
              0,
          ) <=
          1
        ) {
          return NextResponse.json(
            {
              error:
                "A Group must retain at least one active administrator.",
            },
            {
              status:
                409,
            },
          );
        }
      }


      const {
        error:
          removeError,
      } =
        await supabaseAdmin
          .from(
            "group_memberships",
          )
          .update({
            is_active:
              false,

            updated_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "id",
            membershipId,
          )
          .eq(
            "group_id",
            groupId,
          );


      if (
        removeError
      ) {
        throw new Error(
          `Unable to remove Group member: ${removeError.message}`,
        );
      }


      return NextResponse.json({
        success:
          true,
      });
    }


    // ==========================================================
    // PERMANENTLY DELETE AN EMPTY / TEST GROUP
    // ==========================================================

    if (
      action ===
      "delete_group"
    ) {
      if (
        user.systemRole !==
        "super_admin"
      ) {
        return NextResponse.json(
          {
            error:
              "Super Admin access required.",
          },
          {
            status:
              403,
          },
        );
      }


      const groupId =
        String(
          body.groupId ??
            "",
        ).trim();


      const {
        data:
          group,
        error:
          groupError,
      } =
        await supabaseAdmin
          .from(
            "groups",
          )
          .select(
            `
              id,
              name,
              slug,
              is_active
            `,
          )
          .eq(
            "id",
            groupId,
          )
          .maybeSingle();


      if (
        groupError
      ) {
        throw new Error(
          `Unable to load Group: ${groupError.message}`,
        );
      }


      if (
        !group
      ) {
        return NextResponse.json(
          {
            error:
              "Group not found.",
          },
          {
            status:
              404,
          },
        );
      }


      /*
       * The original 111 Group is never deletable from this UI.
       */
      if (
        group.slug ===
        "111"
      ) {
        return NextResponse.json(
          {
            error:
              "The primary 111 Group cannot be deleted.",
          },
          {
            status:
              409,
          },
        );
      }


      if (
        group.is_active
      ) {
        return NextResponse.json(
          {
            error:
              "Deactivate the Group before permanently deleting it.",
          },
          {
            status:
              409,
          },
        );
      }


      const {
        data:
          leagueRows,
        error:
          leaguesLookupError,
      } =
        await supabaseAdmin
          .from(
            "leagues",
          )
          .select(
            "id",
          )
          .eq(
            "group_id",
            groupId,
          );


      if (
        leaguesLookupError
      ) {
        throw new Error(
          `Unable to inspect Group leagues: ${leaguesLookupError.message}`,
        );
      }


      const leagueIds =
        (
          leagueRows ??
          []
        ).map(
          (row) =>
            String(
              row.id,
            ),
        );


      /*
       * Permanent Group deletion is intentionally limited to
       * Groups that have never accumulated slate history.
       */
      if (
        leagueIds.length >
        0
      ) {
        const {
          count:
            slateCount,
          error:
            slateCountError,
        } =
          await supabaseAdmin
            .from(
              "slates",
            )
            .select(
              "id",
              {
                count:
                  "exact",

                head:
                  true,
              },
            )
            .in(
              "league_id",
              leagueIds,
            );


        if (
          slateCountError
        ) {
          throw new Error(
            `Unable to inspect Group history: ${slateCountError.message}`,
          );
        }


        if (
          Number(
            slateCount ??
              0,
          ) >
          0
        ) {
          return NextResponse.json(
            {
              error:
                "This Group has slate history and cannot be permanently deleted. Leave it inactive instead.",
            },
            {
              status:
                409,
            },
          );
        }
      }


      /*
       * These Groups have no competitive history, so delete their
       * platform scaffolding in dependency-safe order.
       *
       * The app_users records themselves are deliberately NOT
       * deleted because accounts can belong to other Groups.
       */
      const cleanupTables = [
        "group_invites",
        "group_memberships",
        "teams",
        "leagues",
      ];


      for (
        const table of
        cleanupTables
      ) {
        const {
          error:
            cleanupError,
        } =
          await supabaseAdmin
            .from(
              table,
            )
            .delete()
            .eq(
              "group_id",
              groupId,
            );


        if (
          cleanupError
        ) {
          throw new Error(
            `Unable to delete ${table}: ${cleanupError.message}`,
          );
        }
      }


      const {
        error:
          deleteGroupError,
      } =
        await supabaseAdmin
          .from(
            "groups",
          )
          .delete()
          .eq(
            "id",
            groupId,
          );


      if (
        deleteGroupError
      ) {
        throw new Error(
          `Unable to permanently delete Group: ${deleteGroupError.message}`,
        );
      }


      return NextResponse.json({
        success:
          true,

        group: {
          id:
            groupId,

          name:
            group.name,
        },
      });
    }


    // ==========================================================
    // ENABLE / DISABLE A GAME INSIDE A GROUP
    // ==========================================================

    if (
      action ===
      "set_league_enabled"
    ) {
      const groupId =
        String(
          body.groupId ??
            "",
        ).trim();

      const leagueId =
        String(
          body.leagueId ??
            "",
        ).trim();

      if (
        !(
          await requireGroupAdmin(
            user,
            groupId,
          )
        )
      ) {
        return NextResponse.json(
          {
            error:
              "Group administrator access required.",
          },
          {
            status:
              403,
          },
        );
      }

      if (
        !leagueId
      ) {
        return NextResponse.json(
          {
            error:
              "League is required.",
          },
          {
            status:
              400,
          },
        );
      }

      const {
        data:
          league,
        error:
          leagueLookupError,
      } =
        await supabaseAdmin
          .from(
            "leagues",
          )
          .select(
            `
              id,
              group_id,
              name,
              is_enabled
            `,
          )
          .eq(
            "id",
            leagueId,
          )
          .eq(
            "group_id",
            groupId,
          )
          .maybeSingle();

      if (
        leagueLookupError
      ) {
        throw new Error(
          `Unable to load Group game: ${leagueLookupError.message}`,
        );
      }

      if (
        !league
      ) {
        return NextResponse.json(
          {
            error:
              "Game was not found in this Group.",
          },
          {
            status:
              404,
          },
        );
      }

      const isEnabled =
        body.isActive ===
        true;

      const {
        error:
          leagueUpdateError,
      } =
        await supabaseAdmin
          .from(
            "leagues",
          )
          .update({
            is_enabled:
              isEnabled,
          })
          .eq(
            "id",
            leagueId,
          )
          .eq(
            "group_id",
            groupId,
          );

      if (
        leagueUpdateError
      ) {
        throw new Error(
          `Unable to update Group game: ${leagueUpdateError.message}`,
        );
      }

      return NextResponse.json({
        success:
          true,

        league: {
          id:
            leagueId,

          name:
            league.name,

          isEnabled,
        },
      });
    }


    // ==========================================================
    // ACTIVATE / DEACTIVATE GROUP
    // ==========================================================

    if (
      action ===
      "set_group_active"
    ) {
      if (
        user.systemRole !==
        "super_admin"
      ) {
        return NextResponse.json(
          {
            error:
              "Super Admin access required.",
          },
          {
            status:
              403,
          },
        );
      }


      const groupId =
        String(
          body.groupId ??
            "",
        ).trim();


      const isActive =
        body.isActive ===
        true;


      const {
        error,
      } =
        await supabaseAdmin
          .from(
            "groups",
          )
          .update({
            is_active:
              isActive,

            updated_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "id",
            groupId,
          );


      if (error) {
        throw new Error(
          `Unable to update Group status: ${error.message}`,
        );
      }


      return NextResponse.json({
        success:
          true,
      });
    }


    return NextResponse.json(
      {
        error:
          "Unsupported Group administration action.",
      },
      {
        status:
          400,
      },
    );
  } catch (
    error
  ) {
    console.error(
      "Group administration action failed",
      error,
    );


    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to update Group administration.",
      },
      {
        status:
          500,
      },
    );
  }
}
