import {
  getNotificationTemplate,
  renderNotificationTemplate,
} from "@/lib/notificationTemplates";
import { sendLoggedNotification } from "@/lib/notifications";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getSportConfig } from "@/lib/sports";

type SlateInput = {
  id: number;
  date: string;
  start_date: string;
  end_date: string;
  sport?: string;
  display_name?: string | null;
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

  /*
   * Golf completes multiple rounds inside one slate. Supplying
   * a suffix gives each round its own deduplicated event.
   */
  event_key_suffix?: string | null;
  round_number?: number | null;
  round_score?: number | null;
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

function formatGolfNotificationScore(
  value: number | null | undefined,
) {
  if (
    value === null ||
    value === undefined ||
    !Number.isFinite(Number(value))
  ) {
    return "—";
  }

  const score = Number(value);

  if (score === 0) {
    return "E";
  }

  return score > 0
    ? `+${score}`
    : String(score);
}

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

  const sport =
    input.slate.sport === "nfl"
      ? "nfl"
      : input.slate.sport === "golf"
        ? "golf"
        : "nba";

  const template =
    await getNotificationTemplate("player_finished", sport);

  const startDate =
    input.slate.start_date ??
    input.slate.date;

  const endDate =
    input.slate.end_date ??
    input.slate.date;

  const dateLabel =
    startDate === endDate
      ? startDate
      : `${startDate} - ${endDate}`;

  /*
   * Golf slates have a meaningful tournament name such as
   * "Rocket Classic." Prefer that over the raw slate dates.
   * NBA/NFL and unnamed slates retain the date fallback.
   */
  const slateLabel =
    input.slate.display_name?.trim() ||
    dateLabel;

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

    const roundNumber =
      stat.round_number ?? "";

    const roundScore =
      formatGolfNotificationScore(
        stat.round_score,
      );

    const values = {
      playerName,
      roundNumber,
      roundScore,
      fantasyPoints,
      teamName,
      slateLabel,
      sportEmoji: getSportConfig(sport).emoji,
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
      eventKey:
        `player_finished:${input.slate.id}:${stat.player_id}` +
        (stat.event_key_suffix
          ? `:${stat.event_key_suffix}`
          : ""),
      notificationType: "player_finished",
      userId: user?.id ?? null,
      teamId,
      slateId: input.slate.id,

      /*
       * notification_history.player_id references the shared
       * players table. Golf uses golf_players, whose numeric IDs
       * are a different namespace and therefore cannot be written
       * into that foreign-key column.
       *
       * Preserve the Golf player identity in the event key and
       * metadata instead. The Notification Monitor's expected
       * ledger already knows the Golf player from that event key.
       */
      playerId:
        sport === "golf"
          ? null
          : Number(stat.player_id),

      title,
      body,
      url:
        `/lineups/scores?sport=${encodeURIComponent(sport)}` +
        `&slateId=${input.slate.id}`,
      tag:
        `player-finished-${input.slate.id}-${stat.player_id}` +
        (stat.event_key_suffix
          ? `-${stat.event_key_suffix}`
          : ""),
      skipReason,
      metadata: {
        playerName,
        fantasyPoints: Number(fantasyPoints),
        teamName,
        slateLabel,
        sportEmoji: getSportConfig(sport).emoji,

        /*
         * Golf cannot use notification_history.player_id because
         * that FK points at players rather than golf_players.
         */
        golfPlayerId:
          sport === "golf"
            ? Number(stat.player_id)
            : null,
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
