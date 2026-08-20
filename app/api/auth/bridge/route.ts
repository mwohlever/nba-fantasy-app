import {
  NextResponse,
} from "next/server";

import {
  createUserSession,
  verifyPin,
} from "@/lib/auth";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";


type BridgeBody = {
  accessToken?: string;

  legacyTeamId?:
    number;

  legacyPin?:
    string;
};


type AppUserRow = {
  id: string;

  team_id:
    number | null;

  display_name:
    string;

  role:
    | "player"
    | "admin";

  system_role:
    | "user"
    | "super_admin";

  pin_salt:
    string | null;

  pin_hash:
    string | null;

  is_active:
    boolean;

  email:
    string | null;

  auth_user_id:
    string | null;
};


function normalizeEmail(
  value:
    string,
) {
  return value
    .trim()
    .toLowerCase();
}


async function createSessionResponse(
  user:
    AppUserRow,
) {
  await createUserSession(
    user.id,
  );


  return NextResponse.json({
    success:
      true,

    user: {
      id:
        user.id,

      teamId:
        user.team_id,

      displayName:
        user.display_name,

      role:
        user.role,

      systemRole:
        user.system_role,

      email:
        user.email,
    },
  });
}


export async function POST(
  request:
    Request,
) {
  try {
    const body =
      (
        await request.json()
      ) as BridgeBody;


    const accessToken =
      String(
        body.accessToken ??
          "",
      ).trim();


    if (
      !accessToken
    ) {
      return NextResponse.json(
        {
          error:
            "Supabase authentication token is required.",
        },
        {
          status: 400,
        },
      );
    }


    /*
     * IMPORTANT:
     *
     * Never trust email/user identifiers supplied by the browser.
     * Ask Supabase Auth to verify the access token itself.
     */
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
          status: 401,
        },
      );
    }


    const rawEmail =
      authUser.email ??
      "";


    if (
      !rawEmail
    ) {
      return NextResponse.json(
        {
          error:
            "Your authentication provider did not supply an email address.",
        },
        {
          status: 400,
        },
      );
    }


    /*
     * Password accounts should already be confirmed according to
     * the project's Supabase Auth settings. OAuth providers such
     * as Google also provide a verified identity through Supabase.
     */
    const email =
      normalizeEmail(
        rawEmail,
      );


    // =========================================================
    // A. ALREADY LINKED BY auth_user_id
    // =========================================================

    const {
      data:
        linkedByAuth,
      error:
        linkedByAuthError,
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
            role,
            system_role,
            pin_salt,
            pin_hash,
            is_active,
            email,
            auth_user_id
          `,
        )
        .eq(
          "auth_user_id",
          authUser.id,
        )
        .maybeSingle();


    if (
      linkedByAuthError
    ) {
      console.error(
        "Failed to resolve linked auth user",
        linkedByAuthError,
      );

      return NextResponse.json(
        {
          error:
            "Unable to complete sign in right now.",
        },
        {
          status: 500,
        },
      );
    }


    if (
      linkedByAuth
    ) {
      const user =
        linkedByAuth as
          AppUserRow;


      if (
        !user.is_active
      ) {
        return NextResponse.json(
          {
            error:
              "That 111 Sports account is unavailable.",
          },
          {
            status: 401,
          },
        );
      }


      return createSessionResponse(
        user,
      );
    }


    // =========================================================
    // B. PRE-LINKED EMAIL MATCH
    //
    // Useful for future invite onboarding and explicit account
    // setup. Because the Supabase access token proves control of
    // this email, an unclaimed matching app_users row can link.
    // =========================================================

    const {
      data:
        linkedByEmail,
      error:
        linkedByEmailError,
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
            role,
            system_role,
            pin_salt,
            pin_hash,
            is_active,
            email,
            auth_user_id
          `,
        )
        .eq(
          "email",
          email,
        )
        .maybeSingle();


    if (
      linkedByEmailError
    ) {
      console.error(
        "Failed to resolve account by email",
        linkedByEmailError,
      );

      return NextResponse.json(
        {
          error:
            "Unable to complete sign in right now.",
        },
        {
          status: 500,
        },
      );
    }


    if (
      linkedByEmail
    ) {
      const existing =
        linkedByEmail as
          AppUserRow;


      if (
        !existing.is_active
      ) {
        return NextResponse.json(
          {
            error:
              "That 111 Sports account is unavailable.",
          },
          {
            status: 401,
          },
        );
      }


      if (
        existing.auth_user_id &&
        existing.auth_user_id !==
          authUser.id
      ) {
        return NextResponse.json(
          {
            error:
              "That email is already linked to another authentication identity.",
          },
          {
            status: 409,
          },
        );
      }


      const now =
        new Date()
          .toISOString();


      const {
        data:
          updated,
        error:
          updateError,
      } =
        await supabaseAdmin
          .from(
            "app_users",
          )
          .update({
            auth_user_id:
              authUser.id,

            email,

            auth_linked_at:
              now,

            updated_at:
              now,
          })
          .eq(
            "id",
            existing.id,
          )
          .is(
            "auth_user_id",
            null,
          )
          .select(
            `
              id,
              team_id,
              display_name,
              role,
              system_role,
              pin_salt,
              pin_hash,
              is_active,
              email,
              auth_user_id
            `,
          )
          .maybeSingle();


      if (
        updateError
      ) {
        console.error(
          "Failed to link account by email",
          updateError,
        );

        return NextResponse.json(
          {
            error:
              "Unable to link your 111 Sports account.",
          },
          {
            status: 500,
          },
        );
      }


      if (
        updated
      ) {
        return createSessionResponse(
          updated as
            AppUserRow,
        );
      }


      /*
       * Another request may have linked the row concurrently.
       * Resolve one more time through auth_user_id.
       */
      const {
        data:
          concurrentLinked,
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
              role,
              system_role,
              pin_salt,
              pin_hash,
              is_active,
              email,
              auth_user_id
            `,
          )
          .eq(
            "auth_user_id",
            authUser.id,
          )
          .maybeSingle();


      if (
        concurrentLinked
      ) {
        return createSessionResponse(
          concurrentLinked as
            AppUserRow,
        );
      }
    }


    // =========================================================
    // C. EXPLICIT LEGACY PIN LINK
    //
    // The existing 111 member proves BOTH:
    //
    // 1. ownership of the modern authenticated email; and
    // 2. ownership of the legacy team/PIN account.
    //
    // This lets Mark/Andy/Jon/Josh safely link themselves
    // without placing their email addresses in source code.
    // =========================================================

    const legacyTeamId =
      Number(
        body.legacyTeamId,
      );

    const legacyPin =
      String(
        body.legacyPin ??
          "",
      ).trim();


    if (
      Number.isInteger(
        legacyTeamId,
      ) &&
      legacyTeamId >
        0 &&
      /^\d{4,8}$/.test(
        legacyPin,
      )
    ) {
      const {
        data:
          legacyData,
        error:
          legacyError,
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
              role,
              system_role,
              pin_salt,
              pin_hash,
              is_active,
              email,
              auth_user_id
            `,
          )
          .eq(
            "team_id",
            legacyTeamId,
          )
          .maybeSingle();


      if (
        legacyError
      ) {
        console.error(
          "Failed to load legacy account for auth linking",
          legacyError,
        );

        return NextResponse.json(
          {
            error:
              "Unable to link your existing account right now.",
          },
          {
            status: 500,
          },
        );
      }


      const legacyUser =
        legacyData as
          AppUserRow | null;


      if (
        !legacyUser?.is_active
      ) {
        return NextResponse.json(
          {
            error:
              "That existing 111 Sports account is unavailable.",
          },
          {
            status: 401,
          },
        );
      }


      if (
        !legacyUser.pin_salt ||
        !legacyUser.pin_hash
      ) {
        return NextResponse.json(
          {
            error:
              "That account does not have a legacy PIN available for linking.",
          },
          {
            status: 409,
          },
        );
      }


      const pinValid =
        await verifyPin(
          legacyPin,
          legacyUser.pin_salt,
          legacyUser.pin_hash,
        );


      if (
        !pinValid
      ) {
        return NextResponse.json(
          {
            error:
              "Incorrect PIN.",
          },
          {
            status: 401,
          },
        );
      }


      if (
        legacyUser.auth_user_id &&
        legacyUser.auth_user_id !==
          authUser.id
      ) {
        return NextResponse.json(
          {
            error:
              "That 111 Sports account is already linked to another sign-in.",
          },
          {
            status: 409,
          },
        );
      }


      if (
        legacyUser.email &&
        normalizeEmail(
          legacyUser.email,
        ) !==
          email
      ) {
        return NextResponse.json(
          {
            error:
              "That 111 Sports account is already associated with another email.",
          },
          {
            status: 409,
          },
        );
      }


      const now =
        new Date()
          .toISOString();


      const {
        data:
          linked,
        error:
          linkError,
      } =
        await supabaseAdmin
          .from(
            "app_users",
          )
          .update({
            email,

            auth_user_id:
              authUser.id,

            auth_linked_at:
              now,

            updated_at:
              now,
          })
          .eq(
            "id",
            legacyUser.id,
          )
          .select(
            `
              id,
              team_id,
              display_name,
              role,
              system_role,
              pin_salt,
              pin_hash,
              is_active,
              email,
              auth_user_id
            `,
          )
          .single();


      if (
        linkError ||
        !linked
      ) {
        console.error(
          "Failed to link legacy account",
          linkError,
        );

        return NextResponse.json(
          {
            error:
              "Unable to link your existing 111 Sports account.",
          },
          {
            status: 500,
          },
        );
      }


      return createSessionResponse(
        linked as
          AppUserRow,
      );
    }


    // =========================================================
    // D. NO EXISTING ACCOUNT YET
    //
    // 4C will consume a valid email-specific Group invite,
    // create app_users + Group membership + Group team, then
    // bridge that identity.
    //
    // Do not silently create public accounts here.
    // =========================================================

    return NextResponse.json(
      {
        error:
          "This sign-in is not linked to a 111 Sports account yet.",

        code:
          "ACCOUNT_LINK_REQUIRED",

        email,
      },
      {
        status: 409,
      },
    );
  } catch (
    error
  ) {
    console.error(
      "Auth bridge failed",
      error,
    );

    return NextResponse.json(
      {
        error:
          "Unable to complete sign in right now.",
      },
      {
        status: 500,
      },
    );
  }
}
