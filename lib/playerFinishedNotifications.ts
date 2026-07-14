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
};

type PlayerInput = {
  id: number;
  name: string;
};

type LineupInput = {
  team_id: number;
  lineup_players: { player_id: number }[] | null;
};

type PreviousStatusInput = {
  playerId: number;
  gameStatus: number | null;
};

type CurrentStatInput = {
  player_id: number;
  fantasy_points: number | null;
  game_status: number | null;
};

type AppUserRow = {
  id: string;
  team_id: number;
};

type PreferenceRow = {
  user_id: string;
  notifications_enabled: boolean;
  player_finished_enabled: boolean;
};

export async function notifyNewlyFinishedPlayers(input: {
  slate: SlateInput;
  players: PlayerInput[];
  lineups: LineupInput[];
  previousStatuses: PreviousStatusInput[];
  currentStats: CurrentStatInput[];
}) {
  const previousStatusMap = new Map(
    input.previousStatuses.map((row) => [row.playerId, row.gameStatus])
  );

  const newlyFinished = input.currentStats.filter((row) => {
    const previousStatus = previousStatusMap.get(row.player_id) ?? null;

    return previousStatus !== 3 && row.game_status === 3;
  });

  if (newlyFinished.length === 0) {
    return {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };
  }

  const teamIds = Array.from(
    new Set(
      newlyFinished
        .map((stat) => {
          const owner = input.lineups.find((lineup) =>
            (lineup.lineup_players ?? []).some(
              (row) => Number(row.player_id) === Number(stat.player_id)
            )
          );

          return owner?.team_id ?? null;
        })
        .filter((teamId): teamId is number => teamId !== null)
    )
  );

  const [{ data: teams }, { data: appUsers }] = await Promise.all([
    supabaseAdmin.from("teams").select("id, name").in("id", teamIds),
    supabaseAdmin
      .from("app_users")
      .select("id, team_id")
      .in("team_id", teamIds)
      .eq("is_active", true),
  ]);

  const safeUsers = (appUsers ?? []) as AppUserRow[];
  const userIds = safeUsers.map((user) => user.id);

  const { data: preferences } =
    userIds.length > 0
      ? await supabaseAdmin
          .from("notification_preferences")
          .select(
            "user_id, notifications_enabled, player_finished_enabled"
          )
          .in("user_id", userIds)
      : { data: [] };

  const teamNameMap = new Map(
    (teams ?? []).map((team) => [Number(team.id), String(team.name)])
  );

  const userByTeamId = new Map(
    safeUsers.map((user) => [Number(user.team_id), user])
  );

  const preferenceByUserId = new Map(
    ((preferences ?? []) as PreferenceRow[]).map((row) => [row.user_id, row])
  );

  const playerNameMap = new Map(
    input.players.map((player) => [Number(player.id), player.name])
  );

  const template = await getNotificationTemplate("player_finished");

  const startDate = input.slate.start_date ?? input.slate.date;
  const endDate = input.slate.end_date ?? input.slate.date;
  const slateLabel =
    startDate === endDate ? startDate : `${startDate} - ${endDate}`;

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const stat of newlyFinished) {
    const owner = input.lineups.find((lineup) =>
      (lineup.lineup_players ?? []).some(
        (row) => Number(row.player_id) === Number(stat.player_id)
      )
    );

    if (!owner) continue;

    const teamId = Number(owner.team_id);
    const teamName = teamNameMap.get(teamId) ?? `Team ${teamId}`;
    const playerName =
      playerNameMap.get(Number(stat.player_id)) ??
      `Player ${stat.player_id}`;
    const user = userByTeamId.get(teamId) ?? null;
    const preference = user
      ? preferenceByUserId.get(user.id) ?? null
      : null;

    const fantasyPoints = Number(stat.fantasy_points ?? 0).toFixed(1);

    const values = {
      playerName,
      fantasyPoints,
      teamName,
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
      skipReason = "The player's team does not have an active league account.";
    } else if (
      preference &&
      (!preference.notifications_enabled ||
        !preference.player_finished_enabled)
    ) {
      skipReason = "Player-finished notifications are disabled.";
    }

    const result = await sendLoggedNotification({
      eventKey: `player_finished:${input.slate.id}:${stat.player_id}`,
      notificationType: "player_finished",
      userId: user?.id ?? null,
      teamId,
      slateId: input.slate.id,
      playerId: Number(stat.player_id),
      title,
      body,
      url: `/lineups/scores?slateId=${input.slate.id}`,
      tag: `player-finished-${input.slate.id}-${stat.player_id}`,
      skipReason,
      metadata: {
        playerName,
        fantasyPoints: Number(fantasyPoints),
        teamName,
        slateLabel,
      },
    });

    if (result.sent > 0) sent += 1;
    else if (result.failed > 0) failed += 1;
    else skipped += 1;
  }

  return {
    attempted: newlyFinished.length,
    sent,
    skipped,
    failed,
  };
}
