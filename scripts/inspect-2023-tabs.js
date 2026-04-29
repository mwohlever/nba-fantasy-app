const XLSX = require("xlsx");

const workbookPath = "imports/nba-playoff-fantasy.xlsx";
const wb = XLSX.readFile(workbookPath);

console.log("All tabs:");
console.log(wb.SheetNames);

const tabs2023 = wb.SheetNames.filter((name) => {
  const clean = name.trim();

  // Matches date-style tabs like:
  // 42823, 42123, 41723, 4/16/23, 4-16-23
  return /^\d{3,4}23$/.test(clean) || /[\/-]\d{1,2}[\/-]23$/.test(clean);
});

console.log("\n2023 tabs found:", tabs2023.length);
console.log(tabs2023);

for (const sheetName of tabs2023) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  console.log("\n==============================");
  console.log(sheetName);
  console.log("==============================");

  rows.slice(0, 25).forEach((row, index) => {
    console.log(index + 1, JSON.stringify(row));
  });
}
