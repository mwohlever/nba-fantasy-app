import { cookies } from "next/headers";

import type {
  AppUser,
} from "@/lib/auth";

import {
  supabaseAdmin,
} from "@/lib/supabaseAdmin";


export const ACTIVE_GROUP_COOKIE_NAME =
  "111-active-group";


export type GroupRole =
  | "member"
  | "admin";


export type GroupLeague = {
  id: string;
  sportKey: string;
  gameMode: string;
  name: string;
  slug: string;
  isEnabled: boolean;
  settingsVersion: number;
  settings: Record<string, unknown>;
};


export type GroupContext = {
  group: {
    id: string;
    name: string;
    slug: string;
    isActive: boolean;
  };

  membership: {
    id: string;
    role: GroupRole;
    isActive: boolean;
  };

  team: {
    id: number;
    name: string;
    displayOrder: number | null;
  } | null;

  leagues: GroupLeague[];

  isGroupAdmin: boolean;
  isSuperAdmin: boolean;
  canAdministerGroup: boolean;
};


type MembershipRow = {
  id: string;
  group_id: string;
  role: GroupRole;
  is_active: boolean;
  joined_at: string;

  groups:
    | {
        id: string;
        name: string;
        slug: string;
        is_active: boolean;
      }
    | {
        id: string;
        name: string;
        slug: string;
        is_active: boolean;
      }[]
    | null;
};


type TeamRow = {
  id: number;
  name: string;
  display_order: number | null;
};


type LeagueRow = {
  id: string;
  sport_key: string;
  game_mode: string;
  name: string;
  slug: string;
  is_enabled: boolean;
  settings_version: number;
  settings: Record<string, unknown> | null;
};


function unwrapRelated<T>(
  value: T | T[] | null,
): T | null {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value;
}


async function resolveRequestedGroupSlug() {
  const cookieStore =
    await cookies();

  return (
    cookieStore.get(
      ACTIVE_GROUP_COOKIE_NAME,
    )?.value
      ?.trim()
      .toLowerCase() ??
    null
  );
}


async function loadMemberships(
  userId: string,
) {
  const {
    data,
    error,
  } =
    await supabaseAdmin
      .from(
        "group_memberships",
      )
      .select(
        `
          id,
          group_id,
          role,
          is_active,
          joined_at,
          groups (
            id,
            name,
            slug,
            is_active
          )
        `,
      )
      .eq(
        "user_id",
        userId,
      )
      .eq(
        "is_active",
        true,
      )
      .order(
        "joined_at",
        {
          ascending: true,
        },
      );

  if (error) {
    throw new Error(
      `Failed to load Group memberships: ${error.message}`,
    );
  }

  return (
    data ?? []
  ) as unknown as MembershipRow[];
}


function chooseMembership(
  memberships: MembershipRow[],
  requestedSlug: string | null,
) {
  const usable =
    memberships.filter(
      (membership) => {
        const group =
          unwrapRelated(
            membership.groups,
          );

        return Boolean(
          membership.is_active &&
            group?.is_active,
        );
      },
    );

  if (
    requestedSlug
  ) {
    const requested =
      usable.find(
        (membership) =>
          unwrapRelated(
            membership.groups,
          )?.slug
            .trim()
            .toLowerCase() ===
          requestedSlug,
      );

    if (requested) {
      return requested;
    }
  }

  /*
   * During the transitional Groups rollout,
   * preserve today's behavior by preferring
   * the migrated 111 Group whenever the user
   * belongs to it.
   */
  const legacy111 =
    usable.find(
      (membership) =>
        unwrapRelated(
          membership.groups,
        )?.slug ===
        "111",
    );

  return (
    legacy111 ??
    usable[0] ??
    null
  );
}


async function loadGroupTeam(
  userId: string,
  groupId: string,
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
        `
          id,
          name,
          display_order
        `,
      )
      .eq(
        "user_id",
        userId,
      )
      .eq(
        "group_id",
        groupId,
      )
      .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to load Group team: ${error.message}`,
    );
  }

  return (
    data ?? null
  ) as TeamRow | null;
}


async function loadGroupLeagues(
  groupId: string,
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
          sport_key,
          game_mode,
          name,
          slug,
          is_enabled,
          settings_version,
          settings
        `,
      )
      .eq(
        "group_id",
        groupId,
      )
      .eq(
        "is_enabled",
        true,
      )
      .order(
        "name",
        {
          ascending: true,
        },
      );

  if (error) {
    throw new Error(
      `Failed to load Group leagues: ${error.message}`,
    );
  }

  return (
    data ?? []
  ) as LeagueRow[];
}


export async function getGroupContextForUser(
  user: AppUser,
): Promise<GroupContext | null> {
  const [
    requestedSlug,
    memberships,
  ] =
    await Promise.all([
      resolveRequestedGroupSlug(),
      loadMemberships(
        user.id,
      ),
    ]);

  const membership =
    chooseMembership(
      memberships,
      requestedSlug,
    );

  if (!membership) {
    return null;
  }

  const group =
    unwrapRelated(
      membership.groups,
    );

  if (
    !group ||
    !group.is_active
  ) {
    return null;
  }

  const [
    team,
    leagueRows,
  ] =
    await Promise.all([
      loadGroupTeam(
        user.id,
        group.id,
      ),

      loadGroupLeagues(
        group.id,
      ),
    ]);

  const leagues:
    GroupLeague[] =
    leagueRows.map(
      (league) => ({
        id: league.id,
        sportKey:
          league.sport_key,
        gameMode:
          league.game_mode,
        name:
          league.name,
        slug:
          league.slug,
        isEnabled:
          league.is_enabled,
        settingsVersion:
          Number(
            league.settings_version,
          ),
        settings:
          league.settings ??
          {},
      }),
    );

  const isSuperAdmin =
    user.systemRole ===
    "super_admin";

  const isGroupAdmin =
    membership.role ===
    "admin";

  return {
    group: {
      id: group.id,
      name: group.name,
      slug: group.slug,
      isActive:
        group.is_active,
    },

    membership: {
      id:
        membership.id,
      role:
        membership.role,
      isActive:
        membership.is_active,
    },

    team: team
      ? {
          id: Number(
            team.id,
          ),
          name:
            team.name,
          displayOrder:
            team.display_order ??
            null,
        }
      : null,

    leagues,

    isGroupAdmin,
    isSuperAdmin,

    canAdministerGroup:
      isSuperAdmin ||
      isGroupAdmin,
  };
}


export async function getCurrentGroupContext() {
  const {
    getCurrentUser,
  } =
    await import(
      "@/lib/auth"
    );

  const user =
    await getCurrentUser();

  if (!user) {
    return null;
  }

  return getGroupContextForUser(
    user,
  );
}


export async function requireGroupAdmin() {
  const {
    getCurrentUser,
  } =
    await import(
      "@/lib/auth"
    );

  const user =
    await getCurrentUser();

  if (!user) {
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

  return {
    user,
    context,
  };
}
