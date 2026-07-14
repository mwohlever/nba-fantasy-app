import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { PushResult } from "@/lib/push";
import { sendLoggedNotification } from "@/lib/notifications";
import {
  getNotificationTemplate,
  renderNotificationTemplate,
  type NotificationTemplateType,
} from "@/lib/notificationTemplates";

type SlateTeamRow = {
  team_id: number;
  draft_order: number;
  teams:
    | {
        name: string;
      }
    | {
        name: string;
      }[]
    | null;
};

type LineupRow = {
  team_id: number;
  lineup_players:
    | {
        player_id: number;
      }[]
    | null;
};

type AppUserRow = {
  id: string;
  display_name: string;
};

type NotificationPreferenceRow = {
  notifications_enabled: boolean;
  draft_turn_enabled: boolean;
};

type PlayerPositionRow = {
  id: number;
  position_group: "G" | "F/C";
};

export type DraftNotificationResult = PushResult & {
  nextTeamId?: number;
  nextTeamName?: string;
};

function getRelatedTeamName(row: SlateTeamRow) {
  if (Array.isArray(row.teams)) {
    return row.teams[0]?.name ?? `Team ${row.team_id}`;
  }

  return row.teams?.name ?? `Team ${row.team_id}`;
}

function getOrdinal(value: number) {
  const remainder100 = value % 100;

  if (remainder100 >= 11 && remainder100 <= 13) {
    return `${value}th`;
  }

  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function getRemainingNeeds(guardCount: number, fcCount: number) {
  const guardNeed = Math.max(0, 2 - guardCount);
  const fcNeed = Math.max(0, 3 - fcCount);

  const parts: string[] = [];

  if (guardNeed > 0) {
    parts.push(`${guardNeed} G`);
  }

  if (fcNeed > 0) {
    parts.push(`${fcNeed} F/C`);
  }

  return parts.length > 0 ? parts.join(" and ") : "roster complete";
}

function getFinalPositionNeed(guardCount: number, fcCount: number) {
  if (guardCount >= 2) return "F/C";
  if (fcCount >= 3) return "G";

  return "G or F/C";
}

export async function notifyNextDrafter(
  slateId: number
): Promise<DraftNotificationResult> {
  const { data: slate, error: slateError } = await supabaseAdmin
    .from("slates")
    .select("id, date, start_date, end_date")
    .eq("id", slateId)
    .single();

  if (slateError || !slate) {
    throw new Error(slateError?.message ?? "Slate not found.");
  }

  const { data: slateTeams, error: slateTeamsError } = await supabaseAdmin
    .from("slate_teams")
    .select("team_id, draft_order, teams(name)")
    .eq("slate_id", slateId)
    .eq("is_participating", true)
    .order("draft_order", { ascending: true });

  if (slateTeamsError) {
    throw new Error(
      `Failed to load the draft order: ${slateTeamsError.message}`
    );
  }

  const orderedTeams = ((slateTeams ?? []) as SlateTeamRow[])
    .map((row) => ({
      ...row,
      team_id: Number(row.team_id),
      draft_order: Number(row.draft_order),
    }))
    .sort((a, b) => a.draft_order - b.draft_order);

  if (orderedTeams.length === 0) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "No participating teams found.",
      devices: [],
    };
  }

  const { data: lineups, error: lineupsError } = await supabaseAdmin
    .from("lineups")
    .select("team_id, lineup_players(player_id)")
    .eq("slate_id", slateId);

  if (lineupsError) {
    throw new Error(`Failed to load draft picks: ${lineupsError.message}`);
  }

  const safeLineups = (lineups ?? []) as LineupRow[];

  const totalDrafted = safeLineups.reduce(
    (sum, lineup) => sum + Number(lineup.lineup_players?.length ?? 0),
    0
  );

  const totalTeams = orderedTeams.length;
  const maxPicks = totalTeams * 5;

  if (totalDrafted >= maxPicks) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "Draft is complete.",
      devices: [],
    };
  }

  const roundIndex = Math.floor(totalDrafted / totalTeams);
  const roundNumber = roundIndex + 1;
  const overallPickNumber = totalDrafted + 1;
  const pickInRound = totalDrafted % totalTeams;

  const nextTeam =
    roundIndex % 2 === 0
      ? orderedTeams[pickInRound]
      : orderedTeams[totalTeams - 1 - pickInRound];

  if (!nextTeam) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "Unable to determine the next drafter.",
      devices: [],
    };
  }

  const nextTeamName = getRelatedTeamName(nextTeam);

  const nextTeamLineup =
    safeLineups.find((lineup) => lineup.team_id === nextTeam.team_id) ?? null;

  const nextTeamPlayerIds =
    nextTeamLineup?.lineup_players?.map((row) => Number(row.player_id)) ?? [];

  let guardCount = 0;
  let fcCount = 0;

  if (nextTeamPlayerIds.length > 0) {
    const { data: rosterPlayers, error: rosterPlayersError } =
      await supabaseAdmin
        .from("players")
        .select("id, position_group")
        .in("id", nextTeamPlayerIds);

    if (rosterPlayersError) {
      throw new Error(
        `Failed to inspect the next team's roster: ${rosterPlayersError.message}`
      );
    }

    for (const player of (rosterPlayers ?? []) as PlayerPositionRow[]) {
      if (player.position_group === "G") {
        guardCount += 1;
      } else if (player.position_group === "F/C") {
        fcCount += 1;
      }
    }
  }

  const isFinalPick = nextTeamPlayerIds.length === 4;

  const { data: appUser, error: appUserError } = await supabaseAdmin
    .from("app_users")
    .select("id, display_name")
    .eq("team_id", nextTeam.team_id)
    .eq("is_active", true)
    .maybeSingle();

  if (appUserError) {
    throw new Error(
      `Failed to find the next drafter: ${appUserError.message}`
    );
  }

  const user = appUser as AppUserRow | null;

  if (!user) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "The next team does not have an active league account.",
      devices: [],
      nextTeamId: nextTeam.team_id,
      nextTeamName,
    };
  }

  const { data: preferences, error: preferencesError } = await supabaseAdmin
    .from("notification_preferences")
    .select("notifications_enabled, draft_turn_enabled")
    .eq("user_id", user.id)
    .maybeSingle();

  if (preferencesError) {
    throw new Error(
      `Failed to load notification preferences: ${preferencesError.message}`
    );
  }

  const userPreferences =
    preferences as NotificationPreferenceRow | null;

  if (
    userPreferences &&
    (!userPreferences.notifications_enabled ||
      !userPreferences.draft_turn_enabled)
  ) {
    return {
      sent: 0,
      failed: 0,
      skipped: true,
      reason: "Draft-turn notifications are disabled for the next drafter.",
      devices: [],
      nextTeamId: nextTeam.team_id,
      nextTeamName,
    };
  }

  const startDate = slate.start_date ?? slate.date;
  const endDate = slate.end_date ?? slate.date;
  const slateLabel =
    startDate === endDate ? startDate : `${startDate} - ${endDate}`;

  const templateType: NotificationTemplateType = isFinalPick
    ? "draft_final_pick"
    : "draft_turn";

  const notificationTemplate =
    await getNotificationTemplate(templateType);

  const templateValues = {
    teamName: nextTeamName,
    slateLabel,
    roundNumber,
    roundOrdinal: getOrdinal(roundNumber),
    overallPickNumber,
    positionNeed: getFinalPositionNeed(guardCount, fcCount),
    remainingNeeds: getRemainingNeeds(guardCount, fcCount),
  };

  const renderedTitle = renderNotificationTemplate(
    notificationTemplate.titleTemplate,
    templateValues
  );

  const renderedBody = renderNotificationTemplate(
    notificationTemplate.bodyTemplate,
    templateValues
  );

  const result = await sendLoggedNotification({
    notificationType: templateType,
    userId: user.id,
    teamId: nextTeam.team_id,
    slateId,
    title: renderedTitle,
    body: renderedBody,
    url: `/lineups/draft?slateId=${slateId}`,
    tag: `draft-turn-${slateId}`,
    metadata: {
      nextTeamName,
      roundNumber,
      roundOrdinal: getOrdinal(roundNumber),
      overallPickNumber,
      positionNeed: getFinalPositionNeed(guardCount, fcCount),
      remainingNeeds: getRemainingNeeds(guardCount, fcCount),
    },
  });

  return {
    ...result,
    nextTeamId: nextTeam.team_id,
    nextTeamName,
  };
}
