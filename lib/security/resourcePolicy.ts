export type OwnedResourcePolicyInput = {
  isSuperAdmin: boolean;
  activeGroupId: string | null;
  targetGroupId: string;
  canAdministerActiveGroup: boolean;
  requireCommissioner: boolean;
  activeLeagueIds: string[];
  targetLeagueId: string;
};

export function canAccessOwnedResource(
  input: OwnedResourcePolicyInput,
) {
  if (input.isSuperAdmin) {
    return true;
  }

  if (
    !input.activeGroupId ||
    input.activeGroupId !== input.targetGroupId ||
    !input.activeLeagueIds.includes(input.targetLeagueId)
  ) {
    return false;
  }

  return (
    !input.requireCommissioner ||
    input.canAdministerActiveGroup
  );
}

export function hasValidInternalAuthorization(
  authorizationHeader: string | null,
  configuredSecret: string | null | undefined,
) {
  const secret = configuredSecret?.trim();

  return Boolean(
    secret && authorizationHeader === `Bearer ${secret}`,
  );
}

export type SlateTeamConfiguration = {
  team_id: number;
  draft_order: number;
  is_participating: boolean;
};

export type SlateTeamValidationResult =
  | {
      ok: true;
      configurations: SlateTeamConfiguration[];
    }
  | {
      ok: false;
      error: string;
    };

export function validateSlateTeamConfigurations(
  configurations: SlateTeamConfiguration[],
  allowedTeamIds: number[],
): SlateTeamValidationResult {
  const allowed = new Set(
    allowedTeamIds.filter(
      (teamId) => Number.isInteger(teamId) && teamId > 0,
    ),
  );

  const seen = new Set<number>();

  for (const configuration of configurations) {
    const teamId = Number(configuration.team_id);

    if (!Number.isInteger(teamId) || !allowed.has(teamId)) {
      return {
        ok: false,
        error:
          "Every slate team must be an active member of the active Group.",
      };
    }

    if (seen.has(teamId)) {
      return {
        ok: false,
        error: "A team can appear only once in a slate configuration.",
      };
    }

    seen.add(teamId);
  }

  if (seen.size !== allowed.size) {
    return {
      ok: false,
      error:
        "Every active Group team must have a slate participation setting.",
    };
  }

  return {
    ok: true,
    configurations,
  };
}

export type GroupCompetitiveHistoryCounts = {
  fantasySlates: number;
  ncaaWeeks: number;
  nbaSkinsSeasons: number;
  leagueAwards?: number;
};

export function hasGroupCompetitiveHistory(
  counts: GroupCompetitiveHistoryCounts,
) {
  return (
    counts.fantasySlates > 0 ||
    counts.ncaaWeeks > 0 ||
    counts.nbaSkinsSeasons > 0 ||
    Number(counts.leagueAwards ?? 0) > 0
  );
}
