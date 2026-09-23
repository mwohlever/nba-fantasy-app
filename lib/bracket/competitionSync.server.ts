import "server-only";

import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { fetchBracketPostseasonEvents } from "@/lib/providers/ncaa";
import { effectiveBracketLockAt, shouldFreezeBracketEntry } from "./lifecycle";
import { bracketTopologyFromRows } from "./persistence";
import { bracketProviderParticipantsMatch, decideBracketResultPromotion } from "./resultPromotion";
import { bracketResultsFromOfficialGames, validateBracketResults } from "./scoring";
import { recomputeFrozenBracketEntriesForCompetition } from "./scoring.server";

type CompetitionRow = { id: number; season: number; sport_key: string; format_key: string };
type ContestRow = { id: string; status: string; lock_at: string | null };
type GameRow = {
  id: number; game_key: string; round_key: string; round_order: number; game_order: number;
  source_a_team_id: string | null; source_a_game_id: number | null;
  source_b_team_id: string | null; source_b_game_id: number | null;
  provider_event_id: string | null; scheduled_at: string | null;
  status: string; winner_team_id: string | null; metadata: Record<string, unknown>;
};

const supported = new Set([
  "college_football:cfp",
  "mens_college_basketball:ncaa_mens",
  "womens_college_basketball:ncaa_womens",
]);

