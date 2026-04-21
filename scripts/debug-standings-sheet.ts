import path from "path";
import * as XLSX from "xlsx";

const workbookPath = path.join(process.cwd(), "NBA Playoff Fantasy (2026).xlsx");
const workbook = XLSX.readFile(workbookPath, { cellDates: true });

for (const sheetName of ["2025 Standings", "2026 Standings"]) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    console.log(`Missing sheet: ${sheetName}`);
    continue;
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  console.log(`\n===== ${sheetName} =====`);
  for (let i = 0; i < Math.min(rows.length, 80); i++) {
    console.log(i, JSON.stringify(rows[i]));
  }
}
