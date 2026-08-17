export type GolfRoundLike = {
  round_number: number;
  holes_completed?: number | null;
  strokes?: number | null;
  tee_time?: string | null;
  tee_time_raw?: string | null;
  status?: string | null;
};

export type GolfStatusInput = {
  status?: string | null;
  current_round?: number | null;
  last_hole?: number | null;
  holes_completed?: number | null;
  rounds_completed?: number | null;
  tee_time?: string | null;
  tee_time_raw?: string | null;
  rounds?: GolfRoundLike[] | null;
};

export type GolfPlayerState =
  | "playing"
  | "upcoming"
  | "round_complete"
  | "finished"
  | "cut"
  | "withdrawn"
  | "disqualified"
  | "did_not_start";

export type GolfStatusMeta = {
  state: GolfPlayerState;
  label: string;
  compactLabel: string;
  detail: string;
  order: number;
  round: number | null;
  holes: number | null;
  teeTime: string | null;
  isLive: boolean;
  isFinished: boolean;
  isCut: boolean;
};

export function formatGolfTeeTime(
  rawValue: string | null | undefined,
  parsedValue?: string | null,
) {
  const raw = rawValue?.trim() ?? "";

  /*
   * PGA TOUR's tee-time page can explicitly label its source clock
   * as UTC, for example:
   *
   *   3:30 PM UTC
   *
   * In that case the parsed ISO value is the authoritative instant.
   * Convert that instant to the app's Eastern-time display convention
   * instead of stripping "UTC" and displaying the UTC clock as local.
   */
  if (
    /\\bUTC\\b/i.test(raw) &&
    parsedValue
  ) {
    const parsedUtc =
      new Date(parsedValue);

    if (
      !Number.isNaN(
        parsedUtc.getTime(),
      )
    ) {
      return parsedUtc.toLocaleTimeString(
        "en-US",
        {
          hour: "numeric",
          minute: "2-digit",
          timeZone:
            "America/New_York",
        },
      );
    }
  }

  /*
   * Prefer the source's tournament-local display clock.
   *
   * Examples:
   *   1:30 PM
   *   Sun 1:30 PM
   *   Sun Aug 02 13:30:00 PDT 2026
   *
   * This avoids accidentally converting a PGA TOUR local tee time
   * into another timezone.
   */
  const twelveHourMatch = raw.match(
    /(?:^|\s)(\d{1,2}:\d{2}\s*[AP]M)(?:\s|$)/i,
  );

  if (twelveHourMatch) {
    return twelveHourMatch[1]
      .replace(/\s+/g, " ")
      .toUpperCase();
  }

  const twentyFourHourMatch = raw.match(
    /(?:^|\s)(\d{1,2}):(\d{2})(?::\d{2})?\s+[A-Z]{2,5}(?:\s|$)/i,
  );

  if (twentyFourHourMatch) {
    const hour24 = Number(twentyFourHourMatch[1]);
    const minute = twentyFourHourMatch[2];

    if (
      Number.isInteger(hour24) &&
      hour24 >= 0 &&
      hour24 <= 23
    ) {
      const period = hour24 >= 12 ? "PM" : "AM";
      const hour12 = hour24 % 12 || 12;

      return `${hour12}:${minute} ${period}`;
    }
  }

  if (raw) {
    const parsedRaw = new Date(raw);

    if (!Number.isNaN(parsedRaw.getTime())) {
      return parsedRaw.toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
      });
    }
  }

  if (!parsedValue) {
    return null;
  }

  const parsed = new Date(parsedValue);

  if (Number.isNaN(parsed.getTime())) {
    return parsedValue;
  }

  /*
   * This is only the fallback when the provider did not give us its
   * preferred tournament-local raw clock. Current Golf slates use the
   * source-local raw value whenever it is available.
   */
  return parsed.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

function normalizedStatus(input: GolfStatusInput) {
  return String(input.status ?? "scheduled")
    .trim()
    .toLowerCase();
}

function sortedRounds(input: GolfStatusInput) {
  return [...(input.rounds ?? [])].sort(
    (a, b) =>
      Number(a.round_number) -
      Number(b.round_number),
  );
}

function aggregateRoundHoles(input: GolfStatusInput) {
  if (
    input.last_hole !== null &&
    input.last_hole !== undefined &&
    Number(input.last_hole) > 0
  ) {
    return Number(input.last_hole);
  }

  const total = Number(input.holes_completed ?? 0);

  if (total <= 0) return 0;

  const remainder = total % 18;

  return remainder === 0 ? 18 : remainder;
}

function result(
  state: GolfPlayerState,
  values: Omit<
    GolfStatusMeta,
    | "state"
    | "isLive"
    | "isFinished"
    | "isCut"
  >,
): GolfStatusMeta {
  return {
    state,
    ...values,
    isLive: state === "playing",
    isFinished: [
      "finished",
      "cut",
      "withdrawn",
      "disqualified",
      "did_not_start",
    ].includes(state),
    isCut: state === "cut",
  };
}

