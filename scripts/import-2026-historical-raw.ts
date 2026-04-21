import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

type PositionGroup = "G" | "F/C";

type PlayerInput = {
  name: string;
  position_group: PositionGroup;
  fantasy_points: number;
};

type TeamLineupInput = {
  team_name: string;
  total: number;
  players: PlayerInput[];
};

type HistoricalSlateInput = {
  start_date: string;
  end_date: string;
  teams: TeamLineupInput[];
};

const IMPORT_MODE: "skip" | "replace" = "replace";
// skip    = do nothing if a slate with same start_date + end_date already exists
// replace = delete existing imported rows for that slate and recreate them

const CREATE_MISSING_PLAYERS_AS_ACTIVE = false;
// false = historical-only players won't clutter your current draft pool
// true  = imported missing players will be active

function loadEnvFile(filePath: string) {
  const fullPath = path.resolve(process.cwd(), filePath);
  const content = fs.readFileSync(fullPath, "utf8");

  const env: Record<string, string> = {};

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    const value = line.slice(equalsIndex + 1).trim();

    env[key] = value;
  }

  return env;
}

const env = loadEnvFile(".env.local");

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

const HISTORICAL_SLATES: HistoricalSlateInput[] = [
  {
    start_date: "2026-04-14",
    end_date: "2026-04-15",
    teams: [
      {
        team_name: "Andy",
        total: 182.2,
        players: [
          { name: "LaMelo Ball", position_group: "G", fantasy_points: 52.0 },
          { name: "Desmond Bane", position_group: "G", fantasy_points: 39.1 },
          { name: "Bam Adebayo", position_group: "F/C", fantasy_points: 13.1 },
          { name: "Brandon Miller", position_group: "F/C", fantasy_points: 39.5 },
          { name: "Kristaps Porzingis", position_group: "F/C", fantasy_points: 38.5 },
        ],
      },
      {
        team_name: "Jon",
        total: 140.5,
        players: [
          { name: "Stephen Curry", position_group: "G", fantasy_points: 41.2 },
          { name: "Kon Knueppel", position_group: "G", fantasy_points: 13.5 },
          { name: "Paolo Banchero", position_group: "F/C", fantasy_points: 26.0 },
          { name: "Dillon Brooks", position_group: "F/C", fantasy_points: 38.4 },
          { name: "Jerami Grant", position_group: "F/C", fantasy_points: 21.4 },
        ],
      },
      {
        team_name: "Mark",
        total: 217.9,
        players: [
          { name: "Devin Booker", position_group: "G", fantasy_points: 29.2 },
          { name: "Darius Garland", position_group: "G", fantasy_points: 39.0 },
          { name: "Deni Avdija", position_group: "F/C", fantasy_points: 66.4 },
          { name: "Paul George", position_group: "F/C", fantasy_points: 33.5 },
          { name: "Miles Bridges", position_group: "F/C", fantasy_points: 49.8 },
        ],
      },
      {
        team_name: "Josh",
        total: 152.9,
        players: [
          { name: "Tyrese Maxey", position_group: "G", fantasy_points: 43.4 },
          { name: "Tyler Herro", position_group: "G", fantasy_points: 33.6 },
          { name: "Kawhi Leonard", position_group: "F/C", fantasy_points: 28.9 },
          { name: "Franz Wagner", position_group: "F/C", fantasy_points: 21.3 },
          { name: "Wendell Carter Jr.", position_group: "F/C", fantasy_points: 25.7 },
        ],
      },
    ],
  },
  {
    start_date: "2026-04-17",
    end_date: "2026-04-17",
    teams: [
      {
        team_name: "Andy",
        total: 129.4,
        players: [
          { name: "Desmond Bane", position_group: "G", fantasy_points: 26.4 },
          { name: "Jalen Suggs", position_group: "G", fantasy_points: 26.0 },
          { name: "Paolo Banchero", position_group: "F/C", fantasy_points: 44.0 },
          { name: "Draymond Green", position_group: "F/C", fantasy_points: 13.4 },
          { name: "Moussa Diabate", position_group: "F/C", fantasy_points: 19.6 },
        ],
      },
      {
        team_name: "Jon",
        total: 84.5,
        players: [
          { name: "LaMelo Ball", position_group: "G", fantasy_points: 29.9 },
          { name: "Kon Knueppel", position_group: "G", fantasy_points: 18.1 },
          { name: "Dillon Brooks", position_group: "F/C", fantasy_points: 15.2 },
          { name: "Kristaps Porzingis", position_group: "F/C", fantasy_points: 9.2 },
          { name: "Ryan Kalkbrenner", position_group: "F/C", fantasy_points: 12.1 },
        ],
      },
      {
        team_name: "Mark",
        total: 138.2,
        players: [
          { name: "Devin Booker", position_group: "G", fantasy_points: 40.2 },
          { name: "Brandin Podziemski", position_group: "G", fantasy_points: 33.0 },
          { name: "Brandon Miller", position_group: "F/C", fantasy_points: 18.1 },
          { name: "Gui Santos", position_group: "F/C", fantasy_points: 22.2 },
          { name: "Wendell Carter Jr.", position_group: "F/C", fantasy_points: 24.7 },
        ],
      },
      {
        team_name: "Josh",
        total: 153.3,
        players: [
          { name: "Stephen Curry", position_group: "G", fantasy_points: 27.8 },
          { name: "Jalen Green", position_group: "G", fantasy_points: 57.2 },
          { name: "Miles Bridges", position_group: "F/C", fantasy_points: 15.9 },
          { name: "Franz Wagner", position_group: "F/C", fantasy_points: 35.4 },
          { name: "Al Horford", position_group: "F/C", fantasy_points: 17.0 },
        ],
      },
    ],
  },
  {
    start_date: "2026-04-18",
    end_date: "2026-04-18",
    teams: [
      {
        team_name: "Andy",
        total: 166.9,
        players: [
          { name: "James Harden", position_group: "G", fantasy_points: 39.4 },
          { name: "Jamal Murray", position_group: "G", fantasy_points: 44.5 },
          { name: "Jalen Johnson", position_group: "F/C", fantasy_points: 34.9 },
          { name: "Scottie Barnes", position_group: "F/C", fantasy_points: 27.7 },
          { name: "Jarrett Allen", position_group: "F/C", fantasy_points: 20.4 },
        ],
      },
      {
        team_name: "Jon",
        total: 200.5,
        players: [
          { name: "Jalen Brunson", position_group: "G", fantasy_points: 44.5 },
          { name: "RJ Barrett", position_group: "G", fantasy_points: 28.9 },
          { name: "Nikola Jokic", position_group: "F/C", fantasy_points: 54.1 },
          { name: "Karl-Anthony Towns", position_group: "F/C", fantasy_points: 43.6 },
          { name: "Evan Mobley", position_group: "F/C", fantasy_points: 29.4 },
        ],
      },
      {
        team_name: "Mark",
        total: 178.6,
        players: [
          { name: "Nickeil Alexander-Walker", position_group: "G", fantasy_points: 25.2 },
          { name: "CJ McCollum", position_group: "G", fantasy_points: 29.3 },
          { name: "LeBron James", position_group: "F/C", fantasy_points: 52.1 },
          { name: "Jabari Smith Jr", position_group: "F/C", fantasy_points: 33.4 },
          { name: "Alperen Sengun", position_group: "F/C", fantasy_points: 38.6 },
        ],
      },
      {
        team_name: "Josh",
        total: 182.6,
        players: [
          { name: "Anthony Edwards", position_group: "G", fantasy_points: 46.3 },
          { name: "Donovan Mitchell", position_group: "G", fantasy_points: 41.6 },
          { name: "Julius Randle", position_group: "F/C", fantasy_points: 26.4 },
          { name: "Brandon Ingram", position_group: "F/C", fantasy_points: 26.4 },
          { name: "Amen Thompson", position_group: "F/C", fantasy_points: 41.9 },
        ],
      },
    ],
  },
  {
    start_date: "2026-04-19",
    end_date: "2026-04-19",
    teams: [
      {
        team_name: "Andy",
        total: 157.8,
        players: [
          { name: "Tyrese Maxey", position_group: "G", fantasy_points: 31.2 },
          { name: "Jalen Green", position_group: "G", fantasy_points: 25.5 },
          { name: "Victor Wembanyama", position_group: "F/C", fantasy_points: 42.5 },
          { name: "Jaylen Brown", position_group: "F/C", fantasy_points: 37.3 },
          { name: "Paul George", position_group: "F/C", fantasy_points: 21.3 },
        ],
      },
      {
        team_name: "Jon",
        total: 0,
        players: [],
      },
      {
        team_name: "Mark",
        total: 213.8,
        players: [
          { name: "Cade Cunningham", position_group: "G", fantasy_points: 48.0 },
          { name: "Stephon Castle", position_group: "G", fantasy_points: 32.9 },
          { name: "Jayson Tatum", position_group: "F/C", fantasy_points: 51.7 },
          { name: "Paolo Banchero", position_group: "F/C", fantasy_points: 38.8 },
          { name: "Jalen Williams", position_group: "F/C", fantasy_points: 42.4 },
        ],
      },
      {
        team_name: "Josh",
        total: 174.3,
        players: [
          { name: "Shai Gilgeous-Alexander", position_group: "G", fantasy_points: 44.3 },
          { name: "Devin Booker", position_group: "G", fantasy_points: 30.2 },
          { name: "Deni Avdija", position_group: "F/C", fantasy_points: 51.5 },
          { name: "Jalen Duren", position_group: "F/C", fantasy_points: 16.9 },
          { name: "Chet Holmgren", position_group: "F/C", fantasy_points: 31.4 },
        ],
      },
    ],
  },
  {
    start_date: "2026-04-20",
    end_date: "2026-04-20",
    teams: [
      {
        team_name: "Andy",
        total: 173.5,
        players: [
          { name: "James Harden", position_group: "G", fantasy_points: 47.0 },
          { name: "Nickeil Alexander-Walker", position_group: "G", fantasy_points: 28.0 },
          { name: "Nikola Jokic", position_group: "F/C", fantasy_points: 53.0 },
          { name: "Karl-Anthony Towns", position_group: "F/C", fantasy_points: 31.6 },
          { name: "Rudy Gobert", position_group: "F/C", fantasy_points: 13.9 },
        ],
      },
      {
        team_name: "Jon",
        total: 0,
        players: [],
      },
      {
        team_name: "Mark",
        total: 180.0,
        players: [
          { name: "Donovan Mitchell", position_group: "G", fantasy_points: 46.9 },
          { name: "Jamal Murray", position_group: "G", fantasy_points: 46.9 },
          { name: "Jalen Johnson", position_group: "F/C", fantasy_points: 30.1 },
          { name: "Julius Randle", position_group: "F/C", fantasy_points: 42.8 },
          { name: "Brandon Ingram", position_group: "F/C", fantasy_points: 13.3 },
        ],
      },
      {
        team_name: "Josh",
        total: 189.2,
        players: [
          { name: "Anthony Edwards", position_group: "G", fantasy_points: 49.0 },
          { name: "Jalen Brunson", position_group: "G", fantasy_points: 38.9 },
          { name: "Scottie Barnes", position_group: "F/C", fantasy_points: 40.3 },
          { name: "Evan Mobley", position_group: "F/C", fantasy_points: 38.6 },
          { name: "Aaron Gordon", position_group: "F/C", fantasy_points: 22.4 },
        ],
      },
    ],
  },
];

