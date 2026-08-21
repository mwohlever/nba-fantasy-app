import {
  getNotificationTemplate,
  renderNotificationTemplate,
} from "@/lib/notificationTemplates";
import { sendLoggedNotification } from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

type SlateInput = {
  id: number;
  date: string;
  start_date: string;
  end_date: string;
  sport?: string;
  display_name?: string | null;
};

type TeamResultInput = {
  team_id: number;
  fantasy_points: number;
  finish_position: number | null;
};

type AppUserRow = {
  id: string;
  team_id: number;
};

type PreferenceRow = {
  user_id: string;
  notifications_enabled: boolean;
  slate_final_enabled: boolean;
};

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

function formatScore(
  value: number,
  sport: "nba" | "nfl" | "golf",
) {
  const numericValue = Number(value ?? 0);

  return sport === "golf"
    ? String(Math.round(numericValue))
    : numericValue.toFixed(1);
}

export async function notifyCompletedSlate(input: {
  slate: SlateInput;
  teamResults: TeamResultInput[];
}) {
  const sortedResults = [...input.teamResults]
    .filter((row) => row.finish_position !== null)
    .sort(
      (a, b) =>
        Number(a.finish_position ?? 999) -
        Number(b.finish_position ?? 999)
    );

  const winner = sortedResults[0] ?? null;

  if (!winner || sortedResults.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const teamIds = sortedResults.map((row) => Number(row.team_id));

  const [
    { data: teams, error: teamsError },
    { data: appUsers, error: usersError },
  ] = await Promise.all([
    supabaseAdmin
      .from("teams")
      .select("id, name")
      .in("id", teamIds),
    supabaseAdmin
      .from("app_users")
      .select("id, team_id")
      .in("team_id", teamIds)
      .eq("is_active", true),
  ]);

  if (teamsError) {
    throw new Error(
      `Failed to load teams for slate notifications: ${teamsError.message}`
    );
  }

  if (usersError) {
    throw new Error(
      `Failed to load users for slate notifications: ${usersError.message}`
    );
  }

  const safeUsers = (appUsers ?? []) as AppUserRow[];
  const userIds = safeUsers.map((user) => user.id);

  const { data: preferences, error: preferencesError } =
    userIds.length > 0
      ? await supabaseAdmin
          .from("notification_preferences")
          .select(
            "user_id, notifications_enabled, slate_final_enabled"
          )
          .in("user_id", userIds)
      : { data: [], error: null };

  if (preferencesError) {
    throw new Error(
      `Failed to load slate notification preferences: ${preferencesError.message}`
    );
  }

  const teamNameMap = new Map(
    (teams ?? []).map((team) => [
      Number(team.id),
      String(team.name),
    ])
  );

  const userByTeamId = new Map(
    safeUsers.map((user) => [Number(user.team_id), user])
  );

  const preferenceByUserId = new Map(
    ((preferences ?? []) as PreferenceRow[]).map((row) => [
      row.user_id,
      row,
    ])
  );

  const winnerTeamId = Number(winner.team_id);
  const winnerName =
    teamNameMap.get(winnerTeamId) ?? `Team ${winnerTeamId}`;

  const sport =

    input.slate.sport === "nfl"

      ? "nfl"

      : input.slate.sport === "golf"

        ? "golf"

        : "nba";

  const winningScore = formatScore(winner.fantasy_points, sport);

  const startDate =
    input.slate.start_date ?? input.slate.date;

  const endDate =
    input.slate.end_date ?? input.slate.date;

  /*
   * Some completion callers were created before display_name
   * was added to the slate payload. Look it up as a fallback
   * so Golf notifications always use the tournament name.
   */
  const { data: slateLabelData, error: slateLabelError } =
    await supabaseAdmin
      .from("slates")
      .select("display_name")
      .eq("id", input.slate.id)
      .maybeSingle();

  if (slateLabelError) {
    console.error(
      "Unable to load the friendly slate label:",
      slateLabelError,
    );
  }

  const friendlySlateName =
    input.slate.display_name?.trim() ||
    slateLabelData?.display_name?.trim() ||
    "";

  const slateLabel =
    friendlySlateName ||
    (startDate === endDate
      ? startDate
      : `${startDate} - ${endDate}`);
  const [standardTemplate, winnerTemplate] = await Promise.all([
    getNotificationTemplate("slate_complete", sport),
    getNotificationTemplate("slate_complete_winner", sport),
  ]);

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const resultRow of sortedResults) {
    const teamId = Number(resultRow.team_id);
    const teamName = teamNameMap.get(teamId) ?? `Team ${teamId}`;
    const user = userByTeamId.get(teamId) ?? null;
    const preference = user
      ? preferenceByUserId.get(user.id) ?? null
      : null;

    const finishNumber = Number(resultRow.finish_position ?? 0);
    const finishOrdinal = getOrdinal(finishNumber);
    const teamScore = formatScore(resultRow.fantasy_points, sport);
    const isWinner = teamId === winnerTeamId;

    const template = isWinner ? winnerTemplate : standardTemplate;

    const values = {
      winnerName,
      winningScore,
      teamName,
      teamScore,
      finishNumber,
      finishOrdinal,
      slateLabel,
    };

    const title = renderNotificationTemplate(
      template.titleTemplate,
      values
    );

    const body = renderNotificationTemplate(
      template.bodyTemplate,
      values
    );

    let skipReason: string | null = null;

    if (!user) {
      skipReason =
        "This team does not have an active league account.";
    } else if (
      !preference ||
      !preference.notifications_enabled ||
      !preference.slate_final_enabled
    ) {
      skipReason = "Slate-complete notifications are disabled.";
    }

    const notificationResult = await sendLoggedNotification({
      eventKey: `slate_complete:${input.slate.id}:${teamId}`,
      notificationType: "slate_complete",
      userId: user?.id ?? null,
      teamId,
      slateId: input.slate.id,
      title,
      body,
      url:
        `/lineups/scores?sport=${encodeURIComponent(input.slate.sport ?? "nba")}` +
        `&slateId=${input.slate.id}`,
      tag: `slate-complete-${input.slate.id}-${teamId}`,
      skipReason,
      metadata: {
        winnerName,
        winningScore: Number(winningScore),
        teamName,
        teamScore: Number(teamScore),
        finishNumber,
        finishOrdinal,
        slateLabel,
        isWinner,
        templateType: isWinner
          ? "slate_complete_winner"
          : "slate_complete",
      },
    });

    if (notificationResult.sent > 0) {
      sent += 1;
    } else if (notificationResult.failed > 0) {
      failed += 1;
    } else {
      skipped += 1;
    }
  }

  return {
    attempted: sortedResults.length,
    sent,
    skipped,
    failed,
  };
}
