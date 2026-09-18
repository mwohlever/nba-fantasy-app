import { supabaseAdmin } from "@/lib/supabaseAdmin";
import type { AppUser } from "@/lib/auth";
import { getBracketChallengeAccess } from "@/lib/bracket/access";
import {
  bracketTopologyFromRows,
  type PersistedBracketGameRow,
} from "@/lib/bracket/persistence";

export type BracketChallengeGame = {
  id: number;
  gameKey: string;
  roundKey: string;
  roundOrder: number;
  gameOrder: number;
  regionKey: string | null;
  sourceATeamId: string | null;
  sourceAGameId: number | null;
  sourceASeed: number | null;
  sourceBTeamId: string | null;
  sourceBGameId: number | null;
  sourceBSeed: number | null;
  providerEventId: string | null;
  scheduledAt: string | null;
  lockAt: string | null;
  status: string;
  winnerTeamId: string | null;
};

export type BracketChallengeDetail = {
  group: {
    id: string;
    name: string;
    slug: string;
  };
  league: {
    id: string;
    name: string;
    slug: string;
  };
  canAdministerGroup: boolean;
  contest: {
    id: string;
    status: string;
    lockAt: string | null;
    maxBracketsPerEntrant: number;
    rulesVersion: number;
    rulesSnapshot: Record<string, unknown>;
  };
  competition: {
    id: number;
    sportKey: string;
    formatKey: string;
    season: number;
    name: string;
    status: string;
    startsAt: string | null;
    endsAt: string | null;
    topologyVersion: number;
  };
  games: BracketChallengeGame[];
};

type ContestRow = {
  id: string;
  league_id: string;
  competition_id: number;
  status: string;
  lock_at: string | null;
  max_brackets_per_entrant: number;
  rules_version: number;
  rules_snapshot: Record<string, unknown> | null;
};

type CompetitionRow = {
  id: number;
  sport_key: string;
  format_key: string;
  season: number;
  name: string;
  status: string;
  starts_at: string | null;
  ends_at: string | null;
  topology_version: number;
};

type GameRow = PersistedBracketGameRow & {
  region_key: string | null;
  source_a_seed: number | null;
  source_b_seed: number | null;
  provider_event_id: string | null;
  scheduled_at: string | null;
  lock_at: string | null;
  status: string;
  winner_team_id: string | null;
};

export async function getBracketChallengeDetail(
  user: AppUser,
  contestId: string,
): Promise<BracketChallengeDetail | null> {
  const access = await getBracketChallengeAccess(user);

  if (!access) return null;

  const contestResult = await supabaseAdmin
    .from("bracket_contests")
    .select(
      "id, league_id, competition_id, status, lock_at, max_brackets_per_entrant, rules_version, rules_snapshot",
    )
    .eq("id", contestId)
    .eq("league_id", access.league.id)
    .maybeSingle();

  if (contestResult.error) {
    throw new Error(
      `Failed to load Bracket Challenge contest: ${contestResult.error.message}`,
    );
  }

  const contest =
    contestResult.data as ContestRow | null;

  if (!contest) return null;

  const [competitionResult, gamesResult] =
    await Promise.all([
      supabaseAdmin
        .from("bracket_competitions")
        .select(
          "id, sport_key, format_key, season, name, status, starts_at, ends_at, topology_version",
        )
        .eq("id", contest.competition_id)
        .maybeSingle(),

      supabaseAdmin
        .from("bracket_games")
        .select(
          "id, game_key, round_key, round_order, game_order, region_key, source_a_team_id, source_a_game_id, source_a_seed, source_b_team_id, source_b_game_id, source_b_seed, provider_event_id, scheduled_at, lock_at, status, winner_team_id",
        )
        .eq("competition_id", contest.competition_id)
        .order("round_order", { ascending: true })
        .order("game_order", { ascending: true }),
    ]);

  if (competitionResult.error) {
    throw new Error(
      `Failed to load bracket competition: ${competitionResult.error.message}`,
    );
  }

  if (gamesResult.error) {
    throw new Error(
      `Failed to load bracket topology: ${gamesResult.error.message}`,
    );
  }

  const competition =
    competitionResult.data as CompetitionRow | null;

  if (!competition) return null;

  const rows =
    (gamesResult.data ?? []) as GameRow[];

  // Validate the persisted graph before exposing it to the UI.
  // If the DB topology is malformed, fail loudly rather than
  // rendering a misleading bracket.
  bracketTopologyFromRows(rows);

  return {
    group: {
      id: access.context.group.id,
      name: access.context.group.name,
      slug: access.context.group.slug,
    },
    league: {
      id: access.league.id,
      name: access.league.name,
      slug: access.league.slug,
    },
    canAdministerGroup:
      access.context.canAdministerGroup,
    contest: {
      id: contest.id,
      status: contest.status,
      lockAt: contest.lock_at,
      maxBracketsPerEntrant:
        contest.max_brackets_per_entrant,
      rulesVersion: contest.rules_version,
      rulesSnapshot:
        contest.rules_snapshot ?? {},
    },
    competition: {
      id: competition.id,
      sportKey: competition.sport_key,
      formatKey: competition.format_key,
      season: competition.season,
      name: competition.name,
      status: competition.status,
      startsAt: competition.starts_at,
      endsAt: competition.ends_at,
      topologyVersion:
        competition.topology_version,
    },
    games: rows.map((game) => ({
      id: Number(game.id),
      gameKey: game.game_key,
      roundKey: game.round_key,
      roundOrder: game.round_order,
      gameOrder: game.game_order,
      regionKey: game.region_key,
      sourceATeamId: game.source_a_team_id,
      sourceAGameId:
        game.source_a_game_id === null
          ? null
          : Number(game.source_a_game_id),
      sourceASeed: game.source_a_seed,
      sourceBTeamId: game.source_b_team_id,
      sourceBGameId:
        game.source_b_game_id === null
          ? null
          : Number(game.source_b_game_id),
      sourceBSeed: game.source_b_seed,
      providerEventId:
        game.provider_event_id,
      scheduledAt: game.scheduled_at,
      lockAt: game.lock_at,
      status: game.status,
      winnerTeamId:
        game.winner_team_id,
    })),
  };
}
