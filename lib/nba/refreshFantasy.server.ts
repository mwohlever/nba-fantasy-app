import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { notifyNewlyFinishedPlayers } from "@/lib/playerFinishedNotifications";
import { notifyCompletedSlate } from "@/lib/slateCompleteNotifications";
import { normalizeTeamCode } from "@/lib/providers/nbaSkinsRecords.mjs";
import { easternDate, fantasyPollPolicy, nbaSlateEndPassed, nbaSlateEndAt } from "./backgroundPolicy";
import { scoreNbaFantasy } from "./fantasyScoring";
import type { NbaProvider } from "./provider";
import type { FantasyContext, FantasyNotifications, NbaGame, NbaBox, NbaConsumerResult } from "./types";

export async function deliverNbaNotifications(slateId: number, token: string, payload: FantasyNotifications) {
  const playerFinishedNotifications = await notifyNewlyFinishedPlayers(payload);
  const slateCompleteNotifications = payload.completed ? await notifyCompletedSlate(payload) : { attempted: 0, sent: 0, skipped: 0, failed: 0 };
  if (playerFinishedNotifications.failed || slateCompleteNotifications.failed) throw new Error("fantasy:notification_delivery_failed:event_keys_retained");
  const ack = await supabaseAdmin.rpc("ack_nba_notifications", { p_slate_id: slateId, p_token: token });
  if (ack.error || !ack.data) throw new Error("fantasy:notification_ack_failed");
  return { playerFinishedNotifications, slateCompleteNotifications };
}

async function slateGames(context: FantasyContext, provider: NbaProvider): Promise<readonly NbaGame[]> {
  // Pinned IDs are authoritative, including historical games absent from the current season schedule.
  let schedule: readonly NbaGame[];
  try { schedule = await provider.schedule(); }
  catch (error) { if (!context.pins.length) throw error; schedule = []; }
  if (context.pins.length) {
    const byId = new Map(schedule.map(game => [game.gameId, game]));
    return context.pins.map(pin => {
      if (!/^\d{10}$/.test(pin.game_id) || !pin.game_code || !/^\d{8}\/[A-Z]{6}$/.test(pin.game_code)) throw new Error("fantasy:invalid_pinned_game");
      if (pin.game_date < context.slate.start_date || pin.game_date > context.slate.end_date) throw new Error("fantasy:pinned_game_outside_slate");
      const known = byId.get(pin.game_id);
      if (known && (known.date !== pin.game_date || known.gameCode !== pin.game_code)) throw new Error("fantasy:pinned_identity_mismatch");
      return known ?? Object.freeze({ provider: "nba.com" as const, gameId: pin.game_id, gameCode: pin.game_code, date: pin.game_date,
        startAt: pin.game_date === context.slate.start_date ? context.slate.first_game_start_time : null,
        status: 1 as const, statusText: "Scheduled", away: normalizeTeamCode(pin.game_code.slice(9, 12))!, home: normalizeTeamCode(pin.game_code.slice(12, 15))!,
      });
    });
  }
  const relevantTeams = new Set((context.slate.nba_team_abbreviations?.length ? context.slate.nba_team_abbreviations
    : context.players.map(player => player.team_abbreviation)).map(code => normalizeTeamCode(code)).filter(Boolean));
  const games = schedule.filter(game => game.date >= context.slate.start_date && game.date <= context.slate.end_date
    && (relevantTeams.has(game.home) || relevantTeams.has(game.away)));
  // A current-season schedule cannot establish completeness for a different season's unpinned slate.
  if (!games.length) throw new Error("fantasy:schedule_does_not_cover_slate:pin_games_for_historical_slates");
  return games;
}

export async function refreshNbaFantasy(slateId: number, token: string, provider: NbaProvider, manual: boolean, now: Date): Promise<NbaConsumerResult> {
  const loaded = await supabaseAdmin.rpc("load_nba_fantasy_context", { p_slate_id: slateId });
  if (loaded.error || !loaded.data) throw new Error("fantasy:context_read_failed");
  const context = loaded.data as FantasyContext;
  if (context.slate.sport !== "nba" || context.slate.is_locked || context.slate.archived_at) throw new Error("fantasy:slate_ineligible");
  if (!context.players.length) return { summary: { success: true, slateId, message: "No drafted players found for this slate." }, delaySeconds: 3600 };
  if (context.players.some(player => !player.nba_player_id || !Number.isSafeInteger(player.nba_player_id))
    || new Set(context.players.map(player => player.nba_player_id)).size !== context.players.length) throw new Error("fantasy:missing_or_ambiguous_nba_player_identity");
  const games = await slateGames(context, provider);
  if (games.length > 40) throw new Error("fantasy:slate_game_limit_exceeded");
  const policy = fantasyPollPolicy(games, context.slate.end_date, now);
  if (!manual && !policy.process) return { summary: { success: true, slateId, skipped: true, reason: policy.reason, gamesFound: games.length }, delaySeconds: policy.delaySeconds };
  const boxes = new Map<string, NbaBox>();
  // Four concurrent payloads at most. All required payloads validate BEFORE any game mutation.
  const fetchGames = games.filter(game => game.status !== 1 || game.startAt && Date.parse(game.startAt) <= now.getTime()
    || !game.startAt && game.date <= easternDate(now));
  for (let offset = 0; offset < fetchGames.length; offset += 4) {
    const batch = await Promise.all(fetchGames.slice(offset, offset + 4).map(game => provider.box(game)));
    for (const box of batch) boxes.set(box.gameId, box);
  }
  const scored = scoreNbaFantasy(context, games, boxes);
  // A stored, reviewed game universe is required to freeze history. A fresh unpinned schedule may score, but cannot prove no game was omitted.
  const finalizationNeedsPins = scored.allFinal && context.pins.length === 0;
  const completed = scored.allFinal && !finalizationNeedsPins && nbaSlateEndPassed(context.slate.end_date, now);
  const payload: FantasyNotifications = { slate: { ...context.slate, sport: "nba" }, players: context.players, lineups: context.lineups,
    previousStatuses: context.previous.map(row => ({ playerId: row.player_id, gameStatus: row.game_status })),
    currentStats: scored.rows, teamResults: scored.teams, completed,
  };
  const saved = await supabaseAdmin.rpc("apply_nba_fantasy", { p_slate_id: slateId, p_token: token, p_context: context,
    p_players: scored.rows, p_teams: scored.teams, p_final: completed, p_notifications: payload,
    p_final_after: nbaSlateEndAt(context.slate.end_date) });
  if (saved.error || !saved.data) throw new Error("fantasy:atomic_apply_failed:lease_or_context_changed");
  const notificationSummary = await deliverNbaNotifications(slateId, token, payload);
  const actualGames = games.map(game => boxes.has(game.gameId) ? { ...game, status: boxes.get(game.gameId)!.status } : game);
  return { summary: { success: true, slateId, provider: "nba.com", gameIds: games.map(game => game.gameId), gamesFound: games.length,
    liveGames: actualGames.filter(game => game.status === 2).length, finalGames: actualGames.filter(game => game.status === 3).length,
    playerStatsUpdated: scored.rows.length, teamResultsUpdated: scored.teams.length, slateAutoLocked: completed, finalizationNeedsPins, ...notificationSummary },
    delaySeconds: finalizationNeedsPins ? 3600 : fantasyPollPolicy(actualGames, context.slate.end_date, now).delaySeconds };
}
