import type { EspnGameSummary, EspnStatGroup, EspnSummaryTeam } from "@/lib/providers/nfl";
import type { AggregatedNflStat } from "@/lib/aggregateEspnBoxscore";

const categories = {
  passing: { passing_yards: "YDS", passing_tds: "TD", passing_ints: "INT" },
  rushing: { rushing_yards: "YDS", rushing_tds: "TD" },
  receiving: { receiving_yards: "YDS", receiving_tds: "TD", receptions: "REC" },
  fumbles: { fumbles_lost: "LOST" },
} as const;
type Category = keyof typeof categories;
type StatField = Exclude<keyof AggregatedNflStat, "espnPlayerId" | "playerName">;
type OffensiveStats = Record<StatField, number>;
type Context = { eventId: string; playerId: string | null; category: string; reason: string };

export class NflBoxscoreValidationError extends Error {
  constructor(readonly context: Context) {
    super("NFL player boxscore incomplete");
  }
}

function fail(context: Omit<Context, "reason">, reason: string): never {
  throw new NflBoxscoreValidationError({ ...context, reason });
}

// Never let Number(null), Number("") or ESPN's "--" stand in for a measured zero.
function integer(value: unknown): number | null {
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function cell(group: EspnStatGroup, values: string[] | undefined, label: string) {
  return integer(values?.[group.labels.indexOf(label)]);
}

type TeamCategories = Map<Category, EspnStatGroup>;

/** Validate raw scoring cells before merging; placeholders must never become measured zeros. */
export function nflCategoryIndex(summary: EspnGameSummary, eventId: string) {
  const index = new Map<string, TeamCategories>();
  for (const team of summary.boxscore?.players ?? []) {
    const context = { eventId, playerId: null, category: "team" };
    const id = String(team?.team?.id ?? "");
    if (!id || index.has(id) || !Array.isArray(team.statistics)) fail(context, "missing_or_duplicate_team");
    const groups: TeamCategories = new Map();
    index.set(id, groups);
    for (const group of team.statistics) {
      if (!group || !Object.hasOwn(categories, group.name)) continue;
      const category = group.name as Category;
      const context = { eventId, playerId: null, category };
      if (groups.has(category) || !Array.isArray(group.athletes)) fail(context, "missing_or_duplicate_category");
      groups.set(category, group);
      if (!Array.isArray(group.labels) || new Set(group.labels).size !== group.labels.length)
        fail(context, "missing_or_duplicate_labels");
      const ids = new Set<string>();
      for (const athlete of group.athletes) {
        const id = String(athlete?.athlete?.id ?? "");
        const context = { eventId, playerId: id || null, category };
        if (!id || ids.has(id) || !Array.isArray(athlete.stats)) fail(context, "missing_or_duplicate_athlete");
        ids.add(id);
        for (const label of Object.values(categories[category])) {
          const value = cell(group, athlete.stats, label);
          if (value === null || (label !== "YDS" && value < 0)) fail(context, "invalid_scoring_cell");
        }
      }
      // ESPN emits empty categories with totals: [] when no stats exist yet.
      // Leave these unproven; clearing accepted stats still requires complete totals below.
      if (group.athletes.length && group.totals !== undefined) assertCategoryTotals(group, category, context);
    }
  }
  return index;
}

/** Reconcile additive columns only; averages, ratings and longest plays are not sums. */
function assertCategoryTotals(group: EspnStatGroup, category: Category, context: Omit<Context, "reason">) {
  if (!Array.isArray(group.totals)) fail(context, "missing_category_totals");
  const total = (label: string) => {
    const value = cell(group, group.totals, label);
    if (value === null || (label !== "YDS" && value < 0)) fail(context, "invalid_category_total");
    return value;
  };
  const sum = (label: string) => group.athletes.reduce((sum, athlete) => {
    const value = cell(group, athlete.stats, label);
    if (value === null || (label !== "YDS" && value < 0)) fail(context, "invalid_athlete_cell");
    return sum + value;
  }, 0);
  const reconcile = (label: string, expected = total(label)) => {
    if (sum(label) !== expected) fail(context, "category_does_not_reconcile");
  };
  const pair = (values: string[] | undefined, label: string, separator: string) => {
    const raw = values?.[group.labels.indexOf(label)];
    if (!raw || !/^\d+[/-]\d+$/.test(raw) || !raw.includes(separator)) fail(context, "invalid_category_pair");
    const result = raw.split(separator).map(Number);
    if (result.some(value => !Number.isSafeInteger(value))) fail(context, "invalid_category_pair");
    return result;
  };
  if (category === "passing") {
    // ESPN's passing total YDS is NET; individual passing YDS is GROSS.
    const sacks = pair(group.totals, "SACKS", "-");
    reconcile("YDS", total("YDS") + sacks[1]);
    reconcile("TD");
    reconcile("INT");
    for (const [label, separator] of [["SACKS", "-"], ["C/ATT", "/"]]) {
      const totals = pair(group.totals, label, separator);
      const sums = group.athletes.reduce((sum, athlete) => {
        const values = pair(athlete.stats, label, separator);
        return [sum[0] + values[0], sum[1] + values[1]];
      }, [0, 0]);
      if (sums.some((value, i) => value !== totals[i])) fail(context, "category_pair_does_not_reconcile");
    }
  } else {
    for (const label of Object.values(categories[category])) reconcile(label);
    if (category === "rushing") reconcile("CAR");
    if (category === "fumbles") reconcile("FUM");
  }
}

/** Missing rows and downward corrections also need corroborating team-level evidence. */
function assertCompleteCategory(
  group: EspnStatGroup | undefined,
  team: EspnSummaryTeam | undefined,
  groups: TeamCategories,
  category: Category,
  context: Omit<Context, "reason">,
) {
  if (!group || !Array.isArray(group.totals)) fail(context, "correction_missing_category_totals");
  assertCategoryTotals(group, category, context);
  if (!team || !Array.isArray(team.statistics)) fail(context, "correction_missing_team_totals");
  const total = (label: string) => cell(group, group.totals, label)!;
  const teamTotal = (name: string) => {
    const rows = team.statistics!.filter(stat => stat.name === name);
    const values = rows.map(stat => integer(stat.displayValue));
    // ESPN can repeat a team statistic; all copies must agree.
    if (!values.length || values.some(value => value === null || value !== values[0]))
      fail(context, "correction_missing_or_conflicting_team_total");
    return values[0]!;
  };
  if (category === "rushing") {
    if (total("YDS") !== teamTotal("rushingYards") || total("CAR") !== teamTotal("rushingAttempts"))
      fail(context, "correction_rushing_team_totals_do_not_reconcile");
  } else if (category === "fumbles") {
    if (total("LOST") !== teamTotal("fumblesLost")) fail(context, "correction_fumbles_do_not_reconcile");
  } else {
    const sacks = team.statistics.filter(stat => stat.name === "sacksYardsLost");
    const raw = sacks[0]?.displayValue;
    if (!raw || !/^\d+-\d+$/.test(raw) || sacks.some(stat => stat.displayValue !== raw))
      fail(context, "correction_missing_or_conflicting_sack_losses");
    const netYards = teamTotal("netPassingYards");
    if (category === "passing") {
      if (total("YDS") !== netYards || group.totals[group.labels.indexOf("SACKS")] !== raw)
        fail(context, "correction_passing_team_totals_do_not_reconcile");
      if (total("INT") !== teamTotal("interceptions")) fail(context, "correction_interceptions_do_not_reconcile");
    } else if (total("YDS") !== netYards + Number(raw.split("-")[1])) {
      fail(context, "correction_receiving_team_yards_do_not_reconcile");
    }
    // Zero-yard receptions and touchdowns need count evidence as well as yardage.
    const passing = groups.get("passing");
    const receiving = groups.get("receiving");
    if (!passing || !receiving) fail(context, "correction_missing_passing_or_receiving_category");
    assertCategoryTotals(passing, "passing", context);
    assertCategoryTotals(receiving, "receiving", context);
    const completions = Number(passing.totals![passing.labels.indexOf("C/ATT")].split("/")[0]);
    if (cell(passing, passing.totals, "YDS") !== netYards ||
        passing.totals![passing.labels.indexOf("SACKS")] !== raw ||
        completions !== cell(receiving, receiving.totals, "REC") ||
        cell(passing, passing.totals, "TD") !== cell(receiving, receiving.totals, "TD") ||
        cell(receiving, receiving.totals, "YDS") !== netYards + Number(raw.split("-")[1]))
      fail(context, "correction_passing_and_receiving_do_not_reconcile");
  }
}

export function mergeNflPlayerCategories({
  groups, team, playerId, eventId, prior,
}: {
  groups: TeamCategories;
  team: EspnSummaryTeam | undefined;
  playerId: string;
  eventId: string;
  prior: OffensiveStats;
}): OffensiveStats {
  const next = { ...prior };
  for (const category of Object.keys(categories) as Category[]) {
    const fields = Object.entries(categories[category]) as [StatField, string][];
    const group = groups.get(category);
    const athlete = group?.athletes.find(row => String(row.athlete.id) === playerId);
    const hadStats = fields.some(([field]) => Number(prior[field]));
    if (!athlete && !hadStats) continue;
    const values = fields.map(([field, label]) => [field, athlete ? cell(group!, athlete.stats, label)! : 0] as const);
    const correction = !athlete || values.some(([field, value]) =>
      value < Number(prior[field]) || (value === 0 && Number(prior[field]) !== 0));
    if (correction) assertCompleteCategory(group, team, groups, category, { eventId, playerId, category });
    for (const [field, value] of values) next[field] = value;
  }
  return next;
}
