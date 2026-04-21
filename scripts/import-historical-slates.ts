import fs from "fs";
import path from "path";
import * as XLSX from "xlsx";
import { createClient } from "@supabase/supabase-js";

type TeamRow = {
  id: number;
  name: string;
};

type SlateInsertRow = {
  start_date: string;
  end_date: string;
  date: string;
  is_locked: boolean;
};

type TeamSlateResultInsertRow = {
  slate_id: number;
  team_id: number;
  fantasy_points: number;
  finish_position: number | null;
  games_completed: number;
  games_in_progress: number;
  games_remaining: number;
};

type ParsedSlateRow = {
  label: string;
  start_date: string;
  end_date: string;
  date: string;
  scoresByTeam: Record<string, number>;
  finishesByTeam: Record<string, number | null>;
};

function normalizeName(value: string) {
  return value.trim().toLowerCase();
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toIsoDate(mm: number, dd: number, yy: number) {
  return `20${String(yy).padStart(2, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

function formatDateObjectToIso(raw: Date) {
  const year = raw.getFullYear();
  const month = raw.getMonth() + 1;
  const day = raw.getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function parseSpreadsheetDateLabel(raw: unknown) {
  if (raw instanceof Date) {
    const iso = formatDateObjectToIso(raw);
    return {
      label: iso,
      start_date: iso,
      end_date: iso,
      date: iso,
    };
  }

  if (typeof raw !== "string") return null;

  const value = raw.trim();

  const rangeMatch = value.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*-\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/
  );
  if (rangeMatch) {
    const startMonth = Number(rangeMatch[1]);
    const startDay = Number(rangeMatch[2]);
    const startYear = Number(String(rangeMatch[3]).slice(-2));
    const endMonth = Number(rangeMatch[4]);
    const endDay = Number(rangeMatch[5]);
    const endYear = Number(String(rangeMatch[6]).slice(-2));

    const start_date = toIsoDate(startMonth, startDay, startYear);
    const end_date = toIsoDate(endMonth, endDay, endYear);

    return {
      label: value,
      start_date,
      end_date,
      date: start_date,
    };
  }

  const singleMatch = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (singleMatch) {
    const month = Number(singleMatch[1]);
    const day = Number(singleMatch[2]);
    const year = Number(String(singleMatch[3]).slice(-2));
    const iso = toIsoDate(month, day, year);

    return {
      label: value,
      start_date: iso,
      end_date: iso,
      date: iso,
    };
  }

  return null;
}

function isNullishOrEmpty(value: unknown) {
  return value === null || value === undefined || value === "";
}

function rowIsBlank(row: unknown[]) {
  return row.every((cell) => isNullishOrEmpty(cell));
}

function getNonEmptyStringCells(row: unknown[]) {
  return row
    .filter((cell) => typeof cell === "string" && cell.trim() !== "")
    .map((cell) => String(cell).trim());
}

function findScoresHeaderRowIndex(rows: unknown[][]) {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const first = row[0];
    if (first !== "Date") continue;

    const teamNames = row
      .slice(1)
      .filter((cell) => typeof cell === "string" && String(cell).trim() !== "");

    if (teamNames.length >= 4) {
      return i;
    }
  }
  return -1;
}

function findFinishingSectionLabelRowIndex(rows: unknown[][]) {
  for (let i = 0; i < rows.length; i++) {
    const cells = getNonEmptyStringCells(rows[i] ?? []).map((cell) => cell.toLowerCase());
    if (cells.includes("finishing position")) {
      return i;
    }
  }
  return -1;
}

function findNextDateHeaderRowIndex(rows: unknown[][], startIndex: number) {
  for (let i = startIndex; i < rows.length; i++) {
    const row = rows[i] ?? [];
    if (row[0] === "Date") {
      return i;
    }
  }
  return -1;
}

function parseStandingsSheet(
  workbook: XLSX.WorkBook,
  sheetName: string
): ParsedSlateRow[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet not found: ${sheetName}`);
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  const scoresHeaderRowIndex = findScoresHeaderRowIndex(rows);
  if (scoresHeaderRowIndex === -1) {
    throw new Error(`Could not find Scores header row in ${sheetName}`);
  }

  const finishingSectionLabelRowIndex = findFinishingSectionLabelRowIndex(rows);
  if (finishingSectionLabelRowIndex === -1) {
    throw new Error(`Could not find Finishing Position section in ${sheetName}`);
  }

  const finishingHeaderRowIndex = findNextDateHeaderRowIndex(
    rows,
    finishingSectionLabelRowIndex
  );
  if (finishingHeaderRowIndex === -1) {
    throw new Error(`Could not find Finishing Position header row in ${sheetName}`);
  }

  const scoreHeaderRow = rows[scoresHeaderRowIndex] ?? [];
  const finishHeaderRow = rows[finishingHeaderRowIndex] ?? [];

  const scoreTeams = scoreHeaderRow
    .slice(1)
    .filter((cell) => typeof cell === "string" && String(cell).trim() !== "")
    .map((cell) => String(cell).trim());

  const finishTeams = finishHeaderRow
    .slice(1)
    .filter((cell) => typeof cell === "string" && String(cell).trim() !== "")
    .map((cell) => String(cell).trim());

  const scoreRowsByKey = new Map<
    string,
    {
      parsed: { label: string; start_date: string; end_date: string; date: string };
      scoresByTeam: Record<string, number>;
    }
  >();

  const finishRowsByKey = new Map<string, Record<string, number | null>>();

  for (let r = scoresHeaderRowIndex + 1; r < finishingSectionLabelRowIndex; r++) {
    const row = rows[r] ?? [];
    if (rowIsBlank(row)) continue;

    const parsedDate = parseSpreadsheetDateLabel(row[0]);
    if (!parsedDate) continue;

    const scoresByTeam: Record<string, number> = {};
    for (let c = 0; c < scoreTeams.length; c++) {
      scoresByTeam[scoreTeams[c]] = toNumber(row[c + 1]) ?? 0;
    }

    const key = `${parsedDate.start_date}|${parsedDate.end_date}`;
    scoreRowsByKey.set(key, { parsed: parsedDate, scoresByTeam });
  }

  for (let r = finishingHeaderRowIndex + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    if (rowIsBlank(row)) continue;

    const parsedDate = parseSpreadsheetDateLabel(row[0]);
    if (!parsedDate) continue;

    const finishesByTeam: Record<string, number | null> = {};
    for (let c = 0; c < finishTeams.length; c++) {
      finishesByTeam[finishTeams[c]] = toNumber(row[c + 1]);
    }

    const key = `${parsedDate.start_date}|${parsedDate.end_date}`;
    finishRowsByKey.set(key, finishesByTeam);
  }

  const parsedRows: ParsedSlateRow[] = [];

  for (const [key, scoreRow] of scoreRowsByKey.entries()) {
    parsedRows.push({
      ...scoreRow.parsed,
      scoresByTeam: scoreRow.scoresByTeam,
      finishesByTeam: finishRowsByKey.get(key) ?? {},
    });
  }

  parsedRows.sort((a, b) => a.start_date.localeCompare(b.start_date));

  return parsedRows;
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
    throw new Error(`Workbook not found at project root: ${workbookPath}`);
  }

  const workbook = XLSX.readFile(workbookPath, { cellDates: true });

  const seasonSheets = ["2025 Standings", "2026 Standings"];

  const parsedSlateRows = seasonSheets.flatMap((sheetName) =>
    parseStandingsSheet(workbook, sheetName)
  );

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

  const slateInsertRows: SlateInsertRow[] = parsedSlateRows.map((row) => ({
    start_date: row.start_date,
    end_date: row.end_date,
    date: row.date,
    is_locked: false,
  }));

  const { data: insertedSlates, error: slateInsertError } = await supabase
    .from("slates")
    .insert(slateInsertRows)
    .select("id, start_date, end_date");

  if (slateInsertError || !insertedSlates) {
    throw new Error(`Failed to insert slates: ${slateInsertError?.message}`);
  }

  const slateIdByKey = new Map<string, number>();
  insertedSlates.forEach((slate) => {
    const key = `${slate.start_date}|${slate.end_date}`;
    slateIdByKey.set(key, slate.id);
  });

  const teamResultRows: TeamSlateResultInsertRow[] = [];

  for (const row of parsedSlateRows) {
    const slateKey = `${row.start_date}|${row.end_date}`;
    const slateId = slateIdByKey.get(slateKey);

    if (!slateId) {
      throw new Error(`Missing inserted slate id for ${row.label}`);
    }

    for (const [teamName, score] of Object.entries(row.scoresByTeam)) {
      const team = teamMap.get(normalizeName(teamName));
      if (!team) {
        throw new Error(`Could not match spreadsheet team name "${teamName}"`);
      }

      const finish = row.finishesByTeam[teamName] ?? null;
      const didPlay = score > 0;

      teamResultRows.push({
        slate_id: slateId,
        team_id: team.id,
        fantasy_points: score,
        finish_position: finish,
        games_completed: didPlay ? 5 : 0,
        games_in_progress: 0,
        games_remaining: 0,
      });
    }
  }

  const { error: teamResultsError } = await supabase
    .from("team_slate_results")
    .insert(teamResultRows);

  if (teamResultsError) {
    throw new Error(`Failed to insert team_slate_results: ${teamResultsError.message}`);
  }

  console.log("Historical slates import complete.");
  console.log(`Inserted slates: ${insertedSlates.length}`);
  console.log(`Inserted team result rows: ${teamResultRows.length}`);
  console.table(
    parsedSlateRows.slice(0, 15).map((row) => ({
      label: row.label,
      start_date: row.start_date,
      end_date: row.end_date,
    }))
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