export function getGolfStatusMeta(
  input: GolfStatusInput | null | undefined,
): GolfStatusMeta {
  const stat = input ?? {};
  const status = normalizedStatus(stat);
  const rounds = sortedRounds(stat);

  const playingRound =
    rounds
      .filter(
        (round) =>
          Number(round.holes_completed ?? 0) > 0 &&
          Number(round.holes_completed ?? 0) < 18,
      )
      .at(-1) ?? null;

  const completedRound =
    rounds
      .filter(
        (round) =>
          Number(round.holes_completed ?? 0) >= 18 ||
          round.strokes !== null &&
            round.strokes !== undefined,
      )
      .filter(
        (round) =>
          Number(round.holes_completed ?? 0) >= 18,
      )
      .at(-1) ?? null;

  const upcomingRound =
    rounds.find(
      (round) =>
        Number(round.holes_completed ?? 0) === 0 &&
        (round.strokes === null ||
          round.strokes === undefined) &&
        (
          Boolean(
            round.tee_time ||
              round.tee_time_raw,
          ) ||
          String(
            round.status ?? "",
          ).toLowerCase() === "scheduled"
        ),
    ) ?? null;

  if (status === "cut") {
    return result("cut", {
      label: "✂ Cut",
      compactLabel: "CUT",
      detail: "Missed cut",
      order: 4,
      round:
        Number(stat.current_round ?? 0) || null,
      holes: null,
      teeTime: null,
    });
  }

  if (status === "withdrawn") {
    return result("withdrawn", {
      label: "⚠ WD",
      compactLabel: "WD",
      detail: "Withdrawn",
      order: 5,
      round:
        Number(stat.current_round ?? 0) || null,
      holes: null,
      teeTime: null,
    });
  }

  if (status === "disqualified") {
    return result("disqualified", {
      label: "⛔ DQ",
      compactLabel: "DQ",
      detail: "Disqualified",
      order: 6,
      round:
        Number(stat.current_round ?? 0) || null,
      holes: null,
      teeTime: null,
    });
  }

  if (status === "did_not_start") {
    return result("did_not_start", {
      label: "DNS",
      compactLabel: "DNS",
      detail: "Did not start",
      order: 7,
      round:
        Number(stat.current_round ?? 0) || null,
      holes: 0,
      teeTime: null,
    });
  }

  if (status === "finished") {
    return result("finished", {
      label: "✓ Final",
      compactLabel: "Final",
      detail: "Tournament complete",
      order: 3,
      round:
        Number(stat.current_round ?? 4) || 4,
      holes: 18,
      teeTime: null,
    });
  }

  if (playingRound) {
    const roundNumber =
      Number(playingRound.round_number);

    const holes =
      Number(
        playingRound.holes_completed ?? 0,
      );

    return result("playing", {
      label: "🟢 Playing",
      compactLabel:
        `R${roundNumber} · thru ${holes}`,
      detail:
        `R${roundNumber} · Thru ${holes}`,
      order: 0,
      round: roundNumber,
      holes,
      teeTime: null,
    });
  }

  const aggregateHoles =
    aggregateRoundHoles(stat);

  const currentRound =
    Number(
      stat.current_round ??
        Math.max(
          Number(
            stat.rounds_completed ?? 0,
          ) + 1,
          1,
        ),
    ) || 1;

  if (
    status === "active" &&
    aggregateHoles > 0 &&
    aggregateHoles < 18
  ) {
    return result("playing", {
      label: "🟢 Playing",
      compactLabel:
        `R${currentRound} · thru ${aggregateHoles}`,
      detail:
        `R${currentRound} · Thru ${aggregateHoles}`,
      order: 0,
      round: currentRound,
      holes: aggregateHoles,
      teeTime: null,
    });
  }

  /*
   * A real persisted upcoming round always wins over a stale
   * round_complete flag from the provider.
   */
  if (upcomingRound) {
    const roundNumber =
      Number(upcomingRound.round_number);

    const teeTime =
      formatGolfTeeTime(
        upcomingRound.tee_time_raw,
        upcomingRound.tee_time,
      );

    return result("upcoming", {
      label: "⏰ Upcoming",
      compactLabel:
        `R${roundNumber} · ` +
        (teeTime
          ? `Tee ${teeTime}`
          : "Upcoming"),
      detail:
        `R${roundNumber}` +
        (teeTime
          ? ` · Tee ${teeTime}`
          : " · Upcoming"),
      order: 1,
      round: roundNumber,
      holes: 0,
      teeTime,
    });
  }

  if (
    status === "scheduled" ||
    (
      aggregateHoles === 0 &&
      Number(
        stat.rounds_completed ?? 0,
      ) === 0
    )
  ) {
    const roundNumber =
      Math.max(
        1,
        Number(
          stat.current_round ??
            Number(
              stat.rounds_completed ?? 0,
            ) + 1,
        ),
      );

    const teeTime =
      formatGolfTeeTime(
        stat.tee_time_raw,
        stat.tee_time,
      );

    return result("upcoming", {
      label: "⏰ Upcoming",
      compactLabel:
        `R${roundNumber} · ` +
        (teeTime
          ? `Tee ${teeTime}`
          : "Upcoming"),
      detail:
        `R${roundNumber}` +
        (teeTime
          ? ` · Tee ${teeTime}`
          : " · Upcoming"),
      order: 1,
      round: roundNumber,
      holes: 0,
      teeTime,
    });
  }

  if (
    status === "round_complete" ||
    completedRound ||
    aggregateHoles === 18
  ) {
    const roundNumber =
      Number(
        completedRound?.round_number ??
          stat.current_round ??
          stat.rounds_completed ??
          1,
      );

    return result("round_complete", {
      label: "✓ Round complete",
      compactLabel:
        `R${roundNumber} complete`,
      detail:
        `Round ${roundNumber} complete`,
      order: 2,
      round: roundNumber,
      holes: 18,
      teeTime: null,
    });
  }

  const teeTime =
    formatGolfTeeTime(
      stat.tee_time_raw,
      stat.tee_time,
    );

  return result("upcoming", {
    label: "⏰ Upcoming",
    compactLabel:
      `R${currentRound} · ` +
      (teeTime
        ? `Tee ${teeTime}`
        : "Upcoming"),
    detail:
      `R${currentRound}` +
      (teeTime
        ? ` · Tee ${teeTime}`
        : " · Upcoming"),
    order: 1,
    round: currentRound,
    holes: 0,
    teeTime,
  });
}
