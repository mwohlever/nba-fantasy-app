import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendPushToUser, type PushResult } from "@/lib/push";
import {
  getNotificationTemplate,
  renderNotificationTemplate,
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
    };
  }

  const { data: lineups, error: lineupsError } = await supabaseAdmin
    .from("lineups")
    .select("lineup_players(player_id)")
    .eq("slate_id", slateId);

  if (lineupsError) {
    throw new Error(`Failed to load draft picks: ${lineupsError.message}`);
  }

  const totalDrafted = ((lineups ?? []) as LineupRow[]).reduce(
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
    };
  }

  const roundIndex = Math.floor(totalDrafted / totalTeams);
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
    };
  }

  const nextTeamName = getRelatedTeamName(nextTeam);

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
      nextTeamId: nextTeam.team_id,
      nextTeamName,
    };
  }

  const startDate = slate.start_date ?? slate.date;
  const endDate = slate.end_date ?? slate.date;
  const slateLabel =
    startDate === endDate ? startDate : `${startDate} - ${endDate}`;

  const notificationTemplate = await getNotificationTemplate("draft_turn");

  const templateValues = {
    teamName: nextTeamName,
    slateLabel,
  };

  const result = await sendPushToUser(user.id, {
    title: renderNotificationTemplate(
      notificationTemplate.titleTemplate,
      templateValues
    ),
    body: renderNotificationTemplate(
      notificationTemplate.bodyTemplate,
      templateValues
    ),
    url: `/lineups/draft?slateId=${slateId}`,
    tag: `draft-turn-${slateId}`,
  });

  return {
    ...result,
    nextTeamId: nextTeam.team_id,
    nextTeamName,
  };
}
