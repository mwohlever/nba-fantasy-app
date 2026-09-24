import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  type EspnGameStatusType,
  nflProviderFailureCode,
} from "@/lib/providers/nfl";
import {
  aggregateEspnBoxscore,
  aggregateEspnDstBoxscore,
} from "@/lib/aggregateEspnBoxscore";
import {
  calculateNflDstFantasyPoints,
  calculateNflFantasyPoints,
  DEFAULT_NFL_SCORING_RULES,
  type NflScoringRules,
} from "@/lib/scoring/nfl";
import { notifyNewlyFinishedPlayers } from "@/lib/playerFinishedNotifications";
import { notifyCompletedSlate } from "@/lib/slateCompleteNotifications";

import { NflScoringProvider } from "@/lib/nfl/scoringProvider";
import { nflGameIsFinal, nflRelevantScheduleUnambiguous, nflScheduleResolved, nflSlateEndPassed } from "@/lib/nfl/scoringPolicy";

type SlateRecord = {
  id: number;
  sport: string;
  date: string;
  start_date: string;
  end_date: string;
  is_locked: boolean;
  rules_snapshot: Record<string, unknown> | null;
};

type LineupWithPlayers = {
  id: number;
  team_id: number;
  lineup_players: { player_id: number }[] | null;
};

type PlayerNflRecord = {
  id: number;
  name: string;
  nfl_player_id: number | null;
  team_abbreviation: string | null;
  position: string;
};

type ExistingNflStatusRow = {
  player_id: number;
  game_status: number | null;
};

const DST_PLAYER_ID_BASE = 100_000_000;

function blankRow() {
  return {
    passing_yards: 0,
    passing_tds: 0,
    passing_ints: 0,
    rushing_yards: 0,
    rushing_tds: 0,
    receiving_yards: 0,
    receiving_tds: 0,
    receptions: 0,
    fumbles_lost: 0,
    fantasy_points: 0,
    game_status: null as number | null,
    game_status_text: null as string | null,
    games_completed: 0,
    games_in_progress: 0,
    games_remaining: 1,
  };
}

function getDstEspnTeamId(player: PlayerNflRecord) {
  if (player.position !== "D/ST") return null;

  const teamId = Number(player.nfl_player_id) - DST_PLAYER_ID_BASE;
  return Number.isInteger(teamId) && teamId > 0
    ? String(teamId)
    : null;
}

function applyGameStatus(
  row: ReturnType<typeof blankRow>,
  status: EspnGameStatusType | undefined,
) {
  row.game_status_text = status?.description ?? null;
  if (/CANCELED|CANCELLED|POSTPONED|SUSPENDED/.test(status?.name ?? "")) {
    row.game_status = null; row.games_completed = 0; row.games_in_progress = 0; row.games_remaining = 1;
    return;
  }

  if (status?.completed === true || status?.state === "post") {
    row.game_status = 3;
    row.games_completed = 1;
    row.games_in_progress = 0;
    row.games_remaining = 0;
    return;
  }

  if (status?.state === "in") {
    row.game_status = 2;
    row.games_completed = 0;
    row.games_in_progress = 1;
    row.games_remaining = 0;
    return;
  }

  row.game_status = null;
  row.games_completed = 0;
  row.games_in_progress = 0;
  row.games_remaining = 1;
}

type NotificationCounts = { attempted: number; sent: number; skipped: number; failed: number };
export type NflRefreshMetrics = { dbReadMs: number; dbWriteMs: number; scoringMs: number; gamesConsidered: number; relevantGames: number; liveGames: number; finalGames: number;
  playerNotifications?: NotificationCounts; completionNotifications?: NotificationCounts; locked?: boolean; failureCode?: string };
