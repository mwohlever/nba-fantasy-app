type SlateDateFields = {
  date?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

function parseDateParts(value: string) {
  const [year, month, day] = value.split("-").map(Number);

  if (!year || !month || !day) return null;

  return {
    year,
    month,
    day,
    date: new Date(Date.UTC(year, month - 1, day)),
  };
}

function monthName(date: Date) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
}

export function formatSlateDateLabel(
  slate: SlateDateFields | null | undefined
) {
  const startValue =
    slate?.start_date ??
    slate?.date ??
    "";

  const endValue =
    slate?.end_date ??
    slate?.date ??
    startValue;

  if (!startValue) return "Unknown slate";

  const start = parseDateParts(startValue);
  const end = parseDateParts(endValue);

  if (!start || !end) {
    return startValue === endValue
      ? startValue
      : `${startValue} - ${endValue}`;
  }

  if (
    start.year === end.year &&
    start.month === end.month &&
    start.day === end.day
  ) {
    return `${monthName(start.date)} ${start.day}, ${start.year}`;
  }

  if (
    start.year === end.year &&
    start.month === end.month
  ) {
    return `${monthName(start.date)} ${start.day}-${end.day}, ${start.year}`;
  }

  if (start.year === end.year) {
    return `${monthName(start.date)} ${start.day} - ${monthName(
      end.date
    )} ${end.day}, ${start.year}`;
  }

  return `${monthName(start.date)} ${start.day}, ${start.year} - ${monthName(
    end.date
  )} ${end.day}, ${end.year}`;
}

/** Display only: persisted NFL week identity is independent of its provider date window. */
export function formatFantasySlateLabel(slate: SlateDateFields & {
  sport?: string | null; display_name?: string | null; label?: string | null;
}) {
  if (slate.sport === "nfl") {
    const identity = slate.display_name?.trim() || slate.label?.trim();
    const week = identity?.match(/^(?:\d{4}\s+)?Week\s+(\d+)$/i);
    if (week) return `Week ${Number(week[1])}`;
    // Legacy date-based slates have no authoritative week identity to invent.
    return identity || formatSlateDateLabel(slate);
  }
  if (slate.sport === "golf" && slate.display_name) return slate.display_name;
  return formatSlateDateLabel(slate);
}