async function getTeamMap() {
  const { data, error } = await supabase
    .from("teams")
    .select("id, name");

  if (error || !data) {
    throw new Error(`Failed to load teams: ${error?.message}`);
  }

  const map = new Map<string, number>();
  for (const row of data) {
    map.set(row.name.trim().toLowerCase(), row.id);
  }
  return map;
}

async function getOrCreatePlayerId(
  playerName: string,
  positionGroup: PositionGroup,
  cache: Map<string, number>
) {
  const key = playerName.trim().toLowerCase();
  const cached = cache.get(key);
  if (cached) return cached;

  const { data: existing, error: findError } = await supabase
    .from("players")
    .select("id, name")
    .ilike("name", playerName)
    .limit(1)
    .maybeSingle();

  if (findError) {
    throw new Error(`Failed to look up player "${playerName}": ${findError.message}`);
  }

  if (existing?.id) {
    cache.set(key, existing.id);
    return existing.id;
  }

  const { data: created, error: createError } = await supabase
    .from("players")
    .insert({
      name: playerName,
      position_group: positionGroup,
      is_active: CREATE_MISSING_PLAYERS_AS_ACTIVE,
      is_playing_today: false,
    })
    .select("id")
    .single();

  if (createError || !created) {
    throw new Error(`Failed to create player "${playerName}": ${createError?.message}`);
  }

  cache.set(key, created.id);
  return created.id;
}

