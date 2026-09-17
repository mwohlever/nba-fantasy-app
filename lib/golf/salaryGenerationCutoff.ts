export type GolfSalaryGenerationCutoff = {
  cutoffAt: string;
  source: 'authoritative_tee_time' | 'start_date_fallback';
};

function validTeeTime(value: unknown): value is string {
  return typeof value === 'string' && value.includes('T') && Number.isFinite(Date.parse(value));
}

/**
 * Salary generation and Golf acquisition share the imported field's earliest
 * tee time. A slate date remains a deliberately conservative fallback until
 * that authoritative field evidence exists.
 */
export function resolveGolfSalaryGenerationCutoff(input: {
  startDate: string;
  teeTimes: readonly unknown[];
}): GolfSalaryGenerationCutoff {
  const earliestTeeTime = input.teeTimes
    .filter(validTeeTime)
    .sort((left, right) => Date.parse(left) - Date.parse(right))[0];
  if (earliestTeeTime) return { cutoffAt: new Date(earliestTeeTime).toISOString(), source: 'authoritative_tee_time' };
  return { cutoffAt: `${input.startDate}T00:00:00.000Z`, source: 'start_date_fallback' };
}

export function canGenerateGolfSalariesAt(input: {
  asOfAt: string;
  cutoffAt: string;
  nowAt?: string;
}) {
  const asOf = Date.parse(input.asOfAt);
  const cutoff = Date.parse(input.cutoffAt);
  const now = Date.parse(input.nowAt ?? new Date().toISOString());
  return Number.isFinite(asOf) && Number.isFinite(cutoff) && Number.isFinite(now) && asOf < cutoff && asOf <= now;
}
