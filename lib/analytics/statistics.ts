/** Pure utilities. Invalid evidence is an error, never silently a zero. */
export type WeightedValue = { value: number; weight: number };

function finite(value: number) {
  if (!Number.isFinite(value)) throw new Error("Expected finite numeric evidence");
}
function weight(value: number) {
  finite(value);
  if (value < 0) throw new Error("Negative weight");
}
export function weightedMean(rows: readonly WeightedValue[]): number | null {
  let sum = 0, total = 0;
  for (const row of rows) {
    finite(row.value); weight(row.weight);
    sum += row.value * row.weight; total += row.weight;
  }
  return total > 0 ? sum / total : null;
}
/** At an exact halfway boundary, return the midpoint of adjacent positive-weight values. */
export function weightedMedian(rows: readonly WeightedValue[]): number | null {
  for (const row of rows) { finite(row.value); weight(row.weight); }
  const sorted = rows.filter(row => row.weight > 0).slice().sort((a, b) => a.value - b.value);
  const half = sorted.reduce((sum, row) => sum + row.weight, 0) / 2;
  let cumulative = 0;
  for (let i = 0; i < sorted.length; i++) {
    cumulative += sorted[i].weight;
    if (cumulative === half && sorted[i + 1]) return (sorted[i].value + sorted[i + 1].value) / 2;
    if (cumulative >= half) return sorted[i].value;
  }
  return null;
}
export function weightedRatioOfTotals(rows: readonly {
  production: number; opportunity: number; weight: number;
}[]): number | null {
  let numerator = 0, denominator = 0;
  for (const row of rows) {
    finite(row.production); weight(row.opportunity); weight(row.weight);
    if (row.opportunity === 0 && row.production !== 0) throw new Error("Production without opportunity");
    numerator += row.weight * row.production;
    denominator += row.weight * row.opportunity;
  }
  return denominator > 0 ? numerator / denominator : null;
}
export function effectiveSampleSize(weights: readonly number[]): number {
  weights.forEach(weight);
  const sum = weights.reduce((a, b) => a + b, 0);
  const squares = weights.reduce((a, b) => a + b * b, 0);
  return squares > 0 ? sum * sum / squares : 0;
}
/** Caller supplies age in a consistent unit (days or appearances); future ages fail. */
export function recencyWeight(age: number, halfLife: number): number {
  weight(age); finite(halfLife);
  if (halfLife <= 0) throw new Error("Half-life must be positive");
  return 2 ** (-age / halfLife);
}
