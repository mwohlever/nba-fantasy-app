import { NextResponse } from "next/server";

import {
  getCurrentUser,
  type AppUser,
} from "@/lib/auth";
import { getGroupContextForUser } from "@/lib/groups/context";
import {
  canAccessOwnedResource,
  hasValidInternalAuthorization,
} from "@/lib/security/resourcePolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type ResourceAuthorizationOptions = {
  allowInternal?: boolean;
  requireCommissioner?: boolean;
};

type ResourceTarget = {
  id: number;
  leagueId: string;
  groupId: string;
  sportKey: string;
};

export type ResourceAuthorization =
  | {
      ok: true;
      mode: "internal" | "user";
      user: AppUser | null;
      target: ResourceTarget;
    }
  | {
      ok: false;
      response: NextResponse;
    };

export function isInternalRequest(request: Request) {
  return hasValidInternalAuthorization(
    request.headers.get("authorization"),
    process.env.GOLF_CRON_SECRET,
  );
}

async function loadLeagueOwner(leagueId: string) {
  const { data, error } = await supabaseAdmin
    .from("leagues")
    .select("id, group_id, sport_key")
    .eq("id", leagueId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to validate resource ownership: ${error.message}`,
    );
  }

  return data
    ? {
        leagueId: String(data.id),
        groupId: String(data.group_id),
        sportKey: String(data.sport_key),
      }
    : null;
}

async function authorizeTarget(
  request: Request,
  target: ResourceTarget | null,
  options: ResourceAuthorizationOptions,
): Promise<ResourceAuthorization> {
  if (!target) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Resource not found." },
        { status: 404 },
      ),
    };
  }

  if (options.allowInternal && isInternalRequest(request)) {
    return {
      ok: true,
      mode: "internal",
      user: null,
      target,
    };
  }

  const user = await getCurrentUser();

  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Login required." },
        { status: 401 },
      ),
    };
  }

  if (user.systemRole === "super_admin") {
    return {
      ok: true,
      mode: "user",
      user,
      target,
    };
  }

  const context = await getGroupContextForUser(user);
  const allowed = canAccessOwnedResource({
    isSuperAdmin: false,
    activeGroupId: context?.group.id ?? null,
    targetGroupId: target.groupId,
    canAdministerActiveGroup:
      context?.canAdministerGroup ?? false,
    requireCommissioner:
      options.requireCommissioner ?? false,
    activeLeagueIds:
      context?.leagues
        .filter((league) => league.isEnabled)
        .map((league) => league.id) ?? [],
    targetLeagueId: target.leagueId,
  });

  if (!allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Resource not found." },
        { status: 404 },
      ),
    };
  }

  return {
    ok: true,
    mode: "user",
    user,
    target,
  };
}

export async function authorizeSlateResource(
  request: Request,
  slateId: number,
  options: ResourceAuthorizationOptions = {},
) {
  const { data, error } = await supabaseAdmin
    .from("slates")
    .select("id, league_id")
    .eq("id", slateId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to validate slate ownership: ${error.message}`,
    );
  }

  const owner = data?.league_id
    ? await loadLeagueOwner(String(data.league_id))
    : null;

  return authorizeTarget(
    request,
    data && owner
      ? {
          id: Number(data.id),
          ...owner,
        }
      : null,
    options,
  );
}

export async function authorizeNcaaWeekResource(
  request: Request,
  weekId: number,
  options: ResourceAuthorizationOptions = {},
) {
  const { data, error } = await supabaseAdmin
    .from("ncaa_pickem_weeks")
    .select("id, league_id")
    .eq("id", weekId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to validate NCAA week ownership: ${error.message}`,
    );
  }

  const owner = data?.league_id
    ? await loadLeagueOwner(String(data.league_id))
    : null;

  return authorizeTarget(
    request,
    data && owner
      ? {
          id: Number(data.id),
          ...owner,
        }
      : null,
    options,
  );
}

export async function authorizeNbaSkinsSeasonResource(
  request: Request,
  seasonId: number,
  options: ResourceAuthorizationOptions = {},
) {
  const { data, error } = await supabaseAdmin
    .from("nba_skins_seasons")
    .select("id, league_id")
    .eq("id", seasonId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to validate NBA Skins season ownership: ${error.message}`,
    );
  }

  const owner = data?.league_id
    ? await loadLeagueOwner(String(data.league_id))
    : null;

  return authorizeTarget(
    request,
    data && owner
      ? {
          id: Number(data.id),
          ...owner,
        }
      : null,
    options,
  );
}

export async function loadActiveGroupTeamIds(
  groupId: string,
) {
  const { data: memberships, error: membershipsError } =
    await supabaseAdmin
      .from("group_memberships")
      .select("user_id")
      .eq("group_id", groupId)
      .eq("is_active", true);

  if (membershipsError) {
    throw new Error(
      `Failed to load active Group members: ${membershipsError.message}`,
    );
  }

  const userIds = (memberships ?? []).map((row) =>
    String(row.user_id),
  );

  if (userIds.length === 0) {
    return [];
  }

  const { data: teams, error: teamsError } = await supabaseAdmin
    .from("teams")
    .select("id")
    .eq("group_id", groupId)
    .in("user_id", userIds);

  if (teamsError) {
    throw new Error(
      `Failed to load active Group teams: ${teamsError.message}`,
    );
  }

  return (teams ?? []).map((team) => Number(team.id));
}