/** Sync one global competition. No HTTP, user session, or active Group is needed. */
export async function syncBracketCompetitionResults(competitionId: number) {
  if (!Number.isSafeInteger(competitionId) || competitionId <= 0)
    throw new Error("A valid Bracket competition ID is required.");
  const competitionResponse = await supabaseAdmin.from("bracket_competitions")
    .select("id, season, sport_key, format_key").eq("id", competitionId).maybeSingle();
  if (competitionResponse.error) throw new Error(`Failed to load Bracket competition: ${competitionResponse.error.message}`);
  const competition = competitionResponse.data as CompetitionRow | null;
  if (!competition) return null;
  if (!supported.has(`${competition.sport_key}:${competition.format_key}`))
    return { promoted: 0, liveUpdated: 0, skipped: 0, conflicts: 0, frozen: 0, unsupported: true };

  const [gamesResponse, contestsResponse] = await Promise.all([
    supabaseAdmin.from("bracket_games")
      .select("id, game_key, round_key, round_order, game_order, source_a_team_id, source_a_game_id, source_b_team_id, source_b_game_id, provider_event_id, scheduled_at, status, winner_team_id, metadata")
      .eq("competition_id", competitionId).order("round_order").order("game_order"),
    supabaseAdmin.from("bracket_contests")
      .select("id, status, lock_at").eq("competition_id", competitionId),
  ]);
  if (gamesResponse.error) throw new Error(`Failed to load Bracket games: ${gamesResponse.error.message}`);
  if (contestsResponse.error) throw new Error(`Failed to load Bracket contests: ${contestsResponse.error.message}`);
  const games = ((gamesResponse.data ?? []) as GameRow[]).sort((a, b) =>
    a.round_order - b.round_order || a.game_order - b.game_order);
  const contests = (contestsResponse.data ?? []) as ContestRow[];
  const topology = bracketTopologyFromRows(games);
  const results = bracketResultsFromOfficialGames(games.map((game) => ({
    gameId: game.game_key, status: game.status, winnerTeamId: game.winner_team_id,
  })));
  validateBracketResults(topology, results);

  const events = await fetchBracketPostseasonEvents({
    season: competition.season, sportKey: competition.sport_key, formatKey: competition.format_key,
  });
  const eventCounts = new Map<string, number>();
  for (const event of events) eventCounts.set(event.espnEventId, (eventCounts.get(event.espnEventId) ?? 0) + 1);
  const eventById = new Map(events.map((event) => [event.espnEventId, event]));
  const bindingCounts = new Map<string, number>();
  for (const game of games) if (game.provider_event_id)
    bindingCounts.set(game.provider_event_id, (bindingCounts.get(game.provider_event_id) ?? 0) + 1);
  const eventFor = (game: GameRow) => game.provider_event_id &&
    bindingCounts.get(game.provider_event_id) === 1 && eventCounts.get(game.provider_event_id) === 1
      ? eventById.get(game.provider_event_id) : undefined;

  // Lock every Group contest before a provider result can become official.
  // A matching live/final event also closes contests with missing schedule data.
  const providerStarted = games.some((game) => {
    const event = eventFor(game);
    return Boolean(event && (event.status === "in" || event.status === "post") &&
      bracketProviderParticipantsMatch(topology, game.game_key, results, event));
  });
  const contestIds = contests.filter((contest) => providerStarted || shouldFreezeBracketEntry({
    contestStatus: contest.status,
    contestLockAt: effectiveBracketLockAt(contest.lock_at, games.map((game) => ({
      scheduledAt: game.scheduled_at, status: game.status,
    }))),
  })).map((contest) => contest.id);
  let frozen = 0;
  if (contestIds.length) {
    const entries = await supabaseAdmin.from("bracket_entries").select("id")
      .eq("competition_id", competitionId).in("contest_id", contestIds).is("locked_at", null);
    if (entries.error) throw new Error(`Failed to load Bracket freeze cohort: ${entries.error.message}`);
    for (const entry of entries.data ?? []) {
      const freeze = await supabaseAdmin.rpc("freeze_bracket_entry", { p_entry_id: entry.id });
      if (freeze.error) throw new Error(`Failed to freeze Bracket entry ${entry.id}: ${freeze.error.message}`);
      frozen++;
    }
  }

  let promoted = 0;
  let liveUpdated = 0;
  let skipped = 0;
  let conflicts = 0;
  // A failed scoring pass must remain retryable even if ESPN is unavailable
  // on the next call. The persisted official final is sufficient to rescore.
  const pendingRecompute: GameRow[] = games.filter((game) =>
    game.status === "final" && game.winner_team_id &&
    game.metadata?.bracket_scoring_synced_winner !== game.winner_team_id,
  );
  for (const game of games) {
    const eventId = game.provider_event_id;
    if (!eventId) continue;
    const event = eventFor(game);
    const decision = decideBracketResultPromotion({
      game: { gameKey: game.game_key, providerEventId: eventId, status: game.status, winnerTeamId: game.winner_team_id },
      event, topology, results,
      competition: { sportKey: competition.sport_key, formatKey: competition.format_key },
      boundEventCount: bindingCounts.get(eventId) ?? 0,
    });
    if (decision.state === "conflict") { conflicts++; continue; }
    if (decision.state === "identical") {
      skipped++;
      continue;
    }
    if (decision.state === "promote") {
      validateBracketResults(topology, { ...results, [game.game_key]: decision.winnerTeamId });
      const metadata = {
        ...game.metadata,
        bracket_official_result: {
          provider_event_id: eventId, away_team_id: event!.awayTeam.id,
          away_score: event!.awayTeam.score, home_team_id: event!.homeTeam.id,
          home_score: event!.homeTeam.score, completed: true,
        },
      };
      const update = await supabaseAdmin.from("bracket_games")
        .update({ status: "final", winner_team_id: decision.winnerTeamId, metadata, updated_at: new Date().toISOString() })
        .eq("id", game.id).eq("competition_id", competitionId).eq("provider_event_id", eventId)
        .eq("status", game.status).is("winner_team_id", null).select("id");
      if (update.error) throw new Error(`Failed to persist Bracket final: ${update.error.message}`);
      if (!update.data?.length) { conflicts++; continue; }
      game.status = "final";
      game.winner_team_id = decision.winnerTeamId;
      game.metadata = metadata;
      results[game.game_key] = decision.winnerTeamId;
      pendingRecompute.push(game);
      promoted++;
      continue;
    }
    // Live scores stay on the provider read path. Only advance status here.
    if (game.status === "scheduled" && event?.status === "in" && !event.completed &&
        bracketProviderParticipantsMatch(topology, game.game_key, results, event)) {
      const update = await supabaseAdmin.from("bracket_games")
        .update({ status: "in_progress", updated_at: new Date().toISOString() })
        .eq("id", game.id).eq("competition_id", competitionId).eq("provider_event_id", eventId)
        .eq("status", "scheduled").is("winner_team_id", null).select("id");
      if (update.error) throw new Error(`Failed to persist live Bracket status: ${update.error.message}`);
      if (update.data?.length) liveUpdated++;
      else conflicts++;
      continue;
    }
    skipped++;
  }

  // Newly frozen entries need scoring even if a final was promoted earlier.
  if (pendingRecompute.length || (frozen > 0 && Object.keys(results).length > 0)) {
    await recomputeFrozenBracketEntriesForCompetition(competitionId);
    for (const game of pendingRecompute) {
      const marker = await supabaseAdmin.from("bracket_games")
        .update({ metadata: { ...game.metadata, bracket_scoring_synced_winner: game.winner_team_id } })
        .eq("id", game.id).eq("competition_id", competitionId)
        .eq("status", "final").eq("winner_team_id", game.winner_team_id).select("id");
      if (marker.error || !marker.data?.length) throw new Error(`Failed to mark Bracket scoring for game ${game.id}.`);
    }
  }
  return { promoted, liveUpdated, skipped, conflicts, frozen, unsupported: false };
}
