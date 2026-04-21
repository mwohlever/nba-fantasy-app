import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

type TeamRow = {
  id: number;
  name: string;
};

type SummaryRow = {
  name: string;
  wins: number;
  runnerUps: number;
  avgFinish: number | null;
  avgScore: number | null;
  highScore: number | null;
  lowScore: number | null;
  slatesPlayed: number;
};

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function isDateLike(value: unknown) {
  if (value instanceof Date) return true;
  if (typeof value !== "string") return false;

  const trimmed = value.trim();
  return /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed);
}

function rowContainsText(row: unknown[], text: string) {
  return row.some(
    (cell) => typeof cell === "string" && cell.trim().toLowerCase() === text.toLowerCase()
  );
}

function countPlayedSlatesFromScoresSection(rows: unknown[][]) {
  let scoreHeaderRowIndex = -1;

  for (let i = 0; i < rows.length; i++) {
    const firstCell = rows[i]?.[0];
    const secondCell = rows[i]?.[1];

    if (firstCell === "Date" && typeof secondCell === "string" && secondCell.trim() !== "") {
      scoreHeaderRowIndex = i;
      break;
    }
  }

  if (scoreHeaderRowIndex === -1) {
    return new Map<string, number>();
  }

  const headerRow = rows[scoreHeaderRowIndex];
  const teamNames = headerRow
    .slice(1)
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map(String);

  const counts = new Map<string, number>();
  for (const teamName of teamNames) {
    counts.set(normalizeName(teamName), 0);
  }

  for (let r = scoreHeaderRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];

    if (!row || row.every((cell) => cell === null || cell === undefined || cell === "")) {
      continue;
    }

    if (rowContainsText(row, "Finishing Position")) {
      break;
    }

    if (rowContainsText(row, "Scores")) {
      continue;
    }

    const firstCell = row[0];

    if (!isDateLike(firstCell)) {
      continue;
    }

    for (let c = 1; c <= teamNames.length; c++) {
      const teamName = teamNames[c - 1];
      const score = toNumber(row[c]);

      if (score !== null && score > 0) {
        const key = normalizeName(teamName);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }

  return counts;
}

function readSeasonSummary(workbook: XLSX.WorkBook, sheetName: string): SummaryRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const playedSlateCounts = countPlayedSlatesFromScoresSection(rows);

  const result: SummaryRow[] = [];
  let started = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const firstCell = row?.[0];
    const secondCell = row?.[1];

    if (!started) {
      if (firstCell === "Name" && secondCell === "Wins") {
        started = true;
      }
      continue;
    }

    if (
      firstCell === null ||
      firstCell === undefined ||
      firstCell === "" ||
      firstCell === "Scores" ||
      firstCell === "Date"
    ) {
      break;
    }

    if (typeof firstCell !== "string") {
      break;
    }

    const name = firstCell;
    const wins = row?.[1];
    const runnerUps = row?.[2];
    const avgFinish = row?.[3];
    const avgScore = row?.[4];
    const highScore = row?.[5];
    const lowScore = row?.[6];

    const winsNum = toNumber(wins);
    const runnerUpsNum = toNumber(runnerUps);

    if (winsNum === null && runnerUpsNum === null) {
      break;
    }

    const key = normalizeName(name);

    result.push({
      name,
      wins: winsNum ?? 0,
      runnerUps: runnerUpsNum ?? 0,
      avgFinish: toNumber(avgFinish),
      avgScore: toNumber(avgScore),
      highScore: toNumber(highScore),
      lowScore: toNumber(lowScore),
      slatesPlayed: playedSlateCounts.get(key) ?? 0,
    });
  }

  return result;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment."
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const workbookPath = path.join(process.cwd(), "NBA Playoff Fantasy (2026).xlsx");

  if (!fs.existsSync(workbookPath)) {
    throw new Error(
      `Workbook not found at project root: ${workbookPath}\nPut the xlsx file in your project root first.`
    );
  }

  const workbook = XLSX.readFile(workbookPath, { cellDates: true });

  const seasonConfigs = [
    { season: 2025, sheetName: "2025 Standings" },
    { season: 2026, sheetName: "2026 Standings" },
  ];

  const { data: teams, error: teamsError } = await supabase
    .from("teams")
    .select("id, name")
    .order("name");

  if (teamsError || !teams) {
    throw new Error(`Failed to load teams: ${teamsError?.message}`);
  }

  const safeTeams = teams as TeamRow[];
  const teamMap = new Map<string, TeamRow>();
  for (const team of safeTeams) {
    teamMap.set(normalizeName(team.name), team);
  }

  const upsertRows: Array<{
    season: number;
    team_id: number;
    wins: number;
    runner_ups: number;
    avg_finish: number | null;
    avg_score: number | null;
    high_score: number | null;
    low_score: number | null;
    slates_played: number;
    updated_at: string;
  }> = [];

  for (const config of seasonConfigs) {
    const summaryRows = readSeasonSummary(workbook, config.sheetName);

    for (const row of summaryRows) {
      const team = teamMap.get(normalizeName(row.name));

      if (!team) {
        throw new Error(
          `Could not match spreadsheet team name "${row.name}" to a team in Supabase.`
        );
      }

      upsertRows.push({
        season: config.season,
        team_id: team.id,
        wins: row.wins,
        runner_ups: row.runnerUps,
        avg_finish: row.avgFinish,
        avg_score: row.avgScore,
        high_score: row.highScore,
        low_score: row.lowScore,
        slates_played: row.slatesPlayed,
        updated_at: new Date().toISOString(),
      });
    }
  }

  const { error: upsertError } = await supabase
    .from("season_team_summary")
    .upsert(upsertRows, {
      onConflict: "season,team_id",
    });

  if (upsertError) {
    throw new Error(`Failed to upsert season summaries: ${upsertError.message}`);
  }

  console.log("Season summary import complete.");
  console.table(
    upsertRows.map((row) => ({
      season: row.season,
      team_id: row.team_id,
      wins: row.wins,
      runner_ups: row.runner_ups,
      avg_score: row.avg_score,
      slates_played: row.slates_played,
    }))
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
