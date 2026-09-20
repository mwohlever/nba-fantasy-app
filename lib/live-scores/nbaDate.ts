export function easternToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
}

export function nbaDateKey(date: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date.replaceAll("-", "") : null;
}

/** Uses a midday UTC anchor so calendar arithmetic never depends on browser locale offsets. */
export function shiftNbaDate(date: string, days: number) {
  if (!nbaDateKey(date) || !Number.isInteger(days)) return null;
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
