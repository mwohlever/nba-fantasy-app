import {
  createHash,
} from "crypto";

import {
  NextResponse,
} from "next/server";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";


export const dynamic =
  "force-dynamic";


type RouteContext = {
  params:
    Promise<{
      token:
        string;
    }>;
};


type AcceptBody = {
  accessToken?: string;

  displayName?: string;
};


type AppUserRow = {
  id: string;

  team_id:
    number | null;

  display_name:
    string;

  email:
    string | null;

  auth_user_id:
    string | null;

  is_active:
    boolean;
};


function normalizeEmail(
  value:
    string,
) {
  return value
    .trim()
    .toLowerCase();
}


function hashToken(
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


function cleanDisplayName(
  value:
    string,
) {
  return value
    .trim()
    .replace(
      /\s+/g,
      " ",
    )
    .slice(
      0,
      80,
    );
}


function displayNameFromAuthUser(
  authUser:
    {
      email?:
        string;

      user_metadata?:
        Record<
          string,
          unknown
        >;
    },

  requestedName:
    string,
) {
  const explicit =
    cleanDisplayName(
      requestedName,
    );


  if (explicit) {
    return explicit;
  }


  const metadata =
    authUser.user_metadata ??
    {};


  const candidates = [
    metadata.full_name,
    metadata.name,
    metadata.display_name,
  ];


  for (
    const candidate
    of candidates
  ) {
    if (
      typeof candidate ===
      "string"
    ) {
      const cleaned =
        cleanDisplayName(
          candidate,
        );


      if (cleaned) {
        return cleaned;
      }
    }
  }


  const email =
    String(
      authUser.email ??
        "",
    );


  const localPart =
    email
      .split(
        "@",
      )[0]
      ?.replace(
        /[._-]+/g,
        " ",
      ) ??
    "";


  return (
    cleanDisplayName(
      localPart,
    ) ||
    "111 Sports Player"
  );
}


async function loadInvite(
  rawToken:
    string,
) {
  const tokenHash =
    hashToken(
      rawToken,
    );


  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "group_invites",
      )
      .select(
        `
          id,
          group_id,
          email,
          status,
          expires_at,
          accepted_at,
          revoked_at,
          created_at,
          groups (
            id,
            name,
            slug,
            is_active
          )
        `,
      )
      .eq(
        "token_hash",
        tokenHash,
      )
      .maybeSingle();


  if (error) {
    throw new Error(
      `Unable to load invitation: ${error.message}`,
    );
  }


  return data;
}


function relatedGroup(
  value:
    unknown,
) {
  if (
    Array.isArray(
      value,
    )
  ) {
    return (
      value[0] ??
      null
    ) as
      | {
          id: string;
          name: string;
          slug: string;
          is_active: boolean;
        }
      | null;
  }


  return value as
    | {
        id: string;
        name: string;
        slug: string;
        is_active: boolean;
      }
    | null;
}


async function makeUniqueTeamName(
  desiredName:
    string,

  groupName:
    string,
) {
  const base =
    cleanDisplayName(
      desiredName,
    ) ||
    "Player";


  const candidates = [
    base,

    `${base} (${groupName})`,
  ];


  for (
    let index =
      2;
    index <=
      20;
    index +=
      1
  ) {
    candidates.push(
      `${base} (${groupName} ${index})`,
    );
  }


  for (
    const candidate
    of candidates
  ) {
    const {
      data,
      error,
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
          candidate,
        )
        .maybeSingle();


    if (error) {
      throw new Error(
        `Unable to validate team name: ${error.message}`,
      );
    }


    if (!data) {
      return candidate;
    }
  }


  throw new Error(
    "Unable to create a unique fantasy-team name.",
  );
}