async function findExistingSlateId(startDate: string, endDate: string) {
  const { data, error } = await supabase
    .from("slates")
    .select("id")
    .eq("start_date", startDate)
    .eq("end_date", endDate)
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to check existing slate ${startDate} - ${endDate}: ${error.message}`
    );
  }

  return data?.id ?? null;
}

async function deleteSlateDependencies(slateId: number) {
  const { data: lineups, error: lineupsError } = await supabase
    .from("lineups")
    .select("id")
    .eq("slate_id", slateId);

  if (lineupsError) {
    throw new Error(`Failed loading existing lineups for slate ${slateId}: ${lineupsError.message}`);
  }

  const lineupIds = (lineups ?? []).map((row) => row.id);

  if (lineupIds.length > 0) {
    const { error: deleteLineupPlayersError } = await supabase
      .from("lineup_players")
      .delete()
      .in("lineup_id", lineupIds);

    if (deleteLineupPlayersError) {
      throw new Error(
        `Failed deleting lineup_players for slate ${slateId}: ${deleteLineupPlayersError.message}`
      );
    }

    const { error: deleteLineupsError } = await supabase
      .from("lineups")
      .delete()
      .eq("slate_id", slateId);

    if (deleteLineupsError) {
      throw new Error(
        `Failed deleting lineups for slate ${slateId}: ${deleteLineupsError.message}`
      );
    }
  }

  const { error: deleteStatsError } = await supabase
    .from("player_slate_stats")
    .delete()
    .eq("slate_id", slateId);

  if (deleteStatsError) {
    throw new Error(`Failed deleting player_slate_stats for slate ${slateId}: ${deleteStatsError.message}`);
  }

  const { error: deleteResultsError } = await supabase
    .from("team_slate_results")
    .delete()
    .eq("slate_id", slateId);

  if (deleteResultsError) {
    throw new Error(`Failed deleting team_slate_results for slate ${slateId}: ${deleteResultsError.message}`);
  }

  const { error: deleteSlateTeamsError } = await supabase
    .from("slate_teams")
    .delete()
    .eq("slate_id", slateId);

  if (deleteSlateTeamsError) {
    throw new Error(`Failed deleting slate_teams for slate ${slateId}: ${deleteSlateTeamsError.message}`);
  }

  const { error: deleteSlateError } = await supabase
    .from("slates")
    .delete()
    .eq("id", slateId);

  if (deleteSlateError) {
    throw new Error(`Failed deleting slate ${slateId}: ${deleteSlateError.message}`);
  }
}

function buildFinishMap(teams: TeamLineupInput[]) {
  const participating = teams
    .filter((team) => team.players.length > 0)
    .sort((a, b) => b.total - a.total);

  const finishMap = new Map<string, number | null>();

  participating.forEach((team, index) => {
    finishMap.set(team.team_name.trim().toLowerCase(), index + 1);
  });

  teams
    .filter((team) => team.players.length === 0)
    .forEach((team) => {
      finishMap.set(team.team_name.trim().toLowerCase(), null);
    });

  return finishMap;
}

async function importSlate(
  slate: HistoricalSlateInput,
  teamMap: Map<string, number>,
  playerCache: Map<string, number>
) {
  const existingSlateId = await findExistingSlateId(slate.start_date, slate.end_date);

  if (existingSlateId && IMPORT_MODE === "skip") {
    console.log(`Skipping existing slate ${slate.start_date} - ${slate.end_date}`);
    return;
  }

  if (existingSlateId && IMPORT_MODE === "replace") {
    console.log(`Replacing existing slate ${slate.start_date} - ${slate.end_date}`);
    await deleteSlateDependencies(existingSlateId);
  }

  const { data: newSlate, error: slateError } = await supabase
    .from("slates")
    .insert({
      date: slate.start_date,
      start_date: slate.start_date,
      end_date: slate.end_date,
      is_locked: true,
    })
    .select("id")
    .single();

  if (slateError || !newSlate) {
    throw new Error(
      `Failed creating slate ${slate.start_date} - ${slate.end_date}: ${slateError?.message}`
    );
  }

  const slateId = newSlate.id;
  const finishMap = buildFinishMap(slate.teams);

  const lineupsToInsert: Array<{ slate_id: number; team_id: number }> = [];
  for (const team of slate.teams) {
    const teamId = teamMap.get(team.team_name.trim().toLowerCase());
    if (!teamId) {
      throw new Error(`Team "${team.team_name}" does not exist in teams table.`);
    }

    lineupsToInsert.push({
      slate_id: slateId,
      team_id: teamId,
    });
  }

  const { data: createdLineups, error: lineupError } = await supabase
    .from("lineups")
    .insert(lineupsToInsert)
    .select("id, team_id");

  if (lineupError || !createdLineups) {
    throw new Error(
      `Failed creating lineups for slate ${slate.start_date}: ${lineupError?.message}`
    );
  }

  const lineupIdByTeamId = new Map<number, number>();
  for (const row of createdLineups) {
    lineupIdByTeamId.set(row.team_id, row.id);
  }

  const lineupPlayersToInsert: Array<{ lineup_id: number; player_id: number }> = [];
  const playerSlateStatsToInsert: Array<{
    slate_id: number;
    player_id: number;
    fantasy_points: number;
  }> = [];
  const seenPlayerStatsKeys = new Set<string>();

  for (const team of slate.teams) {
    const teamId = teamMap.get(team.team_name.trim().toLowerCase())!;
    const lineupId = lineupIdByTeamId.get(teamId);

    if (!lineupId) {
      throw new Error(`Missing lineup id for team "${team.team_name}" on slate ${slateId}`);
    }

    for (const player of team.players) {
      const playerId = await getOrCreatePlayerId(
        player.name,
        player.position_group,
        playerCache
      );

      lineupPlayersToInsert.push({
        lineup_id: lineupId,
        player_id: playerId,
      });

      const statKey = `${slateId}-${playerId}`;
      if (!seenPlayerStatsKeys.has(statKey)) {
        seenPlayerStatsKeys.add(statKey);

        playerSlateStatsToInsert.push({
          slate_id: slateId,
          player_id: playerId,
          fantasy_points: player.fantasy_points,
        });
      }
    }
  }

  if (lineupPlayersToInsert.length > 0) {
    const { error: lineupPlayersError } = await supabase
      .from("lineup_players")
      .insert(lineupPlayersToInsert);

    if (lineupPlayersError) {
      throw new Error(
        `Failed creating lineup_players for slate ${slate.start_date}: ${lineupPlayersError.message}`
      );
    }
  }

  if (playerSlateStatsToInsert.length > 0) {
    const { error: playerStatsError } = await supabase
      .from("player_slate_stats")
      .insert(playerSlateStatsToInsert);

    if (playerStatsError) {
      throw new Error(
        `Failed creating player_slate_stats for slate ${slate.start_date}: ${playerStatsError.message}`
      );
    }
  }

  const teamResultsToInsert = slate.teams.map((team) => {
    const teamId = teamMap.get(team.team_name.trim().toLowerCase())!;
    const finishPosition = finishMap.get(team.team_name.trim().toLowerCase()) ?? null;
    const gamesCompleted = team.players.length;

    return {
      slate_id: slateId,
      team_id: teamId,
      fantasy_points: team.total,
      finish_position: finishPosition,
      games_completed: gamesCompleted,
      games_in_progress: 0,
      games_remaining: 0,
    };
  });

  const { error: teamResultsError } = await supabase
    .from("team_slate_results")
    .insert(teamResultsToInsert);

  if (teamResultsError) {
    throw new Error(
      `Failed creating team_slate_results for slate ${slate.start_date}: ${teamResultsError.message}`
    );
  }

  console.log(
    `Imported slate ${slate.start_date}${slate.start_date !== slate.end_date ? ` - ${slate.end_date}` : ""}`
  );
}

async function main() {
  const teamMap = await getTeamMap();
  const playerCache = new Map<string, number>();

  for (const slate of HISTORICAL_SLATES) {
    await importSlate(slate, teamMap, playerCache);
  }

  console.log("2026 historical slate import complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

