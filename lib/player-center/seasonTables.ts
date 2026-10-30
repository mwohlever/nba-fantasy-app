import type { CenterSeasonStats } from "./espn";
import type { CenterSport } from "./types";

type Category = CenterSeasonStats["categories"][number];
export type SeasonTable = {
  key: string; title: string; secondary: boolean;
  columns: { label: string; unit: string }[];
  rows: { label: string; team: string | null; values: (string | null)[] }[];
};
const shots = new Set(["FG", "FG%", "3PT", "3P%", "FT", "FT%"]);
const nbaOrder = ["GP", "MIN", "PTS", "REB", "AST", "STL", "BLK", "TO", "GS", "OR", "DR", "PF"];
function unit(sport: CenterSport, category: string, label: string) {
  if (label.includes("%")) return "%";
  if (label === "GP") return "games";
  if (label === "GS") return "starts";
  if (sport === "nba") {
    if (shots.has(label)) return category === "averages" ? "made–att/G" : "made–att";
    if (label === "MIN") return category === "averages" ? "min/G" : "min";
    return category === "averages" && ["PTS", "REB", "AST", "STL", "BLK", "TO", "OR", "DR", "PF"].includes(label) ? "/ game" : "";
  }
  if (label === "AVG") return category === "passing" ? "yd/att" : category === "rushing" ? "yd/carry" : category === "receiving" ? "yd/rec" : "";
  if (label === "YDS" || label === "LNG" || label === "STFYDS") return "yards";
  if ((label === "FG" && category === "kicking") || /^\d+-\d+$|^50\+$/.test(label)) return "made–att";
  if (label === "PTS" && category === "kicking") return "kick points";
  if (["RTG", "QBR"].includes(label)) return "rating";
  return ["CMP", "ATT", "TD", "INT", "CAR", "REC", "TGTS", "FD", "FUM", "LST", "SACK", "XPM", "XPA", "TOT", "SOLO", "AST", "FF", "FR", "PD", "STF", "KB"].includes(label) ? "total" : "";
}
function hasPassingActivity(category: Category) {
  // Only selects a relevant category; never turns absent or unknown values into zero statistics.
  return category.fields.some(item => ["ATT", "CMP", "YDS", "TD", "INT"].includes(item.label.trim()) && item.value !== null && Number.isFinite(Number(item.value.replaceAll(",", ""))) && Number(item.value.replaceAll(",", "")) !== 0);
}

/** Presentation only: exact provider values, separate team rows, no calculated totals/averages or GP fills. */
export function seasonTables(stats: CenterSeasonStats, sport: CenterSport, position: string): SeasonTable[] {
  const tables: SeasonTable[] = [];
  const split = new Set(stats.categories.map(category => category.teamId)).size > 1;
  const add = (category: Category, title: string, fields: Category["fields"], secondary: boolean, rowLabel: string) => {
    if (!fields.length) return;
    const columns = fields.map(field => ({ label: field.label.trim(), unit: unit(sport, category.name, field.label.trim()) }));
    // A different field order/schema is a separate table, including repeated labels in NFL defense.
    const key = `${title}:${JSON.stringify(columns)}`;
    let table = tables.find(table => table.key === key);
    if (!table) { table = { key, title, secondary, columns, rows: [] }; tables.push(table); }
    table.rows.push({ label: rowLabel, team: split ? category.teamId : null, values: fields.map(field => field.value) });
  };
  const allowed = position === "K" ? ["kicking"] : position === "D/ST" ? ["defensive", "defense"]
    : position === "QB" ? ["passing", "rushing", "receiving"] : position === "RB" ? ["rushing", "receiving", "passing"] : ["receiving", "rushing", "passing"];
  const categories = [...stats.categories].sort((a, b) => sport === "nba"
    ? ["averages", "totals", "miscellaneous"].indexOf(a.name) - ["averages", "totals", "miscellaneous"].indexOf(b.name)
    : allowed.indexOf(a.name) - allowed.indexOf(b.name));
  for (const category of categories) {
    if (sport === "nba") {
      const main = category.fields.filter(field => !shots.has(field.label.trim()));
      if (category.name === "averages" || category.name === "totals") {
        main.sort((a, b) => {
          const rank = (label: string) => nbaOrder.includes(label.trim()) ? nbaOrder.indexOf(label.trim()) : nbaOrder.length;
          return rank(a.label) - rank(b.label);
        });
        add(category, category.name === "averages" ? "Season averages" : "Season totals", main, category.name !== "averages", category.name === "averages" ? "Per game" : "Totals");
        add(category, category.name === "averages" ? "Shooting per game" : "Shooting totals", category.fields.filter(field => shots.has(field.label.trim())), true, category.name === "averages" ? "Per game" : "Totals");
      } else add(category, category.name.replaceAll("_", " "), category.fields, true, "Season");
    } else if (allowed.includes(category.name)) {
      if (category.name === "passing" && position !== "QB" && !hasPassingActivity(category)) continue;
      add(category, category.name.replaceAll("_", " "), category.fields, false, "Totals");
    }
  }
  if (sport === "nba") {
    const rank = (title: string) => ["Season averages", "Season totals", "Shooting per game", "Shooting totals"].includes(title) ? ["Season averages", "Season totals", "Shooting per game", "Shooting totals"].indexOf(title) : 4;
    tables.sort((a, b) => rank(a.title) - rank(b.title));
  }
  return tables;
}