export async function refreshNflSlate(slateId: number, provider = new NflScoringProvider(), metrics?: NflRefreshMetrics, leaseToken?: string) {
  const readStarted = performance.now();
  async function assertLease() {
    if (!leaseToken) return;
    const check = await supabaseAdmin.rpc("nfl_sync_lease_owned", { p_slate_id: slateId, p_lease_token: leaseToken });
    if (check.error || !check.data) throw new Error("NFL scoring lease lost");
  }
  try {
    const { data: slate, error: slateError } = await supabaseAdmin
      .from("slates")
      .select("id, sport, date, start_date, end_date, is_locked, rules_snapshot")
      .eq("id", slateId)
      .single();

    if (slateError || !slate) {
      return NextResponse.json({ error: "Slate not found." }, { status: 404 });
    }

    const safeSlate = slate as SlateRecord;

    if (safeSlate.sport !== "nfl") {
      return NextResponse.json(
        { error: "This slate is not an NFL slate." },
        { status: 400 }
      );
    }

    if (safeSlate.is_locked) {
      return NextResponse.json(
        { error: "This slate is locked. Stats cannot be refreshed." },
        { status: 400 }
      );
    }

    const snapshotScoring =
      safeSlate.rules_snapshot &&
      typeof safeSlate.rules_snapshot === "object" &&
      !Array.isArray(safeSlate.rules_snapshot) &&
      safeSlate.rules_snapshot.scoring &&
      typeof safeSlate.rules_snapshot.scoring === "object" &&
      !Array.isArray(safeSlate.rules_snapshot.scoring)
        ? (safeSlate.rules_snapshot.scoring as Record<string, unknown>)
        : {};

    const nflScoringRules: NflScoringRules = {
      ...DEFAULT_NFL_SCORING_RULES,
      ...Object.fromEntries(
        Object.entries(snapshotScoring)
          .filter(([key, value]) =>
            key in DEFAULT_NFL_SCORING_RULES &&
            Number.isFinite(Number(value))
          )
          .map(([key, value]) => [key, Number(value)])
      ),
    };

    const { data: lineupsData, error: lineupsError } = await supabaseAdmin
      .from("lineups")
      .select(`
        id,
        team_id,
        lineup_players (
          player_id
        )
      `)
      .eq("slate_id", slateId);

    if (lineupsError) {
      if (metrics) metrics.failureCode = "scoring_database_failed:lineups_read";
      return NextResponse.json(
        { error: `Failed to load lineups: ${lineupsError.message}` },
        { status: 500 }
      );
    }

    const lineups = (lineupsData ?? []) as LineupWithPlayers[];
    const draftedPlayerIds = Array.from(
      new Set(
        lineups.flatMap((lineup) =>
          (lineup.lineup_players ?? []).map((row) => row.player_id)
        )
      )
    );

    if (draftedPlayerIds.length === 0) {
      return NextResponse.json({
        success: true,
        message: "No drafted players found for this slate.",
      });
    }

    const { data: playersData, error: playersError } = await supabaseAdmin
      .from("players_nfl")
      .select("id, name, nfl_player_id, team_abbreviation, position")
      .in("id", draftedPlayerIds);

    if (playersError) {
      if (metrics) metrics.failureCode = "scoring_database_failed:players_read";
      return NextResponse.json(
        { error: `Failed to load NFL players: ${playersError.message}` },
        { status: 500 }
      );
    }

    const players = (playersData ?? []) as PlayerNflRecord[];

    const playerByEspnId = new Map<string, PlayerNflRecord>();
    const dstPlayerByEspnTeamId = new Map<string, PlayerNflRecord>();
    const draftedTeamAbbreviations = new Set<string>();

    for (const player of players) {
      const dstEspnTeamId = getDstEspnTeamId(player);

      if (dstEspnTeamId) {
        dstPlayerByEspnTeamId.set(dstEspnTeamId, player);
      } else if (player.nfl_player_id) {
        playerByEspnId.set(String(player.nfl_player_id), player);
      }
      if (player.team_abbreviation) {
        draftedTeamAbbreviations.add(player.team_abbreviation.toUpperCase());
      }
    }

    // Load previous game_status per player so we can detect newly-finished players
    const { data: existingStatsData, error: existingStatsError } =
      await supabaseAdmin
        .from("player_nfl_slate_stats")
        .select("player_id, game_status, game_status_text, passing_yards, passing_tds, passing_ints, rushing_yards, rushing_tds, receiving_yards, receiving_tds, receptions, fumbles_lost, fantasy_points, games_completed, games_in_progress, games_remaining")
        .eq("slate_id", slateId)
        .in("player_id", draftedPlayerIds);

    if (existingStatsError) {
      if (metrics) metrics.failureCode = "scoring_database_failed:stats_read";
      return NextResponse.json(
        { error: `Failed to load existing NFL stats: ${existingStatsError.message}` },
        { status: 500 }
      );
    }

    const previousStatuses =
      ((existingStatsData ?? []) as ExistingNflStatusRow[]).map((row) => ({
        playerId: Number(row.player_id),
        gameStatus: row.game_status ?? null,
      }));

    if (metrics) metrics.dbReadMs += performance.now() - readStarted;
    const events = await provider.schedule(safeSlate.start_date, safeSlate.end_date);
    if (metrics) metrics.gamesConsidered = events.length;

    const relevantEvents = events.filter((event) => {
      const competitors = event.competitions?.[0]?.competitors ?? [];
      return competitors.some((competitor) =>
        draftedTeamAbbreviations.has(
          String(competitor.team?.abbreviation ?? "").toUpperCase()
        )
      );
    });
    if (metrics) {
      metrics.relevantGames = relevantEvents.length;
      metrics.liveGames = relevantEvents.filter(e => (e.competitions?.[0]?.status?.type ?? e.status?.type)?.state === "in").length;
      metrics.finalGames = relevantEvents.filter(e => nflGameIsFinal(e.competitions?.[0]?.status?.type ?? e.status?.type)).length;
    }

    const statByPlayerId = new Map<number, ReturnType<typeof blankRow>>();
    for (const player of players) {
      const previous = (existingStatsData ?? []).find(row => Number(row.player_id) === player.id);
      statByPlayerId.set(player.id, { ...blankRow(), ...(previous ?? {}) });
    }

    const eventStatuses = new Map<string, EspnGameStatusType | undefined>();
    let allRelevantGamesFinal = relevantEvents.length > 0;

    const scoringStarted = performance.now();
    const summaryBefore = provider.summaryMs;
    for (const event of relevantEvents) {
      const eventStatus = event.competitions?.[0]?.status?.type ?? event.status?.type;
      eventStatuses.set(String(event.id), eventStatus);
      const eventCompetitors = event.competitions?.[0]?.competitors ?? [];
      const unresolved = eventStatus?.state === "pre" || /CANCELED|CANCELLED|POSTPONED|SUSPENDED/i.test(eventStatus?.name ?? "");
      const summary = unresolved ? null : await provider.summary(String(event.id));
      if (!summary) {
        for (const competitor of eventCompetitors) {
          const dstPlayer = dstPlayerByEspnTeamId.get(
            String(competitor.team?.id ?? ""),
          );

          if (!dstPlayer) continue;

          const row = statByPlayerId.get(dstPlayer.id) ?? blankRow();
          applyGameStatus(row, eventStatus);
          statByPlayerId.set(dstPlayer.id, row);
        }

        allRelevantGamesFinal = false;
        continue;
      }

      const statusInfo = summary.header?.competitions?.[0]?.status?.type;
      eventStatuses.set(String(event.id), statusInfo ?? eventStatus);
      const isCompleted = statusInfo?.completed === true;

      if (!isCompleted || !nflGameIsFinal(statusInfo)) {
        allRelevantGamesFinal = false;
      }

      if (!summary.boxscore || !Array.isArray(summary.boxscore.players) ||
          (summary.boxscore.players.length === 0 && !(summary.boxscore.teams?.length))) throw new Error("NFL game boxscore incomplete");
      for (const player of players) {
        if (player.position === "D/ST") continue;
        const competitor = eventCompetitors.find(c =>
          String(c.team?.abbreviation ?? "").toUpperCase() === String(player.team_abbreviation ?? "").toUpperCase());
        if (!competitor) continue;
        const teamBoxscore = summary.boxscore.players.find(t => String(t.team?.id ?? "") === String(competitor.team?.id ?? ""));
        if (!teamBoxscore?.statistics?.some(group => group.athletes?.length))
          throw new Error("NFL game boxscore incomplete");
      }
      const aggregated = aggregateEspnBoxscore(summary);
      const requiredLabels: Record<string, string[]> = {
        passing: ["YDS", "TD", "INT"], rushing: ["YDS", "TD"],
        receiving: ["YDS", "TD", "REC"], fumbles: ["LOST"],
      };
      const observedGroups = new Map<string, Set<string>>();
      for (const team of summary.boxscore.players) {
        for (const group of team.statistics ?? []) {
          const labels = requiredLabels[group.name];
          if (!labels) continue;
          for (const athlete of group.athletes ?? []) {
            const id = String(athlete.athlete?.id ?? "");
            const drafted = playerByEspnId.get(id);
            if (!drafted) continue;
            const prior = statByPlayerId.get(drafted.id)!;
            const priorInGroup = group.name === "passing"
              ? Boolean(Number(prior.passing_yards) || Number(prior.passing_tds) || Number(prior.passing_ints))
              : group.name === "rushing"
                ? Boolean(Number(prior.rushing_yards) || Number(prior.rushing_tds))
                : group.name === "receiving"
                  ? Boolean(Number(prior.receiving_yards) || Number(prior.receiving_tds) || Number(prior.receptions))
                  : Boolean(Number(prior.fumbles_lost));
            if (!Array.isArray(group.labels) || !Array.isArray(athlete.stats) ||
                labels.some(label => {
                  const index = group.labels.indexOf(label);
                  return index < 0 || index >= athlete.stats.length ||
                    (priorInGroup && !Number.isFinite(Number(athlete.stats[index])));
                })) throw new Error("NFL player boxscore incomplete");
            if (!observedGroups.has(id)) observedGroups.set(id, new Set());
            observedGroups.get(id)!.add(group.name);
          }
        }
      }

      // An omitted group can be legitimate before a player records a stat. Once
      // accepted, its disappearance is incomplete provider data, not a zero.
      for (const player of players) {
        if (!player.nfl_player_id || !eventCompetitors.some(c =>
          String(c.team?.abbreviation ?? "").toUpperCase() === String(player.team_abbreviation ?? "").toUpperCase())) continue;
        const prior = statByPlayerId.get(player.id)!;
        const observed = observedGroups.get(String(player.nfl_player_id));
        if ((Number(prior.passing_yards) || Number(prior.passing_tds) || Number(prior.passing_ints)) && !observed?.has("passing") ||
            (Number(prior.rushing_yards) || Number(prior.rushing_tds)) && !observed?.has("rushing") ||
            (Number(prior.receiving_yards) || Number(prior.receiving_tds) || Number(prior.receptions)) && !observed?.has("receiving") ||
            Number(prior.fumbles_lost) && !observed?.has("fumbles")) throw new Error("NFL player boxscore incomplete");
      }

      for (const [espnPlayerId, stat] of aggregated.entries()) {
        const player = playerByEspnId.get(espnPlayerId);
        if (!player) continue;

        const row = statByPlayerId.get(player.id) ?? blankRow();
        const observed = observedGroups.get(espnPlayerId);
        if (observed?.has("passing")) {
          row.passing_yards = stat.passing_yards; row.passing_tds = stat.passing_tds; row.passing_ints = stat.passing_ints;
        }
        if (observed?.has("rushing")) { row.rushing_yards = stat.rushing_yards; row.rushing_tds = stat.rushing_tds; }
        if (observed?.has("receiving")) {
          row.receiving_yards = stat.receiving_yards; row.receiving_tds = stat.receiving_tds; row.receptions = stat.receptions;
        }
        if (observed?.has("fumbles")) row.fumbles_lost = stat.fumbles_lost;
        row.fantasy_points =
          Math.round(
            calculateNflFantasyPoints(
              row,
              nflScoringRules,
            ) * 10,
          ) / 10;
        applyGameStatus(row, statusInfo ?? eventStatus);

        statByPlayerId.set(player.id, row);
      }

      const summaryCompetitors =
        summary.header?.competitions?.[0]?.competitors ?? eventCompetitors;

      for (const competitor of summaryCompetitors) {
        const espnTeamId = String(competitor.team?.id ?? "");
        const dstPlayer = dstPlayerByEspnTeamId.get(espnTeamId);

        if (!dstPlayer) continue;

        const row = statByPlayerId.get(dstPlayer.id) ?? blankRow();
        const dstStats = aggregateEspnDstBoxscore(summary, espnTeamId);
        if (!dstStats || summaryCompetitors.some(c => c.score === undefined || c.score === null))
          throw new Error("NFL D/ST boxscore incomplete");
        const nextPoints = Math.round(calculateNflDstFantasyPoints(dstStats, nflScoringRules) * 10) / 10;
        const defense = summary.boxscore.teams?.find(t => String(t.team?.id ?? "") === espnTeamId);
        const opponent = summary.boxscore.teams?.find(t => String(t.team?.id ?? "") !== espnTeamId);
        const missingComponent = !defense || !opponent ||
          !["sacksYardsLost", "interceptions", "fumblesLost"].every(name => opponent.statistics?.some(s => s.name === name)) ||
          !defense.statistics?.some(s => s.name === "defensiveTouchdowns");
        if (missingComponent && Number(row.fantasy_points) > nextPoints)
          throw new Error("NFL D/ST boxscore incomplete");
        row.fantasy_points = nextPoints;

        applyGameStatus(row, statusInfo ?? eventStatus);
        statByPlayerId.set(dstPlayer.id, row);
      }
    }

    // Lifecycle belongs to the team's slate game, independent of box-score presence.
    // Missing/ambiguous schedules stay unresolved (left), never implicitly final.
    for (const player of players) {
      const dstTeamId = getDstEspnTeamId(player);
      const matchingEvents = events.filter(event => (event.competitions?.[0]?.competitors ?? []).some(c =>
        dstTeamId ? String(c.team?.id ?? "") === dstTeamId :
          Boolean(player.team_abbreviation) && String(c.team?.abbreviation ?? "").toUpperCase() === player.team_abbreviation!.toUpperCase()));
      const event = matchingEvents.length === 1 ? matchingEvents[0] : null;
      // A missing or duplicated schedule mapping cannot erase accepted live state.
      const status = event ? eventStatuses.get(String(event.id)) ?? event.competitions?.[0]?.status?.type ?? event.status?.type : undefined;
      if (status) applyGameStatus(statByPlayerId.get(player.id)!, status);
    }

    if (!nflRelevantScheduleUnambiguous(events, draftedTeamAbbreviations)) {
      return NextResponse.json({ success: true, slateId, message: "NFL schedule unresolved; previous stats preserved." });
    }
    if (metrics) metrics.scoringMs += Math.max(0, performance.now() - scoringStarted - (provider.summaryMs - summaryBefore));

    const playerStatRows = Array.from(statByPlayerId.entries()).map(
      ([playerId, stat]) => ({
        slate_id: slateId,
        player_id: playerId,
        ...stat,
        updated_at: new Date().toISOString(),
      })
    );

    await assertLease();
    const writeStarted = performance.now();
    const { error: statsUpsertError } = await supabaseAdmin
      .from("player_nfl_slate_stats")
      .upsert(playerStatRows, {
        onConflict: "slate_id,player_id",
      });

    if (statsUpsertError) {
      if (metrics) metrics.failureCode = "scoring_database_failed:stats_write";
      return NextResponse.json(
        { error: `Failed to save NFL player stats: ${statsUpsertError.message}` },
        { status: 500 }
      );
    }
    if (metrics) metrics.dbWriteMs += performance.now() - writeStarted;

    let playerFinishedNotifications = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    try {
      playerFinishedNotifications = await notifyNewlyFinishedPlayers({
        slate: {
          id: safeSlate.id,
          date: safeSlate.date,
          start_date: safeSlate.start_date,
          end_date: safeSlate.end_date,
          sport: "nfl",
        },
        players: players.map((player) => ({
          id: player.id,
          name: player.name,
        })),
        lineups,
        previousStatuses,
        currentStats: playerStatRows.map((row) => ({
          player_id: row.player_id,
          fantasy_points: row.fantasy_points,
          game_status: row.game_status,
        })),
      });
    } catch (notificationError) {
      console.error(
        "NFL stats saved, but finished-player notifications failed",
        notificationError
      );
    }
    if (metrics) metrics.playerNotifications = playerFinishedNotifications;

    const recomputeStarted = performance.now();
    const statsByPlayerId = new Map(
      playerStatRows.map((row) => [row.player_id, row])
    );

    const teamRows = lineups.map((lineup) => {
      const playerRows = lineup.lineup_players ?? [];

      const fantasyPoints = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.fantasy_points ?? 0);
      }, 0);

      const gamesCompleted = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.games_completed ?? 0);
      }, 0);

      const gamesInProgress = playerRows.reduce((sum, playerRow) => {
        const stat = statsByPlayerId.get(playerRow.player_id);
        return sum + Number(stat?.games_in_progress ?? 0);
      }, 0);

      return {
        slate_id: slateId,
        team_id: lineup.team_id,
        fantasy_points: Math.round(fantasyPoints * 10) / 10,
        finish_position: null as number | null,
        games_completed: gamesCompleted,
        games_in_progress: gamesInProgress,
        games_remaining: playerRows.reduce((sum, playerRow) => sum + Number(statsByPlayerId.get(playerRow.player_id)?.games_remaining ?? 1), 0),
      };
    });

    const sortedTeamRows = [...teamRows].sort(
      (a, b) => Number(b.fantasy_points) - Number(a.fantasy_points)
    );

    sortedTeamRows.forEach((row, index) => {
      row.finish_position = index + 1;
    });
    if (metrics) metrics.scoringMs += performance.now() - recomputeStarted;

    await assertLease();
    const teamWriteStarted = performance.now();
    const { error: teamUpsertError } = await supabaseAdmin
      .from("team_slate_results")
      .upsert(sortedTeamRows, {
        onConflict: "slate_id,team_id",
      });

    if (teamUpsertError) {
      if (metrics) metrics.failureCode = "scoring_database_failed:teams_write";
      return NextResponse.json(
        { error: `Failed to save NFL team results: ${teamUpsertError.message}` },
        { status: 500 }
      );
    }
    if (metrics) metrics.dbWriteMs += performance.now() - teamWriteStarted;

    let slateAutoLocked = false;

    let slateCompleteNotifications = {
      attempted: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
    };

    const slateHasEndedByDate = nflSlateEndPassed(safeSlate.end_date);

    if (allRelevantGamesFinal && nflScheduleResolved(events, draftedTeamAbbreviations) && slateHasEndedByDate) {
      await assertLease();
      const { data: lockedRows, error: lockError } = await supabaseAdmin
        .from("slates")
        .update({ is_locked: true })
        .eq("id", slateId).eq("is_locked", false).select("id");

      if (lockError || !lockedRows?.length) {
        if (metrics) metrics.failureCode = "scoring_database_failed:slate_lock";
        return NextResponse.json(
          { error: "Stats saved, but failed to auto-lock slate." },
          { status: 500 }
        );
      }

      slateAutoLocked = true;
      if (metrics) metrics.locked = true;

      try {
        slateCompleteNotifications = await notifyCompletedSlate({
          slate: {
            id: safeSlate.id,
            date: safeSlate.date,
            start_date: safeSlate.start_date,
            end_date: safeSlate.end_date,
          },
          teamResults: sortedTeamRows.map((row) => ({
            team_id: row.team_id,
            fantasy_points: Number(row.fantasy_points ?? 0),
            finish_position: row.finish_position,
          })),
        });
      } catch (notificationError) {
        console.error(
          "NFL slate locked, but slate-complete notifications failed",
          notificationError
        );
      }
      if (metrics) metrics.completionNotifications = slateCompleteNotifications;
    }

    return NextResponse.json({
      success: true,
      slateId,
      relevantGamesFound: relevantEvents.length,
      allRelevantGamesFinal,
      playerStatsUpdated: playerStatRows.length,
      teamResultsUpdated: sortedTeamRows.length,
      slateAutoLocked,
      playerFinishedNotifications,
      slateCompleteNotifications,
    });
  } catch (error) {
    if (metrics) metrics.failureCode = nflProviderFailureCode(error) ??
      (error instanceof Error && /boxscore incomplete/.test(error.message)
        ? "provider_response_malformed:summary:boxscore" : "scoring_database_failed:unexpected");
    console.error("nfl_refresh_failed");
    return NextResponse.json(
      { error: "Unexpected server error while refreshing NFL stats." },
      { status: 500 }
    );
  }
}