export async function GET(
  _request:
    Request,

  context:
    RouteContext,
) {
  try {
    const {
      token,
    } =
      await context.params;


    const rawToken =
      String(
        token ??
          "",
      ).trim();


    if (
      !rawToken
    ) {
      return NextResponse.json(
        {
          error:
            "Invitation token is required.",
        },
        {
          status:
            400,
        },
      );
    }


    const invite =
      await loadInvite(
        rawToken,
      );


    if (!invite) {
      return NextResponse.json(
        {
          error:
            "This invitation could not be found.",
        },
        {
          status:
            404,
        },
      );
    }


    const group =
      relatedGroup(
        invite.groups,
      );


    if (!group) {
      return NextResponse.json(
        {
          error:
            "The Group for this invitation no longer exists.",
        },
        {
          status:
            404,
        },
      );
    }


    if (
      invite.status ===
      "pending" &&
      new Date(
        invite.expires_at,
      ).getTime() <=
        Date.now()
    ) {
      const now =
        new Date()
          .toISOString();


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
        .eq(
          "id",
          invite.id,
        )
        .eq(
          "status",
          "pending",
        );


      return NextResponse.json(
        {
          error:
            "This invitation has expired.",

          status:
            "expired",
        },
        {
          status:
            410,
        },
      );
    }


    if (
      invite.status !==
      "pending"
    ) {
      const labels:
        Record<
          string,
          string
        > = {
          accepted:
            "This invitation has already been accepted.",

          revoked:
            "This invitation has been revoked.",

          expired:
            "This invitation has expired.",
        };


      return NextResponse.json(
        {
          error:
            labels[
              invite.status
            ] ??
            "This invitation is no longer available.",

          status:
            invite.status,
        },
        {
          status:
            410,
        },
      );
    }


    if (
      !group.is_active
    ) {
      return NextResponse.json(
        {
          error:
            "This Group is currently inactive.",
        },
        {
          status:
            409,
        },
      );
    }


    return NextResponse.json({
      success:
        true,

      invite: {
        id:
          invite.id,

        email:
          normalizeEmail(
            invite.email,
          ),

        expiresAt:
          invite.expires_at,

        createdAt:
          invite.created_at,
      },

      group: {
        id:
          group.id,

        name:
          group.name,

        slug:
          group.slug,
      },
    });
  } catch (
    error
  ) {
    console.error(
      "Failed to resolve Group invitation",
      error,
    );


    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to load invitation.",
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

  context:
    RouteContext,
) {
  try {
    const {
      token,
    } =
      await context.params;


    const rawToken =
      String(
        token ??
          "",
      ).trim();


    const body =
      (
        await request.json()
      ) as AcceptBody;


    const accessToken =
      String(
        body.accessToken ??
          "",
      ).trim();


    if (
      !rawToken ||
      !accessToken
    ) {
      return NextResponse.json(
        {
          error:
            "Invitation and authenticated session are required.",
        },
        {
          status:
            400,
        },
      );
    }


    // ==========================================================
    // VERIFY AUTH IDENTITY SERVER-SIDE
    // ==========================================================

    const {
      data:
        authData,
      error:
        authError,
    } =
      await supabaseAdmin
        .auth
        .getUser(
          accessToken,
        );


    const authUser =
      authData.user;


    if (
      authError ||
      !authUser
    ) {
      return NextResponse.json(
        {
          error:
            "Your authentication session could not be verified.",
        },
        {
          status:
            401,
        },
      );
    }


    const authEmail =
      normalizeEmail(
        String(
          authUser.email ??
            "",
        ),
      );


    if (!authEmail) {
      return NextResponse.json(
        {
          error:
            "Your sign-in did not provide an email address.",
        },
        {
          status:
            400,
        },
      );
    }


    // ==========================================================
    // LOAD + VALIDATE INVITE
    // ==========================================================

    const invite =
      await loadInvite(
        rawToken,
      );


    if (!invite) {
      return NextResponse.json(
        {
          error:
            "This invitation could not be found.",
        },
        {
          status:
            404,
        },
      );
    }


    const group =
      relatedGroup(
        invite.groups,
      );


    if (!group) {
      return NextResponse.json(
        {
          error:
            "The Group for this invitation no longer exists.",
        },
        {
          status:
            404,
        },
      );
    }


    if (
      invite.status !==
      "pending"
    ) {
      return NextResponse.json(
        {
          error:
            invite.status ===
            "accepted"
              ? "This invitation has already been accepted."
              : "This invitation is no longer active.",
        },
        {
          status:
            409,
        },
      );
    }


    if (
      new Date(
        invite.expires_at,
      ).getTime() <=
        Date.now()
    ) {
      const now =
        new Date()
          .toISOString();


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
        .eq(
          "id",
          invite.id,
        )
        .eq(
          "status",
          "pending",
        );


      return NextResponse.json(
        {
          error:
            "This invitation has expired.",
        },
        {
          status:
            410,
        },
      );
    }


    if (
      !group.is_active
    ) {
      return NextResponse.json(
        {
          error:
            "This Group is currently inactive.",
        },
        {
          status:
            409,
        },
      );
    }


    const inviteEmail =
      normalizeEmail(
        invite.email,
      );


    if (
      authEmail !==
      inviteEmail
    ) {
      return NextResponse.json(
        {
          error:
            `This invitation is for ${inviteEmail}. Sign in with that exact email address.`,

          code:
            "INVITE_EMAIL_MISMATCH",
        },
        {
          status:
            403,
        },
      );
    }


    // ==========================================================
    // RESOLVE / CREATE PERMANENT APP USER
    // ==========================================================

    const {
      data:
        byAuthData,
      error:
        byAuthError,
    } =
      await supabaseAdmin
        .from(
          "app_users",
        )
        .select(
          `
            id,
            team_id,
            display_name,
            email,
            auth_user_id,
            is_active
          `,
        )
        .eq(
          "auth_user_id",
          authUser.id,
        )
        .maybeSingle();


    if (byAuthError) {
      throw new Error(
        `Unable to resolve your 111 Sports account: ${byAuthError.message}`,
      );
    }


    let appUser =
      byAuthData as
        AppUserRow |
        null;


    if (!appUser) {
      const {
        data:
          byEmailData,
        error:
          byEmailError,
      } =
        await supabaseAdmin
          .from(
            "app_users",
          )
          .select(
            `
              id,
              team_id,
              display_name,
              email,
              auth_user_id,
              is_active
            `,
          )
          .eq(
            "email",
            authEmail,
          )
          .maybeSingle();


      if (byEmailError) {
        throw new Error(
          `Unable to resolve your account by email: ${byEmailError.message}`,
        );
      }


      const byEmail =
        byEmailData as
          AppUserRow |
          null;


      if (
        byEmail?.auth_user_id &&
        byEmail.auth_user_id !==
          authUser.id
      ) {
        return NextResponse.json(
          {
            error:
              "That email is already linked to another authentication identity.",
          },
          {
            status:
              409,
          },
        );
      }


      if (byEmail) {
        const now =
          new Date()
            .toISOString();


        const {
          data:
            linkedData,
          error:
            linkedError,
        } =
          await supabaseAdmin
            .from(
              "app_users",
            )
            .update({
              auth_user_id:
                authUser.id,

              email:
                authEmail,

              auth_linked_at:
                now,

              updated_at:
                now,
            })
            .eq(
              "id",
              byEmail.id,
            )
            .select(
              `
                id,
                team_id,
                display_name,
                email,
                auth_user_id,
                is_active
              `,
            )
            .single();


        if (
          linkedError ||
          !linkedData
        ) {
          throw new Error(
            `Unable to link your existing account${linkedError?.message ? `: ${linkedError.message}` : "."}`,
          );
        }


        appUser =
          linkedData as
            AppUserRow;
      } else {
        const displayName =
          displayNameFromAuthUser(
            authUser,
            String(
              body.displayName ??
                "",
            ),
          );


        const now =
          new Date()
            .toISOString();


        const {
          data:
            createdData,
          error:
            createdError,
        } =
          await supabaseAdmin
            .from(
              "app_users",
            )
            .insert({
              team_id:
                null,

              display_name:
                displayName,

              role:
                "player",

              system_role:
                "user",

              pin_salt:
                null,

              pin_hash:
                null,

              is_active:
                true,

              email:
                authEmail,

              auth_user_id:
                authUser.id,

              auth_linked_at:
                now,

              updated_at:
                now,
            })
            .select(
              `
                id,
                team_id,
                display_name,
                email,
                auth_user_id,
                is_active
              `,
            )
            .single();


        if (
          createdError ||
          !createdData
        ) {
          throw new Error(
            `Unable to create your 111 Sports account${createdError?.message ? `: ${createdError.message}` : "."}`,
          );
        }


        appUser =
          createdData as
            AppUserRow;
      }
    }


    if (
      !appUser.is_active
    ) {
      return NextResponse.json(
        {
          error:
            "Your 111 Sports account is inactive.",
        },
        {
          status:
            403,
        },
      );
    }


    // ==========================================================
    // GROUP MEMBERSHIP
    // ==========================================================

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
          `
            id,
            role,
            is_active
          `,
        )
        .eq(
          "group_id",
          group.id,
        )
        .eq(
          "user_id",
          appUser.id,
        )
        .maybeSingle();


    if (
      membershipLookupError
    ) {
      throw new Error(
        `Unable to check Group membership: ${membershipLookupError.message}`,
      );
    }


    if (
      existingMembership
    ) {
      if (
        !existingMembership.is_active
      ) {
        const {
          error:
            reactivateError,
        } =
          await supabaseAdmin
            .from(
              "group_memberships",
            )
            .update({
              is_active:
                true,

              updated_at:
                new Date()
                  .toISOString(),
            })
            .eq(
              "id",
              existingMembership.id,
            );


        if (
          reactivateError
        ) {
          throw new Error(
            `Unable to reactivate Group membership: ${reactivateError.message}`,
          );
        }
      }
    } else {
      const {
        error:
          membershipCreateError,
      } =
        await supabaseAdmin
          .from(
            "group_memberships",
          )
          .insert({
            group_id:
              group.id,

            user_id:
              appUser.id,

            role:
              "member",

            is_active:
              true,
          });


      if (
        membershipCreateError
      ) {
        throw new Error(
          `Unable to create Group membership: ${membershipCreateError.message}`,
        );
      }
    }


    // ==========================================================
    // GROUP-SPECIFIC FANTASY TEAM
    // ==========================================================

    const {
      data:
        existingTeam,
      error:
        teamLookupError,
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
          group.id,
        )
        .eq(
          "user_id",
          appUser.id,
        )
        .maybeSingle();


    if (
      teamLookupError
    ) {
      throw new Error(
        `Unable to check Group team: ${teamLookupError.message}`,
      );
    }


    let team =
      existingTeam;


    if (!team) {
      const teamName =
        await makeUniqueTeamName(
          appUser.display_name,
          group.name,
        );


      const {
        data:
          createdTeam,
        error:
          teamCreateError,
      } =
        await supabaseAdmin
          .from(
            "teams",
          )
          .insert({
            name:
              teamName,

            group_id:
              group.id,

            user_id:
              appUser.id,
          })
          .select(
            `
              id,
              name
            `,
          )
          .single();


      if (
        teamCreateError ||
        !createdTeam
      ) {
        throw new Error(
          `Unable to create your Group team${teamCreateError?.message ? `: ${teamCreateError.message}` : "."}`,
        );
      }


      team =
        createdTeam;
    }


    /*
     * Legacy/default pointer:
     *
     * New accounts do not begin with a team_id. Set it once to
     * their first Group team for transitional compatibility.
     *
     * Existing multi-Group users keep their original pointer.
     */
    if (
      appUser.team_id ===
      null
    ) {
      const {
        error:
          pointerError,
      } =
        await supabaseAdmin
          .from(
            "app_users",
          )
          .update({
            team_id:
              team.id,

            updated_at:
              new Date()
                .toISOString(),
          })
          .eq(
            "id",
            appUser.id,
          )
          .is(
            "team_id",
            null,
          );


      if (
        pointerError
      ) {
        throw new Error(
          `Unable to finish account setup: ${pointerError.message}`,
        );
      }
    }


    // ==========================================================
    // CONSUME INVITATION LAST
    // ==========================================================

    const now =
      new Date()
        .toISOString();


    const {
      data:
        acceptedInvite,
      error:
        acceptError,
    } =
      await supabaseAdmin
        .from(
          "group_invites",
        )
        .update({
          status:
            "accepted",

          accepted_by_user_id:
            appUser.id,

          accepted_at:
            now,

          updated_at:
            now,
        })
        .eq(
          "id",
          invite.id,
        )
        .eq(
          "status",
          "pending",
        )
        .select(
          "id",
        )
        .maybeSingle();


    if (acceptError) {
      throw new Error(
        `Unable to finish invitation acceptance: ${acceptError.message}`,
      );
    }


    if (!acceptedInvite) {
      return NextResponse.json(
        {
          error:
            "This invitation was already used or changed while onboarding was completing.",
        },
        {
          status:
            409,
        },
      );
    }


    return NextResponse.json({
      success:
        true,

      group: {
        id:
          group.id,

        name:
          group.name,

        slug:
          group.slug,
      },

      user: {
        id:
          appUser.id,

        displayName:
          appUser.display_name,

        email:
          authEmail,
      },

      team: {
        id:
          team.id,

        name:
          team.name,
      },
    });
  } catch (
    error
  ) {
    console.error(
      "Group invitation acceptance failed",
      error,
    );


    return NextResponse.json(
      {
        error:
          error instanceof
          Error
            ? error.message
            : "Unable to accept invitation.",
      },
      {
        status:
          500,
      },
    );
  }
}
