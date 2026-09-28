import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { loadNcaaPickEmParticipants } from "./access";
import { sendLoggedNotification } from "@/lib/notifications";
import { getNcaaPickEmNotificationSettings, renderNcaaPickEmNotificationTemplate } from "@/lib/ncaaPickEmNotificationSettings";
import type { NcaaWeek } from "./backgroundPolicy";

/** Separate from ESPN/scoring: same pre-lock, missing-card and preference rules as the legacy route. */
export async function remindNcaaWeek(weekId: number, token: string, assertLease: () => Promise<void>, now = new Date()) {
  const loaded = await supabaseAdmin.from("ncaa_pickem_weeks")
    .select("id,season,week_number,label,lock_at,status,league_id").eq("id", weekId).single();
  if (loaded.error || !loaded.data) throw new Error("NCAA reminder week unavailable.");
  const week = loaded.data as NcaaWeek & { label: string };
  const settings = await getNcaaPickEmNotificationSettings(week.league_id);
  const lock = week.lock_at ? Date.parse(week.lock_at) : NaN;
  const summary = { checkedWeeks: 1, remindersSent: 0, remindersSkipped: 0, duplicateEvents: 0, notificationsFailed: 0, deferred: false };
  if (!settings.enabled || week.status !== "open" || !Number.isFinite(lock) || lock <= now.getTime() || lock > now.getTime() + settings.reminderHours * 3_600_000)
    return summary;
  const owner = await supabaseAdmin.from("leagues").select("group_id").eq("id", week.league_id).single();
  if (owner.error || !owner.data) throw new Error("NCAA reminder Group unavailable.");
  const participants = await loadNcaaPickEmParticipants(String(owner.data.group_id));
  const games = await supabaseAdmin.from("ncaa_pickem_games").select("id").eq("week_id", weekId).eq("included", true);
  if (games.error) throw new Error("NCAA reminder games unavailable.");
  const gameIds = (games.data ?? []).map(game => Number(game.id));
  if (!gameIds.length || !participants.length) return summary;
  const ids = participants.map(team => team.userId);
  const [picks, users, preferences, reservations, history] = await Promise.all([
    supabaseAdmin.from("ncaa_pickem_picks").select("team_id,game_id").eq("week_id", weekId).in("game_id", gameIds),
    supabaseAdmin.from("app_users").select("id,display_name").in("id", ids).eq("is_active", true),
    supabaseAdmin.from("notification_preferences").select("user_id,notifications_enabled,pickem_reminder_enabled").in("user_id", ids),
    supabaseAdmin.from("ncaa_pickem_reminder_events").select("event_key").eq("week_id", weekId),
    supabaseAdmin.from("notification_history").select("event_key").like("event_key", `ncaa_pickem_lock_reminder:${weekId}:%`),
  ]);
  if (picks.error || users.error || preferences.error || reservations.error || history.error)
    throw new Error("NCAA reminder recipients or event history unavailable.");
  const existingEvents = new Set([...(reservations.data ?? []), ...(history.data ?? [])].map(row => String(row.event_key)));
  const names = new Map((users.data ?? []).map(user => [String(user.id), String(user.display_name ?? "Player")]));
  const prefs = new Map((preferences.data ?? []).map(pref => [String(pref.user_id), pref]));
  const picked = new Map<number, Set<number>>();
  for (const pick of picks.data ?? []) {
    const games = picked.get(Number(pick.team_id)) ?? new Set<number>();
    games.add(Number(pick.game_id)); picked.set(Number(pick.team_id), games);
  }
  const lockDisplay = new Intl.DateTimeFormat("en-US", {
    weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short",
  }).format(new Date(lock));
  // At most 25 new events per week/pass, 15 seconds of notification starts.
  // Already-reserved events do not consume that budget, so later recipients advance next pass.
  let attempted = 0;
  const stopStartingAt = Date.now() + 15_000;
  for (const team of participants) {
    if (attempted >= 25 || Date.now() >= stopStartingAt) { summary.deferred = true; break; }
    if (!names.has(team.userId)) continue;
    const preference = prefs.get(team.userId);
    const savedPicks = picked.get(team.teamId)?.size ?? 0;
    const missingPicks = Math.max(gameIds.length - savedPicks, 0);
    if (!missingPicks || preference?.notifications_enabled === false || preference?.pickem_reminder_enabled === false) {
      summary.remindersSkipped++; continue;
    }
    const eventKey = `ncaa_pickem_lock_reminder:${weekId}:${team.userId}`;
    if (existingEvents.has(eventKey)) { summary.duplicateEvents++; continue; }
    await assertLease();
    // Reservation verifies current lease, deadline, membership, card and preferences atomically.
    // It also honors historical notification_history keys, regardless of their delivery status.
    const reserved = await supabaseAdmin.rpc("reserve_ncaa_pickem_reminder", {
      p_week_id: weekId, p_lease_token: token, p_team_id: team.teamId, p_user_id: team.userId,
    });
    if (reserved.error) throw new Error(`NCAA reminder reservation failed: ${reserved.error.message}`);
    if (reserved.data === "duplicate") { summary.duplicateEvents++; continue; }
    if (reserved.data !== "reserved") { summary.remindersSkipped++; continue; }
    attempted++;
    await assertLease();
    const values = { teamName: names.get(team.userId), missingPicks, weekLabel: week.label, lockTime: lockDisplay, season: week.season, weekNumber: week.week_number };
    const result = await sendLoggedNotification({
      eventKey, notificationType: "ncaa_pickem_lock_reminder", userId: team.userId, teamId: team.teamId, leagueId: week.league_id,
      title: renderNcaaPickEmNotificationTemplate(settings.titleTemplate, values),
      body: renderNcaaPickEmNotificationTemplate(settings.bodyTemplate, values),
      url: `/ncaa-pickem?season=${week.season}&week=${week.week_number}`, tag: `ncaa-pickem-lock-${weekId}`,
      metadata: { sport: "ncaa", season: week.season, weekNumber: week.week_number, weekLabel: week.label,
        weekId, lockAt: week.lock_at, lockDisplay, activeGames: gameIds.length, savedPicks, missingPicks },
    });
    if (result.duplicate) summary.duplicateEvents++;
    else if (result.sent > 0) summary.remindersSent++;
    else summary.remindersSkipped++;
    summary.notificationsFailed += result.failed;
  }
  return summary;
}
