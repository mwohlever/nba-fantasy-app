const XLSX = require("xlsx");

const workbookPath = "imports/nba-playoff-fantasy.xlsx";
const wb = XLSX.readFile(workbookPath);

console.log("All tabs:");
console.log(wb.SheetNames);

const tabs2024 = wb.SheetNames.filter((name) => {
  const clean = name.trim();

  // Matches 2024 compact tabs like 52724, 5924, 5324
  return /^\d{3,4}24$/.test(clean);
});

console.log("\n2024 tabs found:", tabs2024.length);
console.log(tabs2024);

for (const sheetName of tabs2024) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });

  console.log("\n==============================");
  console.log(sheetName);
  console.log("==============================");

  rows.slice(0, 30).forEach((row, index) => {
    console.log(index + 1, JSON.stringify(row));
  });
}
