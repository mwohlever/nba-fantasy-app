type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Obj : {};
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
function count(value: unknown): number | null {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value.trim()))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export type NflFumbleAbsenceEvidence = "reconciled_category" | "team_zero_fumbles_lost";

/** Shared research/Player Center evidence. Absence alone never establishes zero. */
export function reconcileNflFumbleEvidence(input: { group: unknown; teamTotals: unknown[]; final: boolean }) {
  const group = obj(input.group), values: Record<string, number | null> = {}, conflicts = new Set<string>(), issues: string[] = [];
  const labels = list(group.labels), lostIndex = labels.indexOf("LOST"), fumIndex = labels.indexOf("FUM");
  const validGroup = Array.isArray(group.labels) && Array.isArray(group.athletes) &&
    labels.every(label => typeof label === "string") && new Set(labels).size === labels.length && lostIndex >= 0;
  let validCells = validGroup, sumLost = 0;
  for (const raw of list(group.athletes)) {
    const row = obj(raw), id = obj(row.athlete).id, stats = list(row.stats);
    if (typeof id !== "string" || !/^\d+$/.test(id)) { validCells = false; issues.push("invalid_fumbles_athlete"); continue; }
    const lost = validGroup && stats.length === labels.length ? count(stats[lostIndex]) : null;
    const fum = fumIndex >= 0 ? count(stats[fumIndex]) : null;
    if (Object.hasOwn(values, id)) { validCells = false; conflicts.add(id); values[id] = null; }
    else {
      values[id] = lost;
      if (lost === null || fumIndex >= 0 && (fum === null || fum < lost)) {
        validCells = false; values[id] = null; issues.push(`invalid_fumbles_lost:${id}`);
        // Unavailable evidence must not erase an explicit fact in another source.
        if (lost !== null && fum !== null && fum < lost) conflicts.add(id);
      }
      else sumLost += lost;
    }
  }
  const totals = list(group.totals), lostTotal = validGroup && totals.length === labels.length ? count(totals[lostIndex]) : null;
  const teamRows = input.teamTotals.map(obj);
  const cells = teamRows.length === 1 ? list(teamRows[0].statistics).map(obj).filter(s => s.name === "fumblesLost") : [];
  const aggregate = cells.length && cells.every(s => count(s.displayValue) !== null &&
    (!Object.hasOwn(s, "value") || count(s.value) === count(s.displayValue))) &&
    new Set(cells.map(s => count(s.displayValue))).size === 1 ? count(cells[0].displayValue) : null;
  if (cells.length && aggregate === null) issues.push("invalid_or_conflicting_team_fumbles_lost");
  if (aggregate !== null && validCells && lostTotal !== null && lostTotal !== aggregate) {
    validCells = false; issues.push("conflicting_fumbles_totals");
    for (const id of Object.keys(values)) conflicts.add(id);
  }
  if (aggregate === 0) {
    for (const [id, lost] of Object.entries(values)) if (lost !== null && lost > 0) { conflicts.add(id); validCells = false; }
  }
  for (const id of conflicts) { values[id] = null; issues.push(`conflicting_or_invalid_fumbles_lost:${id}`); }
  const categoryCells = [
    ...(totals.length ? [totals[lostIndex]] : []),
    ...list(group.athletes).map(row => list(obj(row).stats)[lostIndex]),
  ];
  // A final exact-team LOST=0 proves every individual loss zero, even if the
  // athlete category is omitted. Malformed/contradictory category cells veto it.
  const teamZero = input.final && aggregate === 0 && !conflicts.size &&
    (input.group === undefined || validCells && categoryCells.every(cell => count(cell) === 0));
  const reconciled = input.final && validCells && lostTotal !== null && sumLost === lostTotal && !conflicts.size &&
    (aggregate === null && !cells.length || aggregate === lostTotal);
  const absenceEvidence: NflFumbleAbsenceEvidence | null = teamZero ? "team_zero_fumbles_lost" : reconciled ? "reconciled_category" : null;
  return { values, conflicts: [...conflicts], absenceEvidence, issues };
}
