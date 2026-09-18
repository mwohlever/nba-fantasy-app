export type GolfLiveStatusInput = {
  status?: string | null;
  statusState?: string | null;
  statusLabel?: string | null;
  teeTime?: string | null;
  progressHoles?: number | null;
  lastHole?: number | null;
  holesCompleted?: number | null;
};

export type GolfLiveRound = {
  round_number: number;
  holes_completed?: number | null;
  tee_time?: string | null;
  tee_time_raw?: string | null;
  status?: string | null;
};

export type GolfLiveTournamentPlayer = {
  status?: string | null;
  current_round?: number | null;
  rounds?: GolfLiveRound[] | null;
};

export type GolfLiveLeaderboardOrderRow = {
  playerId: number;
  name: string;
  score: number | null;
  status?: string | null;
  providerPosition?: number | null;
};

export type GolfLiveLeaderboardRank = {
  position: number | null;
  positionDisplay: string | null;
};

const terminalStates = new Set([
  "cut",
  "withdrawn",
  "disqualified",
  "did_not_start",
  "finished",
]);

const unrankedLeaderboardStatuses = new Set([
  "withdrawn",
  "disqualified",
  "did_not_start",
]);

/**
 * Order the Live presentation by accepted tournament score and calculate
 * standard competition ranks from that same score. Provider order remains a
 * fallback only for terminal/no-score rows, whose legacy presentation is not
 * a live scoring rank.
 */
export function orderGolfLiveLeaderboard<T extends GolfLiveLeaderboardOrderRow>(
  rows: T[],
): Array<T & GolfLiveLeaderboardRank> {
  const ranked = rows
    .filter((row) => {
      const score = Number(row.score);
      return (
        row.score !== null &&
        row.score !== undefined &&
        Number.isFinite(score) &&
        !unrankedLeaderboardStatuses.has(String(row.status ?? "").toLowerCase())
      );
    })
    .sort((a, b) => {
      const scoreDifference = Number(a.score) - Number(b.score);
      if (scoreDifference !== 0) return scoreDifference;

      const nameDifference = a.name.localeCompare(b.name);
      if (nameDifference !== 0) return nameDifference;

      return Number(a.playerId) - Number(b.playerId);
    });

  const countByScore = new Map<number, number>();
  ranked.forEach((row) => {
    const score = Number(row.score);
    countByScore.set(score, (countByScore.get(score) ?? 0) + 1);
  });

  const rankByPlayerId = new Map<number, GolfLiveLeaderboardRank>();
  ranked.forEach((row, index) => {
    const previous = ranked[index - 1];
    const position =
      previous && Number(previous.score) === Number(row.score)
        ? rankByPlayerId.get(previous.playerId)!.position!
        : index + 1;
    const tied = (countByScore.get(Number(row.score)) ?? 0) > 1;

    rankByPlayerId.set(row.playerId, {
      position,
      positionDisplay: tied ? `T${position}` : String(position),
    });
  });

  const unranked = rows.filter((row) => !rankByPlayerId.has(row.playerId));

  return [
    ...ranked.map((row) => ({ ...row, ...rankByPlayerId.get(row.playerId)! })),
    ...unranked.map((row) => ({
      ...row,
      position: row.providerPosition ?? null,
      positionDisplay:
        row.providerPosition === null || row.providerPosition === undefined
          ? null
          : String(row.providerPosition),
    })),
  ];
}

/** Resolve the active tournament round, not each golfer's last completed one. */
export function resolveGolfLiveTournamentRound(players: GolfLiveTournamentPlayer[]) {
  const activeRounds = players.flatMap((player) => {
    if (String(player.status ?? "").toLowerCase() !== "active") return [];
    const round = Number(player.current_round ?? 0);
    return round >= 1 && round <= 4 ? [round] : [];
  });
  if (activeRounds.length) return Math.max(...activeRounds);

  const scheduledRounds = players.flatMap((player) => {
    if (terminalStates.has(String(player.status ?? "").toLowerCase())) return [];
    const round = Number(player.current_round ?? 0);
    return round >= 1 && round <= 4 ? [round] : [];
  });
  if (scheduledRounds.length) return Math.max(...scheduledRounds);

  const acceptedRounds = players.flatMap((player) =>
    (player.rounds ?? []).flatMap((round) => {
      const roundNumber = Number(round.round_number);
      return Number(round.holes_completed ?? 0) > 0 && roundNumber >= 1 && roundNumber <= 4
        ? [roundNumber]
        : [];
    }),
  );
  return acceptedRounds.length ? Math.max(...acceptedRounds) : 1;
}

/** Build the Live-only status for one exact tournament round. */
export function getGolfLiveRoundStatus(input: {
  status?: string | null;
  round: GolfLiveRound | null | undefined;
  formatTeeTime: (raw: string | null | undefined, parsed: string | null | undefined) => string | null;
}) {
  const status = String(input.status ?? "").trim().toLowerCase();
  if (status === "cut") return { statusState: "cut", progressHoles: null, teeTime: null };
  if (status === "withdrawn") return { statusState: "withdrawn", progressHoles: null, teeTime: null };
  if (status === "disqualified") return { statusState: "disqualified", progressHoles: null, teeTime: null };
  if (status === "did_not_start") return { statusState: "did_not_start", progressHoles: 0, teeTime: null };
  if (status === "finished") return { statusState: "finished", progressHoles: 18, teeTime: null };

  const holes = Math.max(0, Number(input.round?.holes_completed ?? 0));
  if (holes >= 18) return { statusState: "round_complete", progressHoles: 18, teeTime: null };
  if (holes > 0) return { statusState: "playing", progressHoles: holes, teeTime: null };
  return {
    statusState: "upcoming",
    progressHoles: 0,
    teeTime: input.formatTeeTime(input.round?.tee_time_raw, input.round?.tee_time),
  };
}

/** Format accepted Golf state for a compact, golf-native leaderboard row. */
export function formatGolfLiveProgress(input: GolfLiveStatusInput) {
  const rawStatus = String(input.status ?? "").trim().toLowerCase();
  const state = String(input.statusState ?? "").trim().toLowerCase();

  if (/playoff/.test(rawStatus)) return "Playoff";
  if (state === "cut" || rawStatus === "cut") return "CUT";
  if (state === "withdrawn" || rawStatus === "withdrawn") return "WD";
  if (state === "disqualified" || rawStatus === "disqualified") return "DQ";
  if (state === "did_not_start" || rawStatus === "did_not_start") return "DNS";

  if (state === "upcoming") return input.teeTime?.trim() || "Upcoming";

  const hole = Number(
    input.progressHoles ?? input.lastHole ?? input.holesCompleted ?? 0,
  );
  if (state === "playing" && hole > 0 && hole < 18) return `thru ${hole}`;
  if (
    state === "round_complete" ||
    state === "finished" ||
    rawStatus === "finished" ||
    hole === 18
  ) {
    return "F";
  }

  const fallback = input.statusLabel?.trim();
  return fallback && !/thru\s*0/i.test(fallback) ? fallback : "Upcoming";
}
